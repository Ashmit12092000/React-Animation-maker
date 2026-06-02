import { useRef, useEffect, useCallback, useState } from "react";
import { useEditorStore } from "@/stores/editorStore";
import type { Keyframe } from "../../types";

import { Button } from "@/components/ui/button";
import {
  Play,
  Pause,
  SkipBack,
  Diamond,
  Plus,
  Music,
  SquareSplitHorizontal,
  Video,
  Route,
  X,
  RotateCcw,
  Mic,
  Volume2,
  VolumeX,
  Zap,
  Wand2,
  Scissors,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { KeyframeEditor } from "./KeyframeEditor";
import { toast } from "sonner";
import { VoiceRecorder } from "./VoiceRecorder";
import { PropActionPopup } from "./PropActionPopup";
import { AudioFilterPanel } from "./AudioFilterPanel";

// Color system
const TYPE_COLORS: Record<"audio" | "video", { from: string; to: string; glow: string; text: string; dot: string }> = {
  audio: {
    from: "#7c3aed", to: "#9333ea",
    glow: "rgba(167,139,250,0.3)",
    text: "#a78bfa", dot: "#8b5cf6",
  },
  video: {
    from: "#0369a1", to: "#0284c7",
    glow: "rgba(56,189,248,0.3)",
    text: "#38bdf8", dot: "#0ea5e9",
  },
};

const VISUAL_PALETTES: [string, string, string, string, string][] = [
  ["#059669", "#0d9488", "rgba(52,211,153,0.3)", "#34d399", "#10b981"],
  ["#d97706", "#b45309", "rgba(251,191,36,0.3)", "#fbbf24", "#f59e0b"],
  ["#dc2626", "#b91c1c", "rgba(248,113,113,0.3)", "#f87171", "#ef4444"],
  ["#7c3aed", "#6d28d9", "rgba(196,181,253,0.3)", "#c4b5fd", "#8b5cf6"],
  ["#db2777", "#be185d", "rgba(249,168,212,0.3)", "#f9a8d4", "#ec4899"],
  ["#0891b2", "#0e7490", "rgba(103,232,249,0.3)", "#67e8f9", "#06b6d4"],
  ["#65a30d", "#4d7c0f", "rgba(163,230,53,0.3)", "#a3e635", "#84cc16"],
  ["#ea580c", "#c2410c", "rgba(253,186,116,0.3)", "#fdba74", "#f97316"],
];

interface TrackColorSet {
  from: string; to: string; glow: string; text: string; dot: string;
}

function getTrackColor(track: { id: string; type: string }, visualIndex: number): TrackColorSet {
  if (track.type === "audio") return TYPE_COLORS.audio;
  if (track.type === "video") return TYPE_COLORS.video;
  const p = VISUAL_PALETTES[visualIndex % VISUAL_PALETTES.length];
  return { from: p[0], to: p[1], glow: p[2], text: p[3], dot: p[4] };
}

function WaveformBars({ trackId, count = 28 }: { trackId: string; count?: number }) {
  const seed = trackId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <div className="absolute inset-0 flex items-center gap-px px-2 pointer-events-none overflow-hidden opacity-30">
      {Array.from({ length: count }).map((_, i) => {
        const h = 20 + ((seed * (i + 1) * 7) % 60);
        return (
          <div
            key={i}
            className="flex-1 rounded-sm bg-white"
            style={{ height: `${h}%`, minWidth: 2 }}
          />
        );
      })}
    </div>
  );
}

export function Timeline() {
  const {
    tracks,
    currentTime,
    duration,
    isPlaying,
    selectedObjectId,
    selectedObject,
    setCurrentTime,
    setIsPlaying,
    setSelectedObject,
    setSelectedKeyframe,
    selectedKeyframe,
    addKeyframeAtCurrentTime,
    applyKeyframesAtTime,
    splitTrack,
    canvas,
    syncAudioPlayback,
    deleteSelected,
    setContextMenu,
    saveCheckpoint,
    pathDrawMode,
    setPathDrawMode,
    removePathFromTrack,
    updateTrack,
    reorderTracks,
    removeAudioFiltersFromTrack,
    activeSceneId,
    scenes,
    setActiveScene,
  } = useEditorStore();

  // Only show tracks that belong to the active scene (or legacy tracks with no sceneId)
  const sceneTracks = tracks.filter(t => !t.sceneId || t.sceneId === activeSceneId);
  // Active scene metadata for the header chip
  const activeScene = scenes.find(s => s.id === activeSceneId);

  const timelineRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();
  const startTimeRef = useRef<number>(0);
  const isDraggingPlayhead = useRef(false);
  const resizingTrack = useRef<{ id: string; edge: "start" | "end" } | null>(null);
  const draggingTrack = useRef<{
    id: string;
    startX: number;
    originalStart: number;
    originalEnd: number;
  } | null>(null);

  const [timelineWidth, setTimelineWidth] = useState(2000);
  const [propPopup, setPropPopup] = useState<{
    propName: string;
    position: { x: number; y: number };
    canvasEl: HTMLCanvasElement | null;
    propTrackId: string;
  } | null>(null);

  // Track row drag-to-reorder state
  const [draggingRowIndex, setDraggingRowIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  // Row reorder handlers
  const handleRowDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDraggingRowIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  }, []);

  const handleRowDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetIndex(index);
  }, []);

  const handleRowDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = draggingRowIndex;
    if (fromIndex !== null && fromIndex !== toIndex) {
      reorderTracks(fromIndex, toIndex);
    }
    setDraggingRowIndex(null);
    setDropTargetIndex(null);
  }, [draggingRowIndex, reorderTracks]);

  const handleRowDragEnd = useCallback(() => {
    setDraggingRowIndex(null);
    setDropTargetIndex(null);
  }, []);

  // Helper: open PropActionPopup for a prop track
  const openPropActions = useCallback((track: (typeof tracks)[0], e?: React.MouseEvent) => {
    e?.stopPropagation();
    const fab = track.fabricObject as any;
    if (!fab || fab.customType !== "prop") return;
    const propName: string = fab._assetName ?? fab.propName ?? "";
    if (!propName) return;
    const canvasEl = canvas?.getElement() ?? null;
    const rect = canvasEl?.getBoundingClientRect();
    const scaleX = rect && canvasEl ? rect.width  / (canvasEl.width  || rect.width)  : 1;
    const scaleY = rect && canvasEl ? rect.height / (canvasEl.height || rect.height) : 1;
    const cx = (fab.left ?? 0) + (fab.getScaledWidth?.() ?? 0) / 2;
    const cy = fab.top ?? 0;
    const screenX = rect ? rect.left + cx * scaleX : cx;
    const screenY = rect ? rect.top  + cy * scaleY : cy;
    setPropPopup({
      propName,
      position: { x: screenX, y: screenY },
      canvasEl,
      propTrackId: track.id,
    });
  }, [canvas, tracks]);

  const maxTrackEnd = Math.max(0, ...sceneTracks.map((t) => (isFinite(t.endTime) ? t.endTime : 0)));

  const minVisibleDuration = 10;
  const visibleDuration = Math.max(minVisibleDuration, maxTrackEnd + 2);
  const maxDuration = maxTrackEnd > 0 ? maxTrackEnd : duration;

  const pixelsPerSecond = 80;
  const timeToPixels = (time: number) => time * pixelsPerSecond;
  const pixelsToTime = useCallback((px: number) => px / pixelsPerSecond, []);

  useEffect(() => {
    const newWidth = timeToPixels(visibleDuration);
    if (isFinite(newWidth) && newWidth > 0) {
      setTimelineWidth(newWidth);
    }
  }, [visibleDuration, timeToPixels]);

  const updateTrackLive = useCallback(
    (id: string, updates: { startTime?: number; endTime?: number }) => {
      useEditorStore.setState((state) => ({
        tracks: state.tracks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
      }));
    },
    [],
  );

  const getTimeFromX = useCallback(
    (clientX: number) => {
      if (!scrollContainerRef.current) return 0;
      const rect = scrollContainerRef.current.getBoundingClientRect();
      const scrollLeft = scrollContainerRef.current.scrollLeft;
      return Math.max(0, pixelsToTime(clientX - rect.left + scrollLeft));
    },
    [pixelsToTime],
  );

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest(".keyframe-marker")) return;
      if ((e.target as HTMLElement).closest(".track-label")) return;
      if ((e.target as HTMLElement).closest(".track-resize-handle")) return;
      if (!scrollContainerRef.current) return;
      const newTime = getTimeFromX(e.clientX);
      setCurrentTime(newTime);
      applyKeyframesAtTime(newTime);
    },
    [getTimeFromX, setCurrentTime, applyKeyframesAtTime],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedObjectId) deleteSelected();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedObjectId, deleteSelected]);

  const handlePlayheadMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      isDraggingPlayhead.current = true;
      const handleMouseMove = (e: MouseEvent) => {
        if (!isDraggingPlayhead.current) return;
        setCurrentTime(getTimeFromX(e.clientX));
        applyKeyframesAtTime(getTimeFromX(e.clientX));
      };
      const handleMouseUp = () => {
        isDraggingPlayhead.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [getTimeFromX, setCurrentTime, applyKeyframesAtTime],
  );

  const handleTrackResizeStart = useCallback(
    (e: React.MouseEvent, trackId: string, edge: "start" | "end") => {
      e.preventDefault();
      e.stopPropagation();
      saveCheckpoint();
      resizingTrack.current = { id: trackId, edge };
      const handleMouseMove = (ev: MouseEvent) => {
        if (!resizingTrack.current) return;
        const newTime = Math.max(0, getTimeFromX(ev.clientX));
        const track = useEditorStore.getState().tracks.find((t: any) => t.id === resizingTrack.current?.id);
        if (!track) return;
        if (resizingTrack.current.edge === "start") {
          if (newTime < track.endTime - 0.1) updateTrackLive(track.id, { startTime: Math.round(newTime * 10) / 10 });
        } else {
          if (newTime > track.startTime + 0.1) updateTrackLive(track.id, { endTime: Math.round(newTime * 10) / 10 });
        }
      };
      const handleMouseUp = () => {
        resizingTrack.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [getTimeFromX, saveCheckpoint, updateTrackLive],
  );

  const handleTrackDragStart = useCallback(
    (e: React.MouseEvent, trackId: string) => {
      if ((e.target as HTMLElement).closest(".track-resize-handle")) return;
      e.preventDefault();
      e.stopPropagation();
      const track = useEditorStore.getState().tracks.find((t: any) => t.id === trackId);
      if (!track) return;
      saveCheckpoint();
      draggingTrack.current = { id: trackId, startX: e.clientX, originalStart: track.startTime, originalEnd: track.endTime };
      const handleMouseMove = (ev: MouseEvent) => {
        if (!draggingTrack.current) return;
        const delta = pixelsToTime(ev.clientX - draggingTrack.current.startX);
        const newStart = Math.max(0, draggingTrack.current.originalStart + delta);
        const dur = draggingTrack.current.originalEnd - draggingTrack.current.originalStart;
        updateTrackLive(draggingTrack.current.id, { startTime: Math.round(newStart * 10) / 10, endTime: Math.round((newStart + dur) * 10) / 10 });
      };
      const handleMouseUp = () => {
        draggingTrack.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [pixelsToTime, saveCheckpoint, updateTrackLive],
  );

  const handleKeyframeClick = (e: React.MouseEvent, keyframe: Keyframe, trackId: string) => {
    e.stopPropagation();
    setSelectedKeyframe(keyframe, trackId);
  };

  const handleAddKeyframe = () => {
    if (!selectedObjectId) return;
    const track = tracks.find((t) => t.id === selectedObjectId);
    if (track?.type === "audio") { toast.error("Cannot add keyframes to audio tracks"); return; }
    addKeyframeAtCurrentTime(selectedObjectId);
    toast.success("Keyframe added");
  };

  const handlePlay = () => {
    if (isPlaying) { setIsPlaying(false); return; }
    startTimeRef.current = performance.now() - currentTime * 1000;
    setIsPlaying(true);
  };

  const handleReset = () => { setIsPlaying(false); setCurrentTime(0); applyKeyframesAtTime(0); };

  const maxDurationRef = useRef(maxDuration);
  useEffect(() => { maxDurationRef.current = maxDuration; }, [maxDuration]);

  useEffect(() => {
    if (isPlaying) {
      const animate = (ts: number) => {
        const elapsed = (ts - startTimeRef.current) / 1000;
        const currentMax = maxDurationRef.current;
        if (elapsed >= currentMax) {
          setCurrentTime(currentMax);
          applyKeyframesAtTime(currentMax); 
          setIsPlaying(false);
          syncAudioPlayback();
          return;
        }
        setCurrentTime(elapsed); 
        applyKeyframesAtTime(elapsed);
        syncAudioPlayback(); // FIX: Dynamically sync/trigger audio properties on every timeline tick
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
      syncAudioPlayback();
    } else {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      syncAudioPlayback();
    }
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [isPlaying, setCurrentTime, applyKeyframesAtTime, syncAudioPlayback, setIsPlaying]);

  const handleTrackClick = (e: React.MouseEvent, track: (typeof tracks)[0]) => {
    e.stopPropagation(); 
    if (track.type === "audio") setSelectedObject(track.id, null, "audio");
    else if (track.type === "video") setSelectedObject(track.id, null, "video");
    else if (track.fabricObject) {
      setSelectedObject(track.id, track.fabricObject, "object");
      if (canvas) { canvas.setActiveObject(track.fabricObject); canvas.renderAll(); }
    }
  };

  const handleTimelineRightClick = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY / 2 - 50 });
  };

  const handleSplit = () => {
    if (!selectedObjectId) return;
    splitTrack(selectedObjectId);
    toast.success("Track split");
  };

  const selectedTrack = sceneTracks.find((t) => t.id === selectedObjectId);
  const hasPath = !!(selectedTrack?.pathAnimation);
  const isDrawingObjectSelected =
    !selectedTrack &&
    !!selectedObjectId &&
    ((selectedObject as any)?.customType === "drawing" ||
      selectedObjectId.startsWith("drawing_"));

  const handleDrawPath = () => {
    if (isDrawingObjectSelected && selectedObject) {
      const store = useEditorStore.getState();
      const trackId = (selectedObject as any)._customId || `drawing_${Date.now()}`;
      (selectedObject as any)._customId = trackId;
      const maxEnd = Math.max(5, ...store.tracks.map(t => t.endTime).filter(isFinite));
      store.addTrack({
        id: trackId,
        name: (selectedObject as any)._assetName || "Drawing",
        type: "visual",
        fabricObject: selectedObject,
        startTime: 0,
        endTime: maxEnd,
        keyframes: [],
        color: "purple",
        initialState: {
          left: selectedObject.left ?? 0,
          top: selectedObject.top ?? 0,
          scaleX: selectedObject.scaleX ?? 1,
          scaleY: selectedObject.scaleY ?? 1,
          angle: selectedObject.angle ?? 0,
          opacity: selectedObject.opacity ?? 1,
        },
      });
      setPathDrawMode(true, trackId);
      return;
    }
    if (!selectedObjectId) { toast.error("Select a track first"); return; }
    const track = sceneTracks.find((t) => t.id === selectedObjectId);
    if (!track || track.type !== "visual") { toast.error("Path animation only works on visual objects"); return; }
    const isCharacter = (track.fabricObject as any)?.customType === "character";
    if (isCharacter) {
      toast.info("Draw a path — then choose how the character moves!");
    }
    setPathDrawMode(true, selectedObjectId);
  };

  const handleRemovePath = () => {
    if (!selectedObjectId) return;
    removePathFromTrack(selectedObjectId);
    toast.success("Path removed");
  };

  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [audioFilterPanel, setAudioFilterPanel] = useState<{ trackId: string; trackName: string } | null>(null);
  const [trimDialog, setTrimDialog] = useState<{ trackId: string; startTime: number; endTime: number } | null>(null);

  const handleOpenTrimDialog = () => {
    if (!selectedObjectId || !selectedTrack) {
      toast.error("Select a track first");
      return;
    }
    setTrimDialog({
      trackId: selectedObjectId,
      startTime: selectedTrack.startTime,
      endTime: selectedTrack.endTime,
    });
  };

  const handleTrimTrack = (newStartTime: number, newEndTime: number) => {
    if (!trimDialog) return;
    if (newStartTime >= newEndTime) {
      toast.error("Start time must be before end time");
      return;
    }
    saveCheckpoint();
    
    const selectedTrack = tracks.find((t) => t.id === trimDialog.trackId);
    if (!selectedTrack) return;

    const trimmedDuration = newEndTime - newStartTime;
    const originalStartTime = selectedTrack.startTime;
    const existingMediaOffset = selectedTrack.mediaOffset || 0;
    const mediaOffsetAdjustment = (newStartTime - originalStartTime) + existingMediaOffset;

    updateTrack(trimDialog.trackId, {
      startTime: 0,
      endTime: trimmedDuration,
      mediaOffset: mediaOffsetAdjustment,
      trimmed: true,
    });
    setTrimDialog(null);
    toast.success("Track trimmed and placed at 0 seconds");
  };

  const timeMarkers = isFinite(visibleDuration) ? Array.from({ length: Math.ceil(visibleDuration) + 1 }, (_, i) => i) : [];

  return (
    <div
      className="flex flex-col relative select-none flex-shrink-0"
      style={{
        background: "linear-gradient(180deg, #0f1117 0%, #0a0d14 100%)",
        borderTop: "1px solid rgba(255,255,255,0.07)",
        height: 284,
        minHeight: 284,
        maxHeight: 284,
      }}
    >
      {/* ── Scene Context Bar (Canva/Animaker-style) ─────────────────────── */}
      <div
        className="flex items-center gap-1 px-2 flex-shrink-0 overflow-x-auto"
        style={{
          height: 28,
          minHeight: 28,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(0,0,0,0.25)",
          scrollbarWidth: "none",
        }}
      >
        {/* Left arrow */}
        <button
          title="Previous scene"
          onClick={() => {
            const idx = scenes.findIndex(s => s.id === activeSceneId);
            if (idx > 0) setActiveScene(scenes[idx - 1].id);
          }}
          disabled={scenes.findIndex(s => s.id === activeSceneId) === 0}
          className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-gray-500 hover:text-gray-300 hover:bg-white/8 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
        >
          <svg width="8" height="10" viewBox="0 0 8 10" fill="none"><path d="M6.5 1L1.5 5L6.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>

        {/* Scene pills */}
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {scenes.map((sc, idx) => {
            const isActive = sc.id === activeSceneId;
            const scTrackCount = tracks.filter(t => !t.sceneId || t.sceneId === sc.id).length;
            return (
              <button
                key={sc.id}
                onClick={() => setActiveScene(sc.id)}
                title={`${sc.label} · ${scTrackCount} track${scTrackCount !== 1 ? "s" : ""}`}
                className="flex-shrink-0 flex items-center gap-1.5 px-2 h-5 rounded transition-all"
                style={{
                  background: isActive
                    ? "rgba(99,102,241,0.22)"
                    : "rgba(255,255,255,0.04)",
                  border: isActive
                    ? "1px solid rgba(99,102,241,0.55)"
                    : "1px solid rgba(255,255,255,0.07)",
                  color: isActive ? "#a5b4fc" : "#4b5563",
                }}
              >
                {/* Scene color swatch */}
                <span
                  className="w-2 h-2 rounded-sm flex-shrink-0"
                  style={{ background: sc.bg ?? "#334155", border: "1px solid rgba(255,255,255,0.15)" }}
                />
                <span className="text-[10px] font-semibold whitespace-nowrap" style={{ color: isActive ? "#c7d2fe" : "#6b7280" }}>
                  {idx + 1}. {sc.label}
                </span>
                {scTrackCount > 0 && (
                  <span
                    className="text-[9px] font-medium px-1 rounded-full flex-shrink-0"
                    style={{
                      background: isActive ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.06)",
                      color: isActive ? "#a5b4fc" : "#374151",
                    }}
                  >
                    {scTrackCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right arrow */}
        <button
          title="Next scene"
          onClick={() => {
            const idx = scenes.findIndex(s => s.id === activeSceneId);
            if (idx < scenes.length - 1) setActiveScene(scenes[idx + 1].id);
          }}
          disabled={scenes.findIndex(s => s.id === activeSceneId) === scenes.length - 1}
          className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-gray-500 hover:text-gray-300 hover:bg-white/8 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
        >
          <svg width="8" height="10" viewBox="0 0 8 10" fill="none"><path d="M1.5 1L6.5 5L1.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>

        {/* Separator + active scene duration badge */}
        {activeScene && (
          <>
            <div className="w-px h-3.5 flex-shrink-0 mx-1" style={{ background: "rgba(255,255,255,0.07)" }} />
            <span
              className="flex-shrink-0 flex items-center gap-1 text-[10px] font-mono tabular-nums px-1.5 h-5 rounded"
              style={{ background: "rgba(255,255,255,0.04)", color: "#475569", border: "1px solid rgba(255,255,255,0.05)" }}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="opacity-50"><circle cx="4" cy="4" r="3" stroke="currentColor" strokeWidth="1.2"/><line x1="4" y1="4" x2="4" y2="2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="4" y1="4" x2="5.5" y2="4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              {(activeScene.duration / 1000).toFixed(1)}s
            </span>
            {activeScene.transition && activeScene.transition !== "none" && (
              <span
                className="flex-shrink-0 text-[9px] font-medium px-1.5 h-5 flex items-center rounded"
                style={{ background: "rgba(139,92,246,0.12)", color: "#7c3aed", border: "1px solid rgba(139,92,246,0.2)" }}
              >
                ↝ {activeScene.transition}
              </span>
            )}
          </>
        )}
      </div>
      <div
        className="flex items-center gap-2 px-3 py-2 flex-wrap"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="flex items-center gap-1.5 pr-3" style={{ borderRight: "1px solid rgba(255,255,255,0.08)" }}>
          <button
            onClick={handleReset}
            title="Reset"
            className="h-7 w-7 flex items-center justify-center rounded-md transition-all hover:bg-white/10 text-gray-400 hover:text-white"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handlePlay}
            disabled={sceneTracks.length === 0}
            className={cn(
              "h-7 min-w-[80px] flex items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-all px-3",
              sceneTracks.length === 0
                ? "bg-white/5 text-gray-600 border border-white/5 cursor-not-allowed opacity-50"
                : isPlaying
                ? "bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
                : "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30",
            )}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isPlaying ? "Pause" : "Play"}
          </button>
        </div>

        <div
          className="px-2 py-1 rounded font-mono text-xs tabular-nums"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "#94a3b8" }}
        >
          <span style={{ color: "#e2e8f0" }}>{currentTime.toFixed(2)}</span>
          <span className="mx-0.5">/</span>
          {maxTrackEnd.toFixed(2)}s
        </div>

        <div className="flex items-center gap-1.5 pl-1">
          <button
            onClick={handleAddKeyframe}
            disabled={!selectedObjectId || selectedTrack?.type === "audio"}
            title="Add Keyframe"
            className={cn(
              "h-7 px-2.5 flex items-center gap-1.5 rounded-md text-xs font-medium transition-all border",
              selectedObjectId && selectedTrack?.type !== "audio"
                ? "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border-amber-500/25 hover:border-amber-500/50"
                : "text-gray-600 border-gray-700/50 cursor-not-allowed opacity-40",
            )}
          >
            <Diamond className="w-3 h-3" />
            Keyframe
          </button>

          <button
            onClick={handleSplit}
            disabled={!selectedObjectId}
            title="Split Track"
            className={cn(
              "h-7 px-2.5 flex items-center gap-1.5 rounded-md text-xs font-medium transition-all border",
              selectedObjectId
                ? "bg-sky-500/15 text-sky-400 hover:bg-sky-500/25 border-sky-500/25 hover:border-sky-500/50"
                : "text-gray-600 border-gray-700/50 cursor-not-allowed opacity-40",
            )}
          >
            <SquareSplitHorizontal className="w-3.5 h-3.5" />
            Split
          </button>

          <button
            onClick={handleOpenTrimDialog}
            disabled={!selectedObjectId}
            title="Trim Track"
            className={cn(
              "h-7 px-2.5 flex items-center gap-1.5 rounded-md text-xs font-medium transition-all border",
              selectedObjectId
                ? "bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 border-purple-500/25 hover:border-purple-500/50"
                : "text-gray-600 border-gray-700/50 cursor-not-allowed opacity-40",
            )}
          >
            <SkipBack className="w-3.5 h-3.5" />
            Trim
          </button>

          {hasPath ? (
            <button
              onClick={handleRemovePath}
              title="Remove path animation"
              className="h-7 px-2.5 flex items-center gap-1.5 rounded-md text-xs font-medium transition-all border bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 border-rose-500/25"
            >
              <X className="w-3 h-3" />
              Remove Path
            </button>
          ) : (
            <button
              onClick={handleDrawPath}
              disabled={!isDrawingObjectSelected && (!selectedObjectId || selectedTrack?.type !== "visual")}
              title={
                isDrawingObjectSelected
                  ? "Draw a motion path for this drawing"
                  : !selectedObjectId
                  ? "Select a visual track or drawing first"
                  : selectedTrack?.type !== "visual"
                  ? "Only works on visual objects"
                  : "Draw a motion path"
              }
              className={cn(
                "h-7 px-2.5 flex items-center gap-1.5 rounded-md text-xs font-semibold transition-all border",
                (isDrawingObjectSelected || (selectedObjectId && selectedTrack?.type === "visual"))
                  ? pathDrawMode
                    ? "bg-violet-500/30 text-violet-300 border-violet-500/50 animate-pulse"
                    : "bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 border-violet-500/25 hover:border-violet-500/50"
                  : "text-gray-600 border-gray-700/50 cursor-not-allowed opacity-40",
              )}
            >
              <Route className="w-3.5 h-3.5" />
              {pathDrawMode ? "Drawing…" : "Draw Path"}
            </button>
          )}

          {hasPath && selectedTrack?.pathAnimation && (
            <button
              onClick={() => {
                useEditorStore.setState((s) => ({
                  tracks: s.tracks.map((t) =>
                    t.id === selectedObjectId && t.pathAnimation
                      ? { ...t, pathAnimation: { ...t.pathAnimation, orientToPath: !t.pathAnimation.orientToPath } }
                      : t,
                  ),
                }));
              }}
              title="Toggle orient-to-path"
              className={cn(
                "h-7 px-2.5 flex items-center gap-1.5 rounded-md text-xs font-medium transition-all border",
                selectedTrack.pathAnimation.orientToPath
                  ? "bg-teal-500/20 text-teal-300 border-teal-500/30"
                  : "bg-white/5 text-gray-400 border-white/10 hover:bg-white/10",
              )}
            >
              <Route className="w-3 h-3" />
              Orient
            </button>
          )}

          {hasPath && selectedTrack?.pathAnimation && (
            <div
              className="flex items-center gap-2 px-2.5 h-7 rounded-md border"
              style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)" }}
            >
              <span className="text-[10px] text-gray-400 font-medium select-none whitespace-nowrap">Speed</span>
              <input
                type="range"
                min={0.1}
                max={4}
                step={0.1}
                value={selectedTrack.pathAnimation.speed ?? 1}
                onChange={(e) => {
                  const newSpeed = parseFloat(e.target.value);
                  useEditorStore.setState((s) => ({
                    tracks: s.tracks.map((t) =>
                      t.id === selectedObjectId && t.pathAnimation
                        ? { ...t, pathAnimation: { ...t.pathAnimation, speed: newSpeed } }
                        : t,
                    ),
                  }));
                }}
                className="w-20 h-1.5 accent-violet-400 cursor-pointer"
                title={`Speed: ${(selectedTrack.pathAnimation.speed ?? 1).toFixed(1)}×`}
              />
              <span className="text-[10px] font-mono tabular-nums w-6 text-violet-300">
                {(selectedTrack.pathAnimation.speed ?? 1).toFixed(1)}×
              </span>
            </div>
          )}
        </div>

        <div className="ml-auto relative">
          <button
            onClick={() => setShowVoiceRecorder(v => !v)}
            title="Voice Recorder"
            className={cn(
              "h-7 px-2.5 flex items-center gap-1.5 rounded-md text-xs font-medium transition-all border",
              showVoiceRecorder
                ? "bg-red-500/20 text-red-400 border-red-500/30"
                : "bg-white/5 text-gray-400 border-white/10 hover:bg-white/10 hover:text-white",
            )}
          >
            <Mic className="w-3.5 h-3.5" />
            Record
          </button>

          {showVoiceRecorder && (
            <div
              className="absolute bottom-full right-0 mb-2 z-50 w-72 rounded-xl shadow-2xl border"
              style={{
                background: "linear-gradient(180deg, #0f1117 0%, #0a0d14 100%)",
                borderColor: "rgba(255,255,255,0.1)",
              }}
            >
              <div
                className="flex items-center justify-between px-3 py-2 border-b"
                style={{ borderColor: "rgba(255,255,255,0.07)" }}
              >
                <span className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                  <Mic className="w-3.5 h-3.5 text-red-400" /> Voice Recorder
                </span>
                <button
                  onClick={() => setShowVoiceRecorder(false)}
                  className="text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="p-3">
                <VoiceRecorder />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
        <div
          className="w-48 flex-shrink-0 flex flex-col overflow-y-auto track-label"
          style={{ borderRight: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="h-7 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }} />

          {sceneTracks.length === 0 && (
            <div className="h-10 px-3 flex items-center text-xs text-gray-600">No tracks</div>
          )}

          {sceneTracks.map((track, trackIndex) => {
            const visualIdx = sceneTracks.filter(t => t.type === "visual" && sceneTracks.indexOf(t) <= sceneTracks.indexOf(track)).length - 1;
            const c = getTrackColor(track, visualIdx);
            const isSelected = selectedObjectId === track.id;
            const isDraggingThis = draggingRowIndex === trackIndex;
            const isDropTarget = dropTargetIndex === trackIndex && draggingRowIndex !== null && draggingRowIndex !== trackIndex;
            return (
              <div
                key={track.id}
                draggable
                onDragStart={(e) => handleRowDragStart(e, trackIndex)}
                onDragOver={(e) => handleRowDragOver(e, trackIndex)}
                onDrop={(e) => handleRowDrop(e, trackIndex)}
                onDragEnd={handleRowDragEnd}
                onClick={(e) => handleTrackClick(e, track)}
                className="relative flex items-center gap-1.5 px-2 h-12 cursor-pointer transition-colors overflow-hidden"
                style={{
                  background: isDropTarget
                    ? "rgba(99,102,241,0.15)"
                    : isSelected ? "rgba(255,255,255,0.06)" : undefined,
                  boxShadow: isSelected ? `inset 2px 0 0 ${c.dot}` : undefined,
                  borderBottom: isDropTarget
                    ? "2px solid rgba(99,102,241,0.8)"
                    : "1px solid rgba(255,255,255,0.035)",
                  opacity: isDraggingThis ? 0.4 : 1,
                  transition: "opacity 0.15s, background 0.1s, border-color 0.1s",
                }}
              >
                {isSelected && (
                  <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: c.dot }} />
                )}

                {/* Drag handle */}
                <div
                  className="flex-shrink-0 flex flex-col gap-px cursor-grab active:cursor-grabbing"
                  style={{ opacity: 0.35, padding: "0 1px" }}
                  title="Drag to reorder track"
                >
                  {[0,1,2].map(i => (
                    <div key={i} style={{ display: "flex", gap: 2 }}>
                      <div style={{ width: 2, height: 2, borderRadius: "50%", background: "#9ca3af" }} />
                      <div style={{ width: 2, height: 2, borderRadius: "50%", background: "#9ca3af" }} />
                    </div>
                  ))}
                </div>

                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.dot }} />

                {track.type === "audio" && <Music className="w-3 h-3 flex-shrink-0 opacity-70" style={{ color: c.text }} />}
                {track.type === "video" && <Video className="w-3 h-3 flex-shrink-0 opacity-70" style={{ color: c.text }} />}
                {track.pathAnimation && <Route className="w-3 h-3 flex-shrink-0 opacity-80" style={{ color: "#c4b5fd" }} />}
                {track.trimmed && (
                  <span title="Track has been trimmed" className="flex items-center gap-1">
                    <Scissors className="w-3 h-3 flex-shrink-0" style={{ color: "#f59e0b" }} />
                    <span className="text-xs font-medium text-amber-600" style={{ fontSize: "10px" }}>Trimmed</span>
                  </span>
                )}
                {track.type === "audio" && ((track.audioFilterKeys?.length ?? 0) + (track.audioCleaningKeys?.length ?? 0) > 0) && (
                  <span title="Filters applied">
                    <Wand2 className="w-3 h-3 flex-shrink-0" style={{ color: "#a78bfa" }} />
                  </span>
                )}

                <div className="flex-1 overflow-hidden">
                  <span
                    className="truncate text-xs font-medium block"
                    style={{ color: isSelected ? c.text : "#6b7280" }}
                  >
                    {track.name}
                  </span>
                  {(track.type === "audio" || track.type === "video") && (
                    <div className="flex items-center gap-1 mt-1" onClick={e => e.stopPropagation()}>
                      <button onClick={() => updateTrack(track.id, { volume: track.volume === 0 ? 1 : 0 })}>
                        {track.volume === 0 ? <VolumeX className="w-3 h-3 text-gray-500" /> : <Volume2 className="w-3 h-3 text-gray-400" />}
                      </button>
                      <input
                        type="range"
                        min={0} max={1} step={0.05}
                        value={track.volume ?? 1}
                        onChange={(e) => updateTrack(track.id, { volume: parseFloat(e.target.value) })}
                        className="w-16 h-1 accent-purple-400 bg-gray-700 rounded-full appearance-none"
                      />
                    </div>
                  )}
                  {/* Remove Filters button — shown only when selected audio track has filters */}
                  {isSelected && track.type === "audio" && ((track.audioFilterKeys?.length ?? 0) + (track.audioCleaningKeys?.length ?? 0) > 0) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeAudioFiltersFromTrack(track.id); }}
                      title="Remove all applied filters"
                      style={{
                        marginTop: 3,
                        display: "flex",
                        alignItems: "center",
                        gap: 3,
                        fontSize: 9,
                        fontWeight: 700,
                        color: "#f87171",
                        background: "rgba(239,68,68,0.1)",
                        border: "1px solid rgba(239,68,68,0.3)",
                        borderRadius: 4,
                        padding: "2px 6px",
                        cursor: "pointer",
                        letterSpacing: "0.03em",
                      }}
                    >
                      <Wand2 style={{ width: 8, height: 8 }} />
                      Remove Filters ({(track.audioFilterKeys?.length ?? 0) + (track.audioCleaningKeys?.length ?? 0)})
                    </button>
                  )}
                  {isSelected && (track.fabricObject as any)?.customType === "prop" && (
                    <button
                      onClick={(e) => openPropActions(track, e)}
                      title="Open prop actions"
                      style={{
                        marginTop: 2,
                        display: "flex",
                        alignItems: "center",
                        gap: 3,
                        fontSize: 9,
                        fontWeight: 700,
                        color: c.text,
                        background: `${c.dot}22`,
                        border: `1px solid ${c.dot}44`,
                        borderRadius: 4,
                        padding: "1px 5px",
                        cursor: "pointer",
                        letterSpacing: "0.03em",
                      }}
                    >
                      <Zap style={{ width: 8, height: 8 }} />
                      Actions
                    </button>
                  )}
                </div>

                {track.keyframes.length > 0 && (
                  <span
                    className="ml-auto text-[10px] rounded-full px-1.5 flex-shrink-0 tabular-nums self-start mt-1"
                    style={{ background: c.glow, color: c.text, border: `1px solid ${c.dot}40` }}
                  >
                    {track.keyframes.length}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div ref={scrollContainerRef} className="flex-1 overflow-x-auto overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
          <div
            ref={timelineRef}
            className="relative"
            style={{ width: `${timelineWidth}px`, minHeight: "100%" }}
            onClick={handleTimelineClick}
            onContextMenu={handleTimelineRightClick}
          >
            <div
              className="h-7 relative sticky top-0 z-10"
              style={{
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(10,13,20,0.95)",
                backdropFilter: "blur(4px)",
              }}
            >
              {timeMarkers.map((sec) => (
                <div
                  key={sec}
                  className="absolute flex flex-col items-center"
                  style={{ left: `${timeToPixels(sec)}px`, top: 0, bottom: 0 }}
                >
                  <div className="w-px h-full" style={{ background: "rgba(255,255,255,0.08)" }} />
                  <span
                    className="absolute bottom-1 text-[9px] tabular-nums"
                    style={{ color: "#4b5563", transform: "translateX(-50%)" }}
                  >
                    {sec}s
                  </span>
                </div>
              ))}
              {timeMarkers.slice(0, -1).map((sec) =>
                [0.25, 0.5, 0.75].map((frac) => (
                  <div
                    key={`${sec}-${frac}`}
                    className="absolute"
                    style={{
                      left: `${timeToPixels(sec + frac)}px`,
                      top: "60%",
                      bottom: 0,
                      width: 1,
                      background: "rgba(255,255,255,0.04)",
                    }}
                  />
                )),
              )}
            </div>

            <div className="relative">
              {sceneTracks.map((track, trackIdx) => {
                const visualIdx = sceneTracks.filter((t, i) => t.type === "visual" && i <= trackIdx).length - 1;
                const c = getTrackColor(track, visualIdx);
                const isSelected = selectedObjectId === track.id;
                return (
                  <div
                    key={track.id}
                    className="h-12 relative cursor-pointer transition-colors"
                    style={{
                      background: trackIdx % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent",
                      borderBottom: "1px solid rgba(255,255,255,0.035)",
                    }}
                    onClick={(e) => handleTrackClick(e, track)}
                  >
                    <div
                      className="absolute h-8 top-2 rounded-md cursor-move overflow-hidden transition-shadow"
                      style={{
                        left: `${timeToPixels(track.startTime)}px`,
                        width: `${timeToPixels(track.endTime - track.startTime)}px`,
                        background: `linear-gradient(90deg, ${c.from} 0%, ${c.to} 100%)`,
                        boxShadow: isSelected
                          ? `0 0 0 1.5px rgba(255,255,255,0.25), 0 0 14px ${c.glow}`
                          : `0 1px 4px rgba(0,0,0,0.35)`,
                        minWidth: 4,
                      }}
                      onMouseDown={(e) => handleTrackDragStart(e, track.id)}
                      onDoubleClick={(e) => {
                        if ((track.fabricObject as any)?.customType === "prop") {
                          openPropActions(track, e);
                        }
                      }}
                    >
                      {track.type === "audio" && <WaveformBars trackId={track.id} />}

                      {track.type === "video" && (
                        <div
                          className="absolute inset-0 opacity-20 pointer-events-none"
                          style={{ backgroundImage: "repeating-linear-gradient(90deg, transparent, transparent 14px, rgba(0,0,0,0.5) 14px, rgba(0,0,0,0.5) 16px)" }}
                        />
                      )}

                      {track.pathAnimation && (
                        <div
                          className="absolute right-1 top-0.5 flex items-center gap-0.5 px-1 rounded text-[9px] font-bold"
                          style={{ background: "rgba(139,92,246,0.5)", color: "#ede9fe" }}
                        >
                          <Route className="w-2.5 h-2.5" /> PATH
                        </div>
                      )}

                      <div className="absolute inset-0 flex items-center px-2 pointer-events-none overflow-hidden">
                        <span className="text-white/75 text-[10px] font-semibold truncate leading-none drop-shadow-sm">
                          {track.name}
                        </span>
                      </div>

                      <div
                        className="track-resize-handle absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize z-10 rounded-l-md"
                        style={{ background: "linear-gradient(90deg, rgba(0,0,0,0.35) 0%, transparent 100%)" }}
                        onMouseDown={(e) => handleTrackResizeStart(e, track.id, "start")}
                      />
                      <div
                        className="track-resize-handle absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize z-10 rounded-r-md"
                        style={{ background: "linear-gradient(270deg, rgba(0,0,0,0.35) 0%, transparent 100%)" }}
                        onMouseDown={(e) => handleTrackResizeStart(e, track.id, "end")}
                      />
                    </div>

                    {track.type !== "audio" &&
                      track.keyframes.map((kf) => {
                        const isKfSelected = selectedKeyframe?.id === kf.id;
                        return (
                          <button
                            key={kf.id}
                            className={cn(
                              "keyframe-marker absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 z-20 transition-transform hover:scale-125",
                              isKfSelected && "scale-125",
                            )}
                            style={{ left: `${timeToPixels(kf.time)}px` }}
                            onClick={(e) => handleKeyframeClick(e, kf, track.id)}
                            title={`Keyframe @ ${kf.time.toFixed(2)}s`}
                          >
                            <Diamond
                              className="w-4 h-4 drop-shadow-sm"
                              style={{
                                color: isKfSelected ? "#fbbf24" : "rgba(255,255,255,0.65)",
                                fill: isKfSelected ? "#fbbf24" : "transparent",
                                filter: isKfSelected ? "drop-shadow(0 0 4px rgba(251,191,36,0.6))" : undefined,
                              }}
                            />
                          </button>
                        );
                      })}
                  </div>
                );
              })}
            </div>

            <div
              className="absolute top-0 bottom-0 z-30 pointer-events-none"
              style={{ left: `${Math.min(timeToPixels(currentTime), timelineWidth)}px` }}
            >
              <div className="absolute top-0 bottom-0 w-px" style={{ background: "rgba(251,191,36,0.8)", boxShadow: "0 0 8px rgba(251,191,36,0.5)" }} />
              <div
                className="absolute -top-0 pointer-events-auto cursor-ew-resize"
                style={{ left: "-10px", width: 20 }}
                onMouseDown={handlePlayheadMouseDown}
              >
                <div
                  className="mx-auto w-5 h-5 flex items-end justify-center cursor-ew-resize"
                  style={{ marginLeft: -2 }}
                >
                  <div
                    style={{
                      width: 0, height: 0,
                      borderLeft: "7px solid transparent",
                      borderRight: "7px solid transparent",
                      borderTop: "10px solid #fbbf24",
                      filter: "drop-shadow(0 2px 4px rgba(251,191,36,0.5))",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Trim Dialog */}
      {trimDialog && (() => {
        const originalStart = selectedTrack?.startTime ?? 0;
        const originalEnd   = selectedTrack?.endTime   ?? trimDialog.endTime;
        const trimmedDur    = trimDialog.endTime - trimDialog.startTime;
        const originalDur   = originalEnd - originalStart;
        const pctStart      = originalDur > 0 ? ((trimDialog.startTime - originalStart) / originalDur) * 100 : 0;
        const pctEnd        = originalDur > 0 ? ((trimDialog.endTime   - originalStart) / originalDur) * 100 : 100;
        const isValid       = trimDialog.startTime < trimDialog.endTime;

        const nudge = (field: "startTime" | "endTime", delta: number) => {
          setTrimDialog((prev) => {
            if (!prev) return prev;
            const raw = parseFloat((prev[field] + delta).toFixed(2));
            if (field === "startTime") {
              const clamped = Math.max(0, Math.min(raw, prev.endTime - 0.1));
              return { ...prev, startTime: clamped };
            } else {
              const clamped = Math.max(prev.startTime + 0.1, raw);
              return { ...prev, endTime: clamped };
            }
          });
        };

        const handleRawInput = (field: "startTime" | "endTime", raw: string) => {
          setTrimDialog((prev) => prev ? { ...prev, [field]: raw as any } : prev);
        };

        const handleBlur = (field: "startTime" | "endTime", raw: string) => {
          const val = parseFloat(raw);
          if (isNaN(val)) {
            setTrimDialog((prev) => prev ? { ...prev } : prev);
            return;
          }
          setTrimDialog((prev) => {
            if (!prev) return prev;
            if (field === "startTime") {
              const clamped = Math.max(0, Math.min(val, prev.endTime - 0.1));
              return { ...prev, startTime: parseFloat(clamped.toFixed(2)) };
            } else {
              const clamped = Math.max((prev.startTime as number) + 0.1, val);
              return { ...prev, endTime: parseFloat(clamped.toFixed(2)) };
            }
          });
        };

        const inputStyle: React.CSSProperties = {
          flex: 1,
          padding: "8px 10px",
          borderRadius: 8,
          border: "1.5px solid rgba(139,92,246,0.35)",
          background: "rgba(139,92,246,0.08)",
          color: "#e2e8f0",
          fontSize: 15,
          fontWeight: 600,
          fontFamily: "monospace",
          outline: "none",
          textAlign: "center",
          minWidth: 0,
          transition: "border-color 0.15s",
        };

        const nudgeBtnStyle = (side: "left" | "right"): React.CSSProperties => ({
          width: 34,
          height: 38,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: side === "left" ? "8px 0 0 8px" : "0 8px 8px 0",
          border: "1.5px solid rgba(139,92,246,0.25)",
          borderRight: side === "left" ? "none" : "1.5px solid rgba(139,92,246,0.25)",
          borderLeft: side === "right" ? "none" : "1.5px solid rgba(139,92,246,0.25)",
          background: "rgba(139,92,246,0.1)",
          color: "#a78bfa",
          fontSize: 16,
          cursor: "pointer",
          userSelect: "none",
          flexShrink: 0,
          transition: "background 0.12s",
        });

        return (
          <div
            className="fixed inset-0 flex items-center justify-center z-50"
            style={{ backgroundColor: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
            onClick={() => setTrimDialog(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "linear-gradient(180deg, #0f1117 0%, #0a0d14 100%)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 16,
                padding: "24px 24px 20px",
                width: 400,
                boxShadow: "0 24px 64px rgba(0,0,0,0.8), 0 0 0 1px rgba(139,92,246,0.2)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: "rgba(139,92,246,0.15)",
                    border: "1px solid rgba(139,92,246,0.3)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 15,
                  }}>✂️</span>
                  <div>
                    <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 700 }}>Trim Track</div>
                    <div style={{ color: "#64748b", fontSize: 10, marginTop: 1 }}>
                      {selectedTrack?.name ?? "Selected track"}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setTrimDialog(null)}
                  style={{
                    width: 26, height: 26, borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "transparent", color: "#475569",
                    fontSize: 12, cursor: "pointer", display: "flex",
                    alignItems: "center", justifyContent: "center",
                  }}
                >✕</button>
              </div>

              <div style={{ marginBottom: 20 }}>
                <div style={{
                  height: 28, borderRadius: 8, position: "relative",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  overflow: "hidden",
                }}>
                  <div style={{
                    position: "absolute",
                    left: `${pctStart}%`,
                    width: `${pctEnd - pctStart}%`,
                    top: 0, bottom: 0,
                    background: "linear-gradient(90deg, rgba(139,92,246,0.45), rgba(168,85,247,0.3))",
                    borderLeft: "2px solid rgba(139,92,246,0.9)",
                    borderRight: "2px solid rgba(168,85,247,0.9)",
                  }}>
                    <div style={{
                      position: "absolute", inset: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 700, color: "#c4b5fd",
                      fontFamily: "monospace",
                    }}>
                      {trimmedDur.toFixed(2)}s
                    </div>
                  </div>
                  {pctStart > 0 && (
                    <div style={{
                      position: "absolute", left: 0, top: 0, bottom: 0,
                      width: `${pctStart}%`,
                      background: "repeating-linear-gradient(45deg, rgba(255,0,0,0.06) 0px, rgba(255,0,0,0.06) 4px, transparent 4px, transparent 8px)",
                    }} />
                  )}
                  {pctEnd < 100 && (
                    <div style={{
                      position: "absolute", right: 0, top: 0, bottom: 0,
                      width: `${100 - pctEnd}%`,
                      background: "repeating-linear-gradient(45deg, rgba(255,0,0,0.06) 0px, rgba(255,0,0,0.06) 4px, transparent 4px, transparent 8px)",
                    }} />
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9, color: "#334155", fontFamily: "monospace" }}>
                  <span>{originalStart.toFixed(2)}s</span>
                  <span>{originalEnd.toFixed(2)}s</span>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                    Start Time
                  </label>
                  <div style={{ display: "flex", alignItems: "stretch" }}>
                    <button
                      style={nudgeBtnStyle("left")}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => nudge("startTime", -0.1)}
                      title="-0.1s"
                    >−</button>
                    <input
                      type="text"
                      inputMode="decimal"
                      style={inputStyle}
                      value={typeof trimDialog.startTime === "number" ? trimDialog.startTime.toFixed !== undefined && Number.isFinite(trimDialog.startTime) ? trimDialog.startTime.toFixed(2) : String(trimDialog.startTime) : trimDialog.startTime}
                      onChange={(e) => handleRawInput("startTime", e.target.value)}
                      onBlur={(e) => handleBlur("startTime", e.target.value)}
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowUp")   { e.preventDefault(); nudge("startTime", +0.1); }
                        if (e.key === "ArrowDown") { e.preventDefault(); nudge("startTime", -0.1); }
                        if (e.key === "Enter")     { e.currentTarget.blur(); }
                      }}
                    />
                    <button
                      style={nudgeBtnStyle("right")}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => nudge("startTime", +0.1)}
                      title="+0.1s"
                    >+</button>
                  </div>
                  <div style={{ fontSize: 10, color: "#475569", marginTop: 5, display: "flex", gap: 10 }}>
                    <span>Original: <span style={{ color: "#64748b", fontFamily: "monospace" }}>{originalStart.toFixed(2)}s</span></span>
                    <span style={{ color: "#334155" }}>·</span>
                    <span>↑↓ arrows or click ± to nudge by 0.1s</span>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                    End Time
                  </label>
                  <div style={{ display: "flex", alignItems: "stretch" }}>
                    <button
                      style={nudgeBtnStyle("left")}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => nudge("endTime", -0.1)}
                      title="-0.1s"
                    >−</button>
                    <input
                      type="text"
                      inputMode="decimal"
                      style={inputStyle}
                      value={typeof trimDialog.endTime === "number" ? trimDialog.endTime.toFixed !== undefined && Number.isFinite(trimDialog.endTime) ? trimDialog.endTime.toFixed(2) : String(trimDialog.endTime) : trimDialog.endTime}
                      onChange={(e) => handleRawInput("endTime", e.target.value)}
                      onBlur={(e) => handleBlur("endTime", e.target.value)}
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowUp")   { e.preventDefault(); nudge("endTime", +0.1); }
                        if (e.key === "ArrowDown") { e.preventDefault(); nudge("endTime", -0.1); }
                        if (e.key === "Enter")     { e.currentTarget.blur(); }
                      }}
                    />
                    <button
                      style={nudgeBtnStyle("right")}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => nudge("endTime", +0.1)}
                      title="+0.1s"
                    >+</button>
                  </div>
                  <div style={{ fontSize: 10, color: "#475569", marginTop: 5, display: "flex", gap: 10 }}>
                    <span>Original: <span style={{ color: "#64748b", fontFamily: "monospace" }}>{originalEnd.toFixed(2)}s</span></span>
                    <span style={{ color: "#334155" }}>·</span>
                    <span>↑↓ arrows or click ± to nudge by 0.1s</span>
                  </div>
                </div>
              </div>

              <div style={{
                marginTop: 16, padding: "10px 14px", borderRadius: 10,
                background: isValid ? "rgba(139,92,246,0.08)" : "rgba(239,68,68,0.08)",
                border: `1px solid ${isValid ? "rgba(139,92,246,0.2)" : "rgba(239,68,68,0.3)"}`,
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                {isValid ? (
                  <>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>
                      <span style={{ color: "#64748b" }}>Original </span>
                      <span style={{ fontFamily: "monospace", color: "#94a3b8" }}>{originalDur.toFixed(2)}s</span>
                      <span style={{ color: "#475569", margin: "0 6px" }}>→</span>
                      <span style={{ fontFamily: "monospace", color: "#c4b5fd", fontWeight: 700 }}>{trimmedDur.toFixed(2)}s</span>
                    </div>
                    <div style={{ fontSize: 10, color: "#7c3aed", background: "rgba(139,92,246,0.15)", borderRadius: 20, padding: "2px 8px", fontWeight: 600 }}>
                      −{(originalDur - trimmedDur).toFixed(2)}s
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 11, color: "#f87171", fontWeight: 600 }}>
                    ⚠ Start time must be before end time
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button
                  onClick={() => setTrimDialog(null)}
                  style={{
                    flex: 1, padding: "9px 0", borderRadius: 9,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "transparent", color: "#64748b",
                    fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.12s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.color = "#94a3b8"}
                  onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.color = "#64748b"}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleTrimTrack(trimDialog.startTime as number, trimDialog.endTime as number)}
                  disabled={!isValid}
                  style={{
                    flex: 2, padding: "9px 0", borderRadius: 9,
                    border: isValid ? "1.5px solid rgba(139,92,246,0.6)" : "1px solid rgba(255,255,255,0.05)",
                    background: isValid
                      ? "linear-gradient(135deg, rgba(139,92,246,0.35) 0%, rgba(168,85,247,0.25) 100%)"
                      : "rgba(255,255,255,0.03)",
                    color: isValid ? "#e2e8f0" : "#374151",
                    fontSize: 12, fontWeight: 700, cursor: isValid ? "pointer" : "not-allowed",
                    transition: "all 0.15s",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}
                  onMouseEnter={(e) => { if (isValid) { const el = e.currentTarget as HTMLElement; el.style.background = "linear-gradient(135deg, rgba(139,92,246,0.5) 0%, rgba(168,85,247,0.4) 100%)"; }}}
                  onMouseLeave={(e) => { if (isValid) { const el = e.currentTarget as HTMLElement; el.style.background = "linear-gradient(135deg, rgba(139,92,246,0.35) 0%, rgba(168,85,247,0.25) 100%)"; }}}
                >
                  ✂️ Apply Trim
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <KeyframeEditor />

      {propPopup && (
        <PropActionPopup
          propName={propPopup.propName}
          propPosition={propPopup.position}
          canvasEl={propPopup.canvasEl}
          propTrackId={propPopup.propTrackId}
          onClose={() => setPropPopup(null)}
        />
      )}
    </div>
  );
}