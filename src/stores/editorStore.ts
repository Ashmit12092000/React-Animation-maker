import { create } from "zustand";
import { CanvasSlice, createCanvasSlice } from "./slices/canvasSlice";
import { HistorySlice, createHistorySlice } from "./slices/historySlice";
import { TrackSlice, createTrackSlice } from "./slices/trackSlice";
import { AssetSlice, createAssetSlice, sampleAssets, fontStyles } from "./slices/assetSlice";
import { DrawingSlice, createDrawingSlice } from "./slices/drawingSlice";
import { SceneSlice, createSceneSlice } from "./slices/sceneSlice";
import type { PendingArmature } from "../utils/saveLoad";

// Re-export common types/constants for components
export { sampleAssets, fontStyles };
export type { Asset } from "../types";

export interface EditorState extends CanvasSlice, HistorySlice, TrackSlice, AssetSlice, DrawingSlice, SceneSlice {
    projectName: string;
    pendingArmatures: PendingArmature[];
    setPendingArmatures: (a: PendingArmature[]) => void;
}

export const useEditorStore = create<EditorState>((...a) => ({
    projectName: "Untitled Project",
    pendingArmatures: [],
    setPendingArmatures: (armatures) => (a[0] as any)({ pendingArmatures: armatures }),
    ...createCanvasSlice(...a),
    ...createHistorySlice(...a),
    ...createTrackSlice(...a),
    ...createAssetSlice(...a),
    ...createDrawingSlice(...a),
    ...createSceneSlice(...a),
}));