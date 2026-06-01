import { useState, useRef, useCallback, useEffect } from "react";
import {
  Wand2,
  Sliders,
  Check,
  Loader2,
  Play,
  Square,
  X,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/stores/editorStore";

// ─── Filter definitions (shared with VoiceRecorder) ─────────────────────────

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
  { key: "reverb",     label: "Reverb",      description: "Add room ambience" },
  { key: "echo",       label: "Echo",        description: "Subtle delay effect" },
  { key: "pitch_up",   label: "Pitch Up",    description: "Raise pitch slightly" },
  { key: "pitch_down", label: "Pitch Down",  description: "Lower pitch slightly" },
  { key: "telephone",  label: "Telephone",   description: "Lo-fi telephone effect" },
  { key: "deep",       label: "Deep Voice",  description: "Low & resonant tone" },
];

// ─── Web Audio filter engine (same as VoiceRecorder) ────────────────────────

async function applyAudioFilters(
  sourceBlob: Blob,
  cleaningKeys: string[],
  filterKeys: string[],
  existingCtx?: AudioContext,
): Promise<Blob> {
  const arrayBuffer = await sourceBlob.arrayBuffer();
  const ownedCtx    = !existingCtx;
  const decodeCtx   = existingCtx ?? new AudioContext();
  if (decodeCtx.state === "suspended") await decodeCtx.resume();

  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await Promise.race([
      decodeCtx.decodeAudioData(arrayBuffer.slice(0)),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("decodeAudioData timed out")), 10000)
      ),
    ]);
  } catch (e) {
    console.error("[AudioFilter] decode failed:", e);
    if (ownedCtx) decodeCtx.close();
    return sourceBlob;
  }

  const sr = audioBuffer.sampleRate;
  const ch = audioBuffer.numberOfChannels;
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
    trimmed.copyToChannel(audioBuffer.getChannelData(c).slice(startSample, startSample + trimmedLength), c);
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
    const ratio = hasPitchUp ? Math.pow(2, 3 / 12) : Math.pow(2, -3 / 12);
    const pitchedLength = Math.max(Math.round(sr * 0.1), Math.round(trimmedLength / ratio));
    const pitchCtx = new OfflineAudioContext(ch, pitchedLength, sr);
    const pitchSrc = pitchCtx.createBufferSource();
    pitchSrc.buffer = trimmed;
    pitchSrc.playbackRate.value = ratio;
    pitchSrc.connect(pitchCtx.destination);
    pitchSrc.start(0);
    try { workingBuffer = await pitchCtx.startRendering(); } catch {
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
    const g = offline.createGain(); g.gain.value = normalizeGain;
    lastNode.connect(g); lastNode = g;
  }

  if (cleaningKeys.includes("noise_reduction")) {
    const hp = offline.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 80; hp.Q.value = 0.5;
    lastNode.connect(hp); lastNode = hp;
    const ls = offline.createBiquadFilter(); ls.type = "lowshelf"; ls.frequency.value = 200; ls.gain.value = -4;
    lastNode.connect(ls); lastNode = ls;
  }

  if (filterKeys.includes("telephone")) {
    const hp = offline.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 300; hp.Q.value = 0.7;
    lastNode.connect(hp); lastNode = hp;
    const lp = offline.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3400; lp.Q.value = 0.7;
    lastNode.connect(lp); lastNode = lp;
    const ws = offline.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i * 2) / 256 - 1; curve[i] = ((Math.PI + 30) * x) / (Math.PI + 30 * Math.abs(x)); }
    ws.curve = curve; lastNode.connect(ws); lastNode = ws;
  }

  if (filterKeys.includes("deep")) {
    const ls = offline.createBiquadFilter(); ls.type = "lowshelf"; ls.frequency.value = 300; ls.gain.value = 8;
    lastNode.connect(ls); lastNode = ls;
    const lp = offline.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 4000; lp.Q.value = 0.5;
    lastNode.connect(lp); lastNode = lp;
  }

  if (filterKeys.includes("echo")) {
    const mix = offline.createGain(); const dg = offline.createGain(); const wg = offline.createGain();
    const dl = offline.createDelay(1.0); const fb = offline.createGain();
    dg.gain.value = 0.7; wg.gain.value = 0.35; dl.delayTime.value = 0.25; fb.gain.value = 0.35;
    lastNode.connect(dg); lastNode.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wg);
    dg.connect(mix); wg.connect(mix); lastNode = mix;
  }

  if (filterKeys.includes("reverb")) {
    const convolver = offline.createConvolver();
    const irLen = sr * 1;
    const irBuf = offline.createBuffer(1, irLen, sr);
    const d = irBuf.getChannelData(0);
    for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2);
    convolver.buffer = irBuf;
    const dg = offline.createGain(); const wg = offline.createGain(); const mix = offline.createGain();
    dg.gain.value = 0.65; wg.gain.value = 0.35;
    lastNode.connect(dg); lastNode.connect(convolver); convolver.connect(wg);
    dg.connect(mix); wg.connect(mix); lastNode = mix;
  }

  lastNode.connect(offline.destination);
  sourceNode.start(0);

  let renderedBuffer: AudioBuffer;
  try { renderedBuffer = await offline.startRendering(); } catch {
    return sourceBlob;
  }

  return await audioBufferToWavBlob(renderedBuffer);
}

function audioBufferToWavBlob(buffer: AudioBuffer): Promise<Blob> {
  return new Promise((resolve) => {
    const numChannels = buffer.numberOfChannels;
    const sampleRate  = buffer.sampleRate;
    const length      = buffer.length;
    const blockAlign  = numChannels * 2;
    const dataSize    = length * blockAlign;
    const wavBuffer   = new ArrayBuffer(44 + dataSize);
    const view        = new DataView(wavBuffer);
    const write = (offset: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    write(0, "RIFF"); view.setUint32(4, 36 + dataSize, true); write(8, "WAVE"); write(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true);
    write(36, "data"); view.setUint32(40, dataSize, true);
    let offset = 44; let index = 0; const chunkSize = 50000;
    function processChunk() {
      const end = Math.min(index + chunkSize, length);
      const channelsData = Array.from({ length: numChannels }, (_, c) => buffer.getChannelData(c));
      for (let i = index; i < end; i++) {
        for (let c = 0; c < numChannels; c++) {
          const sample = Math.max(-1, Math.min(1, channelsData[c][i]));
          view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
          offset += 2;
        }
      }
      index = end;
      if (index < length) setTimeout(processChunk, 0);
      else resolve(new Blob([wavBuffer], { type: "audio/wav" }));
    }
    processChunk();
  });
}

// ─── Trim an audio blob to a specific time segment ──────────────────────────

async function trimAudioBlob(
  sourceBlob: Blob,
  offsetSeconds: number,
  durationSeconds: number,
): Promise<Blob> {
  const arrayBuffer = await sourceBlob.arrayBuffer();
  const tmpCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await tmpCtx.decodeAudioData(arrayBuffer);
  } finally {
    tmpCtx.close();
  }

  const sr = decoded.sampleRate;
  const ch = decoded.numberOfChannels;
  const startSample = Math.round(offsetSeconds * sr);
  const clipSamples = Math.round(durationSeconds * sr);
  const availableSamples = Math.max(0, decoded.length - startSample);
  const trimmedSamples = Math.min(clipSamples, availableSamples);

  if (trimmedSamples <= 0) return sourceBlob; // guard edge-case

  const trimmed = new OfflineAudioContext(ch, trimmedSamples, sr);
  const src = trimmed.createBufferSource();
  src.buffer = decoded;
  src.connect(trimmed.destination);
  // start(when, offset, duration)
  src.start(0, offsetSeconds, durationSeconds);
  const rendered = await trimmed.startRendering();
  return audioBufferToWavBlob(rendered);
}



interface AudioFilterPanelProps {
  trackId: string;
  trackName: string;
  mediaOffset: number;
  clipDuration: number;
  onClose: () => void;
}

type PanelState = "idle" | "processing";

export function AudioFilterPanel({ trackId, trackName, mediaOffset, clipDuration, onClose }: AudioFilterPanelProps) {
  const { tracks, applyAudioFiltersToTrack } = useEditorStore();
  const track = tracks.find(t => t.id === trackId);

  const [activeTab, setActiveTab] = useState<"cleaning" | "effects">("cleaning");
  const [panelState, setPanelState] = useState<PanelState>("idle");
  const [activeCleaning, setActiveCleaning] = useState<string[]>(track?.audioCleaningKeys ?? []);
  const [activeFilters, setActiveFilters]   = useState<string[]>(track?.audioFilterKeys ?? []);
  const [isPlaying, setIsPlaying]           = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [previewBlob, setPreviewBlob]       = useState<Blob | null>(null);

  const audioCtxRef      = useRef<AudioContext | null>(null);
  const sourceNodeRef    = useRef<AudioBufferSourceNode | null>(null);
  const audioBufferRef   = useRef<AudioBuffer | null>(null);
  const startAtRef       = useRef<number>(0);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isProcessingRef  = useRef(false);

  const hasOptions = activeCleaning.length > 0 || activeFilters.length > 0;
  const isProcessing = panelState === "processing";

  // Load the source blob once — trimmed to this track's clip segment
  const sourceBlobRef = useRef<Blob | null>(null);
  useEffect(() => {
    const originalSrc = track?.audioSrc;
    if (!originalSrc) return;
    fetch(originalSrc)
      .then(r => r.blob())
      .then(async (b) => {
        // If this track has been split, trim the blob to the clip window so
        // that filters are applied only to the relevant segment.
        const offset = mediaOffset ?? 0;
        const dur    = clipDuration ?? 0;
        if (offset > 0 || (dur > 0 && dur < (track?.mediaDuration ?? Infinity))) {
          try {
            sourceBlobRef.current = await trimAudioBlob(b, offset, dur);
          } catch {
            sourceBlobRef.current = b; // fallback to full blob
          }
        } else {
          sourceBlobRef.current = b;
        }
      })
      .catch(() => {});
  }, [trackId]);

  const getCtx = useCallback(async () => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();
    return audioCtxRef.current;
  }, []);

  const stopPlayback = useCallback(() => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch {}
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
    setIsPlaying(false);
  }, []);

  useEffect(() => () => {
    stopPlayback();
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") audioCtxRef.current.close();
  }, []);

  const playPreview = useCallback(async (blob: Blob) => {
    stopPlayback();
    const ctx = await getCtx();
    try {
      const ab = await blob.arrayBuffer();
      const decoded = await ctx.decodeAudioData(ab);
      audioBufferRef.current = decoded;
      const src = ctx.createBufferSource();
      src.buffer = decoded;
      src.connect(ctx.destination);
      src.onended = () => { setIsPlaying(false); setPreviewProgress(0); if (progressTimerRef.current) clearInterval(progressTimerRef.current); };
      src.start(0);
      sourceNodeRef.current = src;
      startAtRef.current = ctx.currentTime;
      setIsPlaying(true);
      const dur = decoded.duration;
      progressTimerRef.current = setInterval(() => {
        const ctx2 = audioCtxRef.current;
        if (!ctx2) return;
        const elapsed = ctx2.currentTime - startAtRef.current;
        setPreviewProgress(Math.min(1, elapsed / dur));
        if (elapsed >= dur) clearInterval(progressTimerRef.current!);
      }, 80);
    } catch (e) { console.error("Preview play failed", e); }
  }, [getCtx, stopPlayback]);

  const runPreview = useCallback(async (cleaning: string[], filters: string[]) => {
    if (isProcessingRef.current) return;
    const src = sourceBlobRef.current;
    if (!src) return;
    isProcessingRef.current = true;
    stopPlayback();
    setPanelState("processing");
    try {
      const ctx = await getCtx();
      const processed = await applyAudioFilters(src, cleaning, filters, ctx);
      setPreviewBlob(processed);
      await playPreview(processed);
    } catch (e) { console.error("Filter preview failed", e); }
    finally { setPanelState("idle"); isProcessingRef.current = false; }
  }, [getCtx, stopPlayback, playPreview]);

  const toggleOption = (key: string, type: "cleaning" | "effects") => {
    if (isProcessing) return;
    let newCleaning = [...activeCleaning];
    let newFilters  = [...activeFilters];
    if (type === "cleaning") {
      newCleaning = activeCleaning.includes(key) ? activeCleaning.filter(k => k !== key) : [...activeCleaning, key];
      setActiveCleaning(newCleaning);
    } else {
      newFilters = activeFilters.includes(key) ? activeFilters.filter(k => k !== key) : [...activeFilters, key];
      setActiveFilters(newFilters);
    }
    runPreview(newCleaning, newFilters);
  };

  const handleApply = async () => {
    if (!hasOptions) return;
    const src = sourceBlobRef.current;
    if (!src) return;
    stopPlayback();
    setPanelState("processing");
    try {
      const blob = previewBlob ?? await applyAudioFilters(src, activeCleaning, activeFilters);
      applyAudioFiltersToTrack(trackId, activeCleaning, activeFilters, blob);
      onClose();
    } catch (e) { console.error("Apply failed", e); }
    finally { setPanelState("idle"); }
  };

  const togglePlay = async () => {
    if (isPlaying) { stopPlayback(); return; }
    const blob = previewBlob;
    if (!blob) return;
    await playPreview(blob);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[340px] bg-[#13131f] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
          <div className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-purple-400" />
            <div>
              <div className="text-sm font-semibold text-white">Audio Filters</div>
              <div className="text-[10px] text-gray-500 truncate max-w-[180px]">{trackName}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1 rounded-md hover:bg-white/8">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Preview bar */}
        <div className="px-4 py-2.5 border-b border-white/8 flex items-center gap-3">
          <button
            onClick={togglePlay}
            disabled={!previewBlob || isProcessing}
            className="w-7 h-7 rounded-full bg-purple-600/80 hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors flex-shrink-0"
          >
            {isPlaying ? <Square className="w-3 h-3 text-white fill-white" /> : <Play className="w-3 h-3 text-white fill-white" />}
          </button>
          <div className="flex-1 h-1.5 bg-white/8 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 rounded-full transition-all duration-75"
              style={{ width: `${previewProgress * 100}%` }}
            />
          </div>
          {isProcessing && (
            <div className="flex items-center gap-1 text-[10px] text-purple-400">
              <Loader2 className="w-3 h-3 animate-spin" /> Processing…
            </div>
          )}
          {!isProcessing && previewBlob && (
            <div className="flex items-center gap-1 text-[10px] text-green-400">
              <Sparkles className="w-3 h-3" /> Preview ready
            </div>
          )}
          {!isProcessing && !previewBlob && (
            <span className="text-[10px] text-gray-600">Select options</span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/8">
          {(["cleaning", "effects"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold transition-colors ${
                activeTab === tab
                  ? tab === "cleaning"
                    ? "text-green-400 border-b-2 border-green-500 bg-green-500/5"
                    : "text-purple-400 border-b-2 border-purple-500 bg-purple-500/5"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/4"
              }`}
            >
              {tab === "cleaning" ? <Wand2 className="w-3 h-3" /> : <Sliders className="w-3 h-3" />}
              {tab === "cleaning" ? "Cleaning" : "Effects"}
              {tab === "cleaning" && activeCleaning.length > 0 && (
                <span className="bg-green-500/20 text-green-400 text-[9px] font-bold px-1.5 py-0.5 rounded-full">{activeCleaning.length}</span>
              )}
              {tab === "effects" && activeFilters.length > 0 && (
                <span className="bg-purple-500/20 text-purple-400 text-[9px] font-bold px-1.5 py-0.5 rounded-full">{activeFilters.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Options */}
        <div className="p-3 max-h-[200px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
          {activeTab === "cleaning" && (
            <div className="flex flex-col gap-1.5">
              {AUDIO_CLEANING_OPTIONS.map(opt => {
                const active = activeCleaning.includes(opt.key);
                return (
                  <button key={opt.key} disabled={isProcessing} onClick={() => toggleOption(opt.key, "cleaning")}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-all border ${
                      active
                        ? "bg-green-500/10 border-green-500/30 text-green-300"
                        : "bg-white/4 border-white/8 text-gray-400 hover:text-white hover:border-white/15"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <div className="text-left">
                      <div className="font-medium text-xs leading-tight">{opt.label}</div>
                      <div className="text-[10px] opacity-60 mt-0.5">{opt.description}</div>
                    </div>
                    {active && <Check className="w-3.5 h-3.5 text-green-400 shrink-0 ml-3" />}
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
                  <button key={opt.key} disabled={isProcessing} onClick={() => toggleOption(opt.key, "effects")}
                    className={`px-2.5 py-2 rounded-xl text-sm text-left transition-all border flex flex-col gap-0.5 ${
                      active
                        ? "bg-purple-500/10 border-purple-500/30 text-purple-300"
                        : "bg-white/4 border-white/8 text-gray-400 hover:text-white hover:border-white/15"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-medium text-xs leading-tight">{opt.label}</span>
                      {active && <Check className="w-3 h-3 text-purple-400 shrink-0" />}
                    </div>
                    <div className="text-[10px] opacity-60 leading-tight">{opt.description}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-3 pb-3 pt-2 border-t border-white/8 flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}
            className="flex-1 border-white/10 text-gray-400 hover:text-white text-xs">
            Cancel
          </Button>
          <Button size="sm" onClick={handleApply} disabled={!hasOptions || isProcessing}
            className="flex-1 bg-purple-600 hover:bg-purple-700 text-white text-xs disabled:opacity-40 gap-1.5">
            {isProcessing ? <><Loader2 className="w-3 h-3 animate-spin" /> Applying…</> : <><Check className="w-3 h-3" /> Apply to Track</>}
          </Button>
        </div>
      </div>
    </div>
  );
}