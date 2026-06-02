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

export type CharacterAnimName =
  // Core locomotion
  | "Idle" | "walk" | "run" | "jump"
  // Morning / rest
  | "yawn" | "stretch" | "rub_eyes" | "swing_legs_out" | "put_on_shirt"
  // Activity
  | "flip_food" | "eat" | "drink" | "wipe_table" | "read_book"
  | "look_up" | "desk_stretch" | "pick_up_box"
  // Posture
  | "sit_down" | "cross_legs" | "sit_idle" | "lay_down" | "pull_blanket" | "fall_asleep"
  // Social
  | "handshake" | "wave" | "point" | "nod" | "shake_head";

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
  /** Scene this track belongs to */
  sceneId?: string;
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
  ttsParams?: {
    text: string;
    lang: string;
    pitch: number;
    rate: number;
  } | null;
  // Audio post-processing
  audioFilterKeys?: string[];       // active effect keys e.g. ["reverb","pitch_up"]
  audioCleaningKeys?: string[];     // active cleaning keys e.g. ["noise_reduction"]
  processedAudioSrc?: string | null; // blob URL of the processed audio
  originalMediaOffset?: number;     // saved mediaOffset before filter was applied, for restoration
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
  isGif?: boolean;
}