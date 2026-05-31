import { useEffect, useRef, useState, useCallback } from "react";
import { Check, X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

interface BackgroundCropModalProps {
  imageElement: HTMLImageElement;
  canvasWidth: number;
  canvasHeight: number;
  onApply: (offsetX: number, offsetY: number, scale: number) => void;
  onClose: () => void;
}

const MODAL_PREVIEW_W = 720;
const MODAL_PREVIEW_H = 405; // 16:9 to match typical canvas

export function BackgroundCropModal({
  imageElement,
  canvasWidth,
  canvasHeight,
  onApply,
  onClose,
}: BackgroundCropModalProps) {
  const previewRef = useRef<HTMLCanvasElement>(null);

  // Scale the canvas preview to fit in the modal
  const aspectRatio = canvasWidth / canvasHeight;
  const previewW = MODAL_PREVIEW_W;
  const previewH = Math.round(MODAL_PREVIEW_W / aspectRatio);

  // Cover scale: minimum scale so image fills the preview frame completely
  const naturalW = imageElement.naturalWidth || imageElement.width;
  const naturalH = imageElement.naturalHeight || imageElement.height;
  const coverScale = Math.max(previewW / naturalW, previewH / naturalH);

  const [scale, setScale] = useState(coverScale);
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // offset of image center from frame center
  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, ox: 0, oy: 0 });

  // Clamp offset so image never reveals empty space
  const clampOffset = useCallback(
    (ox: number, oy: number, s: number) => {
      const imgW = naturalW * s;
      const imgH = naturalH * s;
      const maxX = (imgW - previewW) / 2;
      const maxY = (imgH - previewH) / 2;
      return {
        x: Math.max(-maxX, Math.min(maxX, ox)),
        y: Math.max(-maxY, Math.min(maxY, oy)),
      };
    },
    [naturalW, naturalH, previewW, previewH],
  );

  // Draw preview
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = previewW;
    canvas.height = previewH;

    ctx.clearRect(0, 0, previewW, previewH);

    const imgW = naturalW * scale;
    const imgH = naturalH * scale;
    const drawX = (previewW - imgW) / 2 + offset.x;
    const drawY = (previewH - imgH) / 2 + offset.y;

    ctx.drawImage(imageElement, drawX, drawY, imgW, imgH);
  }, [scale, offset, imageElement, naturalW, naturalH, previewW, previewH]);

  // Mouse drag handlers
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    dragStart.current = { mx: e.clientX, my: e.clientY, ox: offset.x, oy: offset.y };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - dragStart.current.mx;
      const dy = e.clientY - dragStart.current.my;
      const clamped = clampOffset(
        dragStart.current.ox + dx,
        dragStart.current.oy + dy,
        scale,
      );
      setOffset(clamped);
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [scale, clampOffset]);

  const adjustZoom = (delta: number) => {
    setScale((prev) => {
      const next = Math.max(coverScale, Math.min(coverScale * 3, prev + delta * coverScale));
      setOffset((o) => clampOffset(o.x, o.y, next));
      return next;
    });
  };

  const reset = () => {
    setScale(coverScale);
    setOffset({ x: 0, y: 0 });
  };

  const handleApply = () => {
    // Convert preview-space offset/scale back to real canvas-space values
    // previewScale = previewW / canvasWidth
    const previewScale = previewW / canvasWidth;
    const realScale = scale / previewScale;
    const realOffsetX = offset.x / previewScale;
    const realOffsetY = offset.y / previewScale;
    onApply(realOffsetX, realOffsetY, realScale);
  };

  const zoomPercent = Math.round((scale / coverScale) * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        style={{
          background: "#141420",
          border: "1px solid rgba(255,255,255,0.08)",
          width: previewW + 48,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <div>
            <h2 className="text-white font-semibold text-sm tracking-wide">Set as Background</h2>
            <p className="text-white/40 text-xs mt-0.5">Drag to reposition · scroll or use buttons to zoom</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Canvas preview */}
        <div className="px-6 pt-5 pb-4">
          <div
            className="relative overflow-hidden rounded-xl"
            style={{
              width: previewW,
              height: previewH,
              cursor: "grab",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.1), 0 8px 32px rgba(0,0,0,0.5)",
            }}
            onMouseDown={onMouseDown}
          >
            <canvas
              ref={previewRef}
              style={{ display: "block", width: previewW, height: previewH }}
            />

            {/* Rule-of-thirds grid overlay */}
            <div className="absolute inset-0 pointer-events-none" style={{ opacity: 0.12 }}>
              <svg width="100%" height="100%">
                <line x1="33.3%" y1="0" x2="33.3%" y2="100%" stroke="white" strokeWidth="1" />
                <line x1="66.6%" y1="0" x2="66.6%" y2="100%" stroke="white" strokeWidth="1" />
                <line x1="0" y1="33.3%" x2="100%" y2="33.3%" stroke="white" strokeWidth="1" />
                <line x1="0" y1="66.6%" x2="100%" y2="66.6%" stroke="white" strokeWidth="1" />
              </svg>
            </div>

            {/* Corner frame indicators */}
            {[
              { top: 8, left: 8, deg: 0 },
              { top: 8, right: 8, deg: 90 },
              { bottom: 8, right: 8, deg: 180 },
              { bottom: 8, left: 8, deg: 270 },
            ].map(({ deg, ...pos }, i) => (
              <div
                key={i}
                className="absolute w-5 h-5 pointer-events-none"
                style={{
                  ...pos,
                  borderTop: "2px solid rgba(255,255,255,0.6)",
                  borderLeft: "2px solid rgba(255,255,255,0.6)",
                  transform: `rotate(${deg}deg)`,
                  borderRadius: "2px 0 0 0",
                }}
              />
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between px-6 pb-5">
          {/* Zoom controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => adjustZoom(-0.1)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-all border border-white/[0.06]"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-white/40 text-xs w-10 text-center tabular-nums">{zoomPercent}%</span>
            <button
              onClick={() => adjustZoom(0.1)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-all border border-white/[0.06]"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-4 bg-white/[0.08] mx-1" />
            <button
              onClick={reset}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-all border border-white/[0.06]"
              title="Reset to fit"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="h-8 px-4 rounded-lg text-xs font-medium text-white/50 hover:text-white hover:bg-white/[0.06] transition-all border border-white/[0.06]"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="h-8 px-5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all"
              style={{
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                color: "white",
                boxShadow: "0 2px 12px rgba(99,102,241,0.4)",
              }}
            >
              <Check className="w-3.5 h-3.5" />
              Apply Background
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}