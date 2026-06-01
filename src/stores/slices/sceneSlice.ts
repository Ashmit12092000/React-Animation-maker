/**
 * sceneSlice.ts
 *
 * Zustand slice that holds the Canva/Animaker-style storyboard scenes.
 * The SceneManagerPanel drives writes; the Timeline / CanvasEditor
 * can read `activeSceneId` and `scenes` to implement per-scene playback.
 */

import { StateCreator } from "zustand";
import { EditorState } from "../editorStore";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SceneItem {
  id: string;
  label: string;
  /** Duration in milliseconds */
  duration: number;
  /** Solid background colour for the thumbnail swatch */
  bg: string;
  /** Optional Lottie JSON URL used as animated background */
  lottieUrl?: string;
  lottieEmoji?: string;
  /** Snapshot of canvas JSON for this scene (saved when leaving the scene) */
  canvasSnapshot?: string;
  /** Ordered list of track IDs that belong to this scene */
  trackIds?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _uid = 0;
export const mkSceneId = () => `scene-${Date.now()}-${++_uid}`;

const DEFAULT_SCENES: SceneItem[] = [
  { id: mkSceneId(), label: "Scene 1", duration: 5000, bg: "#0f172a" },
  { id: mkSceneId(), label: "Scene 2", duration: 4000, bg: "#1e1b4b" },
];

// ─── Slice interface ──────────────────────────────────────────────────────────

export interface SceneSlice {
  scenes: SceneItem[];
  activeSceneId: string;

  addScene: (scene?: Partial<Omit<SceneItem, "id">>) => void;
  duplicateScene: (id: string) => void;
  deleteScene: (id: string) => void;
  renameScene: (id: string, label: string) => void;
  setSceneBg: (id: string, bg: string, lottieUrl?: string, lottieEmoji?: string) => void;
  reorderScenes: (fromId: string, toId: string) => void;
  setActiveScene: (id: string) => void;
  updateSceneSnapshot: (id: string, canvasJson: string) => void;
}

const BG_PRESETS = [
  "#0f172a", "#1e293b", "#334155",
  "#fef9c3", "#f0fdf4", "#eff6ff",
  "#7c3aed", "#0ea5e9", "#10b981",
  "#f97316", "#ec4899", "#ffffff",
];

// ─── Creator ──────────────────────────────────────────────────────────────────

export const createSceneSlice: StateCreator<EditorState, [], [], SceneSlice> = (set, get) => ({
  scenes: DEFAULT_SCENES,
  activeSceneId: DEFAULT_SCENES[0].id,

  addScene: (partial = {}) => {
    const { scenes } = get();
    const id = mkSceneId();
    const newScene: SceneItem = {
      id,
      label: partial.label ?? `Scene ${scenes.length + 1}`,
      duration: partial.duration ?? 5000,
      bg: partial.bg ?? BG_PRESETS[scenes.length % BG_PRESETS.length],
      lottieUrl: partial.lottieUrl,
      lottieEmoji: partial.lottieEmoji,
    };
    set((s) => ({ scenes: [...s.scenes, newScene], activeSceneId: id }));
  },

  duplicateScene: (id) => {
    const { scenes } = get();
    const src = scenes.find((s) => s.id === id);
    if (!src) return;
    const newId = mkSceneId();
    const copy: SceneItem = { ...src, id: newId, label: `${src.label} copy` };
    set((s) => {
      const idx = s.scenes.findIndex((x) => x.id === id);
      const next = [...s.scenes];
      next.splice(idx + 1, 0, copy);
      return { scenes: next, activeSceneId: newId };
    });
  },

  deleteScene: (id) => {
    const { scenes, activeSceneId } = get();
    if (scenes.length <= 1) return;
    const next = scenes.filter((s) => s.id !== id);
    const newActive = id === activeSceneId ? next[0]?.id ?? "" : activeSceneId;
    set({ scenes: next, activeSceneId: newActive });
  },

  renameScene: (id, label) => {
    set((s) => ({
      scenes: s.scenes.map((x) => (x.id === id ? { ...x, label } : x)),
    }));
  },

  setSceneBg: (id, bg, lottieUrl, lottieEmoji) => {
    set((s) => ({
      scenes: s.scenes.map((x) =>
        x.id === id ? { ...x, bg, lottieUrl, lottieEmoji } : x
      ),
    }));
  },

  reorderScenes: (fromId, toId) => {
    if (fromId === toId) return;
    set((s) => {
      const from = s.scenes.findIndex((x) => x.id === fromId);
      const to = s.scenes.findIndex((x) => x.id === toId);
      if (from < 0 || to < 0) return s;
      const next = [...s.scenes];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return { scenes: next };
    });
  },

  setActiveScene: (id) => set({ activeSceneId: id }),

  updateSceneSnapshot: (id, canvasJson) => {
    set((s) => ({
      scenes: s.scenes.map((x) =>
        x.id === id ? { ...x, canvasSnapshot: canvasJson } : x
      ),
    }));
  },
});
