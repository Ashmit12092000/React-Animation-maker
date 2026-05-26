import { create } from "zustand";
import { CanvasSlice, createCanvasSlice } from "./slices/canvasSlice";
import { HistorySlice, createHistorySlice } from "./slices/historySlice";
import { TrackSlice, createTrackSlice } from "./slices/trackSlice";
import { AssetSlice, createAssetSlice, sampleAssets, fontStyles } from "./slices/assetSlice";
import { DrawingSlice, createDrawingSlice } from "./slices/drawingSlice";

// Re-export common types/constants for components
export { sampleAssets, fontStyles };
export type { Asset } from "../types";

export interface EditorState extends CanvasSlice, HistorySlice, TrackSlice, AssetSlice, DrawingSlice {
    projectName: string;
}

export const useEditorStore = create<EditorState>((...a) => ({
    projectName: "Untitled Project",
    ...createCanvasSlice(...a),
    ...createHistorySlice(...a),
    ...createTrackSlice(...a),
    ...createAssetSlice(...a),
    ...createDrawingSlice(...a),
}));
