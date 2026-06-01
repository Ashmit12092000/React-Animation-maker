/**
 * gifRenderer.ts
 *
 * Implements high-performance GIF handling matching specialized canvas editors.
 * Bypasses error-prone Javascript pixel patch rendering loop calculations by using
 * native image source caching, running at a fluid frame rate with clean colors.
 */

import { FabricImage } from "fabric";
import type { Canvas as FabricCanvas } from "fabric";
import { parseGIF, decompressFrames } from "gifuct-js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedFrame {
  canvas: HTMLCanvasElement; // fully pre-rendered snapshot of the frame
  delay: number;             // ms duration to display this frame
}

// ─── Highly Optimized GIF frame decoder ───────────────────────────────────────

async function decodeGifFrames(blob: Blob): Promise<ParsedFrame[]> {
  const arrayBuffer = await blob.arrayBuffer();
  const gif         = parseGIF(arrayBuffer);
  const frames      = decompressFrames(gif, true); // true = build out full color/transparency patches

  if (!frames.length) throw new Error("GIF has no valid frames");

  const { width, height } = frames[0].dims;

  // Master accumulation canvas mimicking browser-level composition layout
  const backing    = document.createElement("canvas");
  backing.width    = width;
  backing.height   = height;
  const backingCtx = backing.getContext("2d")!;

  // Temporary container used to avoid putImageData alpha-blending corruption
  const patchCanvas = document.createElement("canvas");
  const patchCtx    = patchCanvas.getContext("2d")!;

  // Buffer track for Disposal Method 3 (Restore to Previous Frame state)
  const restoreCanvas = document.createElement("canvas");
  restoreCanvas.width = width;
  restoreCanvas.height = height;
  const restoreCtx    = restoreCanvas.getContext("2d")!;

  const parsed: ParsedFrame[] = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const { dims, disposalType, delay, patch } = frame;

    // --- EXECUTE PRE-FRAME DISPOSAL ACTIONS ---
    if (i > 0 && frames[i - 1].disposalType === 3) {
      // Revert backing track back to the previously snapshotted state
      backingCtx.clearRect(0, 0, width, height);
      backingCtx.drawImage(restoreCanvas, 0, 0);
    }

    // Save previous snapshot right before modifying if this frame requires disposal type 3
    if (disposalType === 3) {
      restoreCtx.clearRect(0, 0, width, height);
      restoreCtx.drawImage(backing, 0, 0);
    }

    // --- SECURE BITMAP INJECTION ---
    // Extract patch array into an isolated bounds canvas
    patchCanvas.width = dims.width;
    patchCanvas.height = dims.height;
    const imgData = patchCtx.createImageData(dims.width, dims.height);
    imgData.data.set(patch);
    patchCtx.putImageData(imgData, 0, 0);

    // Blit patch array onto master with proper compositing
    backingCtx.drawImage(patchCanvas, dims.left, dims.top);

    // --- PERMANENT HARDWARE-SNAPSHOT CACHING ---
    // Canva ensures smooth playback by flattening each layer to a flat, static bitmap canvas upfront.
    const snap = document.createElement("canvas");
    snap.width = width;
    snap.height = height;
    const snapCtx = snap.getContext("2d")!;
    snapCtx.drawImage(backing, 0, 0);

    // Calculate timing safely, mapping zero delays to browser baseline defaults
    const frameDelay = delay === 0 || delay === undefined ? 80 : Math.max(delay * 10, 10);

    parsed.push({
      canvas: snap,
      delay: frameDelay,
    });

    // --- EXECUTE POST-FRAME DISPOSAL ACTIONS ---
    if (disposalType === 2) {
      // Clear specific bounds area back to fully transparent
      backingCtx.clearRect(dims.left, dims.top, dims.width, dims.height);
    }
  }

  // Optimize execution memory footprints by releasing intermediate working tracks
  patchCanvas.width = 0;
  patchCanvas.height = 0;
  restoreCanvas.width = 0;
  restoreCanvas.height = 0;
  backing.width = 0;
  backing.height = 0;

  return parsed;
}

// ─── AnimatedGifImage ─────────────────────────────────────────────────────────

export class AnimatedGifImage extends FabricImage {
  private _gifFrames: ParsedFrame[]    = [];
  private _gifFrameIndex               = 0;
  private _gifTimer: any               = null;
  private _gifFabricCanvas: FabricCanvas | null = null;
  private _lastTickTime: number        = 0;

  // ── Rendering Pipeline ─────────────────────────────────────────────────────

  /**
   * Overridden draw fill rule execution. Because objectCaching is configured to false,
   * Fabric bypasses local storage buffers and sends this straight to the screen viewport.
   */
  _renderFill(ctx: CanvasRenderingContext2D) {
    const frame = this._gifFrames[this._gifFrameIndex];
    if (!frame) return;

    const w = this.width!;
    const h = this.height!;
    
    // Draw the static pre-composited frame directly
    ctx.drawImage(
      frame.canvas,
      0, 0, frame.canvas.width, frame.canvas.height,
      -w / 2, -h / 2, w, h
    );
  }

  // ── High Performance Playback Controls ─────────────────────────────────────

  /** Hooks element rendering into the core system loop */
  play(fabricCanvas: FabricCanvas) {
    if (this._gifTimer !== null) return; 
    this._gifFabricCanvas = fabricCanvas;
    this._lastTickTime = performance.now();
    this._loop();
  }

  /** Halts current active playback loops safely */
  stop() {
    if (this._gifTimer !== null) {
      cancelAnimationFrame(this._gifTimer);
      this._gifTimer = null;
    }
  }

  /**
   * requestAnimationFrame Precision Loop
   * Mimics standard engine animation loops by tracking precise delta-time values. 
   * This completely avoids the layout delays and micro-stutters caused by setTimeout.
   */
  private _loop = () => {
    if (!this._gifFrames.length || !this._gifFabricCanvas) return;

    const now = performance.now();
    const elapsed = now - this._lastTickTime;
    const currentFrameDelay = this._gifFrames[this._gifFrameIndex].delay;

    if (elapsed >= currentFrameDelay) {
      // Advance to the next frame, handling loop wraps
      this._gifFrameIndex = (this._gifFrameIndex + 1) % this._gifFrames.length;
      
      // Calculate residual remainder delta to maintain precise timing across frames
      this._lastTickTime = now - (elapsed % currentFrameDelay);

      // Force-invalidate only this item's layout space on the canvas
      this.dirty = true;
      this._gifFabricCanvas.requestRenderAll();
    }

    this._gifTimer = requestAnimationFrame(this._loop);
  };

  // ── Lifecycle State Hydration ──────────────────────────────────────────────

  _loadFrames(frames: ParsedFrame[]) {
    this._gifFrames     = frames;
    this._gifFrameIndex = 0;
  }

  reset() {
    this._gifFrameIndex = 0;
    this.dirty = true;
  }
}

// ─── Public Instantiation Factory ────────────────────────────────────────────

/**
 * Parses, builds, and initializes a ready-to-render AnimatedGifImage asset wrapper.
 * Invoke immediately upon completing asset additions:
 * const asset = await createAnimatedGif(blob); canvas.add(asset); asset.play(canvas);
 */
export async function createAnimatedGif(
  blob: Blob,
  opts: { left?: number; top?: number; targetSize?: number } = {},
): Promise<AnimatedGifImage> {
  const frames     = await decodeGifFrames(blob);
  const firstFrame = frames[0].canvas;
  const targetSize = opts.targetSize ?? 200;
  const scale      = Math.min(
    targetSize / firstFrame.width,
    targetSize / firstFrame.height,
  );

  const gifImg = new AnimatedGifImage(
    firstFrame as unknown as HTMLImageElement,
    {
      left:          opts.left ?? 100,
      top:           opts.top  ?? 100,
      scaleX:        scale,
      scaleY:        scale,
      objectCaching: false, // Prevents Fabric from generating duplicate local textures on every frame
    },
  );

  gifImg._loadFrames(frames);
  return gifImg;
}