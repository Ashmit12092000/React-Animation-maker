import { StateCreator } from "zustand";
import { EditorState } from "../editorStore";
import { TrackObject } from "../../types";
import { FabricImage, filters } from "fabric";

export interface HistorySlice {
  past: TrackObject[][];
  future: TrackObject[][];
  saveCheckpoint: () => void;
  undo: () => void;
  redo: () => void;
  captureState: (trackId: string) => void;
}

const cloneTracksForHistory = (tracks: TrackObject[]): TrackObject[] => {
  return tracks.map((t) => ({
    ...t,
    keyframes: JSON.parse(JSON.stringify(t.keyframes)),
    initialState: { ...t.initialState },
    imageFilters: t.imageFilters ? [...t.imageFilters] : undefined,
    fabricObject: t.fabricObject,
    audioElement: t.audioElement,
    audioSrc: t.audioSrc,
  }));
};

const buildImageFilters = (filterKeys: string[]) => {
  const map: Record<string, () => any> = {
    grayscale: () => new filters.Grayscale(),
    sepia: () => new filters.Sepia(),
    vintage: () => new filters.Vintage(),
    blur: () => new filters.Blur({ blur: 0.2 }),
    contrast: () => new filters.Contrast({ contrast: 0.2 }),
    brightness: () => new filters.Brightness({ brightness: 0.1 }),
  };

  return filterKeys.map((key) => map[key]).filter(Boolean).map((factory) => factory());
};

export const createHistorySlice: StateCreator<EditorState, [], [], HistorySlice> = (set, get) => ({
  past: [],
  future: [],

  saveCheckpoint: () => {
    const { tracks, past } = get();
    // Limit history size to 50 steps
    const newPast = [...past, cloneTracksForHistory(tracks)].slice(-50);
    set({ past: newPast, future: [] });
  },

  undo: () => {
    const { past, future, tracks, canvas, currentTime } = get();
    if (past.length === 0) return;

    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);

    set({
      past: newPast,
      tracks: previous,
      future: [cloneTracksForHistory(tracks), ...future],
    });

    if (canvas) {
      const prevIds = new Set(previous.map((t) => t.id));

      // Cleanup objects not in previous state
      canvas.getObjects().forEach((obj) => {
        if ((obj as any).customType === "background") return;
        const cid = (obj as any)._customId;
        if (cid && !prevIds.has(cid)) {
          canvas.remove(obj);
        }
      });

      // Restore objects
      previous.forEach((track) => {
        const applyState = (obj: any) => {
          const s = (track.initialState || {}) as any;
          obj.set({
            left: s.left ?? obj.left,
            top: s.top ?? obj.top,
            scaleX: s.scaleX ?? obj.scaleX,
            scaleY: s.scaleY ?? obj.scaleY,
            angle: s.angle ?? obj.angle,
            opacity: s.opacity ?? obj.opacity,
            flipX: s.flipX ?? obj.flipX,
            flipY: s.flipY ?? obj.flipY,
          });
          if (track.imageFilters && (obj.type === "image" || obj.customType === "image" || obj.customType === "background")) {
            obj.filters = buildImageFilters(track.imageFilters);
            obj.applyFilters();
            obj._imageFilters = [...track.imageFilters];
          } else if (track.imageFilters && track.imageFilters.length === 0) {
            obj.filters = [];
            obj.applyFilters();
            obj._imageFilters = [];
          }
          obj.setCoords();
        };

        const recreateVideoIfNeeded = () => {
          if (track.type !== "video" || !track.audioSrc) return false;

          const videoEl = document.createElement("video");
          videoEl.src = track.audioSrc;
          videoEl.preload = "auto";
          videoEl.crossOrigin = "anonymous";
          videoEl.muted = true;
          videoEl.playsInline = true;
          videoEl.loop = false;
          videoEl.style.display = "none";
          videoEl.width = 480;
          videoEl.height = 360;

          document.body.appendChild(videoEl);

          const fabricVideo = new FabricImage(videoEl as any, {
            left: 0,
            top: 0,
            objectCaching: false,
          });

          (fabricVideo as any)._customId = track.id;
          (fabricVideo as any).customType = "video";
          (fabricVideo as any)._element = videoEl;

          track.fabricObject = fabricVideo as any;
          applyState(fabricVideo);

          canvas.add(fabricVideo);
          return true;
        };

        const objOnCanvas = canvas
          .getObjects()
          .find((o) => (o as any)._customId === track.id);

        if (objOnCanvas) {
          track.fabricObject = objOnCanvas as any;
          applyState(objOnCanvas);
        } else {
          // FIX: if it's a video track, recreate its fabric object + video element
          if (recreateVideoIfNeeded()) return;

          if (track.fabricObject && !canvas.contains(track.fabricObject)) {
            canvas.add(track.fabricObject);
          }
        }
      });

      set({ tracks: previous });
      get().applyKeyframesAtTime(currentTime);
      canvas.requestRenderAll();
    }
  },

  redo: () => {
    const { past, future, tracks, canvas, currentTime } = get();
    if (future.length === 0) return;

    const next = future[0];
    const newFuture = future.slice(1);

    set({
      past: [...past, cloneTracksForHistory(tracks)],
      tracks: next,
      future: newFuture,
    });

    if (canvas) {
      const nextIds = new Set(next.map((t) => t.id));

      canvas.getObjects().forEach((obj) => {
        if ((obj as any).customType === "background") return;
        const cid = (obj as any)._customId;
        if (cid && !nextIds.has(cid)) {
          canvas.remove(obj);
        }
      });

      next.forEach((track) => {
        const applyState = (obj: any) => {
          const s = (track.initialState || {}) as any;
          obj.set({
            left: s.left ?? obj.left,
            top: s.top ?? obj.top,
            scaleX: s.scaleX ?? obj.scaleX,
            scaleY: s.scaleY ?? obj.scaleY,
            angle: s.angle ?? obj.angle,
            opacity: s.opacity ?? obj.opacity,
            flipX: s.flipX ?? obj.flipX,
            flipY: s.flipY ?? obj.flipY,
          });
          if (track.imageFilters && (obj.type === "image" || obj.customType === "image" || obj.customType === "background")) {
            obj.filters = buildImageFilters(track.imageFilters);
            obj.applyFilters();
            obj._imageFilters = [...track.imageFilters];
          } else if (track.imageFilters && track.imageFilters.length === 0) {
            obj.filters = [];
            obj.applyFilters();
            obj._imageFilters = [];
          }
          obj.setCoords();
        };

        const recreateVideoIfNeeded = () => {
          if (track.type !== "video" || !track.audioSrc) return false;

          const videoEl = document.createElement("video");
          videoEl.src = track.audioSrc;
          videoEl.preload = "auto";
          videoEl.crossOrigin = "anonymous";
          videoEl.muted = true;
          videoEl.playsInline = true;
          videoEl.loop = false;
          videoEl.style.display = "none";
          videoEl.width = 480;
          videoEl.height = 360;

          document.body.appendChild(videoEl);

          const fabricVideo = new FabricImage(videoEl as any, {
            left: 0,
            top: 0,
            objectCaching: false,
          });

          (fabricVideo as any)._customId = track.id;
          (fabricVideo as any).customType = "video";
          (fabricVideo as any)._element = videoEl;

          track.fabricObject = fabricVideo as any;
          applyState(fabricVideo);

          canvas.add(fabricVideo);
          return true;
        };

        const objOnCanvas = canvas
          .getObjects()
          .find((o) => (o as any)._customId === track.id);

        if (objOnCanvas) {
          track.fabricObject = objOnCanvas as any;
          applyState(objOnCanvas);
        } else {
          // FIX: if it's a video track, recreate its fabric object + video element
          if (recreateVideoIfNeeded()) return;

          if (track.fabricObject && !canvas.contains(track.fabricObject)) {
            canvas.add(track.fabricObject);
          }
        }
      });

      set({ tracks: next });
      get().applyKeyframesAtTime(currentTime);
      canvas.requestRenderAll();
    }
  },

  captureState: (trackId) => {
    get().saveCheckpoint();
    set((state) => ({
      tracks: state.tracks.map((t) => {
        if (t.id === trackId && t.fabricObject) {
          const o = t.fabricObject;
          return {
            ...t,
            initialState: {
              ...t.initialState,
              left: o.left ?? 0,
              top: o.top ?? 0,
              scaleX: o.scaleX ?? 1,
              scaleY: o.scaleY ?? 1,
              angle: o.angle ?? 0,
              opacity: o.opacity ?? 1,
              flipX: o.flipX ?? false, 
              flipY: o.flipY ?? false, 
            },
          };
        }
        return t;
      }),
    }));
  },
});
