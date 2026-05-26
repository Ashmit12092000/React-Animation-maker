import { StateCreator } from "zustand";
import { EditorState } from "../editorStore";
import { Asset } from "../../types";

export interface AssetSlice {
  uploadedAssets: Asset[];
  addUploadedAsset: (asset: Asset) => void;
}

export const createAssetSlice: StateCreator<EditorState, [], [], AssetSlice> = (set) => ({
  uploadedAssets: [],
  addUploadedAsset: (asset) =>
    set((state) => ({ uploadedAssets: [...state.uploadedAssets, asset] })),
});

// Constants moved here
export const sampleAssets: Asset[] = [
  { id: "circle", name: "Circle", type: "item", color: "#ff6b6b", icon: "●" },
  { id: "square", name: "Square", type: "item", color: "#4ecdc4", icon: "■" },
  { id: "bg-blue", name: "Blue Sky", type: "background", color: "#74b9ff", icon: "🌅" },
  { id: "bg-green", name: "Forest", type: "background", color: "#00b894", icon: "🌲" },
  { id: "bg-purple", name: "Purple", type: "background", color: "#a29bfe", icon: "🌌" },
];

export const fontStyles = [
  "Arial", "Helvetica", "Times New Roman", "Georgia", 
  "Verdana", "Courier New", "Impact", "Comic Sans MS",
];
