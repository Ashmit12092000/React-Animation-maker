import { StateCreator } from "zustand";
import { EditorState } from "../editorStore";

export interface DrawingSlice {
  drawingEnabled: boolean;
  drawingColor: string;
  drawingBrushSize: number;
  eraserEnabled: boolean;
  eraserSize: number;
  pathDrawMode: boolean;
  pathDrawTargetId: string | null;
  setDrawingEnabled: (enabled: boolean) => void;
  setDrawingColor: (color: string) => void;
  setDrawingBrushSize: (size: number) => void;
  setEraserEnabled: (enabled: boolean) => void;
  setEraserSize: (size: number) => void;
  setPathDrawMode: (enabled: boolean, targetId?: string | null) => void;
}

export const createDrawingSlice: StateCreator<EditorState, [], [], DrawingSlice> = (set) => ({
  drawingEnabled: false,
  drawingColor: "#ffffff",
  drawingBrushSize: 6,
  eraserEnabled: false,
  eraserSize: 20,
  pathDrawMode: false,
  pathDrawTargetId: null,
  setDrawingEnabled: (enabled) => set({ drawingEnabled: enabled, ...(enabled ? {} : { eraserEnabled: false }) }),
  setDrawingColor: (color) => set({ drawingColor: color }),
  setDrawingBrushSize: (size) => set({ drawingBrushSize: size }),
  setEraserEnabled: (enabled) => set({ eraserEnabled: enabled }),
  setEraserSize: (size) => set({ eraserSize: size }),
  setPathDrawMode: (enabled, targetId = null) =>
    set({ pathDrawMode: enabled, pathDrawTargetId: targetId }),
});