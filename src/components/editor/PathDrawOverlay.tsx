import { useRef, useState, useCallback, useEffect } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { smoothPoints, buildCumulativeLengths } from "@/utils/pathAnimation";
import type { PathPoint } from "@/types";
import { toast } from "sonner";

interface Props {
  canvasWidth: number;
  canvasHeight: number;
}

export function PathDrawOverlay({ canvasWidth, canvasHeight }: Props) {
  const { pathDrawMode, pathDrawTargetId, setPathDrawMode, assignPathToTrack, tracks } =
    useEditorStore();

  const svgRef = useRef<SVGSVGElement>(null);
  const [rawPoints, setRawPoints] = useState<PathPoint[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [previewD, setPreviewD] = useState("");

  useEffect(() => {
    if (!pathDrawMode) {
      setRawPoints([]);
      setPreviewD("");
      setDrawing(false);
    }
  }, [pathDrawMode]);

  /**
   * Convert a pointer screen-position to Fabric canvas-space coordinates.
   * We read the bounding rect of the <svg> (which sits exactly over the
   * <canvas> element) and scale from CSS pixels → canvas logical pixels.
   * This accounts for any CSS transform / zoom on the canvas wrapper.
   */
  const ptFromEvent = useCallback(
    (e: React.PointerEvent<SVGSVGElement>): PathPoint => {
      const rect = svgRef.current!.getBoundingClientRect();
      // CSS-pixel size of the rendered canvas element
      const cssW = rect.width;
      const cssH = rect.height;
      // Map to Fabric's logical canvas dimensions
      const scaleX = canvasWidth / cssW;
      const scaleY = canvasHeight / cssH;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      return { x, y };
    },
    [canvasWidth, canvasHeight],
  );

  const buildD = (pts: PathPoint[]) => {
    if (pts.length < 2) return "";
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
    }
    return d;
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pathDrawMode) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = ptFromEvent(e);
    setRawPoints([pt]);
    setDrawing(true);
    setPreviewD(`M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing) return;
    e.preventDefault();
    const pt = ptFromEvent(e);
    setRawPoints((prev) => {
      const next = [...prev, pt];
      setPreviewD(buildD(next));
      return next;
    });
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (!drawing) return;
    setDrawing(false);

    if (rawPoints.length < 5) {
      toast.error("Path too short — draw a longer stroke.");
      setRawPoints([]);
      setPreviewD("");
      return;
    }

    const smoothed = smoothPoints(rawPoints, 7);
    const cumLengths = buildCumulativeLengths(smoothed);
    const totalLength = cumLengths[cumLengths.length - 1];

    if (!pathDrawTargetId) {
      toast.error("No target track selected.");
      setPathDrawMode(false);
      return;
    }

    assignPathToTrack(pathDrawTargetId, {
      points: smoothed,
      totalLength,
      orientToPath: false,
      speed: 0
    });

    toast.success("Path assigned! Press Play to preview.");
    setPathDrawMode(false);
    setRawPoints([]);
    setPreviewD("");
  };

  if (!pathDrawMode) return null;

  const track = tracks.find((t) => t.id === pathDrawTargetId);

  return (
    <div className="absolute inset-0 z-50" style={{ cursor: "crosshair" }}>
      {/* Instruction banner */}
      <div
        className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full text-sm font-semibold shadow-lg pointer-events-none"
        style={{
          background: "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
          color: "#fff",
          boxShadow: "0 4px 24px rgba(99,102,241,0.5)",
          letterSpacing: "0.02em",
        }}
      >
        ✏️ Draw a path for{" "}
        <span style={{ color: "#fde68a" }}>{track?.name ?? "object"}</span>
        &nbsp;·&nbsp;Release to confirm&nbsp;·&nbsp;
        <span
          className="pointer-events-auto cursor-pointer underline"
          onClick={() => setPathDrawMode(false)}
          style={{ color: "#fca5a5" }}
        >
          Cancel
        </span>
      </div>

      {/*
        The SVG viewBox matches Fabric's logical canvas size exactly.
        preserveAspectRatio="none" ensures the viewBox stretches to fill the
        rendered <canvas> element (which may be CSS-scaled by the browser),
        so our ptFromEvent mapping stays accurate.
      */}
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, display: "block" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Tinted overlay */}
        <rect
          x={0}
          y={0}
          width={canvasWidth}
          height={canvasHeight}
          fill="rgba(99,102,241,0.06)"
          stroke="rgba(99,102,241,0.3)"
          strokeWidth={2}
          strokeDasharray="8 6"
          rx={4}
        />

        {previewD && (
          <>
            {/* Glow */}
            <path
              d={previewD}
              fill="none"
              stroke="rgba(167,139,250,0.35)"
              strokeWidth={14}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Core dashed line */}
            <path
              d={previewD}
              fill="none"
              stroke="#a78bfa"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="6 3"
            />
            {/* Start dot */}
            {rawPoints.length > 0 && (
              <circle
                cx={rawPoints[0].x}
                cy={rawPoints[0].y}
                r={6}
                fill="#a78bfa"
                opacity={0.9}
              />
            )}
            {/* Arrow at current tip */}
            {rawPoints.length > 1 &&
              (() => {
                const last = rawPoints[rawPoints.length - 1];
                const prev =
                  rawPoints[Math.max(0, rawPoints.length - 5)];
                const dx = last.x - prev.x;
                const dy = last.y - prev.y;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                const ux = dx / len,
                  uy = dy / len;
                const perp = 7,
                  back = 14;
                return (
                  <polygon
                    points={`
                      ${last.x},${last.y}
                      ${last.x - back * ux + perp * uy},${last.y - back * uy - perp * ux}
                      ${last.x - back * ux - perp * uy},${last.y - back * uy + perp * ux}
                    `}
                    fill="#a78bfa"
                    opacity={0.9}
                  />
                );
              })()}
          </>
        )}
      </svg>
    </div>
  );
}