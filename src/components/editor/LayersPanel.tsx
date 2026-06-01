import { useRef, useState } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { Layers, Eye, EyeOff, GripVertical, ChevronUp, ChevronDown, ChevronsUp, ChevronsDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * LayersPanel — shows all visual tracks as a layer stack.
 * Top of the list = front (highest z-order). Drag rows to reorder.
 * Eye icon toggles visibility. Click to select. Arrow buttons for fine control.
 */
export function LayersPanel() {
  const {
    tracks,
    selectedObjectId,
    canvas,
    setSelectedObject,
    reorderTracks,
    bringToFront,
    sendToBack,
    moveObjectUp,
    moveObjectDown,
  } = useEditorStore();

  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  // Only visual tracks get shown in the layers panel
  const visualTracks = [...tracks].filter((t) => t.type === "visual" || t.type === "video");
  // Reverse so topmost layer appears first (like Figma/Photoshop convention)
  const reversed = [...visualTracks].reverse();

  if (reversed.length === 0) return null;

  const toggleVisibility = (id: string, fabricObject: any) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (fabricObject) {
          fabricObject.set("visible", true);
          canvas?.renderAll();
        }
      } else {
        next.add(id);
        if (fabricObject) {
          fabricObject.set("visible", false);
          canvas?.renderAll();
        }
      }
      return next;
    });
  };

  const handleSelect = (track: (typeof tracks)[0]) => {
    if (track.fabricObject && canvas) {
      canvas.setActiveObject(track.fabricObject);
      canvas.renderAll();
    }
    setSelectedObject(track.id, track.fabricObject, (track.fabricObject as any)?.customType || track.type);
  };

  // Drag-to-reorder: reversed display → need to map back to real indices
  const getRealIndex = (reversedIdx: number) => {
    const track = reversed[reversedIdx];
    return tracks.findIndex((t) => t.id === track.id);
  };

  const handleDragStart = (e: React.DragEvent, reversedIdx: number) => {
    e.dataTransfer.effectAllowed = "move";
    setDraggingIndex(reversedIdx);
  };

  const handleDragOver = (e: React.DragEvent, reversedIdx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropIndex(reversedIdx);
  };

  const handleDrop = (e: React.DragEvent, reversedIdx: number) => {
    e.preventDefault();
    if (draggingIndex === null || draggingIndex === reversedIdx) {
      setDraggingIndex(null);
      setDropIndex(null);
      return;
    }
    const fromReal = getRealIndex(draggingIndex);
    const toReal = getRealIndex(reversedIdx);
    reorderTracks(fromReal, toReal);
    setDraggingIndex(null);
    setDropIndex(null);
  };

  const handleDragEnd = () => {
    setDraggingIndex(null);
    setDropIndex(null);
  };

  const handleBringToFront = (e: React.MouseEvent, track: (typeof tracks)[0]) => {
    e.stopPropagation();
    handleSelect(track);
    // Small timeout so selection settles before action
    setTimeout(() => bringToFront(), 0);
  };

  const handleSendToBack = (e: React.MouseEvent, track: (typeof tracks)[0]) => {
    e.stopPropagation();
    handleSelect(track);
    setTimeout(() => sendToBack(), 0);
  };

  const handleMoveUp = (e: React.MouseEvent, track: (typeof tracks)[0]) => {
    e.stopPropagation();
    handleSelect(track);
    setTimeout(() => moveObjectUp(), 0);
  };

  const handleMoveDown = (e: React.MouseEvent, track: (typeof tracks)[0]) => {
    e.stopPropagation();
    handleSelect(track);
    setTimeout(() => moveObjectDown(), 0);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Layers className="w-3.5 h-3.5 text-indigo-400" />
        <span className="text-xs font-medium uppercase tracking-wide text-gray-300">Layers</span>
        <span className="ml-auto text-[10px] text-gray-600">drag to reorder</span>
      </div>

      <div className="rounded-lg border border-white/10 overflow-hidden">
        {reversed.map((track, reversedIdx) => {
          const isSelected = selectedObjectId === track.id;
          const isHidden = hiddenIds.has(track.id);
          const isDragging = draggingIndex === reversedIdx;
          const isDropTarget = dropIndex === reversedIdx && draggingIndex !== null && draggingIndex !== reversedIdx;
          const label = (track.fabricObject as any)?._assetName || track.name || "Layer";
          const customType = (track.fabricObject as any)?.customType || track.type;

          // Pick a color dot per type
          const dotColor =
            customType === "background" ? "#f59e0b"
            : customType === "character" ? "#a78bfa"
            : customType === "scene" ? "#34d399"
            : customType === "video" ? "#f87171"
            : "#60a5fa";

          return (
            <div
              key={track.id}
              draggable
              onDragStart={(e) => handleDragStart(e, reversedIdx)}
              onDragOver={(e) => handleDragOver(e, reversedIdx)}
              onDrop={(e) => handleDrop(e, reversedIdx)}
              onDragEnd={handleDragEnd}
              onClick={() => handleSelect(track)}
              className={cn(
                "group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-all select-none",
                "border-b border-white/5 last:border-b-0",
                isSelected ? "bg-indigo-500/15" : "hover:bg-white/5",
                isDragging ? "opacity-40" : "opacity-100",
                isDropTarget ? "border-b-2 border-indigo-400/70 bg-indigo-500/10" : "",
              )}
            >
              {/* Drag handle */}
              <GripVertical className="w-3 h-3 text-gray-600 flex-shrink-0 cursor-grab active:cursor-grabbing" />

              {/* Color dot */}
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: dotColor }}
              />

              {/* Layer name */}
              <span
                className={cn(
                  "flex-1 text-xs truncate",
                  isHidden ? "text-gray-600 line-through" : isSelected ? "text-white" : "text-gray-300",
                )}
              >
                {label}
              </span>

              {/* Controls — shown on hover or when selected */}
              <div className={cn(
                "flex items-center gap-0.5 transition-opacity",
                isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}>
                <button
                  title="Bring to Front"
                  onClick={(e) => handleBringToFront(e, track)}
                  className="p-0.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                >
                  <ChevronsUp className="w-3 h-3" />
                </button>
                <button
                  title="Move Up"
                  onClick={(e) => handleMoveUp(e, track)}
                  className="p-0.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button
                  title="Move Down"
                  onClick={(e) => handleMoveDown(e, track)}
                  className="p-0.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
                <button
                  title="Send to Back"
                  onClick={(e) => handleSendToBack(e, track)}
                  className="p-0.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                >
                  <ChevronsDown className="w-3 h-3" />
                </button>
              </div>

              {/* Visibility toggle */}
              <button
                title={isHidden ? "Show layer" : "Hide layer"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleVisibility(track.id, track.fabricObject);
                }}
                className="p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-white transition-colors flex-shrink-0"
              >
                {isHidden
                  ? <EyeOff className="w-3 h-3 text-gray-600" />
                  : <Eye className="w-3 h-3" />
                }
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
