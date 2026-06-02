import { useEffect, useRef, useState, useCallback } from "react";
import { useEditorStore } from "@/stores/editorStore";
import {
  X, Play, Pause, SkipBack, SkipForward,
} from "lucide-react";
import { cn } from "@/utils/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TransitionOverlayState {
  active: boolean;
  type: string;
  phase: "out" | "in";
}

// ─── Transition CSS ───────────────────────────────────────────────────────────

function getTransitionStyle(
  type: string,
  phase: "out" | "in",
  progress: number // 0→1
): React.CSSProperties {
  const t = Math.min(1, Math.max(0, progress));

  switch (type) {
    case "fade":
      return { opacity: phase === "out" ? 1 - t : t, transition: "none" };

    case "slide":
      return {
        transform: phase === "out"
          ? `translateX(${-t * 100}%)`
          : `translateX(${(1 - t) * 100}%)`,
        transition: "none",
      };

    case "zoom":
      return {
        transform: phase === "out"
          ? `scale(${1 + t * 0.3})`
          : `scale(${1.3 - t * 0.3})`,
        opacity: phase === "out" ? 1 - t : t,
        transition: "none",
      };

    case "wipe":
      return {
        clipPath: phase === "out"
          ? `inset(0 ${t * 100}% 0 0)`
          : `inset(0 ${(1 - t) * 100}% 0 0)`,
        transition: "none",
      };

    default: // "none" / "cut"
      return {};
  }
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
  const [overlay, setOverlay]       = useState<TransitionOverlayState>({
    active: false, type: "fade", phase: "out",
  });

  // ── Mirror canvas: composites Fabric + PIXI canvases into preview display ──
  // The editor canvases live inside the normal app layout. Rather than trying
  // to make them visible through a fullscreen overlay (which z-index tricks
  // can't reliably solve because they're in a different stacking context), we
  // copy their pixels into our own <canvas> on every RAF tick via drawImage().
  const mirrorCanvasRef = useRef<HTMLCanvasElement>(null);

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

  // ── Canvas mirror: draw Fabric + PIXI pixels into our preview canvas ──────
  const drawMirror = useCallback(() => {
    const dst = mirrorCanvasRef.current;
    if (!dst) return;
    const ctx = dst.getContext("2d");
    if (!ctx) return;

    // Locate the live editor canvases by their data attributes
    const fabricEl = document.querySelector<HTMLCanvasElement>("[data-canvas-role='fabric']");
    // Fabric v6 wraps the user canvas in a container; the actual painted canvas
    // is the lower canvas (Fabric draws there, not on canvasRef directly).
    const lowerEl  = fabricEl?.parentElement?.querySelector<HTMLCanvasElement>(".lower-canvas") ?? fabricEl;
    const pixiEl   = document.querySelector<HTMLCanvasElement>("[data-canvas-role='pixi']");

    ctx.clearRect(0, 0, dst.width, dst.height);

    // Draw background + fabric objects
    if (lowerEl) {
      try { ctx.drawImage(lowerEl, 0, 0, dst.width, dst.height); } catch (_) {}
    }
    // Composite PIXI on top (transparent background, so characters/props appear)
    if (pixiEl) {
      try { ctx.drawImage(pixiEl, 0, 0, dst.width, dst.height); } catch (_) {}
    }
  }, []);

  // Main RAF loop
  const tick = useCallback((wall: number) => {
    // Always mirror the canvas each frame so the display stays live
    drawMirror();

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

      setOverlay({ active: true, type: tr.type, phase: tr.phase });

      if (progress >= 1) {
        if (tr.phase === "out") {
          // Switch scene, start "in" phase.
          // Do NOT call applyKF(0) here: setActiveScene() updates Zustand's
          // activeSceneId synchronously, so applyKF would immediately add the
          // new scene's fabricObjects to the canvas before CanvasEditor has
          // cleared it. That contaminates the leaving scene's saved JSON.
          // CanvasEditor's afterLoad callback handles applyKeyframesAtTime.
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
          // Transition done
          transitionRef.current = null;
          setOverlay({ active: false, type: "none", phase: "out" });
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

        // Start transition
        const tType = sc.transition ?? "fade";
        const tDuration = tType === "none" ? 0 : 400; // ms
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
    setOverlay({ active: false, type: "none", phase: "out" });
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
    setOverlay({ active: false, type: "none", phase: "out" });
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

  // Transition overlay progress
  const trProgress = transitionRef.current
    ? Math.min(1, (performance.now() - transitionRef.current.startWall) / transitionRef.current.duration)
    : 1;

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
            ...(overlay.active ? getTransitionStyle(overlay.type, overlay.phase, trProgress) : {}),
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
                  setOverlay({ active: false, type: "none", phase: "out" });
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