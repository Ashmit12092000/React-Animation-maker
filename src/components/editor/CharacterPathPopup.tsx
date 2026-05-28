/**
 * CharacterPathPopup
 *
 * Two-stage popup that appears after a path is drawn on a character:
 *
 * Stage 1 — "Travel" popup:
 *   Shows action buttons based on the character's current animation.
 *   - If Idle → offer Walk and Run
 *   - If Walk → offer Run (and keep Walk)
 *   - If Run  → offer Walk (and keep Run)
 *   - Always offers "Sequence Builder" to open the advanced choreography popup
 *
 * Stage 2 — "Arrival" popup:
 *   After the user picks a travel animation, ask what to do when the
 *   character reaches the end of the path.
 *   Options: "Keep [anim]" or "Return to Idle"
 *
 * The popup is positioned at the end-point of the drawn path (canvas coords
 * mapped to screen coords).
 */

import { useState, useEffect } from "react";
import { useEditorStore } from "@/stores/editorStore";
import type { CharacterAnimName } from "@/types";

interface PopupPosition {
  screenX: number;
  screenY: number;
}

interface Props {
  trackId: string;
  pathEndPoint: { x: number; y: number } | null; // canvas-space coords
  canvasEl: HTMLCanvasElement | null;
  onClose: () => void;
  /** Called when the user clicks "Sequence Builder" */
  onSequenceBuilder: () => void;
}

const ANIM_LABELS: Record<CharacterAnimName, string> = {
  Idle: "Idle",
  walk: "Walk",
  run:  "Run",
  jump: "Jump",
};

const ANIM_ICONS: Record<CharacterAnimName, string> = {
  Idle: "🧍",
  walk: "🚶",
  run:  "🏃",
  jump: "🦘",
};

const ANIM_COLORS: Record<CharacterAnimName, string> = {
  Idle: "#6366f1",
  walk: "#22c55e",
  run:  "#f97316",
  jump: "#ec4899",
};

export function CharacterPathPopup({ trackId, pathEndPoint, canvasEl, onClose, onSequenceBuilder }: Props) {
  const { tracks, commitCharacterPathAction } = useEditorStore();

  const [stage, setStage] = useState<"travel" | "arrival">("travel");
  const [chosenTravel, setChosenTravel] = useState<CharacterAnimName>("walk");
  const [pos, setPos] = useState<PopupPosition | null>(null);

  const track = tracks.find((t) => t.id === trackId);
  const currentAnim = (track?.characterAnimation ?? "Idle") as CharacterAnimName;

  // Map canvas coords → screen coords using the canvas element's bounding rect
  // Also apply boundary checking to keep popup within canvas bounds
  useEffect(() => {
    if (!pathEndPoint || !canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const scaleX = rect.width  / (canvasEl.width  || rect.width);
    const scaleY = rect.height / (canvasEl.height || rect.height);
    let screenX = rect.left + pathEndPoint.x * scaleX;
    let screenY = rect.top  + pathEndPoint.y * scaleY;
    
    // Clamp to canvas bounds with some padding
    const popupWidth = 260;
    const padding = 16;
    
    // Keep popup within horizontal canvas bounds
    screenX = Math.max(rect.left + padding, Math.min(screenX, rect.right - padding - popupWidth));
    
    // Keep popup below the point but within canvas vertical bounds
    const minY = rect.top + padding;
    const maxY = rect.bottom - padding - 200; // Approximate popup height
    screenY = Math.max(minY, Math.min(screenY, maxY));
    
    setPos({
      screenX,
      screenY,
    });
  }, [pathEndPoint, canvasEl]);

  if (!pos) return null;

  // Show all animations — including the current one so user can keep it
  const travelOptions: CharacterAnimName[] = ["Idle", "walk", "run", "jump"];

  const handleTravelChoice = (anim: CharacterAnimName) => {
    setChosenTravel(anim);
    setStage("arrival");
  };

  const handleArrivalChoice = (behavior: "keep" | "idle") => {
    commitCharacterPathAction(trackId, chosenTravel, behavior);
    onClose();
  };

  // Popup sits just below the path end-point, centred horizontally
  const style: React.CSSProperties = {
    position:  "fixed",
    left:      pos.screenX,
    top:       pos.screenY + 12,
    transform: "translate(-50%, 0%)",
    zIndex:    9999,
  };

  return (
    <div style={style}>
      {/* Arrow pointer */}
      <div
        style={{
          position: "absolute",
          top: -7,
          left: "50%",
          transform: "translateX(-50%)",
          width: 0,
          height: 0,
          borderLeft: "8px solid transparent",
          borderRight: "8px solid transparent",
          borderBottom: "8px solid rgba(15,17,25,0.97)",
        }}
      />

      <div
        style={{
          background:   "rgba(15,17,25,0.97)",
          border:       "1px solid rgba(255,255,255,0.12)",
          borderRadius: 14,
          padding:      "14px 16px",
          minWidth:     240,
          boxShadow:    "0 8px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(99,102,241,0.2)",
          backdropFilter: "blur(12px)",
        }}
      >
        {stage === "travel" ? (
          <>
            <div style={{ marginBottom: 10 }}>
              <p style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, margin: 0 }}>
                Path drawn!
              </p>
              <p style={{ color: "#94a3b8", fontSize: 11, margin: "3px 0 0", lineHeight: 1.4 }}>
                Currently{" "}
                <span style={{ color: ANIM_COLORS[currentAnim] }}>
                  {ANIM_ICONS[currentAnim]} {ANIM_LABELS[currentAnim]}
                </span>
                {" "}— how should it travel?
              </p>
            </div>

            {/* Travel options — 2×2 grid, all 4 animations */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              {travelOptions.map((anim) => {
                const isCurrent = anim === currentAnim;
                return (
                  <button
                    key={anim}
                    onClick={() => handleTravelChoice(anim)}
                    style={{
                      position:      "relative",
                      display:       "flex",
                      flexDirection: "column",
                      alignItems:    "center",
                      gap:           4,
                      padding:       "10px 8px",
                      borderRadius:  10,
                      border:        isCurrent
                        ? `1.5px solid ${ANIM_COLORS[anim]}99`
                        : `1.5px solid ${ANIM_COLORS[anim]}44`,
                      background:    isCurrent
                        ? `${ANIM_COLORS[anim]}28`
                        : `${ANIM_COLORS[anim]}15`,
                      cursor:        "pointer",
                      transition:    "all 0.15s",
                      color:         ANIM_COLORS[anim],
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background  = `${ANIM_COLORS[anim]}30`;
                      (e.currentTarget as HTMLElement).style.borderColor = `${ANIM_COLORS[anim]}99`;
                      (e.currentTarget as HTMLElement).style.transform   = "scale(1.04)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background  = isCurrent ? `${ANIM_COLORS[anim]}28` : `${ANIM_COLORS[anim]}15`;
                      (e.currentTarget as HTMLElement).style.borderColor = isCurrent ? `${ANIM_COLORS[anim]}99` : `${ANIM_COLORS[anim]}44`;
                      (e.currentTarget as HTMLElement).style.transform   = "scale(1)";
                    }}
                  >
                    {isCurrent && (
                      <span style={{
                        position:     "absolute",
                        top:          4,
                        right:        6,
                        fontSize:     8,
                        fontWeight:   700,
                        letterSpacing: "0.05em",
                        color:        ANIM_COLORS[anim],
                        opacity:      0.85,
                        textTransform: "uppercase",
                      }}>
                        Current
                      </span>
                    )}
                    <span style={{ fontSize: 22 }}>{ANIM_ICONS[anim]}</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{ANIM_LABELS[anim]}</span>
                  </button>
                );
              })}
            </div>

            {/* ── Divider ── */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                margin: "10px 0 8px",
              }}
            >
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
              <span style={{ fontSize: 10, color: "#475569", letterSpacing: "0.05em" }}>OR</span>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
            </div>

            {/* ── Sequence Builder option ── */}
            <button
              onClick={onSequenceBuilder}
              style={{
                width:        "100%",
                display:      "flex",
                alignItems:   "center",
                gap:          10,
                padding:      "10px 12px",
                borderRadius: 10,
                border:       "1.5px solid rgba(99,102,241,0.4)",
                background:   "rgba(99,102,241,0.1)",
                cursor:       "pointer",
                transition:   "all 0.15s",
                color:        "#a5b4fc",
                textAlign:    "left",
                marginBottom: 8,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background   = "rgba(99,102,241,0.2)";
                (e.currentTarget as HTMLElement).style.borderColor  = "rgba(99,102,241,0.8)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background   = "rgba(99,102,241,0.1)";
                (e.currentTarget as HTMLElement).style.borderColor  = "rgba(99,102,241,0.4)";
              }}
            >
              <span style={{ fontSize: 20 }}>🎬</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#c7d2fe" }}>
                  Sequence Builder
                </div>
                <div style={{ fontSize: 10, color: "#6366f1", marginTop: 1 }}>
                  Idle → Walk → Stop → Run…
                </div>
              </div>
              <span style={{ marginLeft: "auto", fontSize: 14, color: "#6366f1", opacity: 0.7 }}>›</span>
            </button>

            <button
              onClick={onClose}
              style={{
                width:        "100%",
                padding:      "6px 0",
                borderRadius: 8,
                border:       "1px solid rgba(255,255,255,0.08)",
                background:   "transparent",
                color:        "#64748b",
                fontSize:     11,
                cursor:       "pointer",
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#94a3b8")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#64748b")}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 10 }}>
              <p style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, margin: 0 }}>
                When destination is reached…
              </p>
              <p style={{ color: "#94a3b8", fontSize: 11, margin: "3px 0 0" }}>
                After{" "}
                <span style={{ color: ANIM_COLORS[chosenTravel] }}>
                  {ANIM_ICONS[chosenTravel]} {ANIM_LABELS[chosenTravel]}
                </span>
                {" "}completes the path:
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Keep current travel animation */}
              <button
                onClick={() => handleArrivalChoice("keep")}
                style={{
                  display:     "flex",
                  alignItems:  "center",
                  gap:         10,
                  padding:     "10px 12px",
                  borderRadius: 10,
                  border:      `1.5px solid ${ANIM_COLORS[chosenTravel]}44`,
                  background:  `${ANIM_COLORS[chosenTravel]}15`,
                  cursor:      "pointer",
                  color:       ANIM_COLORS[chosenTravel],
                  textAlign:   "left",
                  transition:  "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background  = `${ANIM_COLORS[chosenTravel]}28`;
                  (e.currentTarget as HTMLElement).style.borderColor = `${ANIM_COLORS[chosenTravel]}88`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background  = `${ANIM_COLORS[chosenTravel]}15`;
                  (e.currentTarget as HTMLElement).style.borderColor = `${ANIM_COLORS[chosenTravel]}44`;
                }}
              >
                <span style={{ fontSize: 20 }}>{ANIM_ICONS[chosenTravel]}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    Keep {ANIM_LABELS[chosenTravel]}
                  </div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>
                    Stay in current animation
                  </div>
                </div>
              </button>

              {/* Return to Idle — only shown if travel isn't already Idle */}
              {chosenTravel !== "Idle" && (
                <button
                  onClick={() => handleArrivalChoice("idle")}
                  style={{
                    display:     "flex",
                    alignItems:  "center",
                    gap:         10,
                    padding:     "10px 12px",
                    borderRadius: 10,
                    border:      `1.5px solid ${ANIM_COLORS["Idle"]}44`,
                    background:  `${ANIM_COLORS["Idle"]}15`,
                    cursor:      "pointer",
                    color:       ANIM_COLORS["Idle"],
                    textAlign:   "left",
                    transition:  "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background  = `${ANIM_COLORS["Idle"]}28`;
                    (e.currentTarget as HTMLElement).style.borderColor = `${ANIM_COLORS["Idle"]}88`;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background  = `${ANIM_COLORS["Idle"]}15`;
                    (e.currentTarget as HTMLElement).style.borderColor = `${ANIM_COLORS["Idle"]}44`;
                  }}
                >
                  <span style={{ fontSize: 20 }}>{ANIM_ICONS["Idle"]}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Return to Idle</div>
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>
                      Stand still after arrival
                    </div>
                  </div>
                </button>
              )}
            </div>

            <button
              onClick={() => setStage("travel")}
              style={{
                marginTop:    10,
                width:        "100%",
                padding:      "6px 0",
                borderRadius: 8,
                border:       "1px solid rgba(255,255,255,0.08)",
                background:   "transparent",
                color:        "#64748b",
                fontSize:     11,
                cursor:       "pointer",
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#94a3b8")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#64748b")}
            >
              ← Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}