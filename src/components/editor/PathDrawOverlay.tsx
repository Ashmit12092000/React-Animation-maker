import { useRef, useState, useCallback, useEffect } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { smoothPoints, buildCumulativeLengths } from "@/utils/pathAnimation";
import type { PathPoint } from "@/types";
import { toast } from "sonner";
import { CharacterPathPopup } from "./CharacterPathPopup";
import { CharacterSequencePopup } from "./CharacterSequencePopup";

interface Props {
  canvasWidth:  number;
  canvasHeight: number;
}

export function PathDrawOverlay({ canvasWidth, canvasHeight }: Props) {
  const {
    pathDrawMode,
    pathDrawTargetId,
    setPathDrawMode,
    assignPathToTrack,
    tracks,
  } = useEditorStore();

  const svgRef    = useRef<SVGSVGElement>(null);
  const [rawPoints, setRawPoints] = useState<PathPoint[]>([]);
  const [drawing,   setDrawing]   = useState(false);
  const [previewD,  setPreviewD]  = useState("");

  // After path is drawn on a character, show the action popup
  const [charPopup, setCharPopup] = useState<{
    trackId:   string;
    endPoint:  { x: number; y: number };
  } | null>(null);

  // When user picks "Sequence Builder" from the simple popup, switch to this
  const [sequencePopup, setSequencePopup] = useState<{
    trackId:  string;
    endPoint: { x: number; y: number };
  } | null>(null);

  // We need the Fabric canvas element to map canvas→screen coords in the popups
  const [fabricCanvasEl, setFabricCanvasEl] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    // Explicitly select the Fabric canvas by its data-canvas-role attribute
    // to avoid accidentally grabbing the PIXI overlay canvas or any other canvas.
    if (svgRef.current) {
      const parent   = svgRef.current.closest(".relative.rounded-lg");
      const canvasEl = parent?.querySelector("canvas[data-canvas-role='fabric']") as HTMLCanvasElement | null;
      setFabricCanvasEl(canvasEl ?? null);
    }
  }, [pathDrawMode]);

  useEffect(() => {
    if (!pathDrawMode) {
      setRawPoints([]);
      setPreviewD("");
      setDrawing(false);
    }
  }, [pathDrawMode]);

  const ptFromEvent = useCallback(
    (e: React.PointerEvent<SVGSVGElement>): PathPoint => {
      const rect = svgRef.current!.getBoundingClientRect();
      const scaleX = canvasWidth  / rect.width;
      const scaleY = canvasHeight / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top)  * scaleY,
      };
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

    if (!pathDrawTargetId) {
      toast.error("No target track selected.");
      setPathDrawMode(false);
      return;
    }

    const smoothed    = smoothPoints(rawPoints, 7);
    const cumLengths  = buildCumulativeLengths(smoothed);
    const totalLength = cumLengths[cumLengths.length - 1];

    // Check if the target is a character track
    const targetTrack = tracks.find((t) => t.id === pathDrawTargetId);
    const isCharacter = (targetTrack?.fabricObject as any)?.customType === "character";

    assignPathToTrack(pathDrawTargetId, {
      points: smoothed,
      totalLength,
      orientToPath: false,
      speed: 1,
    });

    setPathDrawMode(false);
    setRawPoints([]);
    setPreviewD("");

    if (isCharacter) {
      // Show action popup at the path's end-point
      const endPt = smoothed[smoothed.length - 1];
      setCharPopup({ trackId: pathDrawTargetId, endPoint: endPt });
    } else {
      toast.success("Path assigned! Press Play to preview.");
    }
  };

  // Switch from the simple popup to the sequence builder
  const handleOpenSequenceBuilder = () => {
    if (!charPopup) return;
    const { trackId, endPoint } = charPopup;
    setCharPopup(null);
    setSequencePopup({ trackId, endPoint });
  };

  // Go back from sequence builder to the simple popup
  const handleSequenceBack = () => {
    if (!sequencePopup) return;
    const { trackId, endPoint } = sequencePopup;
    setSequencePopup(null);
    setCharPopup({ trackId, endPoint });
  };

  if (!pathDrawMode && !charPopup && !sequencePopup) return null;

  const track = tracks.find((t) => t.id === pathDrawTargetId);

  return (
    <>
      {pathDrawMode && (
        <div className="absolute inset-0 z-50" style={{ cursor: "crosshair" }}>
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
              x={0} y={0}
              width={canvasWidth} height={canvasHeight}
              fill="#6366f1" fillOpacity={0.06}
              stroke="#6366f1" strokeOpacity={0.3}
              strokeWidth={2} strokeDasharray="8 6" rx={4}
            />

            {previewD && (
              <>
                {/* Glow */}
                <path
                  d={previewD} fill="none"
                  stroke="#a78bfa" strokeOpacity={0.35}
                  strokeWidth={14} strokeLinecap="round" strokeLinejoin="round"
                />
                {/* Core dashed line */}
                <path
                  d={previewD} fill="none"
                  stroke="#a78bfa" strokeWidth={3}
                  strokeLinecap="round" strokeLinejoin="round"
                  strokeDasharray="6 3"
                />
                {/* Start dot */}
                {rawPoints.length > 0 && (
                  <circle cx={rawPoints[0].x} cy={rawPoints[0].y} r={6} fill="#a78bfa" opacity={0.9} />
                )}
                {/* Arrow at tip */}
                {rawPoints.length > 1 && (() => {
                  const last = rawPoints[rawPoints.length - 1];
                  const prev = rawPoints[Math.max(0, rawPoints.length - 5)];
                  const dx = last.x - prev.x, dy = last.y - prev.y;
                  const len = Math.sqrt(dx * dx + dy * dy) || 1;
                  const ux = dx / len, uy = dy / len;
                  const perp = 7, back = 14;
                  return (
                    <polygon
                      points={`
                        ${last.x},${last.y}
                        ${last.x - back * ux + perp * uy},${last.y - back * uy - perp * ux}
                        ${last.x - back * ux - perp * uy},${last.y - back * uy + perp * ux}
                      `}
                      fill="#a78bfa" opacity={0.9}
                    />
                  );
                })()}
              </>
            )}
          </svg>
        </div>
      )}

      {/* Simple two-stage popup (existing behaviour) */}
      {charPopup && (
        <CharacterPathPopup
          trackId={charPopup.trackId}
          pathEndPoint={charPopup.endPoint}
          canvasEl={fabricCanvasEl}
          onClose={() => setCharPopup(null)}
          onSequenceBuilder={handleOpenSequenceBuilder}
        />
      )}

      {/* Advanced sequence builder popup */}
      {sequencePopup && (
        <CharacterSequencePopup
          trackId={sequencePopup.trackId}
          pathEndPoint={sequencePopup.endPoint}
          canvasEl={fabricCanvasEl}
          onClose={() => setSequencePopup(null)}
          onBack={handleSequenceBack}
        />
      )}
    </>
  );
}