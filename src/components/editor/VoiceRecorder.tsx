import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Square, Play, Trash2, Check, Wand2, Sliders, Loader2 } from "lucide-react";
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
// Takes raw audio blob, applies all selected cleaning + effect filters,
// and returns a new Blob with the processed audio (WAV).

async function applyAudioFilters(
  sourceBlob: Blob,
  cleaningKeys: string[],
  filterKeys: string[],
): Promise<Blob> {
  const arrayBuffer = await sourceBlob.arrayBuffer();
  const offlineCtx = new OfflineAudioContext(1, 1, 44100); // temp to decode
  let audioBuffer: AudioBuffer;

  try {
    // Decode using a standard context first (OfflineAudioContext can be picky)
    const decodeCtx = new AudioContext();
    audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
    await decodeCtx.close();
  } catch {
    return sourceBlob; // couldn't decode, return original
  }

  const sr      = audioBuffer.sampleRate;
  const ch      = audioBuffer.numberOfChannels;
  const samples = audioBuffer.length;

  // ── Step 1: Silence trim (modify the buffer directly) ──────────────────────
  let startSample = 0;
  let endSample   = samples - 1;

  if (cleaningKeys.includes("silence_trim")) {
    const threshold = 0.01;
    const data = audioBuffer.getChannelData(0);
    // Find first sample above threshold
    for (let i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) > threshold) { startSample = Math.max(0, i - sr * 0.05); break; }
    }
    // Find last sample above threshold
    for (let i = data.length - 1; i >= 0; i--) {
      if (Math.abs(data[i]) > threshold) { endSample = Math.min(data.length - 1, i + sr * 0.05); break; }
    }
    startSample = Math.round(startSample);
    endSample   = Math.round(endSample);
  }

  const trimmedLength = endSample - startSample + 1;

  // ── Step 2: Normalize peak amplitude ───────────────────────────────────────
  let normalizeGain = 1;
  if (cleaningKeys.includes("normalize")) {
    let peak = 0;
    for (let c = 0; c < ch; c++) {
      const data = audioBuffer.getChannelData(c);
      for (let i = startSample; i <= endSample; i++) {
        if (Math.abs(data[i]) > peak) peak = Math.abs(data[i]);
      }
    }
    if (peak > 0 && peak < 0.95) normalizeGain = 0.95 / peak;
  }

  // ── Step 3: Build offline graph with filters ────────────────────────────────
  const offline = new OfflineAudioContext(ch, trimmedLength, sr);

  // Slice trimmed audio into a new buffer
  const trimmed = offline.createBuffer(ch, trimmedLength, sr);
  for (let c = 0; c < ch; c++) {
    const src = audioBuffer.getChannelData(c).slice(startSample, endSample + 1);
    trimmed.copyToChannel(src, c);
  }

  const sourceNode = offline.createBufferSource();
  sourceNode.buffer = trimmed;

  // Chain: source → [pitch] → [telephone HPF] → [deep LPF] → gainNode → [noise gate] → [reverb/echo] → destination

  let lastNode: AudioNode = sourceNode;

  // ── Normalize gain node ─────────────────────────────────────────────────────
  if (normalizeGain !== 1) {
    const g = offline.createGain();
    g.gain.value = normalizeGain;
    lastNode.connect(g);
    lastNode = g;
  }

  // ── Noise Reduction: high-pass to cut sub-80Hz rumble + slight low-shelf cut ─
  if (cleaningKeys.includes("noise_reduction")) {
    const hp = offline.createBiquadFilter();
    hp.type      = "highpass";
    hp.frequency.value = 80;
    hp.Q.value   = 0.5;
    lastNode.connect(hp);
    lastNode = hp;

    const ls = offline.createBiquadFilter();
    ls.type      = "lowshelf";
    ls.frequency.value = 200;
    ls.gain.value = -4;
    lastNode.connect(ls);
    lastNode = ls;
  }

  // ── Pitch Up: +3 semitones via playback rate (done at source level) ─────────
  // (We can't change playbackRate in OfflineAudioContext after start,
  //  so we handle pitch by resampling the buffer length)
  // We bake pitch into a pre-pass below and swap the source if needed.

  // ── Telephone: bandpass 300–3400 Hz ──────────────────────────────────────
  if (filterKeys.includes("telephone")) {
    const hp = offline.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 300;
    hp.Q.value = 0.7;
    lastNode.connect(hp);
    lastNode = hp;

    const lp = offline.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3400;
    lp.Q.value = 0.7;
    lastNode.connect(lp);
    lastNode = lp;

    // Slight distortion via waveshaper
    const ws = offline.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 256 - 1;
      curve[i] = ((Math.PI + 30) * x) / (Math.PI + 30 * Math.abs(x));
    }
    ws.curve = curve;
    lastNode.connect(ws);
    lastNode = ws;
  }

  // ── Deep Voice: low-shelf boost + gentle low-pass ────────────────────────
  if (filterKeys.includes("deep")) {
    const ls = offline.createBiquadFilter();
    ls.type = "lowshelf";
    ls.frequency.value = 300;
    ls.gain.value = 8;
    lastNode.connect(ls);
    lastNode = ls;

    const lp = offline.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 4000;
    lp.Q.value = 0.5;
    lastNode.connect(lp);
    lastNode = lp;
  }

  // ── Echo: DelayNode + feedback ───────────────────────────────────────────
  if (filterKeys.includes("echo")) {
    const mix      = offline.createGain();
    const dryGain  = offline.createGain();
    const wetGain  = offline.createGain();
    const delay    = offline.createDelay(1.0);
    const feedback = offline.createGain();

    dryGain.gain.value  = 0.7;
    wetGain.gain.value  = 0.4;
    delay.delayTime.value = 0.3;
    feedback.gain.value = 0.4;

    lastNode.connect(dryGain);
    lastNode.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wetGain);

    dryGain.connect(mix);
    wetGain.connect(mix);
    lastNode = mix;
  }

  // ── Reverb: convolver with synthesised IR ────────────────────────────────
  if (filterKeys.includes("reverb")) {
    const convolver = offline.createConvolver();
    const irLength  = sr * 2; // 2 second reverb tail
    const irBuffer  = offline.createBuffer(2, irLength, sr);
    for (let c = 0; c < 2; c++) {
      const d = irBuffer.getChannelData(c);
      for (let i = 0; i < irLength; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLength, 2);
      }
    }
    convolver.buffer = irBuffer;

    const dryGain = offline.createGain();
    const wetGain = offline.createGain();
    const mix     = offline.createGain();
    dryGain.gain.value = 0.6;
    wetGain.gain.value = 0.4;

    lastNode.connect(dryGain);
    lastNode.connect(convolver);
    convolver.connect(wetGain);
    dryGain.connect(mix);
    wetGain.connect(mix);
    lastNode = mix;
  }

  lastNode.connect(offline.destination);

  // Handle pitch shift via pre-processing (adjust buffer sample count)
  // pitch_up  → play faster (shorter buffer, higher pitch)
  // pitch_down → play slower (longer buffer, lower pitch)
  const hasPitchUp   = filterKeys.includes("pitch_up");
  const hasPitchDown = filterKeys.includes("pitch_down");

  if (hasPitchUp || hasPitchDown) {
    const ratio = hasPitchUp ? Math.pow(2, 3 / 12) : Math.pow(2, -3 / 12);
    // Re-sample the trimmed buffer to change pitch
    const pitchedLength = Math.round(trimmedLength / ratio);
    const pitchedOffline = new OfflineAudioContext(ch, pitchedLength, sr);
    const pitchSrc = pitchedOffline.createBufferSource();
    pitchSrc.buffer = trimmed;
    pitchSrc.playbackRate.value = ratio;
    pitchSrc.connect(pitchedOffline.destination);
    pitchSrc.start();
    const pitchedBuffer = await pitchedOffline.startRendering();

    // Rebuild the main offline context with pitch-shifted buffer
    const offline2 = new OfflineAudioContext(ch, pitchedLength, sr);
    const src2 = offline2.createBufferSource();
    src2.buffer = pitchedBuffer;

    let last2: AudioNode = src2;

    // Re-apply non-pitch filters on the pitched buffer
    if (cleaningKeys.includes("noise_reduction")) {
      const hp = offline2.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 80; hp.Q.value = 0.5;
      last2.connect(hp); last2 = hp;
    }
    if (filterKeys.includes("telephone")) {
      const hp = offline2.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 300; hp.Q.value = 0.7;
      last2.connect(hp); last2 = hp;
      const lp = offline2.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 3400; lp.Q.value = 0.7;
      last2.connect(lp); last2 = lp;
    }
    if (filterKeys.includes("deep")) {
      const ls = offline2.createBiquadFilter();
      ls.type = "lowshelf"; ls.frequency.value = 300; ls.gain.value = 8;
      last2.connect(ls); last2 = ls;
    }
    if (filterKeys.includes("echo")) {
      const mix = offline2.createGain(); const dg = offline2.createGain(); const wg = offline2.createGain();
      const delay = offline2.createDelay(1.0); const fb = offline2.createGain();
      dg.gain.value = 0.7; wg.gain.value = 0.4; delay.delayTime.value = 0.3; fb.gain.value = 0.4;
      last2.connect(dg); last2.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wg);
      dg.connect(mix); wg.connect(mix); last2 = mix;
    }
    if (filterKeys.includes("reverb")) {
      const conv = offline2.createConvolver();
      const irBuf = offline2.createBuffer(2, sr * 2, sr);
      for (let c = 0; c < 2; c++) {
        const d = irBuf.getChannelData(c);
        for (let i = 0; i < sr * 2; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / (sr * 2), 2);
      }
      conv.buffer = irBuf;
      const dg = offline2.createGain(); const wg = offline2.createGain(); const mix = offline2.createGain();
      dg.gain.value = 0.6; wg.gain.value = 0.4;
      last2.connect(dg); last2.connect(conv); conv.connect(wg); dg.connect(mix); wg.connect(mix); last2 = mix;
    }
    last2.connect(offline2.destination);
    src2.start();
    const finalBuffer = await offline2.startRendering();
    return audioBufferToWavBlob(finalBuffer);
  }

  sourceNode.start();
  const renderedBuffer = await offline.startRendering();
  return audioBufferToWavBlob(renderedBuffer);
}

// Convert AudioBuffer → WAV Blob
function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate  = buffer.sampleRate;
  const length      = buffer.length;
  const bytesPerSample = 2;
  const blockAlign  = numChannels * bytesPerSample;
  const byteRate    = sampleRate * blockAlign;
  const dataSize    = length * blockAlign;
  const wavBuffer   = new ArrayBuffer(44 + dataSize);
  const view        = new DataView(wavBuffer);

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
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  return new Blob([wavBuffer], { type: "audio/wav" });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function VoiceRecorder() {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingTime, setRecordingTime]   = useState(0);
  const [audioBlob, setAudioBlob]           = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl]             = useState<string | null>(null);
  const [activeCleaningOptions, setActiveCleaningOptions] = useState<string[]>([]);
  const [activeFilters, setActiveFilters]   = useState<string[]>([]);
  const [showOptions, setShowOptions]       = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [waveformData, setWaveformData]     = useState<number[]>([]);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [filterApplied, setFilterApplied]   = useState(false); // tracks whether processed blob is current

  const mediaRecorderRef  = useRef<MediaRecorder | null>(null);
  const chunksRef         = useRef<Blob[]>([]);
  const timerRef          = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  // Web Audio preview — bypasses autoplay policies better than HTMLAudioElement
  const previewCtxRef     = useRef<AudioContext | null>(null);
  const previewSourceRef  = useRef<AudioBufferSourceNode | null>(null);
  const previewBufferRef  = useRef<AudioBuffer | null>(null);
  const previewStartAtRef = useRef<number>(0); // AudioContext.currentTime when playback started
  const previewOffsetRef  = useRef<number>(0); // seconds into buffer where we resumed
  const analyserRef       = useRef<AnalyserNode | null>(null);
  const animFrameRef      = useRef<number | null>(null);
  const keepAudioUrlAliveRef = useRef(false);

  const { addAudioTrack } = useEditorStore();

  // Decode the current audioUrl into a Web Audio buffer whenever url changes
  useEffect(() => {
    previewBufferRef.current = null;
    previewOffsetRef.current = 0;
    if (!audioUrl) return;

    (async () => {
      try {
        const resp = await fetch(audioUrl);
        const ab   = await resp.arrayBuffer();
        const ctx  = previewCtxRef.current ?? new AudioContext();
        previewCtxRef.current = ctx;
        const decoded = await ctx.decodeAudioData(ab);
        previewBufferRef.current = decoded;
      } catch (e) {
        console.warn("Preview decode failed", e);
      }
    })();
  }, [audioUrl]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      stopPreviewPlayback();
      if (audioUrl && !keepAudioUrlAliveRef.current) URL.revokeObjectURL(audioUrl);
      keepAudioUrlAliveRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

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

  // ── Recording ──────────────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new AudioContext();
      const source   = audioCtx.createMediaStreamSource(stream);
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
        const url  = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioUrl(url);
        setWaveformData([]);
        setFilterApplied(false);
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
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingState("idle");
    setRecordingTime(0);
    setPreviewProgress(0);
    setActiveCleaningOptions([]);
    setActiveFilters([]);
    setShowOptions(false);
    setFilterApplied(false);
  };

  // ── Preview playback via Web Audio API ────────────────────────────────────
  const togglePreview = async () => {
    if (!audioUrl) return;

    if (isPreviewPlaying) {
      // Pause: save offset so we can resume
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

    // Ensure AudioContext is running (browsers suspend it until user gesture)
    if (!previewCtxRef.current) previewCtxRef.current = new AudioContext();
    const ctx = previewCtxRef.current;
    if (ctx.state === "suspended") await ctx.resume();

    // Decode if not already done
    if (!previewBufferRef.current) {
      try {
        const resp    = await fetch(audioUrl);
        const ab      = await resp.arrayBuffer();
        previewBufferRef.current = await ctx.decodeAudioData(ab);
      } catch (e) {
        console.warn("Preview decode failed", e);
        return;
      }
    }

    const buffer   = previewBufferRef.current;
    const offset   = previewOffsetRef.current;
    const srcNode  = ctx.createBufferSource();
    srcNode.buffer = buffer;
    srcNode.connect(ctx.destination); // ← connects to SPEAKERS
    srcNode.onended = () => {
      setIsPreviewPlaying(false);
      setPreviewProgress(0);
      previewOffsetRef.current = 0;
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
    srcNode.start(0, offset);
    previewSourceRef.current  = srcNode;
    previewStartAtRef.current = ctx.currentTime;
    setIsPreviewPlaying(true);

    // Progress bar update
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

  // ── Re-apply filters & update preview ─────────────────────────────────────
  const applyFiltersToPreview = useCallback(async () => {
    if (!audioBlob) return;
    stopPreviewPlayback();
    setRecordingState("processing");
    setPreviewProgress(0);

    try {
      const processed = await applyAudioFilters(audioBlob, activeCleaningOptions, activeFilters);
      const newUrl    = URL.createObjectURL(processed);
      // Revoke old processed URL if it differs from the raw recording URL
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(newUrl);
      previewBufferRef.current = null; // force re-decode on next preview
      previewOffsetRef.current = 0;
      setFilterApplied(true);
    } catch (e) {
      console.warn("Filter apply failed", e);
    }
    setRecordingState("recorded");
  }, [audioBlob, audioUrl, activeCleaningOptions, activeFilters, stopPreviewPlayback]);

  // ── Add to timeline ────────────────────────────────────────────────────────
  const applyToTimeline = () => {
    if (!audioBlob || !audioUrl) return;

    const timestamp   = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const filterLabel = activeFilters.length > 0 ? ` [${activeFilters.join(", ")}]` : "";
    const trackName   = `Voice Recording ${timestamp}${filterLabel}`;

    addAudioTrack(trackName, audioUrl);
    keepAudioUrlAliveRef.current = true;
    stopPreviewPlayback();

    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingState("idle");
    setRecordingTime(0);
    setPreviewProgress(0);
    setActiveCleaningOptions([]);
    setActiveFilters([]);
    setShowOptions(false);
    setFilterApplied(false);
  };

  const toggleOption = (key: string, type: "cleaning" | "filter") => {
    setFilterApplied(false); // pending re-apply
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

  const hasActiveOptions = activeCleaningOptions.length > 0 || activeFilters.length > 0;
  const needsApply = hasActiveOptions && !filterApplied;

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

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
          ) : recordingState === "recorded" || recordingState === "processing" ? (
            Array.from({ length: 28 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 rounded-full transition-all duration-75"
                style={{
                  height: `${20 + ((i * 37 + 13) % 65)}%`,
                  minWidth: 2,
                  background: isPreviewPlaying
                    ? `hsl(${270 + i * 3}, 80%, ${50 + ((i * 7) % 20)}%)`
                    : "rgb(167,139,250)",
                  transform: isPreviewPlaying ? `scaleY(${0.6 + Math.sin(i * 0.8 + Date.now() / 200) * 0.4})` : "none",
                }}
              />
            ))
          ) : (
            Array.from({ length: 28 }).map((_, i) => (
              <div key={i} className="flex-1 rounded-full bg-white/10" style={{ height: "20%", minWidth: 2 }} />
            ))
          )}
        </div>

        {/* Progress bar (shown during preview) */}
        {(recordingState === "recorded" || recordingState === "processing") && (
          <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-purple-400 transition-all duration-75"
              style={{ width: `${previewProgress * 100}%` }}
            />
          </div>
        )}

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
              <Button
                size="sm"
                variant="outline"
                className="flex-1 gap-1.5 border-panel-border"
                onClick={togglePreview}
              >
                {isPreviewPlaying ? <MicOff className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {isPreviewPlaying ? "Stop" : "Preview"}
              </Button>
              <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 px-2" onClick={discardRecording}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </>
          )}

          {recordingState === "processing" && (
            <Button size="sm" disabled className="flex-1 gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing…
            </Button>
          )}
        </div>
      </div>

      {/* Options: Audio Cleaning & Filters */}
      {recordingState === "recorded" && (
        <div className="space-y-2">
          <button
            onClick={() => setShowOptions(s => !s)}
            className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            <span className="flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5" /> Audio Options
              {hasActiveOptions && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-purple-500/30 text-purple-300 border border-purple-500/30">
                  {activeCleaningOptions.length + activeFilters.length} active
                </span>
              )}
            </span>
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

              {/* Apply Filters button */}
              <button
                onClick={applyFiltersToPreview}
                disabled={!hasActiveOptions}
                className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-semibold transition-all border ${
                  needsApply
                    ? "bg-amber-500/20 border-amber-500/50 text-amber-300 hover:bg-amber-500/30 cursor-pointer"
                    : filterApplied
                    ? "bg-green-500/10 border-green-500/30 text-green-400 cursor-default"
                    : "bg-secondary/20 border-panel-border text-muted-foreground cursor-not-allowed opacity-50"
                }`}
              >
                {filterApplied ? (
                  <><Check className="w-3.5 h-3.5" /> Filters Applied — Preview to hear</>
                ) : needsApply ? (
                  <><Wand2 className="w-3.5 h-3.5" /> Apply Filters to Preview</>
                ) : (
                  <><Wand2 className="w-3.5 h-3.5" /> Apply Filters to Preview</>
                )}
              </button>
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