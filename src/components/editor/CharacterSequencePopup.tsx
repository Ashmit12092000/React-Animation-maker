/**
 * CharacterSequencePopup
 *
 * Sequence Builder popup. Shows only 5 animations:
 *   Idle · Walk · Run · Jump · Sit
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useEditorStore } from "@/stores/editorStore";
import type { SequenceStep, CharacterAnimName } from "@/types";

interface Props {
  trackId: string;
  pathEndPoint: { x: number; y: number } | null;
  canvasEl: HTMLCanvasElement | null;
  onClose: () => void;
  onBack: () => void;
}

/* ─── Animation metadata (5 animations only) ────────────────────────────── */

const ANIM_META: Record<string, { label: string; icon: string; color: string }> = {
  Idle:     { label: "Idle", icon: "🧍", color: "#6366f1" },
  walk:     { label: "Walk", icon: "🚶", color: "#22c55e" },
  run:      { label: "Run",  icon: "🏃", color: "#f97316" },
  jump:     { label: "Jump", icon: "🦘", color: "#ec4899" },
  sit_idle: { label: "Sit",  icon: "🪑", color: "#8b5cf6" },
};

const ALLOWED_ANIMS: CharacterAnimName[] = ["Idle", "walk", "run", "jump", "sit_idle"];

// Animations that move along the path
const MOVING_ANIMS: CharacterAnimName[] = ["walk", "run", "jump"];

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

/* ─── Path segment distribution ─────────────────────────────────────────── */

function distributePathSegments(steps: SequenceStep[]): SequenceStep[] {
  const movingCount = steps.filter((s) => MOVING_ANIMS.includes(s.animation)).length;
  if (movingCount === 0) return steps.map((s) => ({ ...s, pathSegment: undefined }));
  const segSize = 1 / movingCount;
  let idx = 0;
  return steps.map((s) => {
    if (!MOVING_ANIMS.includes(s.animation)) return { ...s, pathSegment: undefined };
    const from = idx * segSize;
    const to   = (idx + 1) * segSize;
    idx++;
    return { ...s, pathSegment: { from: parseFloat(from.toFixed(4)), to: parseFloat(to.toFixed(4)) } };
  });
}

/* ─── AnimPicker ─────────────────────────────────────────────────────────── */

interface AnimPickerProps {
  current: CharacterAnimName;
  onSelect: (anim: CharacterAnimName) => void;
  onClose: () => void;
}

function AnimPicker({ current, onSelect, onClose }: AnimPickerProps) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background:     "rgba(8,10,18,0.99)",
        border:         "1px solid rgba(255,255,255,0.1)",
        borderRadius:   12,
        padding:        "10px",
        marginTop:      6,
        boxShadow:      "0 8px 32px rgba(0,0,0,0.7)",
        backdropFilter: "blur(16px)",
      }}
    >
      {/* Animation grid */}
      <div style={{
        display:             "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap:                 5,
      }}>
        {ALLOWED_ANIMS.map((anim) => {
          const m    = ANIM_META[anim];
          const isSel = anim === current;
          return (
            <button
              key={anim}
              onClick={() => { onSelect(anim); onClose(); }}
              title={m.label}
              style={{
                display:        "flex",
                flexDirection:  "column",
                alignItems:     "center",
                justifyContent: "center",
                gap:            2,
                padding:        "7px 4px",
                borderRadius:   8,
                border:         isSel
                  ? `1.5px solid ${m.color}cc`
                  : `1.5px solid ${m.color}28`,
                background:     isSel ? `${m.color}22` : `${m.color}0a`,
                cursor:         "pointer",
                transition:     "all 0.12s",
                position:       "relative",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.background  = `${m.color}28`;
                el.style.borderColor = `${m.color}88`;
                el.style.transform   = "scale(1.07)";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.background  = isSel ? `${m.color}22` : `${m.color}0a`;
                el.style.borderColor = isSel ? `${m.color}cc` : `${m.color}28`;
                el.style.transform   = "scale(1)";
              }}
            >
              {isSel && (
                <div style={{
                  position: "absolute", top: 3, right: 3,
                  width: 5, height: 5, borderRadius: "50%",
                  background: m.color, boxShadow: `0 0 4px ${m.color}`,
                }} />
              )}
              <span style={{ fontSize: 16, lineHeight: 1 }}>{m.icon}</span>
              <span style={{
                fontSize: 8, fontWeight: 600, color: m.color,
                textAlign: "center", lineHeight: 1.2,
                maxWidth: "100%", overflow: "hidden",
                whiteSpace: "nowrap", textOverflow: "ellipsis",
              }}>
                {m.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── StepRow ────────────────────────────────────────────────────────────── */

interface StepRowProps {
  step: SequenceStep;
  index: number;
  total: number;
  onChange: (id: string, updates: Partial<SequenceStep>) => void;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

function StepRow({ step, index, total, onChange, onRemove, onMoveUp, onMoveDown }: StepRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const meta     = ANIM_META[step.animation] ?? ANIM_META["Idle"];
  const isMoving = MOVING_ANIMS.includes(step.animation);
  const color    = meta.color;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display:      "flex",
          alignItems:   "center",
          gap:          8,
          padding:      "8px 10px",
          borderRadius: pickerOpen ? "10px 10px 0 0" : 10,
          border:       `1.5px solid ${pickerOpen ? color + "66" : color + "28"}`,
          background:   pickerOpen ? `${color}18` : `${color}0a`,
          transition:   "all 0.15s",
        }}
      >
        {/* Step badge */}
        <div style={{
          minWidth: 20, height: 20, borderRadius: "50%",
          background: `${color}2a`, color, fontSize: 9, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          {index + 1}
        </div>

        {/* Animation chip */}
        <button
          onClick={() => setPickerOpen((v) => !v)}
          title="Click to change animation"
          style={{
            display:      "flex",
            alignItems:   "center",
            gap:          5,
            padding:      "4px 8px",
            borderRadius: 8,
            border:       `1.5px solid ${pickerOpen ? color + "99" : color + "44"}`,
            background:   pickerOpen ? `${color}22` : `${color}12`,
            color,
            cursor:       "pointer",
            flexShrink:   0,
            transition:   "all 0.12s",
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>{meta.icon}</span>
          <span style={{ fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{meta.label}</span>
          <span style={{ fontSize: 9, opacity: 0.5, marginLeft: 1 }}>▾</span>
        </button>

        {/* Duration */}
        <div style={{ display: "flex", alignItems: "center", gap: 3, flex: 1, minWidth: 0 }}>
          <input
            type="number"
            min={0.5}
            max={999}
            step={0.5}
            value={step.duration}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v) && v >= 0.5) onChange(step.id, { duration: v });
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width:        52,
              padding:      "3px 6px",
              borderRadius: 6,
              border:       "1px solid rgba(255,255,255,0.12)",
              background:   "rgba(255,255,255,0.05)",
              color:        "#e2e8f0",
              fontSize:     12,
              textAlign:    "center",
              outline:      "none",
            }}
          />
          <span style={{ color: "#475569", fontSize: 10, flexShrink: 0 }}>s</span>
        </div>

        {/* Move badge */}
        <span style={{
          fontSize:   9,
          color:      isMoving ? color : "#374151",
          background: isMoving ? `${color}15` : "rgba(255,255,255,0.03)",
          border:     `1px solid ${isMoving ? color + "33" : "rgba(255,255,255,0.06)"}`,
          borderRadius: 20,
          padding:    "2px 6px",
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}>
          {isMoving ? "↗ moves" : "⬛ stays"}
        </span>

        {/* Reorder/remove */}
        <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
          {(["▲", "▼"] as const).map((arrow, i) => {
            const disabled = i === 0 ? index === 0 : index === total - 1;
            return (
              <button
                key={arrow}
                onClick={() => i === 0 ? onMoveUp(step.id) : onMoveDown(step.id)}
                disabled={disabled}
                style={{
                  width: 22, height: 22, borderRadius: 5,
                  border:     "1px solid rgba(255,255,255,0.07)",
                  background: "transparent",
                  color:      disabled ? "#1e293b" : "#475569",
                  fontSize:   8, cursor: disabled ? "not-allowed" : "pointer",
                  display:    "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.1s",
                  pointerEvents: disabled ? "none" : "auto",
                }}
              >
                {arrow}
              </button>
            );
          })}
          <button
            onClick={() => onRemove(step.id)}
            disabled={total <= 1}
            style={{
              width: 22, height: 22, borderRadius: 5,
              border:     "1px solid rgba(255,255,255,0.07)",
              background: "transparent",
              color:      total <= 1 ? "#1e293b" : "#ef4444",
              fontSize:   9, cursor: total <= 1 ? "not-allowed" : "pointer",
              display:    "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.1s",
              pointerEvents: total <= 1 ? "none" : "auto",
              opacity:    total <= 1 ? 0.3 : 0.6,
            }}
            onMouseEnter={(e) => { if (total > 1) (e.currentTarget as HTMLElement).style.opacity = "1"; }}
            onMouseLeave={(e) => { if (total > 1) (e.currentTarget as HTMLElement).style.opacity = "0.6"; }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Inline picker */}
      {pickerOpen && (
        <div style={{
          border:     `1.5px solid ${color}44`,
          borderTop:  "none",
          borderRadius: "0 0 10px 10px",
          overflow:   "hidden",
        }}>
          <AnimPicker
            current={step.animation}
            onSelect={(anim) => onChange(step.id, { animation: anim })}
            onClose={() => setPickerOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

/* ─── Quick-add bar ──────────────────────────────────────────────────────── */

interface QuickAddBarProps {
  onAdd: (anim: CharacterAnimName) => void;
}

function QuickAddBar({ onAdd }: QuickAddBarProps) {
  return (
    <div style={{
      background:   "rgba(255,255,255,0.025)",
      border:       "1px solid rgba(255,255,255,0.07)",
      borderRadius: 10,
      padding:      "8px 10px",
      marginBottom: 10,
    }}>
      <div style={{
        fontSize: 9, color: "#4b5563", letterSpacing: "0.08em",
        fontWeight: 600, marginBottom: 6, textTransform: "uppercase",
      }}>
        Add Step
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {ALLOWED_ANIMS.map((anim) => {
          const m = ANIM_META[anim];
          return (
            <button
              key={anim}
              onClick={() => onAdd(anim)}
              title={`Add ${m.label} step`}
              style={{
                display:      "flex",
                alignItems:   "center",
                gap:          4,
                padding:      "4px 8px",
                borderRadius: 8,
                border:       `1.5px solid ${m.color}33`,
                background:   `${m.color}0d`,
                color:        m.color,
                fontSize:     10,
                cursor:       "pointer",
                transition:   "all 0.12s",
                fontWeight:   500,
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.background  = `${m.color}22`;
                el.style.borderColor = `${m.color}66`;
                el.style.transform   = "scale(1.04)";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.background  = `${m.color}0d`;
                el.style.borderColor = `${m.color}33`;
                el.style.transform   = "scale(1)";
              }}
            >
              <span style={{ fontSize: 11 }}>+</span>
              <span style={{ fontSize: 12, lineHeight: 1 }}>{m.icon}</span>
              <span>{m.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── PathSegmentViz ─────────────────────────────────────────────────────── */

interface PathSegVizProps {
  steps: SequenceStep[];
  onSplitChange: (splits: number[]) => void;
}

function PathSegmentViz({ steps, onSplitChange }: PathSegVizProps) {
  const movingSteps = steps.filter((s) => MOVING_ANIMS.includes(s.animation));
  if (movingSteps.length === 0) return null;

  const segments   = movingSteps.map((s) => s.pathSegment!);
  const splits     = segments.slice(0, -1).map((s) => s.to);
  const barRef     = useRef<HTMLDivElement>(null);
  const dragging   = useRef<number | null>(null);
  const [activeHandle, setActiveHandle] = useState<number | null>(null);
  const [tooltip,  setTooltip]  = useState<{ x: number; value: number } | null>(null);

  const SNAP = 0.05;
  const MIN  = 0.1;

  const handleMouseDown = (splitIdx: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = splitIdx;
    setActiveHandle(splitIdx);

    const onMove = (ev: MouseEvent) => {
      if (dragging.current === null || !barRef.current) return;
      const rect = barRef.current.getBoundingClientRect();
      let t      = (ev.clientX - rect.left) / rect.width;
      t          = Math.round(t / SNAP) * SNAP;
      const newSplits = [...splits];
      const prev = splitIdx === 0 ? 0 : newSplits[splitIdx - 1];
      const next = splitIdx === newSplits.length - 1 ? 1 : newSplits[splitIdx + 1];
      t = Math.max(prev + MIN, Math.min(next - MIN, t));
      t = Math.max(0.01, Math.min(0.99, t));
      newSplits[splitIdx] = t;
      setTooltip({ x: ev.clientX - rect.left, value: t });
      onSplitChange(newSplits);
    };

    const onUp = () => {
      dragging.current = null;
      setActiveHandle(null);
      setTooltip(null);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const colors = movingSteps.map((s) => ANIM_META[s.animation].color);

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{
        fontSize: 10, color: "#94a3b8", marginBottom: 8,
        fontWeight: 600, letterSpacing: "0.05em",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span>Path Distribution</span>
        <span style={{ fontSize: 9, color: "#374151", fontWeight: 400 }}>
          Drag handles · 5% snap
        </span>
      </div>

      <div style={{ position: "relative" }}>
        <div
          ref={barRef}
          style={{
            position: "relative", height: 34, borderRadius: 8,
            display: "flex", overflow: "visible",
            border: "1.5px solid rgba(99,102,241,0.25)",
            background: "rgba(99,102,241,0.04)",
            userSelect: "none",
            boxShadow: "inset 0 2px 6px rgba(0,0,0,0.25)",
          }}
        >
          {segments.map((seg, i) => {
            const width = (seg.to - seg.from) * 100;
            return (
              <div
                key={i}
                style={{
                  position: "relative", width: `${width}%`, height: "100%",
                  background: `linear-gradient(135deg, ${colors[i]}35 0%, ${colors[i]}18 100%)`,
                  borderRight: i < segments.length - 1 ? "2px solid rgba(255,255,255,0.06)" : "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: activeHandle === i ? "none" : "width 0.15s ease",
                  overflow: "hidden",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                  <span style={{ fontSize: 12, color: colors[i] }}>
                    {ANIM_META[movingSteps[i].animation].icon}
                  </span>
                  {width > 12 && (
                    <span style={{ fontSize: 9, color: colors[i], fontWeight: 700, opacity: 0.8 }}>
                      {width.toFixed(0)}%
                    </span>
                  )}
                </div>

                {i < segments.length - 1 && (
                  <div
                    onMouseDown={handleMouseDown(i)}
                    onMouseEnter={() => setActiveHandle(i)}
                    onMouseLeave={() => { if (dragging.current !== i) setActiveHandle(null); }}
                    style={{
                      position: "absolute", right: -8, top: "50%",
                      transform: "translateY(-50%)",
                      width: 16, height: 34, cursor: "ew-resize", zIndex: 10,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <div style={{
                      width: 3, height: 20,
                      background: activeHandle === i
                        ? "linear-gradient(90deg, #6366f1, #818cf8)"
                        : "rgba(255,255,255,0.35)",
                      borderRadius: 2,
                      boxShadow: activeHandle === i
                        ? "0 0 10px rgba(99,102,241,0.6)"
                        : "none",
                      transition: "all 0.15s",
                    }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {tooltip && (
          <div style={{
            position: "absolute", left: `calc(${tooltip.x}px - 18px)`, top: -26,
            background: "rgba(99,102,241,0.95)", color: "#fff",
            padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 700,
            whiteSpace: "nowrap", pointerEvents: "none",
            border: "1px solid rgba(255,255,255,0.15)",
            boxShadow: "0 4px 12px rgba(99,102,241,0.4)",
          }}>
            {(tooltip.value * 100).toFixed(0)}%
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, padding: "0 2px" }}>
        {[0, 25, 50, 75, 100].map((p) => (
          <span key={p} style={{ fontSize: 8, color: "#334155", fontWeight: 600 }}>{p}%</span>
        ))}
      </div>

      <div style={{
        display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8,
        padding: "8px 10px",
        background: "rgba(99,102,241,0.05)",
        borderRadius: 7,
        border: "1px solid rgba(99,102,241,0.12)",
      }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: colors[i] }}>
            <span style={{ fontSize: 11 }}>{ANIM_META[movingSteps[i].animation].icon}</span>
            <span style={{ fontWeight: 600 }}>
              {(seg.from * 100).toFixed(0)}%–{(seg.to * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */

export function CharacterSequencePopup({ trackId, pathEndPoint, canvasEl, onClose, onBack }: Props) {
  const { tracks, commitCharacterSequenceAction, updateTrack } = useEditorStore();
  const track = tracks.find((t) => t.id === trackId);

  const hasPath = !!(track?.pathAnimation && track.pathAnimation.points.length > 1);

  const [steps, setSteps] = useState<SequenceStep[]>(() =>
    hasPath
      ? distributePathSegments([
          { id: uid(), animation: "Idle", duration: 2 },
          { id: uid(), animation: "walk", duration: 5 },
          { id: uid(), animation: "Idle", duration: 2 },
        ])
      : [
          { id: uid(), animation: "Idle", duration: 2 },
          { id: uid(), animation: "walk", duration: 3 },
          { id: uid(), animation: "Idle", duration: 1 },
        ]
  );

  const [pos, setPos]               = useState<{ screenX: number; screenY: number } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const popupRef                    = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pathEndPoint || !canvasEl) return;
    const rect   = canvasEl.getBoundingClientRect();
    // Path points are in the 960×540 logical canvas space (Fabric's fixed size).
    // Scale them to screen pixels using the CSS display size of the canvas element.
    // We use canvasEl.width/height but clamp to logical dimensions in case the
    // browser has applied DPR scaling to the backing store.
    const logicalW = Math.min(canvasEl.width,  canvasEl.offsetWidth  || canvasEl.width)  || 960;
    const logicalH = Math.min(canvasEl.height, canvasEl.offsetHeight || canvasEl.height) || 540;
    const scaleX = rect.width  / logicalW;
    const scaleY = rect.height / logicalH;
    let screenX  = rect.left + pathEndPoint.x * scaleX;
    let screenY  = rect.top  + pathEndPoint.y * scaleY;

    const popupWidth  = 420;
    const popupHeight = 560;
    const padding     = 16;
    screenX = Math.max(rect.left + padding, Math.min(screenX, rect.right  - padding - popupWidth));
    screenY = Math.max(rect.top  + padding, Math.min(screenY, rect.bottom - padding - popupHeight));
    setPos({ screenX, screenY });
  }, [pathEndPoint, canvasEl]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!pos) return;
    const startX = e.clientX - pos.screenX;
    const startY = e.clientY - pos.screenY;
    setDragOffset({ x: startX, y: startY });

    const onMove = (ev: MouseEvent) => setPos({
      screenX: ev.clientX - startX,
      screenY: ev.clientY - startY,
    });
    const onUp = () => {
      setDragOffset(null);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const handleChange = useCallback((id: string, updates: Partial<SequenceStep>) => {
    setSteps((prev) => distributePathSegments(
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    ));
  }, []);

  const handleRemove = useCallback((id: string) => {
    setSteps((prev) => distributePathSegments(prev.filter((s) => s.id !== id)));
  }, []);

  const handleAdd = useCallback((anim: CharacterAnimName) => {
    setSteps((prev) => distributePathSegments([...prev, { id: uid(), animation: anim, duration: 4 }]));
  }, []);

  const handleMoveUp = useCallback((id: string) => {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx <= 0) return prev;
      const arr = [...prev];
      [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
      return distributePathSegments(arr);
    });
  }, []);

  const handleMoveDown = useCallback((id: string) => {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx >= prev.length - 1) return prev;
      const arr = [...prev];
      [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
      return distributePathSegments(arr);
    });
  }, []);

  const handleSplitChange = useCallback((splits: number[]) => {
    setSteps((prev) => {
      const movingIndices: number[] = [];
      prev.forEach((s, i) => { if (MOVING_ANIMS.includes(s.animation)) movingIndices.push(i); });
      const allSplits = [0, ...splits, 1];
      const updated   = [...prev];
      movingIndices.forEach((stepIdx, i) => {
        updated[stepIdx] = {
          ...updated[stepIdx],
          pathSegment: {
            from: parseFloat(allSplits[i].toFixed(4)),
            to:   parseFloat(allSplits[i + 1].toFixed(4)),
          },
        };
      });
      return updated;
    });
  }, []);

  const totalDuration = steps.reduce((acc, s) => acc + s.duration, 0);

  const handleApply = () => {
    commitCharacterSequenceAction(trackId, steps);
    if (track) updateTrack(trackId, { endTime: track.startTime + totalDuration });
    onClose();
  };

  if (!pos) return null;

  const TimelinePreview = () => (
    <div style={{
      display: "flex", height: 18, borderRadius: 6, overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.08)", marginBottom: 10,
    }}>
      {steps.map((s) => {
        const pct   = (s.duration / Math.max(totalDuration, 0.01)) * 100;
        const color = (ANIM_META[s.animation] ?? ANIM_META["Idle"]).color;
        return (
          <div
            key={s.id}
            title={`${(ANIM_META[s.animation] ?? ANIM_META["Idle"]).label} · ${s.duration}s`}
            style={{
              width:          `${pct}%`,
              background:     `${color}28`,
              borderRight:    "1px solid rgba(255,255,255,0.06)",
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              fontSize:       10,
              color,
              transition:     "width 0.1s",
              flexShrink:     0,
              overflow:       "hidden",
            }}
          >
            {pct > 7 ? (ANIM_META[s.animation] ?? ANIM_META["Idle"]).icon : ""}
          </div>
        );
      })}
    </div>
  );

  return (
    <div
      ref={popupRef}
      style={{
        position:  "fixed",
        left:      pos.screenX,
        top:       pos.screenY + 12,
        transform: "translate(-50%, 0%)",
        zIndex:    9999,
        cursor:    dragOffset ? "grabbing" : "default",
      }}
    >
      {/* Caret */}
      <div style={{
        position: "absolute", top: -7, left: "50%", transform: "translateX(-50%)",
        width: 0, height: 0,
        borderLeft: "8px solid transparent", borderRight: "8px solid transparent",
        borderBottom: "8px solid rgba(8,10,18,0.99)",
      }} />

      <div style={{
        background:     "rgba(8,10,18,0.99)",
        border:         "1px solid rgba(255,255,255,0.1)",
        borderRadius:   16,
        padding:        "16px 16px 14px",
        width:          400,
        maxHeight:      "88vh",
        overflowY:      "auto",
        boxShadow:      "0 16px 56px rgba(0,0,0,0.85), 0 0 0 1px rgba(99,102,241,0.2)",
        backdropFilter: "blur(20px)",
      }}>

        {/* Header — draggable */}
        <div
          style={{ marginBottom: 12, cursor: "grab", userSelect: "none" }}
          onMouseDown={handleMouseDown}
        >
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>🎬</span>
              <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em" }}>
                Sequence Builder
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{
                fontSize: 10, color: "#6366f1",
                background: "rgba(99,102,241,0.1)",
                border: "1px solid rgba(99,102,241,0.25)",
                borderRadius: 20, padding: "2px 8px", fontWeight: 600,
              }}>
                {totalDuration.toFixed(1)}s
              </span>
              <span style={{
                fontSize: 10, color: "#64748b",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 20, padding: "2px 7px",
              }}>
                {steps.length} steps
              </span>
            </div>
          </div>
          <p style={{ color: "#475569", fontSize: 10, margin: 0, lineHeight: 1.5 }}>
            Click an animation chip to swap · Moving steps share the drawn path
          </p>
        </div>

        {/* Timeline preview */}
        <TimelinePreview />

        {/* Step list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
          {steps.map((step, i) => (
            <StepRow
              key={step.id}
              step={step}
              index={i}
              total={steps.length}
              onChange={handleChange}
              onRemove={handleRemove}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
            />
          ))}
        </div>

        {/* Quick-add bar */}
        <QuickAddBar onAdd={handleAdd} />

        {/* Path segment viz */}
        <PathSegmentViz steps={steps} onSplitChange={handleSplitChange} />

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 7, marginTop: 14 }}>
          <button
            onClick={onBack}
            style={{
              padding: "8px 13px", borderRadius: 9,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "transparent", color: "#475569", fontSize: 11, cursor: "pointer",
              transition: "all 0.12s", flexShrink: 0,
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#94a3b8")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#475569")}
          >
            ← Back
          </button>

          <button
            onClick={handleApply}
            style={{
              flex:           1,
              padding:        "9px 14px",
              borderRadius:   9,
              border:         "1.5px solid rgba(99,102,241,0.5)",
              background:     "linear-gradient(135deg, rgba(99,102,241,0.22) 0%, rgba(168,85,247,0.18) 100%)",
              color:          "#c7d2fe",
              fontSize:       12,
              fontWeight:     700,
              cursor:         "pointer",
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              gap:            6,
              transition:     "all 0.15s",
              letterSpacing:  "0.01em",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = "rgba(99,102,241,0.9)";
              el.style.background  = "linear-gradient(135deg, rgba(99,102,241,0.38) 0%, rgba(168,85,247,0.32) 100%)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = "rgba(99,102,241,0.5)";
              el.style.background  = "linear-gradient(135deg, rgba(99,102,241,0.22) 0%, rgba(168,85,247,0.18) 100%)";
            }}
          >
            🎬 Apply Sequence
          </button>

          <button
            onClick={onClose}
            style={{
              padding: "8px 12px", borderRadius: 9,
              border: "1px solid rgba(255,255,255,0.06)",
              background: "transparent", color: "#374151", fontSize: 11, cursor: "pointer",
              transition: "all 0.12s", flexShrink: 0,
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#64748b")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#374151")}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}