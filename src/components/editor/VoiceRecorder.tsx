import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Square, Play, Trash2, Check, Wand2, Sliders, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/stores/editorStore";

type RecordingState = "idle" | "recording" | "recorded" | "processing";

interface AudioFilter {
  key: string;
  label: string;
  description: string;
}

const AUDIO_CLEANING_OPTIONS: AudioFilter[] = [
  { key: "noise_reduction", label: "Noise Reduction",  description: "Remove background hiss & hum" },
  { key: "normalize",       label: "Normalize",        description: "Balance overall volume levels" },
  { key: "silence_trim",    label: "Trim Silence",     description: "Remove silent start/end gaps" },
];

const AUDIO_FILTER_OPTIONS: AudioFilter[] = [
  { key: "reverb",      label: "Reverb",      description: "Add room ambience" },
  { key: "echo",        label: "Echo",        description: "Subtle delay effect" },
  { key: "pitch_up",    label: "Pitch Up",    description: "Raise pitch slightly" },
  { key: "pitch_down",  label: "Pitch Down",  description: "Lower pitch slightly" },
  { key: "telephone",   label: "Telephone",   description: "Lo-fi telephone effect" },
  { key: "deep",        label: "Deep Voice",  description: "Low & resonant tone" },
];

// ─── Web Audio filter engine ─────────────────────────────────────────────────

async function applyAudioFilters(
  sourceBlob: Blob,
  cleaningKeys: string[],
  filterKeys: string[],
  existingCtx?: AudioContext,   
): Promise<Blob> {
  const arrayBuffer  = await sourceBlob.arrayBuffer();
  const ownedCtx     = !existingCtx;
  const decodeCtx    = existingCtx ?? new AudioContext();
  if (decodeCtx.state === "suspended") await decodeCtx.resume();

  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await Promise.race([
      decodeCtx.decodeAudioData(arrayBuffer.slice(0)),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("decodeAudioData timed out — unsupported format")), 10000)
      ),
    ]);
  } catch (e) {
    console.error("[VoiceFilter] decode failed:", e);
    if (ownedCtx) decodeCtx.close();
    return sourceBlob;
  }

  const sr      = audioBuffer.sampleRate;
  const ch      = audioBuffer.numberOfChannels;
  const samples = audioBuffer.length;

  let startSample = 0;
  let endSample   = samples - 1;

  if (cleaningKeys.includes("silence_trim")) {
    const threshold = 0.01;
    const data = audioBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) > threshold) { startSample = Math.max(0, Math.round(i - sr * 0.05)); break; }
    }
    for (let i = data.length - 1; i >= 0; i--) {
      if (Math.abs(data[i]) > threshold) { endSample = Math.min(data.length - 1, Math.round(i + sr * 0.05)); break; }
    }
  }
  const trimmedLength = Math.max(Math.round(sr * 0.1), endSample - startSample + 1);

  const trimmed = decodeCtx.createBuffer(ch, trimmedLength, sr);
  for (let c = 0; c < ch; c++) {
    trimmed.copyToChannel(
      audioBuffer.getChannelData(c).slice(startSample, startSample + trimmedLength),
      c
    );
  }

  let normalizeGain = 1;
  if (cleaningKeys.includes("normalize")) {
    let peak = 0;
    for (let c = 0; c < ch; c++) {
      const data = trimmed.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]) > peak) peak = Math.abs(data[i]);
      }
    }
    if (peak > 0 && peak < 0.95) normalizeGain = 0.95 / peak;
  }

  const hasPitchUp   = filterKeys.includes("pitch_up");
  const hasPitchDown = filterKeys.includes("pitch_down");
  let workingBuffer: AudioBuffer = trimmed;

  if (hasPitchUp || hasPitchDown) {
    const ratio         = hasPitchUp ? Math.pow(2, 3 / 12) : Math.pow(2, -3 / 12);
    const pitchedLength = Math.max(Math.round(sr * 0.1), Math.round(trimmedLength / ratio));
    const pitchCtx      = new OfflineAudioContext(ch, pitchedLength, sr);
    const pitchSrc      = pitchCtx.createBufferSource();
    pitchSrc.buffer             = trimmed;
    pitchSrc.playbackRate.value = ratio;
    pitchSrc.connect(pitchCtx.destination);
    pitchSrc.start(0);
    try {
      workingBuffer = await pitchCtx.startRendering();
    } catch (e) {
      console.error("[VoiceFilter] pitch render failed:", e);
      if (ownedCtx) decodeCtx.close();
      return sourceBlob;
    }
  }

  if (ownedCtx) decodeCtx.close();

  const offline    = new OfflineAudioContext(ch, workingBuffer.length, sr);
  const sourceNode = offline.createBufferSource();
  sourceNode.buffer = workingBuffer;

  let lastNode: AudioNode = sourceNode;

  if (normalizeGain !== 1) {
    const g = offline.createGain();
    g.gain.value = normalizeGain;
    lastNode.connect(g);
    lastNode = g;
  }

  if (cleaningKeys.includes("noise_reduction")) {
    const hp = offline.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 80; hp.Q.value = 0.5;
    lastNode.connect(hp); lastNode = hp;

    const ls = offline.createBiquadFilter();
    ls.type = "lowshelf"; ls.frequency.value = 200; ls.gain.value = -4;
    lastNode.connect(ls); lastNode = ls;
  }

  if (filterKeys.includes("telephone")) {
    const hp = offline.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 300; hp.Q.value = 0.7;
    lastNode.connect(hp); lastNode = hp;

    const lp = offline.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 3400; lp.Q.value = 0.7;
    lastNode.connect(lp); lastNode = lp;

    const ws = offline.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 256 - 1;
      curve[i] = ((Math.PI + 30) * x) / (Math.PI + 30 * Math.abs(x));
    }
    ws.curve = curve;
    lastNode.connect(ws); lastNode = ws;
  }

  if (filterKeys.includes("deep")) {
    const ls = offline.createBiquadFilter();
    ls.type = "lowshelf"; ls.frequency.value = 300; ls.gain.value = 8;
    lastNode.connect(ls); lastNode = ls;

    const lp = offline.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 4000; lp.Q.value = 0.5;
    lastNode.connect(lp); lastNode = lp;
  }

  if (filterKeys.includes("echo")) {
    const mix = offline.createGain();
    const dg  = offline.createGain();
    const wg  = offline.createGain();
    const dl  = offline.createDelay(1.0);
    const fb  = offline.createGain();
    dg.gain.value = 0.7; wg.gain.value = 0.35;
    dl.delayTime.value = 0.25; fb.gain.value = 0.35; 

    lastNode.connect(dg);
    lastNode.connect(dl);
    dl.connect(fb); fb.connect(dl); 
    dl.connect(wg);
    dg.connect(mix); wg.connect(mix);
    lastNode = mix;
  }

  if (filterKeys.includes("reverb")) {
    const convolver = offline.createConvolver();
    const irLen     = sr * 1; 
    const irBuf     = offline.createBuffer(1, irLen, sr); 
    const d         = irBuf.getChannelData(0);
    for (let i = 0; i < irLen; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2);
    }
    convolver.buffer = irBuf;

    const dg  = offline.createGain();
    const wg  = offline.createGain();
    const mix = offline.createGain();
    dg.gain.value = 0.65; wg.gain.value = 0.35;

    lastNode.connect(dg);
    lastNode.connect(convolver);
    convolver.connect(wg);
    dg.connect(mix); wg.connect(mix);
    lastNode = mix;
  }

  lastNode.connect(offline.destination);
  sourceNode.start(0);

  let renderedBuffer: AudioBuffer;
  try {
    renderedBuffer = await offline.startRendering();
  } catch (e) {
    console.error("[VoiceFilter] render failed:", e);
    return sourceBlob;
  }

  return await audioBufferToWavBlob(renderedBuffer);
}

function audioBufferToWavBlob(buffer: AudioBuffer): Promise<Blob> {
  return new Promise((resolve) => {
    const numChannels    = buffer.numberOfChannels;
    const sampleRate     = buffer.sampleRate;
    const length         = buffer.length;
    const bytesPerSample = 2;
    const blockAlign     = numChannels * bytesPerSample;
    const byteRate       = sampleRate * blockAlign;
    const dataSize       = length * blockAlign;
    const wavBuffer      = new ArrayBuffer(44 + dataSize);
    const view           = new DataView(wavBuffer);

    const write = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    write(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    write(36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;
    let index = 0;
    const chunkSize = 50000;

    function processChunk() {
      const end = Math.min(index + chunkSize, length);
      
      const channelsData = [];
      for (let c = 0; c < numChannels; c++) {
        channelsData.push(buffer.getChannelData(c));
      }

      for (let i = index; i < end; i++) {
        for (let c = 0; c < numChannels; c++) {
          const sample = Math.max(-1, Math.min(1, channelsData[c][i]));
          view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
          offset += 2;
        }
      }

      index = end;
      if (index < length) {
        setTimeout(processChunk, 0);
      } else {
        resolve(new Blob([wavBuffer], { type: "audio/wav" }));
      }
    }

    processChunk();
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function VoiceRecorder() {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingTime, setRecordingTime]   = useState(0);
  const [activeTab, setActiveTab] = useState<"cleaning" | "effects">("cleaning");

  const [rawBlob, setRawBlob]               = useState<Blob | null>(null);
  const [previewBlob, setPreviewBlob]       = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl]         = useState<string | null>(null);

  const [activeCleaningOptions, setActiveCleaningOptions] = useState<string[]>([]);
  const [activeFilters, setActiveFilters]   = useState<string[]>([]);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [waveformData, setWaveformData]     = useState<number[]>([]);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [needsApply, setNeedsApply]         = useState(false);

  const mediaRecorderRef  = useRef<MediaRecorder | null>(null);
  const chunksRef         = useRef<Blob[]>([]);
  const timerRef          = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const previewCtxRef     = useRef<AudioContext | null>(null);
  const previewSourceRef  = useRef<AudioBufferSourceNode | null>(null);
  const previewBufferRef  = useRef<AudioBuffer | null>(null);
  const previewStartAtRef = useRef<number>(0);
  const previewOffsetRef  = useRef<number>(0);
  const analyserRef       = useRef<AnalyserNode | null>(null);
  const animFrameRef      = useRef<number | null>(null);
  const keepPreviewUrlAliveRef = useRef(false);
  const isFilteredUrlRef = useRef(false);

  const { addAudioTrack } = useEditorStore();

  const getPreviewCtx = useCallback(async (): Promise<AudioContext> => {
    if (!previewCtxRef.current || previewCtxRef.current.state === "closed") {
      previewCtxRef.current = new AudioContext();
    }
    if (previewCtxRef.current.state === "suspended") {
      await previewCtxRef.current.resume();
    }
    return previewCtxRef.current;
  }, []);

  useEffect(() => {
    previewBufferRef.current = null;
    previewOffsetRef.current = 0;
    if (!previewBlob) return;

    (async () => {
      try {
        const ctx     = await getPreviewCtx();
        const ab      = await previewBlob.arrayBuffer();
        const decoded = await ctx.decodeAudioData(ab);
        previewBufferRef.current = decoded;
      } catch (e) {
        console.warn("Preview decode failed", e);
      }
    })();
  }, [previewBlob, getPreviewCtx]);

  useEffect(() => {
    return () => {
      if (previewUrl && !keepPreviewUrlAliveRef.current) {
        URL.revokeObjectURL(previewUrl);
      }
      keepPreviewUrlAliveRef.current = false;
    };
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (previewSourceRef.current) {
        try { previewSourceRef.current.stop(); } catch {}
        previewSourceRef.current.disconnect();
      }
      if (previewCtxRef.current && previewCtxRef.current.state !== "closed") {
        previewCtxRef.current.close();
      }
    };
  }, []);

  const stopPreviewPlayback = useCallback(() => {
    if (previewSourceRef.current) {
      try { previewSourceRef.current.stop(); } catch {}
      previewSourceRef.current.disconnect();
      previewSourceRef.current = null;
    }
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    setIsPreviewPlaying(false);
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const vizCtx   = new AudioContext();
      const source   = vizCtx.createMediaStreamSource(stream);
      const analyser = vizCtx.createAnalyser();
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

      const PREFERRED = [
        "audio/ogg;codecs=opus",
        "audio/webm;codecs=pcm",
        "audio/webm",
      ];
      const mimeType = PREFERRED.find(t => MediaRecorder.isTypeSupported(t)) ?? "";

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        vizCtx.close();
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType || "audio/webm" });
        const url  = URL.createObjectURL(blob);

        setRawBlob(blob);
        setPreviewBlob(blob);
        setPreviewUrl(url);
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
    stopPreviewPlayback();
    setRawBlob(null);
    setPreviewBlob(null);
    setPreviewUrl(null);
    setRecordingState("idle");
    setRecordingTime(0);
    setPreviewProgress(0);
    setActiveCleaningOptions([]);
    setActiveFilters([]);
    setNeedsApply(false);
  };

  const startPlaybackWithBuffer = useCallback(async (buffer: AudioBuffer) => {
    const ctx = await getPreviewCtx();
    stopPreviewPlayback();

    const srcNode = ctx.createBufferSource();
    srcNode.buffer = buffer;
    srcNode.connect(ctx.destination);
    
    srcNode.onended = () => {
      setIsPreviewPlaying(false);
      setPreviewProgress(0);
      previewOffsetRef.current = 0;
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };

    srcNode.start(0, 0);
    previewSourceRef.current = srcNode;
    previewStartAtRef.current = ctx.currentTime;
    previewOffsetRef.current = 0;
    setIsPreviewPlaying(true);

    const duration = buffer.duration;
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = setInterval(() => {
      const ctx2 = previewCtxRef.current;
      if (!ctx2) return;
      const elapsed = ctx2.currentTime - previewStartAtRef.current;
      setPreviewProgress(Math.min(1, elapsed / duration));
      if (elapsed >= duration) clearInterval(progressTimerRef.current!);
    }, 80);
  }, [getPreviewCtx, stopPreviewPlayback]);

  const togglePreview = async () => {
    if (!previewBlob) return;

    if (isPreviewPlaying) {
      const ctx = previewCtxRef.current;
      if (ctx) {
        previewOffsetRef.current = Math.min(
          (ctx.currentTime - previewStartAtRef.current) + previewOffsetRef.current,
          previewBufferRef.current?.duration ?? 0
        );
      }
      stopPreviewPlayback();
      return;
    }

    const ctx = await getPreviewCtx();

    if (!previewBufferRef.current) {
      try {
        const ab = await previewBlob.arrayBuffer();
        previewBufferRef.current = await ctx.decodeAudioData(ab);
      } catch (e) {
        console.warn("Preview decode failed", e);
        return;
      }
    }

    const buffer = previewBufferRef.current;
    const offset = Math.min(previewOffsetRef.current, buffer.duration - 0.01);
    const srcNode = ctx.createBufferSource();
    srcNode.buffer = buffer;
    srcNode.connect(ctx.destination);
    srcNode.onended = () => {
      setIsPreviewPlaying(false);
      setPreviewProgress(0);
      previewOffsetRef.current = 0;
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
    srcNode.start(0, Math.max(0, offset));
    previewSourceRef.current  = srcNode;
    previewStartAtRef.current = ctx.currentTime;
    setIsPreviewPlaying(true);

    const duration = buffer.duration;
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = setInterval(() => {
      const ctx2 = previewCtxRef.current;
      if (!ctx2) return;
      const elapsed = (ctx2.currentTime - previewStartAtRef.current) + previewOffsetRef.current;
      setPreviewProgress(Math.min(1, elapsed / duration));
      if (elapsed >= duration) clearInterval(progressTimerRef.current!);
    }, 80);
  };

  const runFilterAudition = useCallback(async (cleaning: string[], filters: string[]) => {
    if (!rawBlob) return;
    stopPreviewPlayback();
    setRecordingState("processing");
    setPreviewProgress(0);
    previewBufferRef.current = null;
    previewOffsetRef.current = 0;

    try {
      const ctx = await getPreviewCtx();  
      const processed = await applyAudioFilters(rawBlob, cleaning, filters, ctx);
      const newUrl = URL.createObjectURL(processed);

      setPreviewUrl(prev => {
        if (prev && isFilteredUrlRef.current) URL.revokeObjectURL(prev);
        return newUrl;
      });
      isFilteredUrlRef.current = true;
      setPreviewBlob(processed);

      const ab = await processed.arrayBuffer();
      const decodedBuffer = await ctx.decodeAudioData(ab);
      previewBufferRef.current = decodedBuffer;
      
      startPlaybackWithBuffer(decodedBuffer);
    } catch (e) {
      console.error("[VoiceFilter] audition failed:", e);
    } finally {
      setRecordingState("recorded");
    }
  }, [rawBlob, getPreviewCtx, stopPreviewPlayback, startPlaybackWithBuffer]);

  const toggleOption = (key: string, type: "cleaning" | "filter") => {
    if (recordingState === "processing") return;
    
    let updatedCleaning = [...activeCleaningOptions];
    let updatedFilters = [...activeFilters];

    if (type === "cleaning") {
      updatedCleaning = activeCleaningOptions.includes(key)
        ? activeCleaningOptions.filter(k => k !== key)
        : [...activeCleaningOptions, key];
      setActiveCleaningOptions(updatedCleaning);
    } else {
      updatedFilters = activeFilters.includes(key)
        ? activeFilters.filter(k => k !== key)
        : [...activeFilters, key];
      setActiveFilters(updatedFilters);
    }

    setNeedsApply(true);
    runFilterAudition(updatedCleaning, updatedFilters);
  };

  const commitFilters = () => {
    setNeedsApply(false);
    stopPreviewPlayback();
  };

  const applyToTimeline = () => {
    if (!previewBlob || !previewUrl) return;

    const timestamp   = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const activeLabelArr = [...activeCleaningOptions, ...activeFilters];
    const filterLabel = activeLabelArr.length > 0 ? ` [${activeLabelArr.join(", ")}]` : "";
    const trackName   = `Voice Recording ${timestamp}${filterLabel}`;

    addAudioTrack(trackName, previewUrl);
    keepPreviewUrlAliveRef.current = true;
    stopPreviewPlayback();

    setRawBlob(null);
    setPreviewBlob(null);
    setPreviewUrl(null);
    setRecordingState("idle");
    setRecordingTime(0);
    setPreviewProgress(0);
    setActiveCleaningOptions([]);
    setActiveFilters([]);
    setNeedsApply(false);
    isFilteredUrlRef.current = false;
  };

  // Helper flags combined to guarantee cross-state TS validation safety
  const isRecordedOrProcessing = recordingState === "recorded" || recordingState === "processing";
  const isCurrentlyProcessing = recordingState === "processing";
  const hasActiveOptions = activeCleaningOptions.length > 0 || activeFilters.length > 0;

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="w-full bg-background border border-panel-border rounded-xl p-3 flex flex-col gap-3 text-foreground">

      {/* ── TOP: Waveform + controls ── */}
      <div className="flex items-center gap-3">
        {/* Waveform + timer stacked */}
        <div className="flex-1 bg-secondary/30 border border-panel-border rounded-lg px-3 py-2 flex flex-col gap-1.5">
          {/* Waveform */}
          <div className="h-8 flex items-center gap-0.5 rounded bg-black/20 overflow-hidden px-1.5">
            {recordingState === "recording" && waveformData.length > 0 ? (
              waveformData.slice(0, 28).map((v, i) => (
                <div key={i} className="flex-1 rounded-full bg-red-400 transition-all duration-75"
                  style={{ height: `${Math.max(8, v * 100)}%`, minWidth: 2 }} />
              ))
            ) : isRecordedOrProcessing ? (
              Array.from({ length: 28 }).map((_, i) => (
                <div key={i} className="flex-1 rounded-full transition-all duration-75"
                  style={{
                    height: `${20 + ((i * 37 + 13) % 65)}%`,
                    minWidth: 2,
                    background: isPreviewPlaying
                      ? `hsl(${270 + i * 3}, 80%, ${50 + ((i * 7) % 20)}%)`
                      : "rgb(167,139,250)",
                  }} />
              ))
            ) : (
              Array.from({ length: 28 }).map((_, i) => (
                <div key={i} className="flex-1 rounded-full bg-white/10" style={{ height: "20%", minWidth: 2 }} />
              ))
            )}
          </div>

          {/* Progress bar */}
          {isRecordedOrProcessing && (
            <div className="w-full h-0.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-purple-400 transition-all duration-75"
                style={{ width: `${previewProgress * 100}%` }} />
            </div>
          )}

          {/* Timer */}
          <div className="flex items-center justify-center gap-1.5">
            <span className={`text-sm font-mono font-bold tabular-nums ${recordingState === "recording" ? "text-red-400" : "text-foreground"}`}>
              {formatTime(recordingTime)}
            </span>
            {recordingState === "recording" && (
              <span className="text-[10px] text-red-400 animate-pulse font-medium">● REC</span>
            )}
          </div>
        </div>

        {/* Action buttons column */}
        <div className="flex flex-col gap-1.5 shrink-0">
          {recordingState === "idle" && (
            <Button size="sm" className="bg-red-500 hover:bg-red-600 text-white gap-1 text-xs px-3" onClick={startRecording}>
              <Mic className="w-3.5 h-3.5" /> Record
            </Button>
          )}
          {recordingState === "recording" && (
            <Button size="sm" className="bg-red-500 hover:bg-red-600 text-white gap-1 text-xs px-3" onClick={stopRecording}>
              <Square className="w-3.5 h-3.5 fill-current" /> Stop
            </Button>
          )}
          {isRecordedOrProcessing && (
            <>
              <Button size="sm" variant="outline" className="gap-1 border-panel-border text-xs px-3"
                onClick={togglePreview} disabled={isCurrentlyProcessing}>
                {isPreviewPlaying ? <MicOff className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {isPreviewPlaying ? "Pause" : "Play"}
              </Button>
              <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 gap-1 text-xs px-3"
                onClick={discardRecording}>
                <Trash2 className="w-3.5 h-3.5" /> Discard
              </Button>
            </>
          )}
          {recordingState === "recorded" && (
            <Button size="sm" onClick={applyToTimeline}
              className="bg-purple-600 hover:bg-purple-700 text-white gap-1 text-xs px-3">
              <Check className="w-3.5 h-3.5" /> Add
            </Button>
          )}
        </div>
      </div>

      {/* ── BOTTOM: Tabbed workspace ── */}
      <div className={`flex flex-col border border-panel-border rounded-lg overflow-hidden transition-opacity duration-200 ${
        recordingState === "idle" || recordingState === "recording" ? "opacity-40 pointer-events-none" : ""
      }`}>
        {/* Tab bar */}
        <div className="flex border-b border-panel-border">
          <button
            onClick={() => setActiveTab("cleaning")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold transition-colors ${
              activeTab === "cleaning"
                ? "bg-secondary/40 text-foreground border-b-2 border-green-500"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/20"
            }`}
          >
            <Wand2 className="w-3 h-3" /> Cleaning
            {activeCleaningOptions.length > 0 && (
              <span className="bg-green-500/20 text-green-400 text-[9px] font-bold px-1 rounded-full">
                {activeCleaningOptions.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("effects")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold transition-colors border-l border-panel-border ${
              activeTab === "effects"
                ? "bg-secondary/40 text-foreground border-b-2 border-purple-500"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/20"
            }`}
          >
            <Sliders className="w-3 h-3" /> Effects
            {activeFilters.length > 0 && (
              <span className="bg-purple-500/20 text-purple-400 text-[9px] font-bold px-1 rounded-full">
                {activeFilters.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab content */}
        <div className="p-2 max-h-[160px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
          {activeTab === "cleaning" && (
            <div className="flex flex-col gap-1">
              {AUDIO_CLEANING_OPTIONS.map(opt => {
                const active = activeCleaningOptions.includes(opt.key);
                return (
                  <button key={opt.key} disabled={isCurrentlyProcessing}
                    onClick={() => toggleOption(opt.key, "cleaning")}
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-all border ${
                      active
                        ? "bg-green-500/10 border-green-500/40 text-green-400"
                        : "bg-secondary/20 border-panel-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
                    }`}
                  >
                    <div className="text-left">
                      <div className="font-semibold text-xs leading-tight">{opt.label}</div>
                      <div className="text-[10px] opacity-70 mt-0.5 leading-tight">{opt.description}</div>
                    </div>
                    {active && <Check className="w-3.5 h-3.5 text-green-400 shrink-0 ml-2" />}
                  </button>
                );
              })}
            </div>
          )}
          {activeTab === "effects" && (
            <div className="grid grid-cols-2 gap-1.5">
              {AUDIO_FILTER_OPTIONS.map(opt => {
                const active = activeFilters.includes(opt.key);
                return (
                  <button key={opt.key} disabled={isCurrentlyProcessing}
                    onClick={() => toggleOption(opt.key, "filter")}
                    className={`px-2.5 py-2 rounded-lg text-xs text-left transition-all border flex flex-col gap-0.5 ${
                      active
                        ? "bg-purple-500/10 border-purple-500/40 text-purple-300"
                        : "bg-secondary/20 border-panel-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-semibold text-xs leading-tight">{opt.label}</span>
                      {active && <Check className="w-3 h-3 text-purple-400 shrink-0" />}
                    </div>
                    <div className="text-[10px] opacity-70 leading-tight">{opt.description}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Status bar */}
        {isRecordedOrProcessing && (
          <div className="border-t border-panel-border px-2.5 py-1.5">
            <button onClick={commitFilters} disabled={!hasActiveOptions || isCurrentlyProcessing}
              className={`w-full flex items-center justify-center gap-1.5 py-1 rounded text-[11px] font-semibold transition-all ${
                isCurrentlyProcessing
                  ? "text-muted-foreground opacity-60 cursor-not-allowed"
                  : needsApply
                  ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 cursor-pointer rounded-md"
                  : hasActiveOptions
                  ? "text-green-400 cursor-default"
                  : "text-muted-foreground opacity-40 cursor-not-allowed"
              }`}
            >
              {isCurrentlyProcessing ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> Processing…</>
              ) : needsApply ? (
                <>Apply Changes</>
              ) : hasActiveOptions ? (
                <><Check className="w-3 h-3" /> Applied</>
              ) : (
                <><Sparkles className="w-3 h-3" /> Select options to preview</>
              )}
            </button>
          </div>
        )}
      </div>

    </div>
  );
}