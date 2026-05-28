import { FabricObject } from "fabric";

export interface Keyframe {
  id: string;
  time: number;
  properties: {
    left?: number;
    top?: number;
    scaleX?: number;
    scaleY?: number;
    angle?: number;
    opacity?: number;
    [key: string]: any;
  };
  easing: string;
}

export interface PathPoint {
  x: number;
  y: number;
}

export interface PathAnimation {
  points: PathPoint[];
  totalLength: number;
  fabricPathId?: string;
  orientToPath: boolean;
  originOffset?: PathPoint;
  speed: number;
}

// ── Sequence types ──────────────────────────────────────────────────────────

export type CharacterAnimName = "Idle" | "walk" | "run" | "jump";

/**
 * One step in a multi-step character sequence.
 *
 * - `animation`   : which DragonBones anim to play during this step
 * - `duration`    : how long this step lasts (seconds)
 * - `pathSegment` : if this is a moving step, the [from,to] slice of the
 *                   drawn path it consumes (values 0..1).
 *                   Stationary steps (Idle) have this undefined.
 */
export interface SequenceStep {
  id: string;
  animation: CharacterAnimName;
  duration: number;
  pathSegment?: {
    from: number; // 0..1 along the full drawn path
    to: number;
  };
}

/**
 * Compiled sequence action stored on the track after the user presses
 * "Apply Sequence" in CharacterSequencePopup.
 */
export interface CharacterSequenceAction {
  steps: SequenceStep[];
}

// ───────────────────────────────────────────────────────────────────────────

export interface CharacterPathAction {
  travelAnim: CharacterAnimName;       // animation while travelling
  arrivalBehavior: "keep" | "idle";   // what to do when path ends
}

export interface TrackObject {
  id: string;
  name: string;
  type: "visual" | "audio" | "video";
  fabricObject: FabricObject | null;
  startTime: number;
  endTime: number;
  keyframes: Keyframe[];
  color: string;
  initialState: any;
  audioElement?: HTMLAudioElement | null;
  audioSrc?: string;
  mediaDuration?: number;
  mediaOffset?: number;
  imageFilters?: string[];
  pathAnimation?: PathAnimation | null;
  volume?: number;
  // Character-specific
  characterAnimation?: string | null;        // current DragonBones anim e.g. "Idle","walk","run"
  pendingPathAction?: CharacterPathAction | null;
  sequenceAction?: CharacterSequenceAction | null; // set by commitCharacterSequenceAction
}

export interface Asset {
  id: string;
  name: string;
  type: "item" | "background" | "audio" | "video" | "character";
  color?: string;
  icon?: string;
  src?: string;
}
