import { useState, useRef, useEffect } from "react";
import { Trash2, Download, Video, Undo2, Redo2, Search, Eraser, AlertTriangle, Save, FolderOpen, CheckCircle2, Loader2, X, PlayCircle, Menu } from "lucide-react";
import { Button } from "./button";
import { Input } from "./input";
import { useEditorStore } from "../../stores/editorStore";
import { exportSceneJSON } from "../../utils/export";
import { saveProject, loadProject } from "../../utils/saveLoad";
import { startVideoExport, findPixiCanvas, findFabricCanvasEl, type VideoExportController } from "../../utils/videoExport";
import { ScenePreviewPlayer } from "../editor/ScenePreviewPlayer";

export function Toolbar() {
  const {
    projectName,
    setProjectName,
    selectedObjectId,
    canvas,
    tracks,
    scenes,
    activeSceneId,
    setActiveScene,
    saveSceneCanvasData,
    sceneCanvasData,
    duration,
    deleteSelected,
    clearCanvas,
    undo,
    redo,
    past,
    future,
    addTrack,
    setDuration,
    saveCheckpoint,
    setPendingArmatures,
    currentTime,
    setCurrentTime,
    setIsPlaying,
    applyKeyframesAtTime,
  } = useEditorStore();

  const [isEditingName, setIsEditingName] = useState(false);
  const [pixabayOpen, setPixabayOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);
  const [saveFlash, setSaveFlash] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // ── Video export state ────────────────────────────────────────────────────
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStage, setExportStage] = useState<"recording" | "converting" | "done">("recording");
  const exportControllerRef = useRef<VideoExportController | null>(null);

  const pixabayRef  = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (!pixabayRef.current) return;
      if (pixabayRef.current.contains(e.target as Node)) return;
      setPixabayOpen(false);
    };
    if (pixabayOpen) document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [pixabayOpen]);

  useEffect(() => {
    if (!confirmClear) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmClear(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [confirmClear]);

  const handleDelete  = () => deleteSelected();
  const handleExport  = () => exportSceneJSON(canvas, tracks, projectName);

  const handleSave = () => {
    // Snapshot the currently active scene's canvas before saving —
    // sceneCanvasData only holds previously-switched-away scenes,
    // so the live scene must be captured here explicitly.
    let latestSceneCanvasData = sceneCanvasData;
    if (canvas && activeSceneId) {
      try {
        const json = JSON.stringify(canvas.toJSON());
        latestSceneCanvasData = { ...sceneCanvasData, [activeSceneId]: json };
        saveSceneCanvasData(activeSceneId, json);
      } catch {}
    }
    saveProject(canvas, tracks, projectName, duration, scenes, activeSceneId, latestSceneCanvasData);
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 2000);
  };

  const handleExportVideo = () => {
    if (!canvas) return;

    const fabricEl = findFabricCanvasEl();
    const pixiEl   = findPixiCanvas();

    if (!fabricEl || !pixiEl) {
      alert("Could not find canvas layers. Make sure the editor is fully loaded.");
      return;
    }

    setIsPlaying(false);
    setCurrentTime(0);
    applyKeyframesAtTime(0);

    setIsExportingVideo(true);
    setExportProgress(0);
    setExportStage("recording");

    // Save current scene canvas before export starts
    if (activeSceneId) {
      try {
        const json = JSON.stringify(canvas.toJSON());
        saveSceneCanvasData(activeSceneId, json);
      } catch {}
    }

    // Build scene list for multi-scene export
    const sceneList = scenes.length > 1 ? scenes : undefined;

    // Compute total duration from scenes or tracks
    const trackMax = tracks.length > 0 ? Math.max(...tracks.map(t => t.endTime)) : 0;
    const singleDuration = trackMax > 0 ? trackMax : 10;
    const totalDuration = sceneList
      ? sceneList.reduce((s, sc) => s + sc.duration / 1000, 0)
      : singleDuration;

    const controller = startVideoExport({
      fabricCanvas: fabricEl,
      pixiCanvas:   pixiEl,
      tracks,
      duration: totalDuration,
      fps: 30,
      projectName,
      scenes: sceneList,
      onSceneSwitch: (sceneId) => {
        // Imperatively switch scene without React re-render lag
        useEditorStore.getState().setActiveScene(sceneId);
      },
      onFrame: (t) => {
        const s = useEditorStore.getState();
        s.setCurrentTime(t);
        s.applyKeyframesAtTime(t);
      },
      onProgress: (pct) => {
        setExportStage(pct >= 100 ? "done" : "recording");
        setExportProgress(pct);
      },
      onComplete: () => {
        setExportProgress(100);
        setExportStage("done");
        setIsExportingVideo(false);
        setIsPlaying(false);
        setCurrentTime(0);
        applyKeyframesAtTime(0);
        // Restore original scene
        if (activeSceneId) setActiveScene(activeSceneId);
        exportControllerRef.current = null;
      },
      onError: (err) => {
        console.error("Video export error:", err);
        alert(`Export failed: ${err.message}`);
        setIsExportingVideo(false);
        exportControllerRef.current = null;
      },
    });

    exportControllerRef.current = controller;
  };

  const handleCancelExport = () => {
    exportControllerRef.current?.cancel();
    exportControllerRef.current = null;
    setIsExportingVideo(false);
    setIsPlaying(false);
    setCurrentTime(0);
    applyKeyframesAtTime(0);
  };

  const handleLoadClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // reset so same file can be re-loaded

    try {
      const { warnings, pendingArmatures } = await loadProject(file, canvas, {
        setProjectName,
        setDuration,
        clearCanvas,
        addTrack,
        saveCheckpoint,
        setScenes: (savedScenes) => {
          // Directly push into Zustand store — addScene one-by-one would
          // mutate activeSceneId; instead we replace the whole array at once.
          useEditorStore.setState({ scenes: savedScenes });
        },
        setActiveSceneId: (id) => {
          useEditorStore.setState({ activeSceneId: id });
        },
        saveSceneCanvasData,
      });
      if (pendingArmatures.length > 0) setPendingArmatures(pendingArmatures);
      if (warnings.length > 0) setLoadWarnings(warnings);
    } catch (err: any) {
      setLoadWarnings([`Failed to load: ${err?.message ?? "Unknown error"}`]);
    }
  };

  const handleClearConfirmed = () => {
    clearCanvas();
    setConfirmClear(false);
  };

  return (
    <>
      <div className="h-12 md:h-14 bg-gray-950 border-b border-gray-700 flex items-center justify-between px-2 md:px-4 gap-2">
        {/* ── Left: Project name + undo/redo ───────────────────────────── */}
        <div className="flex items-center gap-1 md:gap-4 min-w-0">
          {isEditingName ? (
            <Input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onBlur={() => setIsEditingName(false)}
              onKeyDown={(e) => e.key === "Enter" && setIsEditingName(false)}
              className="w-32 md:w-48 h-7 md:h-8 text-sm"
              autoFocus
            />
          ) : (
            <h1
              onClick={() => setIsEditingName(true)}
              className="text-sm md:text-lg font-bold cursor-pointer hover:text-blue-400 transition-colors truncate max-w-[120px] md:max-w-none"
            >
              {projectName}
            </h1>
          )}
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={undo}
              disabled={past.length === 0}
              title="Undo (Ctrl+Z)"
              className="h-7 w-7 md:h-8 md:w-8 p-0"
            >
              <Undo2 className="h-3.5 w-3.5 md:h-4 md:w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={redo}
              disabled={future.length === 0}
              title="Redo (Ctrl+Y)"
              className="h-7 w-7 md:h-8 md:w-8 p-0"
            >
              <Redo2 className="h-3.5 w-3.5 md:h-4 md:w-4" />
            </Button>
          </div>
        </div>

        {/* ── Desktop Actions ───────────────────────────────────────────── */}
        <div className="hidden md:flex items-center gap-2">
          <Button
            onClick={handleSave}
            variant="outline"
            size="sm"
            title="Save project as JSON file"
            className={
              saveFlash
                ? "border-green-500/80 text-green-400 bg-green-500/10 transition-colors"
                : "border-blue-500/60 text-blue-300 hover:bg-blue-500/10 hover:text-blue-200 hover:border-blue-400 transition-colors"
            }
          >
            {saveFlash
              ? <><CheckCircle2 className="h-4 w-4" /> Saved!</>
              : <><Save className="h-4 w-4" /></>
            }
          </Button>

          <Button
            onClick={handleLoadClick}
            variant="outline"
            size="sm"
            title="Load a previously saved project JSON"
            className="border-purple-500/60 text-purple-300 hover:bg-purple-500/10 hover:text-purple-200 hover:border-purple-400 transition-colors"
          >
            <FolderOpen className="h-4 w-4" /> Load
          </Button>

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

          <Button
            onClick={handleDelete}
            disabled={!selectedObjectId}
            variant="destructive"
            size="sm"
          >
            <Trash2 className="h-4 w-4" />
          </Button>

          <Button onClick={handleExport} variant="default" size="sm">
            <Download className="h-4 w-4" /> Export JSON
          </Button>

          <Button
            onClick={() => setShowPreview(true)}
            variant="outline"
            size="sm"
            title="Preview all scenes in sequence"
            className="border-emerald-500/60 text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200 hover:border-emerald-400 transition-colors"
          >
            <PlayCircle className="h-4 w-4" /> Preview
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
        </div>

        {/* ── Mobile Actions: icon row + hamburger ─────────────────────── */}
        <div className="flex md:hidden items-center gap-1">
          <Button
            onClick={handleSave}
            variant="outline"
            size="sm"
            title="Save"
            className={`h-7 w-7 p-0 ${saveFlash ? "border-green-500/80 text-green-400 bg-green-500/10" : "border-blue-500/60 text-blue-300"}`}
          >
            {saveFlash ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
          </Button>

          <Button
            onClick={() => setShowPreview(true)}
            variant="outline"
            size="sm"
            title="Preview"
            className="h-7 w-7 p-0 border-emerald-500/60 text-emerald-300"
          >
            <PlayCircle className="h-3.5 w-3.5" />
          </Button>

          <Button
            onClick={handleDelete}
            disabled={!selectedObjectId}
            variant="destructive"
            size="sm"
            className="h-7 w-7 p-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>

          {/* Hamburger */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMobileMenuOpen(s => !s)}
            className="h-7 w-7 p-0"
          >
            <Menu className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Mobile Dropdown Menu ─────────────────────────────────────────── */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-[9990]"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="absolute top-12 right-2 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-2 flex flex-col gap-1 w-52"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => { handleLoadClick(); setMobileMenuOpen(false); }}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-purple-300 hover:bg-purple-500/10 transition-colors"
            >
              <FolderOpen className="h-4 w-4" /> Load Project
            </button>
            <button
              onClick={() => { handleExport(); setMobileMenuOpen(false); }}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-foreground hover:bg-white/5 transition-colors"
            >
              <Download className="h-4 w-4" /> Export JSON
            </button>
            <button
              onClick={() => { handleExportVideo(); setMobileMenuOpen(false); }}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-red-300 hover:bg-red-500/10 transition-colors"
            >
              <Video className="h-4 w-4" /> Export Video
            </button>
            <div className="h-px bg-gray-700 my-1" />
            <button
              onClick={() => { setConfirmClear(true); setMobileMenuOpen(false); }}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-orange-400 hover:bg-orange-500/10 transition-colors"
            >
              <Eraser className="h-4 w-4" /> Clear Canvas
            </button>
            <button
              onClick={() => { setPixabayOpen(s => !s); setMobileMenuOpen(false); }}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-foreground hover:bg-white/5 transition-colors"
            >
              <Search className="h-4 w-4" /> Pixabay
            </button>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* ── Confirm Clear Dialog ─────────────────────────────────────────── */}
      {confirmClear && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }}
          onClick={() => setConfirmClear(false)}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 w-[min(360px,calc(100vw-32px))] flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-orange-500/15 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-orange-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">Clear Canvas?</h2>
                <p className="text-xs text-muted-foreground mt-0.5">This action cannot be undone after clearing.</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              All objects will be permanently removed — characters, props, drawings, images, text, audio, and video tracks.
            </p>
            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setConfirmClear(false)}>
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

      {/* ── Load Warnings Dialog ─────────────────────────────────────────── */}
      {loadWarnings.length > 0 && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }}
          onClick={() => setLoadWarnings([])}
        >
          <div
            className="bg-gray-900 border border-yellow-600/40 rounded-xl shadow-2xl p-6 w-[min(420px,calc(100vw-32px))] flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-yellow-500/15 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-yellow-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">Project loaded with warnings</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Some items could not be fully restored.</p>
              </div>
            </div>
            <ul className="text-sm text-muted-foreground leading-relaxed list-disc list-inside space-y-1">
              {loadWarnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
            <Button variant="outline" onClick={() => setLoadWarnings([])}>
              Got it
            </Button>
          </div>
        </div>
      )}

      {/* ── Video Export Progress Modal ──────────────────────────────────── */}
      {isExportingVideo && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
        >
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 w-[min(400px,calc(100vw-32px))] flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
                  <Video className="h-5 w-5 text-red-400" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-foreground">Exporting Video</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {exportStage === "done"
                      ? "Done! Downloading…"
                      : scenes.length > 1
                        ? `Recording ${scenes.length} scenes in sequence…`
                        : "Recording canvas in real time…"
                    }
                  </p>
                </div>
              </div>
              <button
                onClick={handleCancelExport}
                className="text-gray-400 hover:text-white transition-colors"
                title="Cancel export"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
              <div
                className="h-3 rounded-full transition-all duration-300"
                style={{
                  width: `${exportProgress}%`,
                  background: exportStage === "converting"
                    ? "linear-gradient(90deg, #f59e0b, #ef4444)"
                    : "linear-gradient(90deg, #3b82f6, #8b5cf6)",
                }}
              />
            </div>
            <div className="flex justify-between items-center text-xs text-muted-foreground">
              <span>
                {exportStage === "done" ? "Complete!" : `Recording… ${exportProgress}%`}
              </span>
              <span className="text-gray-500">Do not close this tab</span>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              The animation plays at real speed during recording. A 10-second project takes ~10 seconds. File downloads automatically as .webm when done.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelExport}
              className="border-red-500/40 text-red-400 hover:bg-red-500/10"
            >
              Cancel Export
            </Button>
          </div>
        </div>
      )}
      {/* ── Scene Preview Player ─────────────────────────────────────────── */}
      {showPreview && (
        <ScenePreviewPlayer onClose={() => setShowPreview(false)} />
      )}
    </>
  );
}