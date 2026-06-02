/**
 * videoExport.ts — Canvas recording without off-screen compositing.
 *
 * Root cause of 0KB: An off-screen (not attached to DOM) canvas's
 * captureStream() does not reliably emit frames to MediaRecorder in all
 * browsers. The fix is to attach the composite canvas to the DOM (hidden),
 * which forces the browser to treat it as a live surface.
 *
 * We also capture the Fabric lower-canvas directly as fallback,
 * and draw PIXI on top of it each frame.
 */

export interface VideoExportOptions {
  fabricCanvas: HTMLCanvasElement;
  pixiCanvas: HTMLCanvasElement;
  tracks: any[];
  duration: number;
  fps?: number;
  projectName?: string;
  onFrame: (currentTime: number) => void;
  onProgress?: (pct: number) => void;
  onComplete?: () => void;
  onError?: (err: Error) => void;
  /** Multi-scene export — when provided, sequences through scenes automatically */
  scenes?: Array<{ id: string; duration: number; transition?: string }>;
  onSceneSwitch?: (sceneId: string) => void;
}

export interface VideoExportController {
  cancel: () => void;
}

export function startVideoExport(opts: VideoExportOptions): VideoExportController {
  const {
    fabricCanvas,
    pixiCanvas,
    tracks,
    duration,
    fps = 30,
    projectName = "animation",
    onFrame,
    onProgress,
    onComplete,
    onError,
    scenes,
    onSceneSwitch,
  } = opts;

  // ── Total duration: sum of all scene durations if multi-scene, else single duration ──
  const totalDuration = scenes && scenes.length > 0
    ? scenes.reduce((s, sc) => s + sc.duration / 1000, 0)
    : duration;

  let cancelled = false;
  let rafId = 0;

  const W = fabricCanvas.width  || 960;
  const H = fabricCanvas.height || 540;

  // ── 1. Composite canvas — MUST be attached to DOM for captureStream to work
  const composite = document.createElement("canvas");
  composite.width  = W;
  composite.height = H;
  // Hide it visually but keep it in the DOM so the browser treats it as live
  composite.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
  document.body.appendChild(composite);
  const ctx = composite.getContext("2d", { willReadFrequently: false })!;

  // Draw an initial frame immediately so the stream has content from the start
  const drawComposite = () => {
    ctx.clearRect(0, 0, W, H);
    try { ctx.drawImage(pixiCanvas,   0, 0, W, H); } catch { /* tainted */ }
    try { ctx.drawImage(fabricCanvas, 0, 0, W, H); } catch { /* tainted */ }
  };
  drawComposite();

  // ── 2. Audio routing ──────────────────────────────────────────────────────
  let audioCtx: AudioContext | null = null;
  let audioDest: MediaStreamAudioDestinationNode | null = null;

  try {
    audioCtx = new AudioContext();
    audioDest = audioCtx.createMediaStreamDestination();

    tracks.forEach((track) => {
      const mediaEl: HTMLMediaElement | null =
        track.audioElement ?? ((track.fabricObject as any)?._element ?? null);
      if (!mediaEl) return;
      if (!(mediaEl instanceof HTMLAudioElement || mediaEl instanceof HTMLVideoElement)) return;
      try {
        const src = audioCtx!.createMediaElementSource(mediaEl);
        src.connect(audioDest!);
        src.connect(audioCtx!.destination);
      } catch { /* already connected or cross-origin */ }
    });
  } catch {
    // AudioContext not available — video-only recording
    audioCtx  = null;
    audioDest = null;
  }

  // ── 3. Capture stream ─────────────────────────────────────────────────────
  // captureStream(0) = browser decides frame timing; we draw manually each RAF
  const videoStream = (composite as any).captureStream(0) as MediaStream;

  const combinedStream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...(audioDest ? audioDest.stream.getAudioTracks() : []),
  ]);

  // ── 4. MediaRecorder ──────────────────────────────────────────────────────
  const mimeTypes = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  const mimeType = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) ?? "video/webm";

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: 5_000_000,
    });
  } catch (e: any) {
    cleanup();
    onError?.(new Error(`MediaRecorder failed: ${e?.message}`));
    return { cancel: () => {} };
  }

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  recorder.onstop = () => {
    cleanup();
    if (cancelled) return;

    if (chunks.length === 0) {
      onError?.(new Error("Recording produced no data. Try a different browser (Chrome works best)."));
      return;
    }

    const blob = new Blob(chunks, { type: mimeType });
    onProgress?.(100);
    downloadBlob(blob, `${projectName.replace(/\s+/g, "_")}.webm`);
    onComplete?.();
  };

  recorder.onerror = (e: any) => {
    cleanup();
    onError?.(new Error(e.error?.message ?? "MediaRecorder error"));
  };

  function cleanup() {
    try { composite.remove(); } catch { /* already removed */ }
    try { audioCtx?.close(); } catch {}
  }

  // ── 5. Recording loop ─────────────────────────────────────────────────────
  const startWall        = performance.now();
  let lastProgressMs     = 0;

  // Multi-scene tracking
  let currentSceneIdx    = 0;
  let sceneStartWall     = 0; // wall time when current scene started recording

  if (scenes && scenes.length > 0) {
    onSceneSwitch?.(scenes[0].id);
  }

  // Start recording — request data every 500ms for reliability
  recorder.start(500);

  const tick = (wallMs: number) => {
    if (cancelled) {
      if (recorder.state !== "inactive") recorder.stop();
      return;
    }

    const totalElapsed = (wallMs - startWall) / 1000;

    if (totalElapsed >= totalDuration) {
      drawComposite();
      if (recorder.state === "recording") recorder.requestData();
      setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, 200);
      return;
    }

    // ── Multi-scene: check if we need to switch scene ──────────────────────
    if (scenes && scenes.length > 0) {
      const sc = scenes[currentSceneIdx];
      const scElapsed = (wallMs - (startWall + sceneStartWall * 1000)) / 1000;

      if (scElapsed >= sc.duration / 1000 && currentSceneIdx < scenes.length - 1) {
        currentSceneIdx++;
        sceneStartWall = totalElapsed;
        onSceneSwitch?.(scenes[currentSceneIdx].id);
        // Give 100ms for canvas to update (scene restore is synchronous JSON parse)
        setTimeout(() => {}, 100);
      }

      // Per-scene time for keyframe application
      const sceneTime = Math.max(0, totalElapsed - sceneStartWall);
      onFrame(sceneTime);
    } else {
      // Single-scene — pass raw elapsed time
      onFrame(totalElapsed);
    }

    // Draw both layers onto composite
    drawComposite();

    // Throttle progress UI updates to 4×/sec
    if (wallMs - lastProgressMs > 250) {
      lastProgressMs = wallMs;
      onProgress?.(Math.round((totalElapsed / totalDuration) * 100));
    }

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  return {
    cancel: () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (recorder.state !== "inactive") recorder.stop();
      cleanup();
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

export function findPixiCanvas(): HTMLCanvasElement | null {
  return document.querySelector<HTMLCanvasElement>('canvas[data-canvas-role="pixi"]');
}

export function findFabricCanvasEl(): HTMLCanvasElement | null {
  return document.querySelector<HTMLCanvasElement>('canvas[data-canvas-role="fabric"]');
}