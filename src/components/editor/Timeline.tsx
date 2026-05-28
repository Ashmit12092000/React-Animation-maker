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
  VolumeX
} from "lucide-react";
import { cn } from "@/lib/utils";
import { KeyframeEditor } from "./KeyframeEditor";
import { toast } from "sonner";
import { VoiceRecorder } from "./VoiceRecorder";

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
  } = useEditorStore();

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

  const maxTrackEnd = Math.max(0, ...tracks.map((t) => (isFinite(t.endTime) ? t.endTime : 0)));

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

  useEffect(() => {
    if (isPlaying) {
      const animate = (ts: number) => {
        const elapsed = (ts - startTimeRef.current) / 1000;
        if (elapsed >= maxDuration) {
          setCurrentTime(maxDuration);
          applyKeyframesAtTime(maxDuration); // ensure arrival frame runs before isPlaying flips
          setIsPlaying(false);
          syncAudioPlayback();
          return;
        }
        setCurrentTime(elapsed); applyKeyframesAtTime(elapsed);
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
      syncAudioPlayback();
    } else {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      syncAudioPlayback();
    }
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [isPlaying, maxDuration, setCurrentTime, applyKeyframesAtTime, syncAudioPlayback, setIsPlaying]);

  const handleTrackClick = (track: (typeof tracks)[0]) => {
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

  const handleDrawPath = () => {
    if (!selectedObjectId) { toast.error("Select a track first"); return; }
    const track = tracks.find((t) => t.id === selectedObjectId);
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

  const selectedTrack = tracks.find((t) => t.id === selectedObjectId);
  const hasPath = !!(selectedTrack?.pathAnimation);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
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
    updateTrack(trimDialog.trackId, {
      startTime: newStartTime,
      endTime: newEndTime,
    });
    setTrimDialog(null);
    toast.success("Track trimmed");
  };

  const timeMarkers = isFinite(visibleDuration) ? Array.from({ length: Math.ceil(visibleDuration) + 1 }, (_, i) => i) : [];

  return (
    <div
      className="flex flex-col relative select-none"
      style={{
        background: "linear-gradient(180deg, #0f1117 0%, #0a0d14 100%)",
        borderTop: "1px solid rgba(255,255,255,0.07)",
        minHeight: 200,
      }}
    >
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
            className={cn(
              "h-7 min-w-[80px] flex items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-all px-3",
              isPlaying
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
              disabled={!selectedObjectId || selectedTrack?.type !== "visual"}
              title={
                !selectedObjectId
                  ? "Select a visual track first"
                  : selectedTrack?.type !== "visual"
                  ? "Only works on visual objects"
                  : "Draw a motion path"
              }
              className={cn(
                "h-7 px-2.5 flex items-center gap-1.5 rounded-md text-xs font-semibold transition-all border",
                selectedObjectId && selectedTrack?.type === "visual"
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
              <RotateCcw className="w-3 h-3" />
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

      <div className="flex flex-1 overflow-hidden" style={{ minHeight: 120 }}>
        <div
          className="w-48 flex-shrink-0 flex flex-col overflow-y-auto track-label"
          style={{ borderRight: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="h-7 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }} />

          {tracks.length === 0 && (
            <div className="h-10 px-3 flex items-center text-xs text-gray-600">No tracks</div>
          )}

          {tracks.map((track) => {
            const visualIdx = tracks.filter(t => t.type === "visual" && tracks.indexOf(t) <= tracks.indexOf(track)).length - 1;
            const c = getTrackColor(track, visualIdx);
            const isSelected = selectedObjectId === track.id;
            return (
              <div
                key={track.id}
                onClick={() => handleTrackClick(track)}
                className="h-12 flex-shrink-0 flex items-center gap-1.5 px-3 text-left transition-all group relative overflow-hidden cursor-pointer"
                style={{
                  background: isSelected ? "rgba(255,255,255,0.06)" : undefined,
                  boxShadow: isSelected ? `inset 2px 0 0 ${c.dot}` : undefined,
                }}
              >
                {isSelected && (
                  <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: c.dot }} />
                )}

                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.dot }} />

                {track.type === "audio" && <Music className="w-3 h-3 flex-shrink-0 opacity-70" style={{ color: c.text }} />}
                {track.type === "video" && <Video className="w-3 h-3 flex-shrink-0 opacity-70" style={{ color: c.text }} />}
                {track.pathAnimation && <Route className="w-3 h-3 flex-shrink-0 opacity-80" style={{ color: "#c4b5fd" }} />}

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
              {tracks.map((track, trackIdx) => {
                const visualIdx = tracks.filter((t, i) => t.type === "visual" && i <= trackIdx).length - 1;
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
                    onClick={() => handleTrackClick(track)}
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
      {trimDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div
            className="rounded-lg shadow-2xl border p-6 w-96"
            style={{
              background: "linear-gradient(180deg, #0f1117 0%, #0a0d14 100%)",
              borderColor: "rgba(255,255,255,0.1)",
            }}
          >
            <h3 className="text-lg font-bold text-white mb-4">Trim Track</h3>

            <div className="space-y-4">
              {/* Start Time */}
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-2">Start Time (seconds)</label>
                <input
                  type="number"
                  min={0}
                  max={trimDialog.endTime - 0.1}
                  step={0.1}
                  value={trimDialog.startTime.toFixed(2)}
                  onChange={(e) => setTrimDialog({ ...trimDialog, startTime: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 rounded-md border border-purple-500/30 bg-purple-500/10 text-white focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/30 outline-none transition-all"
                />
                <div className="text-[10px] text-gray-500 mt-1">
                  Track starts at: {selectedTrack?.startTime.toFixed(2)}s
                </div>
              </div>

              {/* End Time */}
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-2">End Time (seconds)</label>
                <input
                  type="number"
                  min={trimDialog.startTime + 0.1}
                  max={selectedTrack?.endTime || 999}
                  step={0.1}
                  value={trimDialog.endTime.toFixed(2)}
                  onChange={(e) => setTrimDialog({ ...trimDialog, endTime: parseFloat(e.target.value) || trimDialog.endTime })}
                  className="w-full px-3 py-2 rounded-md border border-purple-500/30 bg-purple-500/10 text-white focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/30 outline-none transition-all"
                />
                <div className="text-[10px] text-gray-500 mt-1">
                  Track ends at: {selectedTrack?.endTime.toFixed(2)}s
                </div>
              </div>

              {/* Duration Preview */}
              <div className="bg-purple-500/10 border border-purple-500/20 rounded-md p-3">
                <div className="text-xs font-semibold text-purple-400 mb-2">Duration Preview</div>
                <div className="flex items-center gap-3 text-sm">
                  <div>
                    <span className="text-gray-400">Original: </span>
                    <span className="text-white font-mono">
                      {(selectedTrack?.endTime || 0).toFixed(2)}s
                    </span>
                  </div>
                  <div className="text-gray-600">→</div>
                  <div>
                    <span className="text-gray-400">Trimmed: </span>
                    <span className="text-purple-300 font-mono">
                      {(trimDialog.endTime - trimDialog.startTime).toFixed(2)}s
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setTrimDialog(null)}
                className="flex-1 px-3 py-2 rounded-md border border-gray-600 text-gray-300 hover:bg-gray-600/20 transition-all text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => handleTrimTrack(trimDialog.startTime, trimDialog.endTime)}
                className="flex-1 px-3 py-2 rounded-md bg-purple-600 text-white hover:bg-purple-700 transition-all text-sm font-medium"
              >
                Apply Trim
              </button>
            </div>
          </div>
        </div>
      )}

      <KeyframeEditor />
    </div>
  );
}