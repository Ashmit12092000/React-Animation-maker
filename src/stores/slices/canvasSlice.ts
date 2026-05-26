import { StateCreator } from "zustand";
import { EditorState } from "../editorStore";
import { Canvas as FabricCanvas, FabricObject, ActiveSelection, filters } from "fabric";
import { TrackObject } from "../../types";

type AudioClipboard = {
  name: string;
  audioSrc: string;
  startTime: number;
  endTime: number;
  mediaOffset?: number;
  mediaDuration?: number;
};

export interface CanvasSlice {
  canvas: FabricCanvas | null;
  selectedObjectId: string | null;
  selectedObject: FabricObject | null;
  selectedObjectType: string | null;
  clipboard: FabricObject | null;
  audioClipboard: AudioClipboard | null;

  // Context Menu State
  contextMenu: { visible: boolean; x: number; y: number };
  setContextMenu: (menu: { visible: boolean; x: number; y: number }) => void;

  setCanvas: (canvas: FabricCanvas | null) => void;
  setSelectedObject: (id: string | null, obj: FabricObject | null, type?: string | null) => void;
  updateObjectProperty: (property: string, value: number | string) => void;

  moveObjectUp: () => void;
  moveObjectDown: () => void;
  toggleLock: () => void;
  flipObject: (direction: "horizontal" | "vertical") => void;
  rotateImage: () => void;
  setAsBackground: () => void;
  setImageFilters: (filterKeys: string[]) => void;
  deleteSelected: () => void;
  copyObject: () => void;
  pasteObject: () => void;
  duplicateObject: () => void;
}

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

export const createCanvasSlice: StateCreator<EditorState, [], [], CanvasSlice> = (set, get) => ({
  canvas: null,
  selectedObjectId: null,
  selectedObject: null,
  selectedObjectType: null,
  clipboard: null,
  audioClipboard: null,

  contextMenu: { visible: false, x: 0, y: 0 },
  setContextMenu: (menu) => set({ contextMenu: menu }),

  setCanvas: (canvas) => set({ canvas }),

  setSelectedObject: (id, obj, type) =>
    set({
      selectedObjectId: id,
      selectedObjectType: type || (obj ? "object" : null),
      selectedObject: obj,
      selectedTrackId: id, // Sync with track slice
    }),

  updateObjectProperty: (property, value) => {
    const { selectedObject, canvas, selectedObjectId } = get();
    if (!selectedObject || !selectedObjectId) return;

    selectedObject.set(property as any, value as any);
    canvas?.renderAll();
    // Record state change without creating animation keyframe
    get().captureState(selectedObjectId);
  },

  moveObjectUp: () => {
    get().saveCheckpoint();
    const { canvas, selectedObject } = get();
    if (canvas && selectedObject) {
      canvas.bringObjectForward(selectedObject);
      canvas.renderAll();
    }
  },

  moveObjectDown: () => {
    get().saveCheckpoint();
    const { canvas, selectedObject } = get();
    if (canvas && selectedObject) {
      const bg = canvas.getObjects().find((o) => (o as any).customType === "background");
      const index = canvas.getObjects().indexOf(selectedObject);
      const bgIndex = bg ? canvas.getObjects().indexOf(bg) : -1;

      if (index > bgIndex + 1) {
        canvas.sendObjectBackwards(selectedObject);
      }
      canvas.renderAll();
    }
  },

  toggleLock: () => {
    get().saveCheckpoint();
    const { canvas, selectedObject } = get();
    if (canvas && selectedObject) {
      const isLocked = !selectedObject.lockMovementX;
      selectedObject.set({
        lockMovementX: isLocked, lockMovementY: isLocked,
        lockRotation: isLocked, lockScalingX: isLocked, lockScalingY: isLocked,
        selectable: true, evented: true,
        borderColor: isLocked ? "#ff4444" : "#4ecdc4",
        cornerColor: isLocked ? "#ff4444" : "#ffffff",
      });
      canvas.renderAll();
    }
  },

  flipObject: (direction) => {
    const { selectedObject, canvas, selectedObjectId } = get();
    if (selectedObject && canvas && selectedObjectId) {
      if (direction === "horizontal") selectedObject.set("flipX", !selectedObject.flipX);
      else selectedObject.set("flipY", !selectedObject.flipY);
      canvas.renderAll();
      get().captureState(selectedObjectId);
    }
  },

rotateImage: () => {
    get().saveCheckpoint();
    const { selectedObject, canvas, selectedObjectId } = get();
    if (!selectedObject || !canvas) return;

    const isImageType = (selectedObject as any).type === "image" || (selectedObject as any).customType === "image";
    if (!isImageType) return;

    const current = selectedObject.angle || 0;
    selectedObject.set("angle", (current + 90) % 360);
  
    selectedObject.setCoords(); 
    
    canvas.requestRenderAll(); 
    get().captureState(selectedObjectId);
  },

  setAsBackground: () => {
    get().saveCheckpoint();
    const { selectedObject, canvas, selectedObjectId } = get();
    if (!selectedObject || !canvas) return;

    const isImageType = (selectedObject as any).type === "image" || (selectedObject as any).customType === "image";
    if (!isImageType) return;

    (selectedObject as any).customType = "background";
    selectedObject.set({ left: 0, top: 0, selectable: false, evented: false, originX: "left", originY: "top" });

    // Try to scale image to cover canvas while preserving aspect ratio
    try {
      const imgWidth = (selectedObject as any).width || (selectedObject as any).getScaledWidth?.();
      const imgHeight = (selectedObject as any).height || (selectedObject as any).getScaledHeight?.();
      if (imgWidth && imgHeight) {
        const scaleX = canvas.getWidth() / imgWidth;
        const scaleY = canvas.getHeight() / imgHeight;
        const scale = Math.max(scaleX, scaleY);
        selectedObject.set({ scaleX: scale, scaleY: scale, left: 0, top: 0 });
      }
    } catch (err) {
      // ignore scaling errors
    }

    canvas.moveObjectTo(selectedObject, 0);
    canvas.renderAll();
    get().captureState(selectedObjectId);
  },

  setImageFilters: (filterKeys) => {
    const { selectedObject, canvas, selectedObjectId } = get();
    if (!selectedObject || !canvas || !selectedObjectId) return;

    const isImageType =
      (selectedObject as any).type === "image" ||
      (selectedObject as any).customType === "image" ||
      (selectedObject as any).customType === "background";
    if (!isImageType) return;

    get().saveCheckpoint();

    const img = selectedObject as any;
    img.filters = buildImageFilters(filterKeys);
    img.applyFilters();
    img._imageFilters = filterKeys;

    canvas.requestRenderAll();
    get().updateTrack(selectedObjectId, { imageFilters: filterKeys });
  },

  deleteSelected: () => {
    get().saveCheckpoint();
    const { canvas, selectedObjectId } = get();

    if (canvas) {
      const selected = canvas.getActiveObjects() || [];
      if (selected.length > 1) {
        const selGroup = new ActiveSelection(selected, { canvas });
        if (selGroup) {
          const idsToRemove: string[] = [];
          selGroup.forEachObject((obj: FabricObject) => {
            const customId = (obj as any)._customId;
            if (customId) idsToRemove.push(customId);
            try { if (canvas.contains(obj)) canvas.remove(obj); } catch (err) { }
          });

          if (idsToRemove.length > 0) {
            const tracksToCleanup = get().tracks.filter((t) => idsToRemove.includes(t.id));
            tracksToCleanup.forEach((t) => {
              if (t.audioElement) { t.audioElement.pause(); t.audioElement.src = ""; }
            });
            set((state) => ({
              tracks: state.tracks.filter((t) => !idsToRemove.includes(t.id)),
              selectedObjectId: null, selectedObject: null, selectedTrackId: null,
            }));
          }
          canvas.discardActiveObject();
          canvas.requestRenderAll();
          return;
        }
      }
    }

    if (selectedObjectId) {
      get().removeTrack(selectedObjectId);
      if (canvas) {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
      }
    }
  },

  copyObject: async () => {
    const { selectedObject, selectedObjectType, selectedObjectId, tracks } = get();

    if (selectedObjectType === "audio") {
      const track = tracks.find((t) => t.id === selectedObjectId);
      const audioSrc = track?.audioSrc || track?.audioElement?.src;
      if (!track || !audioSrc) return;
      set({
        audioClipboard: {
          name: track.name,
          audioSrc,
          startTime: track.startTime,
          endTime: track.endTime,
          mediaOffset: track.mediaOffset,
          mediaDuration: track.mediaDuration,
        },
      });
      return;
    }

    if (!selectedObject) return;
    const cloned = await selectedObject.clone();
    const originalName = (selectedObject as any)._assetName || (selectedObject as any).name || "Object";
    (cloned as any)._assetName = originalName;
    (cloned as any)._imageFilters = (selectedObject as any)._imageFilters || [];
    set({ clipboard: cloned });
  },

  pasteObject: async () => {
    const {
      selectedObjectType,
      audioClipboard,
      addTrack,
      updateTrack,
      setSelectedObject,
    } = get();

    if (selectedObjectType === "audio") {
      if (!audioClipboard) return;
      get().saveCheckpoint();

      const id = `audio_${Date.now()}`;
      const audio = new Audio(audioClipboard.audioSrc);
      audio.preload = "auto";
      audio.crossOrigin = "anonymous";

      const newName = `${audioClipboard.name} (Copy)`;
      const newTrack: TrackObject = {
        id,
        name: newName,
        fabricObject: null,
        startTime: audioClipboard.startTime,
        endTime: audioClipboard.endTime,
        keyframes: [],
        color: "purple",
        initialState: { left: 0, top: 0, scaleX: 1, scaleY: 1, angle: 0, opacity: 1 },
        type: "audio",
        audioElement: audio,
        audioSrc: audioClipboard.audioSrc,
        mediaOffset: audioClipboard.mediaOffset,
        mediaDuration: audioClipboard.mediaDuration,
      };

      audio.addEventListener("loadedmetadata", () => {
        const duration = audio.duration || audioClipboard.mediaDuration || audioClipboard.endTime;
        updateTrack(id, { endTime: audioClipboard.endTime || duration, mediaDuration: duration });
      });

      audio.addEventListener("timeupdate", () => {
        const track = get().tracks.find((t) => t.id === id);
        if (track && audio.currentTime >= track.endTime - track.startTime) {
          audio.pause();
        }
      });

      addTrack(newTrack);
      setSelectedObject(id, null, "audio");
      return;
    }

    get().saveCheckpoint();
    const { clipboard, canvas } = get();
    if (!clipboard || !canvas) return;

    const clonedObj = await clipboard.clone();
    const clipboardName = (clipboard as any)._assetName || (clipboard as any).name || "Object";
    const newName = `${clipboardName} (Copy)`;

    (clonedObj as any)._assetName = newName;
    (clonedObj as any).customType = (clipboard as any).customType || (clonedObj as any).customType || "item";

    clonedObj.set({
      left: (clonedObj.left || 0) + 20,
      top: (clonedObj.top || 0) + 20,
      evented: true,
    });

    if (clonedObj instanceof ActiveSelection) canvas.discardActiveObject();

    const newId = `${(clonedObj as any).customType || "item"}_${Date.now()}`;
    (clonedObj as any)._customId = newId;

    canvas.add(clonedObj);
    canvas.setActiveObject(clonedObj);
    canvas.renderAll();

    addTrack({
      id: newId,
      name: newName,
      fabricObject: clonedObj,
      startTime: 0,
      endTime: 5,
      keyframes: [],
      color: "green",
      initialState: {
        left: clonedObj.left || 0, top: clonedObj.top || 0,
        scaleX: clonedObj.scaleX || 1, scaleY: clonedObj.scaleY || 1,
        angle: clonedObj.angle || 0, opacity: clonedObj.opacity ?? 1,
      },
      type: (clonedObj as any).customType === "video" ? "video" : "visual",
      imageFilters: (clonedObj as any)._imageFilters || [],
    });

    get().setSelectedObject(newId, clonedObj, (clonedObj as any).customType || "item");
  },

  duplicateObject: async () => {
    const {
      selectedObject,
      selectedObjectType,
      selectedObjectId,
      tracks,
      addTrack,
      updateTrack,
      setSelectedObject,
      canvas,
    } = get();

    if (selectedObjectType === "audio") {
      const track = tracks.find((t) => t.id === selectedObjectId);
      const audioSrc = track?.audioSrc || track?.audioElement?.src;
      if (!track || !audioSrc) return;
      get().saveCheckpoint();

      const id = `audio_${Date.now()}`;
      const audio = new Audio(audioSrc);
      audio.preload = "auto";
      audio.crossOrigin = "anonymous";

      const newName = `${track.name} (Copy)`;
      const newTrack: TrackObject = {
        id,
        name: newName,
        fabricObject: null,
        startTime: track.startTime,
        endTime: track.endTime,
        keyframes: [],
        color: "purple",
        initialState: { left: 0, top: 0, scaleX: 1, scaleY: 1, angle: 0, opacity: 1 },
        type: "audio",
        audioElement: audio,
        audioSrc,
        mediaOffset: track.mediaOffset,
        mediaDuration: track.mediaDuration,
      };

      audio.addEventListener("loadedmetadata", () => {
        const duration = audio.duration || track.mediaDuration || track.endTime;
        updateTrack(id, { endTime: track.endTime || duration, mediaDuration: duration });
      });

      audio.addEventListener("timeupdate", () => {
        const nextTrack = get().tracks.find((t) => t.id === id);
        if (nextTrack && audio.currentTime >= nextTrack.endTime - nextTrack.startTime) {
          audio.pause();
        }
      });

      addTrack(newTrack);
      setSelectedObject(id, null, "audio");
      return;
    }

    get().saveCheckpoint();
    if (!selectedObject || !canvas) return;

    const clonedObj = await selectedObject.clone();
    const originalName = (selectedObject as any)._assetName || (selectedObject as any).name || "Object";
    const newName = `${originalName} (Copy)`;

    (clonedObj as any)._assetName = newName;
    (clonedObj as any)._imageFilters = (selectedObject as any)._imageFilters || [];
    (clonedObj as any).customType = (selectedObject as any).customType || (clonedObj as any).customType || "item";

    clonedObj.set({
      left: (clonedObj.left || 0) + 20,
      top: (clonedObj.top || 0) + 20,
      evented: true,
    });

    if (clonedObj instanceof ActiveSelection) canvas.discardActiveObject();

    const newId = `${(clonedObj as any).customType || "item"}_${Date.now()}`;
    (clonedObj as any)._customId = newId;

    canvas.add(clonedObj);
    canvas.setActiveObject(clonedObj);
    canvas.renderAll();

    addTrack({
      id: newId,
      name: newName,
      fabricObject: clonedObj,
      startTime: 0,
      endTime: 5,
      keyframes: [],
      color: "green",
      initialState: {
        left: clonedObj.left || 0, top: clonedObj.top || 0,
        scaleX: clonedObj.scaleX || 1, scaleY: clonedObj.scaleY || 1,
        angle: clonedObj.angle || 0, opacity: clonedObj.opacity ?? 1,
      },
      type: (clonedObj as any).customType === "video" ? "video" : "visual",
      imageFilters: (clonedObj as any)._imageFilters || [],
    });

    get().setSelectedObject(newId, clonedObj, (clonedObj as any).customType || "item");
  },
});
