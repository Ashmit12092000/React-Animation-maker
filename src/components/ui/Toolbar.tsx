import { useState, useRef, useEffect } from "react";
import { Trash2, Download, Video, Undo2, Redo2, Search, Eraser, AlertTriangle } from "lucide-react";
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
    clearCanvas,
    undo,
    redo,
    past,
    future,
  } = useEditorStore();

  const [isEditingName, setIsEditingName] = useState(false);
  const [pixabayOpen, setPixabayOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
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

  // Close confirm dialog on Escape
  useEffect(() => {
    if (!confirmClear) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmClear(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [confirmClear]);

  const handleDelete = () => deleteSelected();
  const handleExport = () => exportSceneJSON(canvas, tracks, projectName);

  const handleClearConfirmed = () => {
    clearCanvas();
    setConfirmClear(false);
  };

  return (
    <>
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
          {/* Clear Canvas */}
          <Button
            onClick={() => setConfirmClear(true)}
            variant="outline"
            size="sm"
            className="border-orange-500/60 text-orange-400 hover:bg-orange-500/10 hover:text-orange-300 hover:border-orange-400 transition-colors"
            title="Clear all objects from the canvas"
          >
            <Eraser className="h-4 w-4" />
            Clear Canvas
          </Button>

          {/* Delete Selected */}
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

      {/* ── Confirm Clear Dialog ──────────────────────────────────────────── */}
      {confirmClear && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }}
          onClick={() => setConfirmClear(false)}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 w-[360px] flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Icon + title */}
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-orange-500/15 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-orange-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">Clear Canvas?</h2>
                <p className="text-xs text-muted-foreground mt-0.5">This action cannot be undone after clearing.</p>
              </div>
            </div>

            {/* Body */}
            <p className="text-sm text-muted-foreground leading-relaxed">
              All objects will be permanently removed — characters, props, drawings, images, text, audio, and video tracks.
            </p>

            {/* Buttons */}
            <div className="flex gap-3 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setConfirmClear(false)}
              >
                No, Keep it
              </Button>
              <Button
                variant="destructive"
                className="flex-1 bg-orange-600 hover:bg-orange-700 border-orange-600"
                onClick={handleClearConfirmed}
              >
                Yes, Clear All
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}