import { StateCreator } from "zustand";
import { EditorState } from "../editorStore";

export interface DrawingSlice {
  drawingEnabled: boolean;
  drawingColor: string;
  drawingBrushSize: number;
  pathDrawMode: boolean;           // NEW: path animation drawing mode
  pathDrawTargetId: string | null; // NEW: which track to assign path to
  setDrawingEnabled: (enabled: boolean) => void;
  setDrawingColor: (color: string) => void;
  setDrawingBrushSize: (size: number) => void;
  setPathDrawMode: (enabled: boolean, targetId?: string | null) => void;
}

export const createDrawingSlice: StateCreator<EditorState, [], [], DrawingSlice> = (set) => ({
  drawingEnabled: false,
  drawingColor: "#ffffff",
  drawingBrushSize: 6,
  pathDrawMode: false,
  pathDrawTargetId: null,
  setDrawingEnabled: (enabled) => set({ drawingEnabled: enabled }),
  setDrawingColor: (color) => set({ drawingColor: color }),
  setDrawingBrushSize: (size) => set({ drawingBrushSize: size }),
  setPathDrawMode: (enabled, targetId = null) =>
    set({ pathDrawMode: enabled, pathDrawTargetId: targetId }),
});
