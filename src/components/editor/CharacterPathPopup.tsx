/**
 * CharacterPathPopup
 *
 * Two-stage popup that appears after a path is drawn on a character.
 * Only shows: Idle, Walk, Run, Jump, Sit animations.
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
  pathEndPoint: { x: number; y: number } | null;
  canvasEl: HTMLCanvasElement | null;
  onClose: () => void;
  onSequenceBuilder: () => void;
}

/* ─── Animation metadata (only 5 animations) ────────────────────────────── */

const ANIM_META: Record<string, { label: string; icon: string; color: string }> = {
  Idle:     { label: "Idle", icon: "🧍", color: "#6366f1" },
  walk:     { label: "Walk", icon: "🚶", color: "#22c55e" },
  run:      { label: "Run",  icon: "🏃", color: "#f97316" },
  jump:     { label: "Jump", icon: "🦘", color: "#ec4899" },
  sit_idle: { label: "Sit",  icon: "🪑", color: "#8b5cf6" },
};

const ALLOWED_ANIMS: CharacterAnimName[] = ["Idle", "walk", "run", "jump", "sit_idle"];

/* ─── Component ──────────────────────────────────────────────────────────── */

export function CharacterPathPopup({ trackId, pathEndPoint, canvasEl, onClose, onSequenceBuilder }: Props) {
  const { tracks, commitCharacterPathAction } = useEditorStore();

  const [stage, setStage]               = useState<"travel" | "arrival">("travel");
  const [chosenTravel, setChosenTravel] = useState<CharacterAnimName>("walk");
  const [pos, setPos]                   = useState<PopupPosition | null>(null);

  const track       = tracks.find((t) => t.id === trackId);
  const currentAnim = (track?.characterAnimation ?? "Idle") as CharacterAnimName;

  useEffect(() => {
    if (!pathEndPoint || !canvasEl) return;
    const rect   = canvasEl.getBoundingClientRect();
    const scaleX = rect.width  / (canvasEl.width  || rect.width);
    const scaleY = rect.height / (canvasEl.height || rect.height);
    let screenX  = rect.left + pathEndPoint.x * scaleX;
    let screenY  = rect.top  + pathEndPoint.y * scaleY;

    const popupWidth = 280;
    const padding    = 16;
    screenX = Math.max(rect.left + padding, Math.min(screenX, rect.right  - padding - popupWidth));
    const maxY = rect.bottom - padding - 320;
    screenY = Math.max(rect.top + padding, Math.min(screenY, maxY));

    setPos({ screenX, screenY });
  }, [pathEndPoint, canvasEl]);

  if (!pos) return null;

  const meta = ANIM_META[currentAnim] ?? ANIM_META["Idle"];

  const handleTravelChoice = (anim: CharacterAnimName) => {
    setChosenTravel(anim);
    setStage("arrival");
  };

  const handleArrivalChoice = (behavior: "keep" | "idle") => {
    commitCharacterPathAction(trackId, chosenTravel, behavior);
    onClose();
  };

  const containerStyle: React.CSSProperties = {
    position:  "fixed",
    left:      pos.screenX,
    top:       pos.screenY + 12,
    transform: "translate(-50%, 0%)",
    zIndex:    9999,
  };

  const cardStyle: React.CSSProperties = {
    background:     "rgba(12,14,22,0.98)",
    border:         "1px solid rgba(255,255,255,0.1)",
    borderRadius:   14,
    padding:        "14px 16px",
    width:          268,
    boxShadow:      "0 8px 40px rgba(0,0,0,0.75), 0 0 0 1px rgba(99,102,241,0.18)",
    backdropFilter: "blur(16px)",
  };

  return (
    <div style={containerStyle}>
      {/* Caret */}
      <div style={{
        position: "absolute", top: -7, left: "50%", transform: "translateX(-50%)",
        width: 0, height: 0,
        borderLeft: "8px solid transparent", borderRight: "8px solid transparent",
        borderBottom: "8px solid rgba(12,14,22,0.98)",
      }} />

      <div style={cardStyle}>
        {stage === "travel" ? (
          <>
            {/* Header */}
            <div style={{ marginBottom: 12 }}>
              <p style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 700, margin: 0 }}>
                Path drawn — how to travel?
              </p>
              <p style={{ color: "#64748b", fontSize: 11, margin: "3px 0 0" }}>
                Currently{" "}
                <span style={{ color: meta.color }}>{meta.icon} {meta.label}</span>
              </p>
            </div>

            {/* Animation grid */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: 6,
              marginBottom: 10,
            }}>
              {ALLOWED_ANIMS.map((anim) => {
                const m         = ANIM_META[anim];
                const isCurrent = anim === currentAnim;
                return (
                  <button
                    key={anim}
                    onClick={() => handleTravelChoice(anim)}
                    title={m.label}
                    style={{
                      position:       "relative",
                      display:        "flex",
                      flexDirection:  "column",
                      alignItems:     "center",
                      justifyContent: "center",
                      gap:            3,
                      padding:        "8px 4px",
                      borderRadius:   10,
                      border:         isCurrent
                        ? `1.5px solid ${m.color}aa`
                        : `1.5px solid ${m.color}33`,
                      background:     isCurrent ? `${m.color}22` : `${m.color}0d`,
                      cursor:         "pointer",
                      transition:     "all 0.14s",
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.background  = `${m.color}2a`;
                      el.style.borderColor = `${m.color}88`;
                      el.style.transform   = "scale(1.06)";
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.background  = isCurrent ? `${m.color}22` : `${m.color}0d`;
                      el.style.borderColor = isCurrent ? `${m.color}aa` : `${m.color}33`;
                      el.style.transform   = "scale(1)";
                    }}
                  >
                    {isCurrent && (
                      <div style={{
                        position:  "absolute", top: 3, right: 3,
                        width: 5,  height: 5,
                        borderRadius: "50%",
                        background: m.color,
                        boxShadow: `0 0 4px ${m.color}`,
                      }} />
                    )}
                    <span style={{ fontSize: 18, lineHeight: 1 }}>{m.icon}</span>
                    <span style={{
                      fontSize:     9, fontWeight: 600,
                      color:        m.color, textAlign: "center",
                      lineHeight:   1.2,
                      overflow:     "hidden",
                      maxWidth:     "100%",
                      whiteSpace:   "nowrap",
                      textOverflow: "ellipsis",
                    }}>
                      {m.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Divider */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0 8px" }}>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
              <span style={{ fontSize: 10, color: "#334155", letterSpacing: "0.05em" }}>OR</span>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
            </div>

            {/* Sequence Builder */}
            <button
              onClick={onSequenceBuilder}
              style={{
                width:        "100%",
                display:      "flex",
                alignItems:   "center",
                gap:          10,
                padding:      "9px 12px",
                borderRadius: 10,
                border:       "1.5px solid rgba(99,102,241,0.35)",
                background:   "rgba(99,102,241,0.08)",
                cursor:       "pointer",
                transition:   "all 0.15s",
                color:        "#a5b4fc",
                textAlign:    "left",
                marginBottom: 8,
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.background  = "rgba(99,102,241,0.18)";
                el.style.borderColor = "rgba(99,102,241,0.75)";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.background  = "rgba(99,102,241,0.08)";
                el.style.borderColor = "rgba(99,102,241,0.35)";
              }}
            >
              <span style={{ fontSize: 18 }}>🎬</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#c7d2fe" }}>Sequence Builder</div>
                <div style={{ fontSize: 10, color: "#6366f1", marginTop: 1 }}>
                  Chain multiple animations
                </div>
              </div>
              <span style={{ marginLeft: "auto", fontSize: 14, color: "#4f46e5", opacity: 0.8 }}>›</span>
            </button>

            <button
              onClick={onClose}
              style={{
                width: "100%", padding: "5px 0", borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.06)",
                background: "transparent", color: "#475569", fontSize: 11, cursor: "pointer",
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#94a3b8")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#475569")}
            >
              Cancel
            </button>
          </>
        ) : (
          /* ── Arrival stage ─────────────────────────────────────────── */
          <>
            {(() => {
              const tm = ANIM_META[chosenTravel] ?? ANIM_META["Idle"];
              return (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <p style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 700, margin: 0 }}>
                      When destination is reached…
                    </p>
                    <p style={{ color: "#64748b", fontSize: 11, margin: "4px 0 0" }}>
                      After{" "}
                      <span style={{ color: tm.color }}>{tm.icon} {tm.label}</span>
                      {" "}completes the path:
                    </p>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <button
                      onClick={() => handleArrivalChoice("keep")}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 12px", borderRadius: 10,
                        border:     `1.5px solid ${tm.color}44`,
                        background: `${tm.color}12`,
                        cursor: "pointer", color: tm.color, textAlign: "left", transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background  = `${tm.color}24`;
                        el.style.borderColor = `${tm.color}88`;
                      }}
                      onMouseLeave={(e) => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background  = `${tm.color}12`;
                        el.style.borderColor = `${tm.color}44`;
                      }}
                    >
                      <span style={{ fontSize: 20 }}>{tm.icon}</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>Keep {tm.label}</div>
                        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>
                          Stay in current animation
                        </div>
                      </div>
                    </button>

                    {chosenTravel !== "Idle" && (
                      <button
                        onClick={() => handleArrivalChoice("idle")}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "10px 12px", borderRadius: 10,
                          border:     "1.5px solid rgba(99,102,241,0.35)",
                          background: "rgba(99,102,241,0.08)",
                          cursor: "pointer", color: "#6366f1", textAlign: "left", transition: "all 0.15s",
                        }}
                        onMouseEnter={(e) => {
                          const el = e.currentTarget as HTMLElement;
                          el.style.background  = "rgba(99,102,241,0.18)";
                          el.style.borderColor = "rgba(99,102,241,0.7)";
                        }}
                        onMouseLeave={(e) => {
                          const el = e.currentTarget as HTMLElement;
                          el.style.background  = "rgba(99,102,241,0.08)";
                          el.style.borderColor = "rgba(99,102,241,0.35)";
                        }}
                      >
                        <span style={{ fontSize: 20 }}>🧍</span>
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
                      marginTop: 10, width: "100%", padding: "5px 0", borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.07)",
                      background: "transparent", color: "#475569", fontSize: 11, cursor: "pointer",
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#94a3b8")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#475569")}
                  >
                    ← Back
                  </button>
                </>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}