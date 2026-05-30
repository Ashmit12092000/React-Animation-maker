import { StateCreator } from "zustand";
import { EditorState } from "../editorStore";
import { TrackObject } from "../../types";
import { FabricImage, Path, filters, util } from "fabric";

// ── Serialized drawing object stored in history ────────────────────────────
interface SerializedDrawing {
  _customId: string;
  path: any[];
  stroke: string;
  strokeWidth: number;
  strokeLineCap: string;
  strokeLineJoin: string;
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  opacity: number;
  pathOffset?: { x: number; y: number };
}

// ── History snapshot captures both tracks AND canvas drawings ──────────────
export interface HistorySnapshot {
  tracks: TrackObject[];
  drawings: SerializedDrawing[];
}

export interface HistorySlice {
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  saveCheckpoint: () => void;
  undo: () => void;
  redo: () => void;
  captureState: (trackId: string) => void;
}

// ── Deep-clone tracks for storage ─────────────────────────────────────────
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

// ── Serialize all drawing objects from the canvas ──────────────────────────
const serializeDrawings = (canvas: any): SerializedDrawing[] => {
  if (!canvas) return [];
  return canvas
    .getObjects()
    .filter((obj: any) => obj.customType === "drawing")
    .map((obj: any) => ({
      _customId: obj._customId ?? `drawing_${Date.now()}_${Math.random()}`,
      path: JSON.parse(JSON.stringify(obj.path || [])),
      stroke: obj.stroke ?? "#ffffff",
      strokeWidth: obj.strokeWidth ?? 6,
      strokeLineCap: obj.strokeLineCap ?? "round",
      strokeLineJoin: obj.strokeLineJoin ?? "round",
      left: obj.left ?? 0,
      top: obj.top ?? 0,
      scaleX: obj.scaleX ?? 1,
      scaleY: obj.scaleY ?? 1,
      angle: obj.angle ?? 0,
      opacity: obj.opacity ?? 1,
      pathOffset: obj.pathOffset ? { ...obj.pathOffset } : undefined,
    }));
};

// ── Restore drawings onto the canvas from serialized state ─────────────────
const restoreDrawings = (canvas: any, drawings: SerializedDrawing[]) => {
  if (!canvas) return;

  // Remove all existing drawing objects
  const existing = canvas
    .getObjects()
    .filter((obj: any) => obj.customType === "drawing");
  existing.forEach((obj: any) => canvas.remove(obj));

  // Re-create each drawing
  drawings.forEach((d) => {
    const newPath = new Path(d.path as any, {
      stroke: d.stroke,
      strokeWidth: d.strokeWidth,
      fill: "",
      strokeLineCap: d.strokeLineCap as any,
      strokeLineJoin: d.strokeLineJoin as any,
      selectable: false,
      evented: false,
      left: d.left,
      top: d.top,
      scaleX: d.scaleX,
      scaleY: d.scaleY,
      angle: d.angle,
      opacity: d.opacity,
    });
    (newPath as any)._customId = d._customId;
    (newPath as any).customType = "drawing";
    canvas.add(newPath);
  });
};

// ── Filter map for rebuilding fabric image filters ─────────────────────────
const buildImageFilters = (filterKeys: string[]) => {
  const map: Record<string, () => any> = {
    grayscale: () => new filters.Grayscale(),
    sepia: () => new filters.Sepia(),
    vintage: () => new filters.Vintage(),
    blur: () => new filters.Blur({ blur: 0.2 }),
    contrast: () => new filters.Contrast({ contrast: 0.2 }),
    brightness: () => new filters.Brightness({ brightness: 0.1 }),
  };
  return filterKeys.map((key) => map[key]).filter(Boolean).map((f) => f());
};

// ── Apply a snapshot (tracks + drawings) to canvas ────────────────────────
const applySnapshot = (
  snapshot: HistorySnapshot,
  canvas: any,
  currentTime: number,
  applyKeyframesAtTime: (t: number) => void,
  set: (partial: Partial<EditorState>) => void,
  get: () => EditorState
) => {
  const { tracks: previous, drawings } = snapshot;

  if (!canvas) {
    set({ tracks: previous });
    return;
  }

  const prevIds = new Set(previous.map((t) => t.id));

  // Remove fabric objects that are no longer in the target state
  canvas.getObjects().forEach((obj: any) => {
    if (obj.customType === "background" || obj.customType === "drawing") return;
    const cid = obj._customId;
    if (cid && !prevIds.has(cid)) {
      canvas.remove(obj);
    }
  });

  // Restore/update each track's fabric object
  previous.forEach((track) => {
    const applyObjState = (obj: any) => {
      const s = (track.initialState || {}) as any;
      obj.set({
        left:    s.left    ?? obj.left,
        top:     s.top     ?? obj.top,
        scaleX:  s.scaleX  ?? obj.scaleX,
        scaleY:  s.scaleY  ?? obj.scaleY,
        angle:   s.angle   ?? obj.angle,
        opacity: s.opacity ?? obj.opacity,
        flipX:   s.flipX   ?? obj.flipX,
        flipY:   s.flipY   ?? obj.flipY,
      });
      if (
        track.imageFilters &&
        (obj.type === "image" || obj.customType === "image" || obj.customType === "background")
      ) {
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

    // Special: recreate video element if missing
    const recreateVideo = () => {
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
      applyObjState(fabricVideo);
      canvas.add(fabricVideo);
      return true;
    };

    const objOnCanvas = canvas
      .getObjects()
      .find((o: any) => o._customId === track.id);

    if (objOnCanvas) {
      track.fabricObject = objOnCanvas;
      applyObjState(objOnCanvas);
    } else {
      if (recreateVideo()) return;
      if (track.fabricObject && !canvas.contains(track.fabricObject)) {
        canvas.add(track.fabricObject);
      }
    }
  });

  // Restore drawings
  restoreDrawings(canvas, drawings);

  set({ tracks: previous });
  applyKeyframesAtTime(currentTime);
  canvas.requestRenderAll();
};

// ── Slice ──────────────────────────────────────────────────────────────────
export const createHistorySlice: StateCreator<EditorState, [], [], HistorySlice> = (set, get) => ({
  past: [],
  future: [],

  saveCheckpoint: () => {
    const { tracks, past, canvas } = get();
    const drawings = serializeDrawings(canvas);
    const snapshot: HistorySnapshot = {
      tracks: cloneTracksForHistory(tracks),
      drawings,
    };
    const newPast = [...past, snapshot].slice(-50);
    set({ past: newPast, future: [] });
  },

  undo: () => {
    const { past, future, tracks, canvas, currentTime, applyKeyframesAtTime } = get();
    if (past.length === 0) return;

    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);

    // Save current state to future before changing
    const currentDrawings = serializeDrawings(canvas);
    const currentSnapshot: HistorySnapshot = {
      tracks: cloneTracksForHistory(tracks),
      drawings: currentDrawings,
    };

    set({
      past: newPast,
      future: [currentSnapshot, ...future],
    });

    applySnapshot(previous, canvas, currentTime, applyKeyframesAtTime, set as any, get);
  },

  redo: () => {
    const { past, future, tracks, canvas, currentTime, applyKeyframesAtTime } = get();
    if (future.length === 0) return;

    const next = future[0];
    const newFuture = future.slice(1);

    // Save current state to past before changing
    const currentDrawings = serializeDrawings(canvas);
    const currentSnapshot: HistorySnapshot = {
      tracks: cloneTracksForHistory(tracks),
      drawings: currentDrawings,
    };

    set({
      past: [...past, currentSnapshot],
      future: newFuture,
    });

    applySnapshot(next, canvas, currentTime, applyKeyframesAtTime, set as any, get);
  },

  captureState: (trackId) => {
    const { past, tracks, canvas } = get();

    // Deduplicate: only save if something actually changed
    const last = past[past.length - 1];
    const hasChanged =
      !last ||
      last.tracks.length !== tracks.length ||
      last.tracks.some((t, i) => {
        const curr = tracks[i];
        return (
          !curr ||
          t.id !== curr.id ||
          JSON.stringify(t.keyframes) !== JSON.stringify(curr.keyframes)
        );
      });

    if (hasChanged) get().saveCheckpoint();

    set((state) => ({
      tracks: state.tracks.map((t) => {
        if (t.id === trackId && t.fabricObject) {
          const o = t.fabricObject;
          return {
            ...t,
            initialState: {
              ...t.initialState,
              left:    o.left    ?? 0,
              top:     o.top     ?? 0,
              scaleX:  o.scaleX  ?? 1,
              scaleY:  o.scaleY  ?? 1,
              angle:   o.angle   ?? 0,
              opacity: o.opacity ?? 1,
              flipX:   o.flipX   ?? false,
              flipY:   o.flipY   ?? false,
            },
          };
        }
        return t;
      }),
    }));
  },
});