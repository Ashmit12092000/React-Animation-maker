import { useEffect, useRef, useState, useCallback } from "react";
import { useEditorStore } from "@/stores/editorStore";
import {
  X, Play, Pause, SkipBack, SkipForward,
} from "lucide-react";
import { cn } from "@/utils/utils";

// ─── Easing ───────────────────────────────────────────────────────────────────
// Smooth ease-in-out cubic: slow start, fast middle, slow end
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ─── Scene Progress Bar ───────────────────────────────────────────────────────

function SceneProgressBar({
  scenes,
  activeIdx,
  sceneProgress,
}: {
  scenes: any[];
  activeIdx: number;
  sceneProgress: number;
}) {
  const total = scenes.reduce((s, sc) => s + sc.duration, 0);

  return (
    <div className="flex w-full h-1.5 rounded-full overflow-hidden gap-px bg-white/10">
      {scenes.map((sc, i) => {
        const pct = (sc.duration / total) * 100;
        const isActive = i === activeIdx;
        const isDone = i < activeIdx;

        return (
          <div
            key={sc.id}
            className="relative overflow-hidden rounded-sm"
            style={{ width: `${pct}%` }}
          >
            <div className="absolute inset-0 bg-white/20" />
            {isDone && <div className="absolute inset-0 bg-primary" />}
            {isActive && (
              <div
                className="absolute inset-y-0 left-0 bg-primary"
                style={{ width: `${sceneProgress * 100}%` }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ScenePreviewPlayer({ onClose }: { onClose: () => void }) {
  const scenes         = useEditorStore(s => s.scenes);
  const setActiveScene = useEditorStore(s => s.setActiveScene);
  const setCurrentTime = useEditorStore(s => s.setCurrentTime);
  const applyKF        = useEditorStore(s => s.applyKeyframesAtTime);
  const setIsPlaying   = useEditorStore(s => s.setIsPlaying);
  // Subscribe to scene-restore state so the RAF loop can pause during loads
  const sceneRestoring = useEditorStore(s => s.sceneRestoring);

  // The scene that was active when preview opened — restored on close
  const originalSceneIdRef = useRef(useEditorStore.getState().activeSceneId);

  const [sceneIdx, setSceneIdx]     = useState(0);
  const [playing, setPlaying]       = useState(true);
  const [sceneTime, setSceneTime]   = useState(0);   // ms elapsed in current scene

  // ── Mirror canvas: composites Fabric + PIXI canvases into preview display ──
  // The editor canvases live inside the normal app layout. Rather than trying
  // to make them visible through a fullscreen overlay (which z-index tricks
  // can't reliably solve because they're in a different stacking context), we
  // copy their pixels into our own <canvas> on every RAF tick via drawImage().
  const mirrorCanvasRef    = useRef<HTMLCanvasElement>(null);
  // Frozen pixel snapshot of the *outgoing* scene — composited on top during transitions
  const snapshotCanvasRef  = useRef<HTMLCanvasElement | null>(null);

  const rafRef          = useRef<number>(0);
  const lastWallRef     = useRef<number>(0);
  const transitionRef   = useRef<{ startWall: number; duration: number; type: string; phase: "out" | "in"; nextIdx: number } | null>(null);
  const sceneIdxRef     = useRef(0);
  const playingRef      = useRef(true);
  // Mirror of sceneRestoring for use inside RAF callback (avoids stale closure)
  const sceneRestoringRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { sceneIdxRef.current = sceneIdx; }, [sceneIdx]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { sceneRestoringRef.current = sceneRestoring; }, [sceneRestoring]);

  // On mount: save current canvas state, then go to scene 0, t=0.
  useEffect(() => {
    if (scenes.length === 0) return;

    // Save the current scene's canvas before preview hijacks activeSceneId,
    // so CanvasEditor has fresh JSON when it restores on close.
    const store = useEditorStore.getState();
    const currentCanvas = store.canvas;
    if (currentCanvas) {
      try {
        const json = JSON.stringify(currentCanvas.toJSON());
        store.saveSceneCanvasData(store.activeSceneId, json);
      } catch (_) {}
    }

    setCurrentTime(0);
    setSceneTime(0);
    setSceneIdx(0);
    sceneIdxRef.current = 0;
    setActiveScene(scenes[0].id);
    // Do NOT call setIsPlaying(true) here — Timeline's loop and the Preview
    // loop would race. We drive time ourselves via RAF below.
  }, []); // eslint-disable-line

  // ── Grab live editor pixels into a destination canvas ───────────────────
  const drawLiveInto = useCallback((dst: HTMLCanvasElement) => {
    const ctx = dst.getContext("2d");
    if (!ctx) return;
    const fabricEl = document.querySelector<HTMLCanvasElement>("[data-canvas-role='fabric']");
    const lowerEl  = fabricEl?.parentElement?.querySelector<HTMLCanvasElement>(".lower-canvas") ?? fabricEl;
    const pixiEl   = document.querySelector<HTMLCanvasElement>("[data-canvas-role='pixi']");
    ctx.clearRect(0, 0, dst.width, dst.height);
    if (lowerEl) { try { ctx.drawImage(lowerEl, 0, 0, dst.width, dst.height); } catch (_) {} }
    if (pixiEl)  { try { ctx.drawImage(pixiEl,  0, 0, dst.width, dst.height); } catch (_) {} }
  }, []);

  // ── Canvas mirror: composites live scene + outgoing snapshot each frame ───
  // Strategy: live canvas (scene 2) is always drawn first as the base layer.
  // The snapshot of scene 1 is drawn ON TOP with a transition effect applied.
  // This gives true two-scene compositing for slide/zoom/wipe/fade.
  const drawMirror = useCallback((trType?: string, trPhase?: "out" | "in", trRaw?: number) => {
    const dst = mirrorCanvasRef.current;
    if (!dst) return;
    const ctx = dst.getContext("2d");
    if (!ctx) return;
    const W = dst.width, H = dst.height;

    // ── No transition: plain live draw ──────────────────────────────────────
    if (!trType || trType === "none" || trRaw === undefined) {
      drawLiveInto(dst);
      return;
    }

    const t    = easeInOut(Math.min(1, Math.max(0, trRaw)));
    const snap = snapshotCanvasRef.current;

    // Base layer: incoming scene (live canvas), full size, no transform
    drawLiveInto(dst);

    if (!snap) return; // nothing to composite

    ctx.save();

    switch (trType) {

      // ── FADE ──────────────────────────────────────────────────────────────
      // Outgoing snapshot fades from opacity 1 → 0 over the full transition.
      // We collapse both "out" and "in" phases into a single 0→1 progress so
      // there is no visible seam when the scene switches mid-transition.
      case "fade": {
        // trPhase "out": t goes 0→1  → alpha 1→0
        // trPhase "in":  t goes 0→1  → snap already 0 alpha, nothing to draw
        if (trPhase === "out") {
          ctx.globalAlpha = 1 - t;
          ctx.drawImage(snap, 0, 0, W, H);
        }
        // "in" phase: live scene is already drawn; snapshot is invisible
        break;
      }

      // ── SLIDE ─────────────────────────────────────────────────────────────
      // Both scenes slide together: outgoing moves left, incoming moves right-to-0.
      // We achieve this by drawing live (incoming) shifted, then snap on top shifted.
      case "slide": {
        if (trPhase === "out") {
          // Redraw live shifted in from right side
          ctx.clearRect(0, 0, W, H);
          const inX = (1 - t) * W;   // incoming: W → 0
          const offIn = document.createElement("canvas");
          offIn.width = W; offIn.height = H;
          drawLiveInto(offIn);
          ctx.drawImage(offIn, inX, 0, W, H);
          // Outgoing snapshot slides out to the left: 0 → -W
          const outX = -t * W;
          ctx.drawImage(snap, outX, 0, W, H);
        }
        // "in": scene switch already happened; live is at position 0, looks normal
        break;
      }

      // ── ZOOM ──────────────────────────────────────────────────────────────
      // Outgoing zooms and fades out; incoming zooms and fades in underneath.
      case "zoom": {
        if (trPhase === "out") {
          // Redraw live (incoming) at scale 1.3→1 with opacity 0→1
          ctx.clearRect(0, 0, W, H);
          const scaleIn = 1.3 - t * 0.3;     // 1.3 → 1.0
          const offZin = document.createElement("canvas");
          offZin.width = W; offZin.height = H;
          drawLiveInto(offZin);
          ctx.save();
          ctx.globalAlpha = t;               // 0 → 1
          ctx.translate(W / 2, H / 2);
          ctx.scale(scaleIn, scaleIn);
          ctx.drawImage(offZin, -W / 2, -H / 2, W, H);
          ctx.restore();
          // Outgoing snapshot zooms out (scale 1→1.3) and fades out (1→0)
          const scaleOut = 1 + t * 0.3;      // 1.0 → 1.3
          ctx.save();
          ctx.globalAlpha = 1 - t;           // 1 → 0
          ctx.translate(W / 2, H / 2);
          ctx.scale(scaleOut, scaleOut);
          ctx.drawImage(snap, -W / 2, -H / 2, W, H);
          ctx.restore();
        }
        // "in": live is already drawn at full scale/opacity
        break;
      }

      // ── WIPE ──────────────────────────────────────────────────────────────
      // Outgoing is revealed from right to left: a rectangular clip shrinks.
      // Incoming scene is already fully drawn underneath — no separate "in".
      case "wipe": {
        if (trPhase === "out") {
          const visibleW = Math.round((1 - t) * W); // shrinks left to right
          if (visibleW > 0) {
            ctx.beginPath();
            ctx.rect(0, 0, visibleW, H);
            ctx.clip();
            ctx.drawImage(snap, 0, 0, W, H);
          }
        }
        break;
      }

      default:
        break;
    }

    ctx.restore();
  }, [drawLiveInto]);

  // Main RAF loop
  const tick = useCallback((wall: number) => {
    // Always mirror the canvas each frame — pass current transition state for compositing
    const _tr = transitionRef.current;
    if (_tr) {
      const _elapsed  = wall - _tr.startWall;
      const _progress = Math.min(1, _elapsed / (_tr.duration || 1));
      drawMirror(_tr.type, _tr.phase, _progress);
    } else {
      drawMirror();
    }

    // Pause the playback logic while CanvasEditor is reloading canvas for a
    // scene switch. Keep the RAF running so the mirror keeps drawing (it shows
    // the loading spinner / partial state rather than a black freeze).
    if (sceneRestoringRef.current) {
      lastWallRef.current = wall; // keep wall clock up to date so dt is correct on resume
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    const dt = lastWallRef.current ? wall - lastWallRef.current : 16;
    lastWallRef.current = wall;

    const idx = sceneIdxRef.current;
    const sc  = scenes[idx];
    if (!sc) return;

    // ── In transition ──────────────────────────────────────────────────────
    if (transitionRef.current) {
      const tr       = transitionRef.current;
      const elapsed  = wall - tr.startWall;
      const progress = Math.min(1, elapsed / tr.duration);

      // Drive re-render so React re-renders and drawMirror gets called with fresh progress

      if (progress >= 1) {
        if (tr.phase === "out") {
          // Snapshot was already captured when transition started.
          // Switch to next scene now — canvas will update to scene 2.
          const nextSc = scenes[tr.nextIdx];
          if (!nextSc) { transitionRef.current = null; return; }
          setSceneIdx(tr.nextIdx);
          sceneIdxRef.current = tr.nextIdx;
          setActiveScene(nextSc.id);
          setCurrentTime(0);
          setSceneTime(0);
          transitionRef.current = {
            startWall: wall, duration: tr.duration,
            type: tr.type, phase: "in", nextIdx: tr.nextIdx,
          };
        } else {
          // Transition done — clear everything
          transitionRef.current = null;
          snapshotCanvasRef.current = null;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    // ── Normal playback ────────────────────────────────────────────────────
    if (!playingRef.current) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    setSceneTime(prev => {
      const next = prev + dt;

      if (next >= sc.duration) {
        // Scene finished — call applyKF at the exact end time so that path
        // characters reach clampedT=1 and trigger their arrival animation
        // (idle/keep) before we leave this scene.
        const endSec = sc.duration / 1000;
        setCurrentTime(endSec);
        applyKF(endSec);

        // Move to next or stop
        const nextIdx = idx + 1;
        if (nextIdx >= scenes.length) {
          // All scenes done — stop
          playingRef.current = false;
          setPlaying(false);
          setIsPlaying(false);
          return sc.duration;
        }

        // Start transition — type is stored on the *incoming* scene
        const tType = (scenes[nextIdx]?.transition) ?? "none";
        const tDuration = tType === "none" ? 0 : 800; // ms

        if (tType !== "none") {
          // Capture a frozen pixel snapshot of the outgoing scene RIGHT NOW,
          // before setActiveScene() switches the live canvas to scene 2.
          const snap = document.createElement("canvas");
          snap.width  = mirrorCanvasRef.current?.width  ?? 960;
          snap.height = mirrorCanvasRef.current?.height ?? 540;
          const snapCtx = snap.getContext("2d");
          if (snapCtx && mirrorCanvasRef.current) {
            snapCtx.drawImage(mirrorCanvasRef.current, 0, 0);
          }
          snapshotCanvasRef.current = snap;
        }

        transitionRef.current = {
          startWall: wall, duration: tDuration,
          type: tType, phase: "out", nextIdx,
        };
        return sc.duration;
      }

      // Normal advance
      const tSec = next / 1000;
      setCurrentTime(tSec);
      applyKF(tSec);
      return next;
    });

    rafRef.current = requestAnimationFrame(tick);
  }, [scenes, setActiveScene, setCurrentTime, applyKF, setIsPlaying, drawMirror]);

  useEffect(() => {
    lastWallRef.current = 0;
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
    };
  }, [tick]);

  const handlePlayPause = () => {
    const next = !playing;
    setPlaying(next);
    playingRef.current = next;
    setIsPlaying(next);
  };

  const handlePrevScene = () => {
    const prev = Math.max(0, sceneIdx - 1);
    setSceneIdx(prev);
    sceneIdxRef.current = prev;
    setActiveScene(scenes[prev].id);
    setCurrentTime(0);
    // No applyKF(0) — setActiveScene already updated Zustand activeSceneId,
    // so applyKF would add the new scene's objects before CanvasEditor clears.
    setSceneTime(0);
    transitionRef.current = null;
    snapshotCanvasRef.current = null;
  };

  const handleNextScene = () => {
    const next = Math.min(scenes.length - 1, sceneIdx + 1);
    setSceneIdx(next);
    sceneIdxRef.current = next;
    setActiveScene(scenes[next].id);
    setCurrentTime(0);
    // No applyKF(0) — same reason as handlePrevScene above.
    setSceneTime(0);
    transitionRef.current = null;
    snapshotCanvasRef.current = null;
  };

  const handleClose = () => {
    cancelAnimationFrame(rafRef.current);
    setIsPlaying(false);
    setPlaying(false);
    setCurrentTime(0);
    // Do NOT call applyKF(0) here — activeSceneId is still pointing at whatever
    // scene the preview last played, so applyKF would add that scene's objects
    // onto the canvas right before CanvasEditor saves it as the leaving scene.
    // CanvasEditor's afterLoad callback calls applyKeyframesAtTime itself once
    // the correct scene JSON has been fully restored.
    setActiveScene(originalSceneIdRef.current);
    onClose();
  };

  const sc = scenes[sceneIdx];
  const sceneProgress = sc ? Math.min(1, sceneTime / sc.duration) : 0;
  const totalMs = scenes.reduce((s, sc) => s + sc.duration, 0);
  const elapsed = scenes.slice(0, sceneIdx).reduce((s, sc) => s + sc.duration, 0) + sceneTime;
  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  };



  // Canvas dimensions — match the editor canvas (960×540)
  const CANVAS_W = 960;
  const CANVAS_H = 540;

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center">
      {/* Canvas area */}
      <div className="relative flex-1 flex items-center justify-center w-full overflow-hidden">

        {/* Mirror canvas — composites Fabric + PIXI pixels from the live editor */}
        <div
          className="relative"
          style={{
            // Letterbox: fit 960×540 inside available space
            maxWidth: "100%",
            maxHeight: "100%",
            aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
          }}
        >
          <canvas
            ref={mirrorCanvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={{ display: "block", width: "100%", height: "100%" }}
          />
        </div>

        {/* Loading indicator shown while scene canvas is being restored */}
        {sceneRestoring && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Scene label */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm rounded-full px-4 py-1.5 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-[11px] font-semibold text-white/90">
            {sc?.label ?? "—"} &nbsp;·&nbsp; Scene {sceneIdx + 1} / {scenes.length}
          </span>
        </div>

        {/* Close */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
        >
          <X className="w-4 h-4 text-white" />
        </button>
      </div>

      {/* Controls bar */}
      <div className="w-full bg-black/90 backdrop-blur-sm border-t border-white/10 px-6 py-3 flex flex-col gap-2">
        {/* Progress */}
        <SceneProgressBar scenes={scenes} activeIdx={sceneIdx} sceneProgress={sceneProgress} />

        <div className="flex items-center justify-between">
          {/* Time */}
          <span className="text-[10px] font-mono text-white/50">
            {fmt(elapsed)} / {fmt(totalMs)}
          </span>

          {/* Controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={handlePrevScene}
              disabled={sceneIdx === 0}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-30 transition-colors"
            >
              <SkipBack className="w-4 h-4 text-white" />
            </button>

            <button
              onClick={handlePlayPause}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-primary hover:bg-primary/80 transition-colors shadow-lg"
            >
              {playing
                ? <Pause className="w-5 h-5 text-primary-foreground" />
                : <Play  className="w-5 h-5 text-primary-foreground ml-0.5" />
              }
            </button>

            <button
              onClick={handleNextScene}
              disabled={sceneIdx === scenes.length - 1}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-30 transition-colors"
            >
              <SkipForward className="w-4 h-4 text-white" />
            </button>
          </div>

          {/* Scene chips */}
          <div className="flex items-center gap-1">
            {scenes.map((s, i) => (
              <button
                key={s.id}
                onClick={() => {
                  setSceneIdx(i);
                  sceneIdxRef.current = i;
                  setActiveScene(s.id);
                  setCurrentTime(0);
                  // No applyKF(0) — same race as handlePrevScene/handleNextScene.
                  setSceneTime(0);
                  transitionRef.current = null;
                  snapshotCanvasRef.current = null;
                }}
                className={cn(
                  "w-5 h-5 rounded-full text-[8px] font-bold transition-all",
                  i === sceneIdx
                    ? "bg-primary text-primary-foreground scale-110"
                    : "bg-white/20 text-white/60 hover:bg-white/30"
                )}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}