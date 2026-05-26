import { useState, useRef, useEffect } from "react";
import { Mic, MicOff, Square, Play, Trash2, Check, Wand2, Sliders } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/stores/editorStore";

type RecordingState = "idle" | "recording" | "recorded" | "processing";

interface AudioFilter {
  key: string;
  label: string;
  description: string;
}

const AUDIO_CLEANING_OPTIONS: AudioFilter[] = [
  { key: "noise_reduction", label: "Noise Reduction", description: "Remove background hiss & hum" },
  { key: "normalize", label: "Normalize", description: "Balance overall volume levels" },
  { key: "silence_trim", label: "Trim Silence", description: "Remove silent start/end gaps" },
];

const AUDIO_FILTER_OPTIONS: AudioFilter[] = [
  { key: "reverb", label: "Reverb", description: "Add room ambience" },
  { key: "echo", label: "Echo", description: "Subtle delay effect" },
  { key: "pitch_up", label: "Pitch Up", description: "Raise pitch slightly" },
  { key: "pitch_down", label: "Pitch Down", description: "Lower pitch slightly" },
  { key: "telephone", label: "Telephone", description: "Lo-fi telephone effect" },
  { key: "deep", label: "Deep Voice", description: "Low & resonant tone" },
];

export function VoiceRecorder() {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [activeCleaningOptions, setActiveCleaningOptions] = useState<string[]>([]);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [showOptions, setShowOptions] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [waveformData, setWaveformData] = useState<number[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const keepAudioUrlAliveRef = useRef(false);

  const { addAudioTrack } = useEditorStore();

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioUrl && !keepAudioUrlAliveRef.current) {
        URL.revokeObjectURL(audioUrl);
      }
      keepAudioUrlAliveRef.current = false;
    };
  }, [audioUrl]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const drawWaveform = () => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        setWaveformData(Array.from(data).map(v => v / 255));
        animFrameRef.current = requestAnimationFrame(drawWaveform);
      };
      drawWaveform();

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioUrl(url);
        setWaveformData([]);
        setRecordingState("recorded");
      };

      mediaRecorder.start(100);
      setRecordingState("recording");
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch (err) {
      console.error("Mic access denied:", err);
    }
  };

  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRecorderRef.current?.stop();
  };

  const discardRecording = () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      setIsPreviewPlaying(false);
    }
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingState("idle");
    setRecordingTime(0);
    setActiveCleaningOptions([]);
    setActiveFilters([]);
    setShowOptions(false);
  };

  const togglePreview = () => {
    if (!audioUrl) return;
    if (!previewAudioRef.current) {
      previewAudioRef.current = new Audio(audioUrl);
      previewAudioRef.current.onended = () => setIsPreviewPlaying(false);
    }
    if (isPreviewPlaying) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
      setIsPreviewPlaying(false);
    } else {
      previewAudioRef.current.play();
      setIsPreviewPlaying(true);
    }
  };

  const applyToTimeline = () => {
    if (!audioBlob || !audioUrl) return;
    setRecordingState("processing");

    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const filterLabel = activeFilters.length > 0 ? ` [${activeFilters.join(", ")}]` : "";
    const trackName = `Voice Recording ${timestamp}${filterLabel}`;

    addAudioTrack(trackName, audioUrl);
    keepAudioUrlAliveRef.current = true;

    if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current.currentTime = 0;
        setIsPreviewPlaying(false);
    }

    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingState("idle");
    setRecordingTime(0);
    setActiveCleaningOptions([]);
    setActiveFilters([]);
    setShowOptions(false);
  };

  const toggleOption = (key: string, type: "cleaning" | "filter") => {
    if (type === "cleaning") {
      setActiveCleaningOptions(prev =>
        prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      );
    } else {
      setActiveFilters(prev =>
        prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      );
    }
  };

  const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 text-muted-foreground">
        <Mic className="w-4 h-4" />
        <span className="text-xs font-medium uppercase tracking-wide">Voice Record</span>
      </div>

      {/* Recording Controls */}
      <div className="bg-secondary/30 rounded-lg p-3 space-y-3 border border-panel-border">

        {/* Waveform / Status */}
        <div className="h-10 flex items-center justify-center gap-0.5 rounded-md bg-black/20 overflow-hidden px-2">
          {recordingState === "recording" && waveformData.length > 0 ? (
            waveformData.slice(0, 28).map((v, i) => (
              <div
                key={i}
                className="flex-1 rounded-full bg-red-400 transition-all duration-75"
                style={{ height: `${Math.max(8, v * 100)}%`, minWidth: 2 }}
              />
            ))
          ) : recordingState === "recorded" ? (
            // Static waveform preview
            Array.from({ length: 28 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 rounded-full bg-purple-400"
                style={{ height: `${20 + ((i * 37 + 13) % 65)}%`, minWidth: 2 }}
              />
            ))
          ) : (
            Array.from({ length: 28 }).map((_, i) => (
              <div key={i} className="flex-1 rounded-full bg-white/10" style={{ height: "20%", minWidth: 2 }} />
            ))
          )}
        </div>

        {/* Timer */}
        <div className="text-center">
          <span className={`text-lg font-mono font-bold ${recordingState === "recording" ? "text-red-400" : "text-foreground"}`}>
            {formatTime(recordingTime)}
          </span>
          {recordingState === "recording" && (
            <span className="ml-2 text-xs text-red-400 animate-pulse">● REC</span>
          )}
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-2">
          {recordingState === "idle" && (
            <Button size="sm" className="flex-1 bg-red-500 hover:bg-red-600 text-white gap-1.5" onClick={startRecording}>
              <Mic className="w-3.5 h-3.5" /> Record
            </Button>
          )}

          {recordingState === "recording" && (
            <Button size="sm" className="flex-1 bg-red-500 hover:bg-red-600 text-white gap-1.5" onClick={stopRecording}>
              <Square className="w-3.5 h-3.5 fill-current" /> Stop
            </Button>
          )}

          {recordingState === "recorded" && (
            <>
              <Button size="sm" variant="outline" className="flex-1 gap-1.5 border-panel-border" onClick={togglePreview}>
                {isPreviewPlaying ? <MicOff className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {isPreviewPlaying ? "Stop" : "Preview"}
              </Button>
              <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 px-2" onClick={discardRecording}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </>
          )}

          {recordingState === "processing" && (
            <Button size="sm" disabled className="flex-1">Processing…</Button>
          )}
        </div>
      </div>

      {/* Options: Audio Cleaning & Filters (shown when recorded) */}
      {recordingState === "recorded" && (
        <div className="space-y-2">
          <button
            onClick={() => setShowOptions(s => !s)}
            className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            <span className="flex items-center gap-1.5"><Sliders className="w-3.5 h-3.5" /> Audio Options</span>
            <span className="text-xs">{showOptions ? "▲" : "▼"}</span>
          </button>

          {showOptions && (
            <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
              {/* Cleaning */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Wand2 className="w-3.5 h-3.5" />
                  <span className="font-medium">Audio Cleaning</span>
                </div>
                <div className="space-y-1">
                  {AUDIO_CLEANING_OPTIONS.map(opt => {
                    const active = activeCleaningOptions.includes(opt.key);
                    return (
                      <button
                        key={opt.key}
                        onClick={() => toggleOption(opt.key, "cleaning")}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-all border ${
                          active
                            ? "bg-green-500/20 border-green-500/50 text-green-300"
                            : "bg-secondary/20 border-panel-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
                        }`}
                      >
                        <div className="text-left">
                          <div className="font-medium">{opt.label}</div>
                          <div className="text-[10px] opacity-70">{opt.description}</div>
                        </div>
                        {active && <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Filters */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Sliders className="w-3.5 h-3.5" />
                  <span className="font-medium">Audio Filters</span>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {AUDIO_FILTER_OPTIONS.map(opt => {
                    const active = activeFilters.includes(opt.key);
                    return (
                      <button
                        key={opt.key}
                        onClick={() => toggleOption(opt.key, "filter")}
                        className={`px-2 py-1.5 rounded-md text-xs text-left transition-all border ${
                          active
                            ? "bg-purple-500/20 border-purple-500/50 text-purple-300"
                            : "bg-secondary/20 border-panel-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
                        }`}
                      >
                        <div className="font-medium">{opt.label}</div>
                        <div className="text-[10px] opacity-70">{opt.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Add to Timeline */}
          <Button
            size="sm"
            className="w-full bg-purple-600 hover:bg-purple-700 text-white gap-1.5"
            onClick={applyToTimeline}
          >
            <Check className="w-3.5 h-3.5" /> Add to Timeline
          </Button>
        </div>
      )}
    </div>
  );
}
