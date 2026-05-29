/**
 * PropActionPopup
 *
 * Appears when the user double-clicks a prop on the canvas (cup or chair).
 * Shows a curated set of character+prop combined actions:
 *
 *  ☕ Cup   → Sip Coffee · Look Left · Look Right · Wave with One Hand
 *  🪑 Chair → Walk & Sit · Get Up · Sit Down on Chair
 *
 * Applies the chosen action as a CharacterSequenceAction on ALL character
 * tracks currently on the canvas (or lets the user pick one if multiple exist).
 */

import { useState, useEffect, useRef } from "react";
import { useEditorStore } from "@/stores/editorStore";
import type { CharacterAnimName, SequenceStep } from "@/types";

/* ─── Prop action definitions ─────────────────────────────────────────────── */

type PropActionDef = {
  id: string;
  label: string;
  icon: string;
  description: string;
  color: string;
  steps: Array<{ animation: CharacterAnimName; duration: number; label?: string }>;
};

const CUP_ACTIONS: PropActionDef[] = [
  {
    id: "sip_coffee",
    label: "Sip Coffee",
    icon: "☕",
    description: "Hold cup and take a sip",
    color: "#f59e0b",
    steps: [
      { animation: "Idle",   duration: 1, label: "Stand ready" },
      { animation: "drink",  duration: 3, label: "Sip coffee" },
      { animation: "Idle",   duration: 1, label: "Hold idle" },
    ],
  },
  {
    id: "look_left",
    label: "Look Left",
    icon: "👈",
    description: "Glance left while holding cup",
    color: "#6366f1",
    steps: [
      { animation: "Idle",      duration: 1 },
      { animation: "look_up",   duration: 2, label: "Look left" },
      { animation: "Idle",      duration: 1 },
    ],
  },
  {
    id: "look_right",
    label: "Look Right",
    icon: "👉",
    description: "Glance right while holding cup",
    color: "#8b5cf6",
    steps: [
      { animation: "Idle",      duration: 1 },
      { animation: "look_up",   duration: 2, label: "Look right" },
      { animation: "Idle",      duration: 1 },
    ],
  },
  {
    id: "wave_hand",
    label: "Wave One Hand",
    icon: "👋",
    description: "Wave with free hand while holding cup",
    color: "#10b981",
    steps: [
      { animation: "Idle",  duration: 0.5 },
      { animation: "wave",  duration: 3, label: "Wave" },
      { animation: "Idle",  duration: 1 },
    ],
  },
];

const CHAIR_ACTIONS: PropActionDef[] = [
  {
    id: "walk_and_sit",
    label: "Walk & Sit",
    icon: "🚶",
    description: "Walk over and sit down on the chair",
    color: "#22c55e",
    steps: [
      { animation: "walk",     duration: 3, label: "Walk to chair" },
      { animation: "sit_down", duration: 2, label: "Sit down" },
      { animation: "sit_idle", duration: 2, label: "Seated idle" },
    ],
  },
  {
    id: "get_up",
    label: "Get Up",
    icon: "🧍",
    description: "Stand up from the chair",
    color: "#f97316",
    steps: [
      { animation: "sit_idle", duration: 1, label: "Seated" },
      { animation: "sit_down", duration: 2, label: "Rise" },
      { animation: "Idle",     duration: 1.5, label: "Standing" },
    ],
  },
  {
    id: "sit_down",
    label: "Sit Down",
    icon: "🪑",
    description: "Perform the full sit-down motion",
    color: "#8b5cf6",
    steps: [
      { animation: "Idle",     duration: 0.5 },
      { animation: "sit_down", duration: 2, label: "Sit down" },
      { animation: "sit_idle", duration: 3, label: "Sit idle" },
    ],
  },
  {
    id: "cross_legs_relax",
    label: "Cross Legs & Relax",
    icon: "🧘",
    description: "Sit and cross legs comfortably",
    color: "#e879f9",
    steps: [
      { animation: "sit_down",  duration: 2, label: "Sit down" },
      { animation: "cross_legs",duration: 3, label: "Cross legs" },
      { animation: "sit_idle",  duration: 2, label: "Relax" },
    ],
  },
];

const PROP_CONFIG: Record<string, {
  label: string;
  icon: string;
  accentColor: string;
  actions: PropActionDef[];
}> = {
  cup: {
    label: "Coffee Cup",
    icon: "☕",
    accentColor: "#f59e0b",
    actions: CUP_ACTIONS,
  },
  chair: {
    label: "Chair",
    icon: "🪑",
    accentColor: "#8b5cf6",
    actions: CHAIR_ACTIONS,
  },
  food: {
    label: "Food",
    icon: "🍽️",
    accentColor: "#10b981",
    actions: [
      {
        id: "flip_food_action",
        label: "Flip Food",
        icon: "🍳",
        description: "Walk to stove and flip the food",
        color: "#10b981",
        steps: [
          { animation: "walk",      duration: 2,   label: "Walk to stove" },
          { animation: "flip_food", duration: 3,   label: "Flip food" },
          { animation: "Idle",      duration: 1,   label: "Stand" },
        ],
      },
      {
        id: "eat_food",
        label: "Eat",
        icon: "🍽️",
        description: "Sit down and eat",
        color: "#22c55e",
        steps: [
          { animation: "sit_down", duration: 1.5, label: "Sit" },
          { animation: "eat",      duration: 4,   label: "Eat meal" },
          { animation: "sit_idle", duration: 1,   label: "Finished" },
        ],
      },
      {
        id: "wipe_table_action",
        label: "Wipe Table",
        icon: "🧹",
        description: "Walk over and wipe the table",
        color: "#06b6d4",
        steps: [
          { animation: "walk",       duration: 2, label: "Walk to table" },
          { animation: "wipe_table", duration: 3, label: "Wipe table" },
          { animation: "Idle",       duration: 1, label: "Done" },
        ],
      },
    ],
  },
  long_broom: {
    label: "Long Broom",
    icon: "🧹",
    accentColor: "#06b6d4",
    actions: [
      {
        id: "sweep_floor",
        label: "Sweep Floor",
        icon: "🧹",
        description: "Walk and sweep the floor",
        color: "#06b6d4",
        steps: [
          { animation: "walk",       duration: 3, label: "Walk with broom" },
          { animation: "wipe_table", duration: 4, label: "Sweep" },
          { animation: "Idle",       duration: 1, label: "Done" },
        ],
      },
      {
        id: "pick_up_broom",
        label: "Pick Up & Sweep",
        icon: "📦",
        description: "Pick up the broom and start sweeping",
        color: "#8b5cf6",
        steps: [
          { animation: "pick_up_box", duration: 2, label: "Pick up broom" },
          { animation: "wipe_table",  duration: 4, label: "Sweep floor" },
          { animation: "Idle",        duration: 1, label: "Rest" },
        ],
      },
    ],
  },
  tshirt: {
    label: "T-Shirt",
    icon: "👕",
    accentColor: "#f97316",
    actions: [
      {
        id: "put_on_shirt_action",
        label: "Put On Shirt",
        icon: "👕",
        description: "Pick up and put on the shirt",
        color: "#f97316",
        steps: [
          { animation: "Idle",         duration: 0.5, label: "Ready" },
          { animation: "pick_up_box",  duration: 1.5, label: "Pick up shirt" },
          { animation: "put_on_shirt", duration: 3,   label: "Put it on" },
          { animation: "Idle",         duration: 1,   label: "Done" },
        ],
      },
      {
        id: "stretch_and_dress",
        label: "Stretch & Dress",
        icon: "🙆",
        description: "Morning stretch then put on shirt",
        color: "#f59e0b",
        steps: [
          { animation: "stretch",      duration: 2, label: "Morning stretch" },
          { animation: "put_on_shirt", duration: 3, label: "Put on shirt" },
          { animation: "Idle",         duration: 1, label: "Ready" },
        ],
      },
    ],
  },
  car: {
    label: "Car",
    icon: "🚗",
    accentColor: "#3b82f6",
    actions: [
      {
        id: "walk_to_car",
        label: "Walk to Car",
        icon: "🚶",
        description: "Walk over and get in the car",
        color: "#3b82f6",
        steps: [
          { animation: "walk",     duration: 3, label: "Walk to car" },
          { animation: "sit_down", duration: 2, label: "Get in" },
          { animation: "sit_idle", duration: 2, label: "Seated" },
        ],
      },
      {
        id: "wave_at_car",
        label: "Wave at Car",
        icon: "👋",
        description: "Wave as the car arrives",
        color: "#22c55e",
        steps: [
          { animation: "Idle", duration: 0.5, label: "Wait" },
          { animation: "wave", duration: 3,   label: "Wave" },
          { animation: "Idle", duration: 1,   label: "Done" },
        ],
      },
    ],
  },
};

/* ─── Helper ─────────────────────────────────────────────────────────────── */

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function stepsToSequence(steps: PropActionDef["steps"]): SequenceStep[] {
  return steps.map((s) => ({
    id: uid(),
    animation: s.animation,
    duration: s.duration,
  }));
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */

interface ActionCardProps {
  action: PropActionDef;
  accentColor: string;
  onSelect: (action: PropActionDef) => void;
}

function ActionCard({ action, accentColor: _accent, onSelect }: ActionCardProps) {
  const c = action.color;
  const totalDuration = action.steps.reduce((s, step) => s + step.duration, 0);

  return (
    <button
      onClick={() => onSelect(action)}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        width: "100%",
        padding: "11px 13px",
        borderRadius: 11,
        border: `1.5px solid ${c}33`,
        background: `${c}0b`,
        cursor: "pointer",
        transition: "all 0.15s",
        textAlign: "left",
        gap: 6,
        marginBottom: 7,
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = `${c}1e`;
        el.style.borderColor = `${c}77`;
        el.style.transform = "translateY(-1px)";
        el.style.boxShadow = `0 4px 16px ${c}22`;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = `${c}0b`;
        el.style.borderColor = `${c}33`;
        el.style.transform = "translateY(0)";
        el.style.boxShadow = "none";
      }}
    >
      {/* Top row: icon + label + duration */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
        <span
          style={{
            fontSize: 18,
            lineHeight: 1,
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: `${c}1a`,
            borderRadius: 8,
            flexShrink: 0,
          }}
        >
          {action.icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: c, lineHeight: 1.2 }}>
            {action.label}
          </div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2, lineHeight: 1.3 }}>
            {action.description}
          </div>
        </div>
        <div
          style={{
            fontSize: 9,
            fontWeight: 600,
            color: c,
            background: `${c}1a`,
            border: `1px solid ${c}33`,
            borderRadius: 20,
            padding: "2px 7px",
            flexShrink: 0,
          }}
        >
          {totalDuration}s
        </div>
      </div>

      {/* Step mini-timeline */}
      <div style={{ display: "flex", gap: 3, width: "100%" }}>
        {action.steps.map((step, i) => {
          const pct = (step.duration / totalDuration) * 100;
          return (
            <div
              key={i}
              title={`${step.label ?? step.animation} · ${step.duration}s`}
              style={{
                height: 4,
                width: `${pct}%`,
                background: `${c}${i === 0 ? "55" : i === action.steps.length - 1 ? "33" : "88"}`,
                borderRadius: 2,
                transition: "width 0.1s",
              }}
            />
          );
        })}
      </div>

      {/* Step labels */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 8px" }}>
        {action.steps.map((step, i) => (
          <span
            key={i}
            style={{
              fontSize: 9,
              color: `${c}bb`,
              display: "flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <span style={{ fontSize: 7, opacity: 0.6 }}>
              {i < action.steps.length - 1 ? "▸" : "⬛"}
            </span>
            {step.label ?? step.animation}
          </span>
        ))}
      </div>
    </button>
  );
}

/* ─── Character picker (when multiple characters exist) ──────────────────── */

interface CharPickerProps {
  characterTrackIds: string[];
  selected: string[];
  onToggle: (id: string) => void;
  accentColor: string;
}

function CharPicker({ characterTrackIds, selected, onToggle, accentColor }: CharPickerProps) {
  const { tracks } = useEditorStore();
  const charTracks = tracks.filter((t) => characterTrackIds.includes(t.id));

  if (charTracks.length === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.08em",
          color: "#475569",
          marginBottom: 6,
          textTransform: "uppercase",
        }}
      >
        Apply to character{charTracks.length > 1 ? "s" : ""}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {charTracks.map((t) => {
          const isSelected = selected.includes(t.id);
          return (
            <button
              key={t.id}
              onClick={() => onToggle(t.id)}
              style={{
                padding: "4px 10px",
                borderRadius: 20,
                border: `1.5px solid ${isSelected ? accentColor : "rgba(255,255,255,0.1)"}`,
                background: isSelected ? `${accentColor}22` : "transparent",
                color: isSelected ? accentColor : "#64748b",
                fontSize: 11,
                fontWeight: isSelected ? 700 : 400,
                cursor: "pointer",
                transition: "all 0.12s",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span style={{ fontSize: 13 }}>🧍</span>
              {t.name}
              {isSelected && <span style={{ fontSize: 8, opacity: 0.7 }}>✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Confirmation stage ─────────────────────────────────────────────────── */

interface ConfirmStageProps {
  action: PropActionDef;
  propName: string;
  onApply: () => void;
  onBack: () => void;
}

function ConfirmStage({ action, propName, onApply, onBack }: ConfirmStageProps) {
  const c = action.color;
  const totalDuration = action.steps.reduce((s, step) => s + step.duration, 0);

  return (
    <>
      {/* Preview header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderRadius: 10,
          border: `1.5px solid ${c}44`,
          background: `${c}10`,
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 24 }}>{action.icon}</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: c }}>{action.label}</div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>
            {propName} · {totalDuration}s sequence
          </div>
        </div>
      </div>

      {/* Steps breakdown */}
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: "#475569",
            marginBottom: 7,
            textTransform: "uppercase",
          }}
        >
          Animation steps
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {action.steps.map((step, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: `${c}22`,
                  color: c,
                  fontSize: 8,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </div>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#e2e8f0" }}>
                  {step.label ?? step.animation}
                </span>
              </div>
              <span
                style={{
                  fontSize: 9,
                  color: "#475569",
                  background: "rgba(255,255,255,0.05)",
                  padding: "2px 6px",
                  borderRadius: 10,
                }}
              >
                {step.duration}s
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline preview bar */}
      <div
        style={{
          display: "flex",
          height: 14,
          borderRadius: 6,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.07)",
          marginBottom: 14,
        }}
      >
        {action.steps.map((step, i) => {
          const pct = (step.duration / totalDuration) * 100;
          return (
            <div
              key={i}
              title={`${step.animation} · ${step.duration}s`}
              style={{
                width: `${pct}%`,
                background: `${c}${i % 2 === 0 ? "30" : "18"}`,
                borderRight:
                  i < action.steps.length - 1
                    ? "1px solid rgba(255,255,255,0.06)"
                    : "none",
                transition: "width 0.1s",
              }}
            />
          );
        })}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 7 }}>
        <button
          onClick={onBack}
          style={{
            padding: "8px 13px",
            borderRadius: 9,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "transparent",
            color: "#475569",
            fontSize: 11,
            cursor: "pointer",
            flexShrink: 0,
            transition: "all 0.12s",
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLElement).style.color = "#94a3b8")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLElement).style.color = "#475569")
          }
        >
          ← Back
        </button>

        <button
          onClick={onApply}
          style={{
            flex: 1,
            padding: "9px 14px",
            borderRadius: 9,
            border: `1.5px solid ${c}77`,
            background: `linear-gradient(135deg, ${c}33 0%, ${c}18 100%)`,
            color: "#f1f5f9",
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
            const el = e.currentTarget as HTMLElement;
            el.style.borderColor = `${c}cc`;
            el.style.background = `linear-gradient(135deg, ${c}55 0%, ${c}33 100%)`;
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.style.borderColor = `${c}77`;
            el.style.background = `linear-gradient(135deg, ${c}33 0%, ${c}18 100%)`;
          }}
        >
          ✓ Apply to Character
        </button>
      </div>
    </>
  );
}

/* ─── Main PropActionPopup ───────────────────────────────────────────────── */

export interface PropActionPopupProps {
  propName: string; // "cup" | "chair"
  propPosition: { x: number; y: number }; // canvas coords of the prop
  canvasEl: HTMLCanvasElement | null;
  propTrackId: string; // track id of the prop fabric object
  onClose: () => void;
}

// Seat offset relative to the prop proxy's top-left corner (in proxy pixels).
// These are "where the character's feet should land" relative to the prop.
const PROP_SEAT_OFFSET: Record<string, { x: number; y: number }> = {
  chair: { x: 0.5, y: 0.52 }, // 50% across, 52% down — seat pad of office chair
  cup:   { x: 0.5, y: 1.0  }, // stand in front of cup
};

// Which animation names count as "travel" (i.e. character moves along path)
const TRAVEL_ANIMATIONS = new Set(["walk", "run"]);

export function PropActionPopup({
  propName,
  propPosition,
  canvasEl,
  propTrackId,
  onClose,
}: PropActionPopupProps) {
  const { tracks, commitCharacterSequenceAction, updateTrack, assignPathToTrack, removePathFromTrack } = useEditorStore();

  const config = PROP_CONFIG[propName.toLowerCase()];
  // Fallback: if propName is not in PROP_CONFIG, don't render (already handled by parent checks)
  if (!config) return null;
  const popupRef = useRef<HTMLDivElement>(null);

  // All character tracks on the canvas
  const characterTrackIds = tracks
    .filter((t) => (t.fabricObject as any)?.customType === "character")
    .map((t) => t.id);

  const [selectedAction, setSelectedAction] = useState<PropActionDef | null>(null);
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>(() =>
    characterTrackIds.slice(0, 1)
  );
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);

  // Map canvas coords → screen coords
  useEffect(() => {
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const scaleX = rect.width / (canvasEl.width || rect.width);
    const scaleY = rect.height / (canvasEl.height || rect.height);

    const popupW = 310;
    const popupH = 480;
    const pad = 16;

    let x = rect.left + propPosition.x * scaleX;
    let y = rect.top + propPosition.y * scaleY;

    x = Math.max(rect.left + pad, Math.min(x, rect.right - pad - popupW));
    y = Math.max(rect.top + pad, Math.min(y, rect.bottom - pad - popupH));

    setPos({ x, y });
  }, [propPosition, canvasEl]);

  // Drag to reposition
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!pos) return;
    const startX = e.clientX - pos.x;
    const startY = e.clientY - pos.y;
    setDragOffset({ x: startX, y: startY });

    const onMove = (ev: MouseEvent) =>
      setPos({ x: ev.clientX - startX, y: ev.clientY - startY });
    const onUp = () => {
      setDragOffset(null);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // Click-outside to close
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const handleToggleChar = (id: string) => {
    setSelectedCharIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleApply = () => {
    if (!selectedAction) return;

    const targets =
      selectedCharIds.length > 0 ? selectedCharIds : characterTrackIds;

    // Find which steps are "travel" steps (walk/run) vs stationary
    const hasTravelStep = selectedAction.steps.some((s) =>
      TRAVEL_ANIMATIONS.has(s.animation)
    );

    targets.forEach((trackId) => {
      const track = tracks.find((t) => t.id === trackId);
      if (!track) return;

      const totalDur = selectedAction.steps.reduce((s, st) => s + st.duration, 0);

      if (hasTravelStep) {
        // ── Walk-to-prop mode ────────────────────────────────────────────
        // Compute a straight-line path from the character's current position
        // to just in front of the prop's seat point.

        const charProxy = track.fabricObject as any;
        const charLeft  = charProxy?.left ?? 0;
        const charTop   = charProxy?.top  ?? 0;
        const charW     = charProxy?.charW ?? (charProxy?.width ?? 103);
        const charH     = charProxy?.charH ?? (charProxy?.height ?? 300);

        // Find the prop track to get the prop's canvas position
        const propTrack = tracks.find((t) => t.id === propTrackId);
        const propProxy = propTrack?.fabricObject as any;
        const propLeft  = propProxy?.left  ?? propPosition.x;
        const propTop   = propProxy?.top   ?? propPosition.y;
        const propW     = propProxy?.getScaledWidth?.()  ?? (propProxy?.width  ?? 120);
        const propH     = propProxy?.getScaledHeight?.() ?? (propProxy?.height ?? 100);

        // Seat offset: where the character's feet should land, relative to prop top-left
        const seatPct   = PROP_SEAT_OFFSET[propName.toLowerCase()] ?? { x: 0.5, y: 1.0 };

        // Character foot X = proxy left + charW/2  (character proxy is centered on feet)
        // So: destProxyLeft = seatX - charW/2
        const seatX     = propLeft + propW * seatPct.x;
        const destLeft  = seatX - charW / 2;

        // Keep the character at their current ground Y throughout the walk
        // The DragonBones sit_down animation handles the visual transition
        const walkDestTop = charTop;

        // Build a smooth horizontal path (constant Y = charTop).
        // Use enough sample points for smooth PIXI position updates.
        const SAMPLES = 80;
        const pathPoints = Array.from({ length: SAMPLES + 1 }, (_, i) => ({
          x: charLeft + (destLeft - charLeft) * (i / SAMPLES),
          y: walkDestTop,
        }));

        // Assign path — assignPathToTrack will set originOffset automatically
        // so the proxy starts exactly where it currently is.
        const pathAnim = {
          points: pathPoints,
          totalLength: 0,
          orientToPath: false,
          speed: 1,
        };
        assignPathToTrack(trackId, pathAnim);

        // Build sequence steps with pathSegment markers.
        // Travel steps (walk/run) get a pathSegment fraction of the full path.
        // Stationary steps (sit_down, sit_idle) have no pathSegment — they stay at destination.
        const travelSteps = selectedAction.steps.filter((s) => TRAVEL_ANIMATIONS.has(s.animation));
        const totalTravelDuration = travelSteps.reduce((acc, s) => acc + s.duration, 0);

        let pathCursor = 0;
        const steps = selectedAction.steps.map((s) => {
          const isTravel = TRAVEL_ANIMATIONS.has(s.animation);
          if (isTravel && totalTravelDuration > 0) {
            const segFraction = s.duration / totalTravelDuration;
            const from = pathCursor;
            const to   = Math.min(1, pathCursor + segFraction);
            pathCursor = to;
            return {
              id: uid(),
              animation: s.animation as import("@/types").CharacterAnimName,
              duration: s.duration,
              pathSegment: { from, to },
            };
          }
          return {
            id: uid(),
            animation: s.animation as import("@/types").CharacterAnimName,
            duration: s.duration,
          };
        });

        commitCharacterSequenceAction(trackId, steps);
        updateTrack(trackId, {
          endTime: track.startTime + totalDur,
        });

      } else {
        // ── Stationary sequence (cup actions, get_up, sit_down in place) ──
        // If the track previously had a walk path (e.g. "Walk & Sit"), the
        // character's fabricObject is already at the chair. Clear the path
        // so applyKeyframesAtTime stops overriding position with path coords,
        // then pin a keyframe at the current canvas location.
        if (track.pathAnimation && track.pathAnimation.points.length > 1) {
          const charProxy = track.fabricObject as any;
          if (charProxy) {
            // Freeze initialState at the character's current rendered position
            // so the new sequence starts exactly from the chair / current spot.
            updateTrack(trackId, {
              initialState: {
                left:    charProxy.left    ?? 0,
                top:     charProxy.top     ?? 0,
                scaleX:  charProxy.scaleX  ?? 1,
                scaleY:  charProxy.scaleY  ?? 1,
                angle:   charProxy.angle   ?? 0,
                opacity: charProxy.opacity ?? 1,
              },
            });
          }
          removePathFromTrack(trackId);
        }
        const steps = stepsToSequence(selectedAction.steps);
        commitCharacterSequenceAction(trackId, steps);
        updateTrack(trackId, { endTime: track.startTime + totalDur });
      }
    });

    onClose();
  };

  if (!pos) return null;

  return (
    <div
      ref={popupRef}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y + 12,
        transform: "translate(-50%, 0%)",
        zIndex: 9999,
        cursor: dragOffset ? "grabbing" : "default",
      }}
    >
      {/* Caret */}
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
          borderBottom: "8px solid rgba(8,10,18,0.99)",
        }}
      />

      <div
        style={{
          background: "rgba(8,10,18,0.99)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 16,
          padding: "14px 14px 14px",
          width: 310,
          maxHeight: "82vh",
          overflowY: "auto",
          boxShadow: `0 16px 56px rgba(0,0,0,0.85), 0 0 0 1px ${config.accentColor}33`,
          backdropFilter: "blur(20px)",
        }}
      >
        {/* ── Header (draggable) ── */}
        <div
          style={{ marginBottom: 12, cursor: "grab", userSelect: "none" }}
          onMouseDown={handleMouseDown}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 4,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 20,
                  width: 36,
                  height: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: `${config.accentColor}1a`,
                  borderRadius: 9,
                  border: `1px solid ${config.accentColor}33`,
                }}
              >
                {config.icon}
              </span>
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#e2e8f0",
                    lineHeight: 1.2,
                  }}
                >
                  {config.label} Actions
                </div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
                  {selectedAction
                    ? "Confirm & apply to character"
                    : "Choose an animation to apply"}
                </div>
              </div>
            </div>

            <button
              onClick={onClose}
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "transparent",
                color: "#475569",
                fontSize: 12,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "all 0.12s",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.color = "#94a3b8";
                el.style.background = "rgba(255,255,255,0.05)";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.color = "#475569";
                el.style.background = "transparent";
              }}
            >
              ✕
            </button>
          </div>

          {/* Accent rule */}
          <div
            style={{
              height: 1,
              background: `linear-gradient(90deg, ${config.accentColor}44 0%, transparent 100%)`,
            }}
          />
        </div>

        {/* ── No characters warning ── */}
        {characterTrackIds.length === 0 && (
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: "1px solid rgba(251,191,36,0.25)",
              background: "rgba(251,191,36,0.07)",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#fbbf24",
                marginBottom: 3,
              }}
            >
              ⚠️ No character on canvas
            </div>
            <div style={{ fontSize: 10, color: "#78716c" }}>
              Drag a character from the Characters panel first, then use prop
              actions to animate them together.
            </div>
          </div>
        )}

        {/* ── Character picker ── */}
        {characterTrackIds.length > 0 && (
          <CharPicker
            characterTrackIds={characterTrackIds}
            selected={selectedCharIds}
            onToggle={handleToggleChar}
            accentColor={config.accentColor}
          />
        )}

        {/* ── Action list or confirm stage ── */}
        {!selectedAction ? (
          <div>
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.08em",
                color: "#475569",
                marginBottom: 8,
                textTransform: "uppercase",
              }}
            >
              Available actions
            </div>
            {config.actions.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                accentColor={config.accentColor}
                onSelect={(a) => {
                  if (characterTrackIds.length === 0) return;
                  setSelectedAction(a);
                }}
              />
            ))}
          </div>
        ) : (
          <ConfirmStage
            action={selectedAction}
            propName={config.label}
            onApply={handleApply}
            onBack={() => setSelectedAction(null)}
          />
        )}
      </div>
    </div>
  );
}