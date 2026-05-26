import { useState, useRef, useEffect } from "react";
import { Trash2, Download, Video, Undo2, Redo2, Search } from "lucide-react";
import { Button } from "./button";
import { Input } from "./input";
import { useEditorStore } from "../../stores/editorStore";
import { exportSceneJSON } from "../../utils/export";

export function Toolbar() {
  const {
    projectName,
    setProjectName,
    selectedObjectId,
    canvas,
    tracks,
    deleteSelected,
    undo,
    redo,
    past,
    future,
  } = useEditorStore();

  const [isEditingName, setIsEditingName] = useState(false);
  const [pixabayOpen, setPixabayOpen] = useState(false);
  const pixabayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (!pixabayRef.current) return;
      if (pixabayRef.current.contains(e.target as Node)) return;
      setPixabayOpen(false);
    };

    if (pixabayOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }

    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [pixabayOpen]);

  const handleDelete = () => {
    deleteSelected();
  };

  const handleExport = () => {
    exportSceneJSON(canvas, tracks, projectName);
  };

  return (
    <div className="h-14 bg-gray-950 border-b border-gray-700 flex items-center justify-between px-4">
      <div className="flex items-center gap-4">
        {isEditingName ? (
          <Input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onBlur={() => setIsEditingName(false)}
            onKeyDown={(e) => e.key === "Enter" && setIsEditingName(false)}
            className="w-48 h-8"
            autoFocus
          />
        ) : (
          <h1
            onClick={() => setIsEditingName(true)}
            className="text-lg font-bold cursor-pointer hover:text-blue-400 transition-colors"
          >
            {projectName}
          </h1>
        )}
        {/* Undo / Redo to the right of title */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={undo}
            disabled={past.length === 0}
            title="Undo"
            className="h-8 w-8 p-0"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={redo}
            disabled={future.length === 0}
            title="Redo"
            className="h-8 w-8 p-0"
          >
            <Redo2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={handleDelete}
          disabled={!selectedObjectId}
          variant="destructive"
          size="sm"
        >
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
        <Button onClick={handleExport} variant="default" size="sm">
          <Download className="h-4 w-4" /> Export JSON
        </Button>
        <div className="relative" ref={pixabayRef}>
          <Button
            onClick={() => setPixabayOpen((s) => !s)}
            variant="outline"
            size="sm"
            title="Pixabay"
          >
            <Search className="h-4 w-4" /> Pixabay
          </Button>

          {pixabayOpen && (
            <div className="absolute right-0 mt-2 w-72 bg-background border border-panel-border shadow-md rounded p-3 z-50">
              <p className="text-xs text-muted-foreground mb-2">Pixabay Search (display only)</p>
              <div className="flex gap-2">
                <Input placeholder="Search Pixabay..." />
                <Button size="sm" variant="secondary" onClick={() => {}}>
                  Search
                </Button>
              </div>
            </div>
          )}
        </div>
        <Button variant="secondary" size="sm">
          <Video className="h-4 w-4" /> Export Video
        </Button>
      </div>
    </div>
  );
}
