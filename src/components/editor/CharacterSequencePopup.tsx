/**
 * CharacterSequencePopup
 *
 * Advanced "Sequence Builder" popup that appears when the user chooses
 * "Sequence Builder" from the CharacterPathPopup.
 *
 * Lets the user define a multi-step choreography, for example:
 *   1. Idle  · 6 s  · (no movement)
 *   2. Walk  · 10 s · path A→B  (0% → 60%)
 *   3. Idle  · 4 s  · (no movement, stays at 60%)
 *   4. Run   · 5 s  · path B→C  (60% → 100%)
 *
 * Path segments are auto-distributed among the moving steps, but the
 * user can drag the split handles to redistribute them.
 *
 * On "Apply", it calls commitCharacterSequenceAction with the compiled
 * steps and sets the track duration to the total sequence duration.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useEditorStore } from "@/stores/editorStore";
import type { SequenceStep, CharacterAnimName } from "@/types";

interface Props {
  trackId: string;
  pathEndPoint: { x: number; y: number } | null;
  canvasEl: HTMLCanvasElement | null;
  onClose: () => void;
  /** Called to go back to the mode-selection screen */
  onBack: () => void;
}

/* ─── Constants ──────────────────────────────────────────────────────────── */

const ANIM_LABELS: Record<CharacterAnimName, string> = {
  Idle: "Idle",
  walk: "Walk",
  run: "Run",
};
const ANIM_ICONS: Record<CharacterAnimName, string> = {
  Idle: "🧍",
  walk: "🚶",
  run: "🏃",
};
const ANIM_COLORS: Record<CharacterAnimName, string> = {
  Idle: "#6366f1",
  walk: "#22c55e",
  run: "#f97316",
};

const ANIMATIONS: CharacterAnimName[] = ["Idle", "walk", "run"];

const MOVING_ANIMS: CharacterAnimName[] = ["walk", "run"];

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

/* ─── helpers ────────────────────────────────────────────────────────────── */

/** Distribute path [0..1] equally across moving steps */
function distributePathSegments(steps: SequenceStep[]): SequenceStep[] {
  const movingCount = steps.filter((s) => MOVING_ANIMS.includes(s.animation)).length;
  if (movingCount === 0) return steps.map((s) => ({ ...s, pathSegment: undefined }));

  const segSize = 1 / movingCount;
  let idx = 0;
  return steps.map((s) => {
    if (!MOVING_ANIMS.includes(s.animation)) return { ...s, pathSegment: undefined };
    const from = idx * segSize;
    const to = (idx + 1) * segSize;
    idx++;
    return { ...s, pathSegment: { from: parseFloat(from.toFixed(4)), to: parseFloat(to.toFixed(4)) } };
  });
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */

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
  const isMoving = MOVING_ANIMS.includes(step.animation);
  const color = ANIM_COLORS[step.animation];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        borderRadius: 10,
        border: `1.5px solid ${color}33`,
        background: `${color}0d`,
        position: "relative",
        transition: "all 0.15s",
      }}
    >
      {/* Step number badge */}
      <div
        style={{
          minWidth: 22,
          height: 22,
          borderRadius: "50%",
          background: `${color}33`,
          color: color,
          fontSize: 10,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {index + 1}
      </div>

      {/* Animation selector */}
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {ANIMATIONS.map((anim) => (
          <button
            key={anim}
            title={ANIM_LABELS[anim]}
            onClick={() => onChange(step.id, { animation: anim })}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: `1.5px solid ${step.animation === anim ? ANIM_COLORS[anim] : "rgba(255,255,255,0.1)"}`,
              background: step.animation === anim ? `${ANIM_COLORS[anim]}22` : "transparent",
              cursor: "pointer",
              fontSize: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.12s",
            }}
          >
            {ANIM_ICONS[anim]}
          </button>
        ))}
      </div>

      {/* Duration input */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0 }}>
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
          style={{
            width: 56,
            padding: "4px 6px",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.06)",
            color: "#e2e8f0",
            fontSize: 12,
            textAlign: "center",
            outline: "none",
          }}
        />
        <span style={{ color: "#64748b", fontSize: 11, flexShrink: 0 }}>s</span>

        {/* Moving indicator badge */}
        <span
          style={{
            fontSize: 10,
            color: isMoving ? color : "#4b5563",
            background: isMoving ? `${color}18` : "rgba(255,255,255,0.04)",
            border: `1px solid ${isMoving ? color + "44" : "rgba(255,255,255,0.08)"}`,
            borderRadius: 20,
            padding: "1px 7px",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          {isMoving ? "↗ moves" : "⬛ stays"}
        </span>
      </div>

      {/* Reorder / remove controls */}
      <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
        <button
          onClick={() => onMoveUp(step.id)}
          disabled={index === 0}
          title="Move up"
          style={iconBtnStyle(index === 0)}
        >
          ▲
        </button>
        <button
          onClick={() => onMoveDown(step.id)}
          disabled={index === total - 1}
          title="Move down"
          style={iconBtnStyle(index === total - 1)}
        >
          ▼
        </button>
        <button
          onClick={() => onRemove(step.id)}
          disabled={total <= 1}
          title="Remove step"
          style={iconBtnStyle(total <= 1, "#ef4444")}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function iconBtnStyle(disabled: boolean, hoverColor = "#94a3b8"): React.CSSProperties {
  return {
    width: 24,
    height: 24,
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "transparent",
    color: disabled ? "#334155" : "#64748b",
    fontSize: 9,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.12s",
    pointerEvents: disabled ? "none" : "auto",
  };
}

/* ─── Path segment visualiser ────────────────────────────────────────────── */

interface PathSegVizProps {
  steps: SequenceStep[];
  onSplitChange: (splits: number[]) => void; // array of split points [0..1]
}

function PathSegmentViz({ steps, onSplitChange }: PathSegVizProps) {
  const movingSteps = steps.filter((s) => MOVING_ANIMS.includes(s.animation));
  if (movingSteps.length === 0) return null;

  // Build segment data from pathSegment values
  const segments = movingSteps.map((s) => s.pathSegment!);
  // Split points (boundaries between segments)
  const splits = segments.slice(0, -1).map((s) => s.to);

  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const [activeHandle, setActiveHandle] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; value: number } | null>(null);

  const SNAP_INCREMENT = 0.05; // 5% snap grid
  const MIN_SEGMENT_SIZE = 0.1; // 10% minimum segment size

  const snapToGrid = (value: number): number => {
    return Math.round(value / SNAP_INCREMENT) * SNAP_INCREMENT;
  };

  const handleMouseDown = (splitIdx: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = splitIdx;
    setActiveHandle(splitIdx);

    const onMove = (ev: MouseEvent) => {
      if (dragging.current === null || !barRef.current) return;
      const rect = barRef.current.getBoundingClientRect();
      let t = (ev.clientX - rect.left) / rect.width;

      // Snap to grid
      t = snapToGrid(t);

      // Enforce minimum segment sizes
      const newSplits = [...splits];
      
      // Check left segment size (distance from previous split to this one)
      const prevSplit = splitIdx === 0 ? 0 : newSplits[splitIdx - 1];
      t = Math.max(prevSplit + MIN_SEGMENT_SIZE, t);

      // Check right segment size (distance from this split to next split)
      const nextSplit = splitIdx === newSplits.length - 1 ? 1 : newSplits[splitIdx + 1];
      t = Math.min(nextSplit - MIN_SEGMENT_SIZE, t);

      // Clamp to valid range
      t = Math.max(0.01, Math.min(0.99, t));
      newSplits[dragging.current!] = t;

      setTooltip({
        x: ev.clientX - rect.left,
        y: -10,
        value: t,
      });

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

  const colors = movingSteps.map((s) => ANIM_COLORS[s.animation]);

  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          fontSize: 11,
          color: "#cbd5e1",
          marginBottom: 10,
          letterSpacing: "0.05em",
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>Path Distribution</span>
        <span style={{ fontSize: 9, color: "#64748b", fontWeight: 400 }}>
          Drag handles to adjust • Snap: 5% grid
        </span>
      </div>

      <div style={{ position: "relative" }}>
        {/* Main bar */}
        <div
          ref={barRef}
          style={{
            position: "relative",
            height: 36,
            borderRadius: 10,
            overflow: "visible",
            display: "flex",
            border: "2px solid rgba(99,102,241,0.3)",
            background: "rgba(99,102,241,0.05)",
            userSelect: "none",
            boxShadow: "inset 0 2px 8px rgba(0,0,0,0.3)",
          }}
        >
          {/* Grid lines background */}
          {[...Array(10)].map((_, i) => (
            <div
              key={`grid-${i}`}
              style={{
                position: "absolute",
                left: `${i * 10}%`,
                top: 0,
                bottom: 0,
                width: "1px",
                background: "rgba(255,255,255,0.03)",
                pointerEvents: "none",
              }}
            />
          ))}

          {/* Segments */}
          {segments.map((seg, i) => {
            const width = (seg.to - seg.from) * 100;
            return (
              <div
                key={i}
                style={{
                  position: "relative",
                  width: `${width}%`,
                  height: "100%",
                  background: `linear-gradient(135deg, ${colors[i]}40 0%, ${colors[i]}20 100%)`,
                  borderRight:
                    i < segments.length - 1
                      ? `3px solid rgba(99,102,241,0.2)`
                      : "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: activeHandle === i ? "none" : "width 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  overflow: "hidden",
                }}
              >
                {/* Segment content */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 2,
                    pointerEvents: "none",
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      color: colors[i],
                      fontWeight: 700,
                      textShadow: "0 1px 2px rgba(0,0,0,0.5)",
                    }}
                  >
                    {ANIM_ICONS[movingSteps[i].animation]}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: colors[i],
                      fontWeight: 600,
                      opacity: width > 15 ? 1 : 0,
                    }}
                  >
                    {width.toFixed(0)}%
                  </span>
                </div>

                {/* Drag handle */}
                {i < segments.length - 1 && (
                  <div
                    onMouseDown={handleMouseDown(i)}
                    onMouseEnter={() => setActiveHandle(i)}
                    onMouseLeave={() => {
                      if (dragging.current !== i) setActiveHandle(null);
                    }}
                    style={{
                      position: "absolute",
                      right: -8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 16,
                      height: 40,
                      cursor: "ew-resize",
                      zIndex: 10,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.2s ease",
                    }}
                  >
                    {/* Handle visual */}
                    <div
                      style={{
                        position: "absolute",
                        width: 4,
                        height: 24,
                        background:
                          activeHandle === i
                            ? `linear-gradient(90deg, #6366f1 0%, #818cf8 100%)`
                            : "rgba(255,255,255,0.4)",
                        borderRadius: 2,
                        boxShadow:
                          activeHandle === i
                            ? "0 0 12px rgba(99,102,241,0.6), 0 0 20px rgba(99,102,241,0.4)"
                            : "none",
                        transition: "all 0.2s ease",
                      }}
                    />
                    {/* Handle border ring */}
                    {activeHandle === i && (
                      <div
                        style={{
                          position: "absolute",
                          width: 16,
                          height: 40,
                          border: "2px solid rgba(99,102,241,0.5)",
                          borderRadius: 4,
                          pointerEvents: "none",
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Tooltip during drag */}
        {tooltip && (
          <div
            style={{
              position: "absolute",
              left: `calc(${tooltip.x}px - 20px)`,
              top: `-30px`,
              background: "rgba(99,102,241,0.95)",
              color: "#fff",
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: "nowrap",
              border: "1px solid rgba(255,255,255,0.2)",
              boxShadow: "0 4px 12px rgba(99,102,241,0.4)",
              pointerEvents: "none",
              backdropFilter: "blur(8px)",
            }}
          >
            {(tooltip.value * 100).toFixed(0)}%
          </div>
        )}
      </div>

      {/* Percentage markers */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 8,
          padding: "0 4px",
        }}
      >
        {[0, 25, 50, 75, 100].map((pct) => (
          <span
            key={pct}
            style={{
              fontSize: 8,
              color: "#475569",
              fontWeight: 600,
              letterSpacing: "0.05em",
            }}
          >
            {pct}%
          </span>
        ))}
      </div>

      {/* Segment info footer */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 10,
          padding: "10px",
          background: "rgba(99,102,241,0.08)",
          borderRadius: 8,
          border: "1px solid rgba(99,102,241,0.15)",
        }}
      >
        {segments.map((seg, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 10,
              color: colors[i],
            }}
          >
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: 4,
                background: `${colors[i]}33`,
                border: `1.5px solid ${colors[i]}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
              }}
            >
              {ANIM_ICONS[movingSteps[i].animation]}
            </div>
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

  // Initial default sequence
  const [steps, setSteps] = useState<SequenceStep[]>(() =>
    distributePathSegments([
      { id: uid(), animation: "Idle", duration: 3 },
      { id: uid(), animation: "walk", duration: 8 },
      { id: uid(), animation: "Idle", duration: 3 },
    ])
  );

  const [pos, setPos] = useState<{ screenX: number; screenY: number } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pathEndPoint || !canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const scaleX = rect.width / (canvasEl.width || rect.width);
    const scaleY = rect.height / (canvasEl.height || rect.height);
    let screenX = rect.left + pathEndPoint.x * scaleX;
    let screenY = rect.top + pathEndPoint.y * scaleY;
    
    // Clamp to canvas bounds with some padding
    const popupWidth = 400;
    const popupHeight = 500;
    const padding = 16;
    
    // Keep popup within horizontal canvas bounds
    screenX = Math.max(rect.left + padding, Math.min(screenX, rect.right - padding - popupWidth));
    
    // Keep popup below the point but within canvas vertical bounds
    const minY = rect.top + padding;
    const maxY = rect.bottom - padding - popupHeight;
    screenY = Math.max(minY, Math.min(screenY, maxY));
    
    setPos({
      screenX,
      screenY,
    });
  }, [pathEndPoint, canvasEl]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!pos) return;
    const startX = e.clientX - pos.screenX;
    const startY = e.clientY - pos.screenY;
    setDragOffset({ x: startX, y: startY });

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newX = moveEvent.clientX - startX;
      const newY = moveEvent.clientY - startY;
      setPos({ screenX: newX, screenY: newY });
    };

    const handleMouseUp = () => {
      setDragOffset(null);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  /* ── Step mutations ── */

  const handleChange = useCallback((id: string, updates: Partial<SequenceStep>) => {
    setSteps((prev) => {
      const updated = prev.map((s) => (s.id === id ? { ...s, ...updates } : s));
      return distributePathSegments(updated);
    });
  }, []);

  const handleRemove = useCallback((id: string) => {
    setSteps((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      return distributePathSegments(filtered);
    });
  }, []);

  const handleAdd = useCallback((anim: CharacterAnimName) => {
    setSteps((prev) => {
      const appended = [...prev, { id: uid(), animation: anim, duration: 4 }];
      return distributePathSegments(appended);
    });
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

  /* ── Path segment split dragging ── */
  const handleSplitChange = useCallback((splits: number[]) => {
    setSteps((prev) => {
      const movingIndices: number[] = [];
      prev.forEach((s, i) => {
        if (MOVING_ANIMS.includes(s.animation)) movingIndices.push(i);
      });
      // Rebuild segments from splits
      const allSplits = [0, ...splits, 1];
      const updated = [...prev];
      movingIndices.forEach((stepIdx, i) => {
        updated[stepIdx] = {
          ...updated[stepIdx],
          pathSegment: {
            from: parseFloat(allSplits[i].toFixed(4)),
            to: parseFloat(allSplits[i + 1].toFixed(4)),
          },
        };
      });
      return updated;
    });
  }, []);

  /* ── Apply ── */
  const totalDuration = steps.reduce((acc, s) => acc + s.duration, 0);

  const handleApply = () => {
    commitCharacterSequenceAction(trackId, steps);
    // Stretch track to match total sequence duration
    if (track) {
      updateTrack(trackId, { endTime: track.startTime + totalDuration });
    }
    onClose();
  };

  if (!pos) return null;

  /* ── Timeline preview bar ── */
  const TimelinePreview = () => (
    <div
      style={{
        display: "flex",
        height: 20,
        borderRadius: 6,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.1)",
        marginBottom: 12,
        position: "relative",
      }}
    >
      {steps.map((s) => {
        const pct = (s.duration / Math.max(totalDuration, 0.01)) * 100;
        const color = ANIM_COLORS[s.animation];
        return (
          <div
            key={s.id}
            title={`${ANIM_LABELS[s.animation]} · ${s.duration}s`}
            style={{
              width: `${pct}%`,
              background: `${color}33`,
              borderRight: "1px solid rgba(255,255,255,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              fontSize: 11,
              color: color,
              transition: "width 0.1s",
              flexShrink: 0,
            }}
          >
            {pct > 8 ? ANIM_ICONS[s.animation] : ""}
          </div>
        );
      })}
    </div>
  );

  return (
    <div
      ref={popupRef}
      style={{
        position: "fixed",
        left: pos.screenX,
        top: pos.screenY + 12,
        transform: "translate(-50%, 0%)",
        zIndex: 9999,
        cursor: dragOffset ? "grabbing" : "default",
      }}
    >
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
          borderBottom: "8px solid rgba(10,12,20,0.98)",
        }}
      />

      <div
        style={{
          background: "rgba(10,12,20,0.98)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 16,
          padding: "16px 18px 14px",
          width: 380,
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 12px 48px rgba(0,0,0,0.8), 0 0 0 1px rgba(99,102,241,0.25)",
          backdropFilter: "blur(16px)",
        }}
      >
        {/* Header */}
        <div 
          style={{ marginBottom: 14, cursor: "grab", userSelect: "none" }}
          onMouseDown={handleMouseDown}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>🎬</span>
              <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em" }}>
                Sequence Builder
              </span>
            </div>
            <span
              style={{
                fontSize: 10,
                color: "#6366f1",
                background: "rgba(99,102,241,0.12)",
                border: "1px solid rgba(99,102,241,0.3)",
                borderRadius: 20,
                padding: "2px 8px",
                fontWeight: 600,
              }}
            >
              {totalDuration.toFixed(1)}s total
            </span>
          </div>
          <p style={{ color: "#64748b", fontSize: 11, margin: 0, lineHeight: 1.4 }}>
            Define a multi-step choreography. Moving steps share the drawn path.
          </p>
        </div>

        {/* Timeline preview */}
        <TimelinePreview />

        {/* Step list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
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

        {/* Add step buttons */}
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {ANIMATIONS.map((anim) => (
            <button
              key={anim}
              onClick={() => handleAdd(anim)}
              style={{
                flex: 1,
                padding: "7px 4px",
                borderRadius: 8,
                border: `1px solid ${ANIM_COLORS[anim]}33`,
                background: "rgba(255,255,255,0.03)",
                color: ANIM_COLORS[anim],
                fontSize: 11,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                transition: "all 0.12s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = `${ANIM_COLORS[anim]}18`;
                (e.currentTarget as HTMLElement).style.borderColor = `${ANIM_COLORS[anim]}66`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
                (e.currentTarget as HTMLElement).style.borderColor = `${ANIM_COLORS[anim]}33`;
              }}
            >
              <span style={{ fontSize: 14 }}>+ {ANIM_ICONS[anim]}</span>
              <span style={{ fontSize: 9, opacity: 0.7 }}>{ANIM_LABELS[anim]}</span>
            </button>
          ))}
        </div>

        {/* Path segment visualiser */}
        <PathSegmentViz steps={steps} onSplitChange={handleSplitChange} />

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button
            onClick={onBack}
            style={{
              flex: "0 0 auto",
              padding: "8px 14px",
              borderRadius: 9,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "transparent",
              color: "#64748b",
              fontSize: 12,
              cursor: "pointer",
              transition: "all 0.12s",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#94a3b8")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#64748b")}
          >
            ← Back
          </button>

          <button
            onClick={handleApply}
            style={{
              flex: 1,
              padding: "9px 14px",
              borderRadius: 9,
              border: "1.5px solid rgba(99,102,241,0.5)",
              background: "linear-gradient(135deg, rgba(99,102,241,0.25) 0%, rgba(168,85,247,0.2) 100%)",
              color: "#c7d2fe",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              transition: "all 0.15s",
              letterSpacing: "0.01em",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(99,102,241,0.9)";
              (e.currentTarget as HTMLElement).style.background =
                "linear-gradient(135deg, rgba(99,102,241,0.4) 0%, rgba(168,85,247,0.35) 100%)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(99,102,241,0.5)";
              (e.currentTarget as HTMLElement).style.background =
                "linear-gradient(135deg, rgba(99,102,241,0.25) 0%, rgba(168,85,247,0.2) 100%)";
            }}
          >
            🎬 Apply Sequence
          </button>

          <button
            onClick={onClose}
            style={{
              flex: "0 0 auto",
              padding: "8px 14px",
              borderRadius: 9,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "transparent",
              color: "#475569",
              fontSize: 12,
              cursor: "pointer",
              transition: "all 0.12s",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#64748b")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#475569")}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
