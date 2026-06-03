/**
 * sceneSlice.ts
 *
 * Stores scenes (storyboard) + per-scene canvas snapshots.
 * Canvas snapshots are plain JSON strings produced by fabric's canvas.toJSON().
 * CanvasEditor watches activeSceneId and saves/restores them on switch.
 */

import { StateCreator } from "zustand";
import { EditorState } from "../editorStore";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SceneItem {
  id: string;
  label: string;
  /** Duration in milliseconds */
  duration: number;
  /** Solid background colour */
  bg: string;
  /** Optional image URL used as background (overrides solid bg colour on canvas) */
  bgImageUrl?: string;
  /** Optional Lottie JSON URL used as animated background */
  lottieUrl?: string;
  lottieEmoji?: string;
  /** Thumbnail data URL (captured from canvas) */
  thumbnail?: string;
  /** Ordered list of track IDs that belong to this scene */
  trackIds?: string[];
  /** Transition type from previous scene */
  transition?: "none" | "fade" | "slide" | "zoom" | "wipe";
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
  /** Per-scene canvas JSON snapshots (keyed by scene id) */
  sceneCanvasData: Record<string, string>;

  addScene: (scene?: Partial<Omit<SceneItem, "id">>) => void;
  duplicateScene: (id: string) => void;
  deleteScene: (id: string) => void;
  renameScene: (id: string, label: string) => void;
  setSceneBg: (id: string, bg: string, lottieUrl?: string, lottieEmoji?: string) => void;
  updateSceneDuration: (id: string, ms: number) => void;
  updateSceneTransition: (id: string, transition: SceneItem["transition"]) => void;
  reorderScenes: (fromId: string, toId: string) => void;
  setActiveScene: (id: string) => void;
  updateSceneSnapshot: (id: string, canvasJson: string) => void;
  /** Save canvas JSON for a scene (called before switching away) */
  saveSceneCanvasData: (id: string, json: string) => void;
  /** Get canvas JSON for a scene */
  getSceneCanvasData: (id: string) => string | null;
  /** Save thumbnail data URL for a scene */
  updateSceneThumbnail: (id: string, dataUrl: string) => void;
  /** Update bgImageUrl for a scene (when user drops an image as background) */
  updateSceneBgImage: (id: string, bgImageUrl: string | undefined) => void;
}

const BG_PRESETS = [
  "#0f172a","#1e293b","#334155",
  "#fef9c3","#f0fdf4","#eff6ff",
  "#7c3aed","#0ea5e9","#10b981",
  "#f97316","#ec4899","#ffffff",
];

// ─── Creator ──────────────────────────────────────────────────────────────────

export const createSceneSlice: StateCreator<EditorState, [], [], SceneSlice> = (set, get) => ({
  scenes: DEFAULT_SCENES,
  activeSceneId: DEFAULT_SCENES[0].id,
  sceneCanvasData: {},

  addScene: (partial = {}) => {
    const { scenes } = get();
    const id = mkSceneId();
    const newScene: SceneItem = {
      id,
      label:       partial.label    ?? `Scene ${scenes.length + 1}`,
      duration:    partial.duration ?? 5000,
      bg:          partial.bg       ?? BG_PRESETS[scenes.length % BG_PRESETS.length],
      bgImageUrl:  partial.bgImageUrl,
      lottieUrl:   partial.lottieUrl,
      lottieEmoji: partial.lottieEmoji,
      thumbnail:   partial.thumbnail,
      transition:  "fade",
    };
    set((s) => ({ scenes: [...s.scenes, newScene], activeSceneId: id }));
  },

  duplicateScene: (id) => {
    const { scenes, sceneCanvasData } = get();
    const src = scenes.find((s) => s.id === id);
    if (!src) return;
    const newId = mkSceneId();
    const copy: SceneItem = { ...src, id: newId, label: `${src.label} copy` };
    // Also duplicate canvas data
    const srcData = sceneCanvasData[id];
    set((s) => {
      const idx = s.scenes.findIndex((x) => x.id === id);
      const next = [...s.scenes];
      next.splice(idx + 1, 0, copy);
      return {
        scenes: next,
        activeSceneId: newId,
        sceneCanvasData: srcData
          ? { ...s.sceneCanvasData, [newId]: srcData }
          : s.sceneCanvasData,
      };
    });
  },

  deleteScene: (id) => {
    const { scenes, activeSceneId, sceneCanvasData } = get();
    if (scenes.length <= 1) return;
    const next = scenes.filter((s) => s.id !== id);
    const newActive = id === activeSceneId ? next[0]?.id ?? "" : activeSceneId;
    const nextData = { ...sceneCanvasData };
    delete nextData[id];
    set({ scenes: next, activeSceneId: newActive, sceneCanvasData: nextData });
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

  updateSceneDuration: (id, ms) => {
    set((s) => ({
      scenes: s.scenes.map((x) => (x.id === id ? { ...x, duration: ms } : x)),
    }));
  },

  updateSceneTransition: (id, transition) => {
    set((s) => ({
      scenes: s.scenes.map((x) => (x.id === id ? { ...x, transition } : x)),
    }));
  },

  reorderScenes: (fromId, toId) => {
    if (fromId === toId) return;
    set((s) => {
      const from = s.scenes.findIndex((x) => x.id === fromId);
      const to   = s.scenes.findIndex((x) => x.id === toId);
      if (from < 0 || to < 0) return s;
      const next = [...s.scenes];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return { scenes: next };
    });
  },

  setActiveScene: (id) => set({
    activeSceneId: id,
    // Always reset the playhead to 0 when switching scenes so the yellow
    // seek indicator starts from the beginning of the incoming scene.
    currentTime: 0,
    isPlaying: false,
  }),

  updateSceneSnapshot: (id, canvasJson) => {
    set((s) => ({
      scenes: s.scenes.map((x) =>
        x.id === id ? { ...x, canvasSnapshot: canvasJson } : x
      ),
    }));
  },

  saveSceneCanvasData: (id, json) => {
    set((s) => ({
      sceneCanvasData: { ...s.sceneCanvasData, [id]: json },
    }));
  },

  getSceneCanvasData: (id) => {
    return get().sceneCanvasData[id] ?? null;
  },

  updateSceneThumbnail: (id, dataUrl) => {
    set((s) => ({
      scenes: s.scenes.map((x) => (x.id === id ? { ...x, thumbnail: dataUrl } : x)),
    }));
  },

  updateSceneBgImage: (id, bgImageUrl) => {
    set((s) => ({
      scenes: s.scenes.map((x) => (x.id === id ? { ...x, bgImageUrl } : x)),
    }));
  },
});