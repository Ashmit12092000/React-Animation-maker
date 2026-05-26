import { useState, useRef, useEffect } from "react";
import { Volume2, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEditorStore } from "@/stores/editorStore";

const TTS_LANGUAGES = [
  { code: "en-US", label: "English (US)", flag: "🇺🇸" },
  { code: "fr-FR", label: "French", flag: "🇫🇷" },
  { code: "es-ES", label: "Spanish", flag: "🇪🇸" },
  { code: "de-DE", label: "German", flag: "🇩🇪" },
  { code: "hi-IN", label: "Hindi", flag: "🇮🇳" },
];

const TTS_VOICES: Record<string, { name: string; pitch: number; rate: number }[]> = {
  "en-US": [
    { name: "Natural", pitch: 1.0, rate: 1.0 },
    { name: "Warm", pitch: 0.9, rate: 0.95 },
    { name: "Clear", pitch: 1.1, rate: 1.05 },
  ],
  "fr-FR": [
    { name: "Natural", pitch: 1.0, rate: 0.95 },
    { name: "Expressive", pitch: 1.05, rate: 1.0 },
  ],
  "es-ES": [
    { name: "Natural", pitch: 1.0, rate: 1.0 },
    { name: "Energetic", pitch: 1.1, rate: 1.1 },
  ],
  "de-DE": [
    { name: "Natural", pitch: 0.95, rate: 0.95 },
    { name: "Crisp", pitch: 1.0, rate: 1.0 },
  ],
  "hi-IN": [
    { name: "Natural", pitch: 1.0, rate: 0.9 },
    { name: "Clear", pitch: 1.05, rate: 1.0 },
  ],
};

type TTSState = "idle" | "generating" | "ready";

export function TTSPanel() {
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("en-US");
  const [voiceIndex, setVoiceIndex] = useState(0);
  const [ttsState, setTtsState] = useState<TTSState>("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [charCount, setCharCount] = useState(0);
  const MAX_CHARS = 300;

  const keepAudioUrlAliveRef = useRef(false);
  const { addAudioTrack } = useEditorStore();

  useEffect(() => {
    return () => {
      if (audioUrl && !keepAudioUrlAliveRef.current) {
        URL.revokeObjectURL(audioUrl);
      }
      keepAudioUrlAliveRef.current = false;
    };
  }, [audioUrl]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value.slice(0, MAX_CHARS);
    setText(val);
    setCharCount(val.length);
    setTtsState("idle");
    setAudioUrl(null);
  };

  const handleLanguageChange = (val: string) => {
    setLanguage(val);
    setVoiceIndex(0);
    setTtsState("idle");
    setAudioUrl(null);
  };

  const generateSpeech = () => {
    if (!text.trim()) return;
    setTtsState("generating");

    const voices = TTS_VOICES[language] || TTS_VOICES["en-US"];
    const voiceConfig = voices[voiceIndex] || voices[0];

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.pitch = voiceConfig.pitch;
    utterance.rate = voiceConfig.rate;

    const availableVoices = window.speechSynthesis.getVoices();
    const match = availableVoices.find(v => v.lang.startsWith(language.split("-")[0]));
    if (match) utterance.voice = match;

    try {
      const audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      const recorder = new MediaRecorder(dest.stream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setTtsState("ready");
      };

      utterance.onstart = () => recorder.start(100);
      utterance.onend = () => {
        setTimeout(() => recorder.stop(), 200);
      };
      utterance.onerror = () => {
        setTtsState("ready");
      };

      window.speechSynthesis.speak(utterance);
    } catch {
      utterance.onend = () => setTtsState("ready");
      utterance.onerror = () => setTtsState("idle");
      window.speechSynthesis.speak(utterance);
    }
  };

  const addToTimeline = () => {
    if (!audioUrl) return;
    const langLabel = TTS_LANGUAGES.find(l => l.code === language)?.label || language;
    const voices = TTS_VOICES[language] || TTS_VOICES["en-US"];
    const voiceName = voices[voiceIndex]?.name || "Natural";
    const trackName = `TTS – ${langLabel} (${voiceName})`;
    const snippet = text.slice(0, 30) + (text.length > 30 ? "…" : "");

    addAudioTrack(`${trackName}: "${snippet}"`, audioUrl);
    keepAudioUrlAliveRef.current = true;

    setText("");
    setCharCount(0);
    setAudioUrl(null);
    setTtsState("idle");
  };

  const previewSpeech = () => {
    if (!text.trim()) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    const voices = TTS_VOICES[language] || TTS_VOICES["en-US"];
    const voiceConfig = voices[voiceIndex] || voices[0];
    utterance.pitch = voiceConfig.pitch;
    utterance.rate = voiceConfig.rate;
    const availableVoices = window.speechSynthesis.getVoices();
    const match = availableVoices.find(v => v.lang.startsWith(language.split("-")[0]));
    if (match) utterance.voice = match;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const voices = TTS_VOICES[language] || TTS_VOICES["en-US"];
  const selectedLang = TTS_LANGUAGES.find(l => l.code === language);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 text-muted-foreground">
        <Volume2 className="w-4 h-4" />
        <span className="text-xs font-medium uppercase tracking-wide">Text to Speech</span>
      </div>

      <div className="bg-secondary/30 rounded-lg p-3 space-y-3 border border-panel-border">
        {/* Language Selector */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Language</label>
          <Select value={language} onValueChange={handleLanguageChange}>
            <SelectTrigger className="h-8 text-sm bg-secondary border-panel-border">
              <SelectValue>
                <span className="flex items-center gap-2">
                  <span>{selectedLang?.flag}</span>
                  <span>{selectedLang?.label}</span>
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {TTS_LANGUAGES.map(lang => (
                <SelectItem key={lang.code} value={lang.code}>
                  <span className="flex items-center gap-2">
                    <span>{lang.flag}</span>
                    <span>{lang.label}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Voice Style */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Voice Style</label>
          <div className="flex gap-1.5 flex-wrap">
            {voices.map((v, i) => (
              <button
                key={v.name}
                onClick={() => setVoiceIndex(i)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all border ${
                  voiceIndex === i
                    ? "bg-blue-500/20 border-blue-500/60 text-blue-300"
                    : "bg-secondary/30 border-panel-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {v.name}
              </button>
            ))}
          </div>
        </div>

        {/* Text Input */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground">Text</label>
            <span className={`text-[10px] ${charCount > MAX_CHARS * 0.85 ? "text-yellow-400" : "text-muted-foreground"}`}>
              {charCount}/{MAX_CHARS}
            </span>
          </div>
          <textarea
            value={text}
            onChange={handleTextChange}
            placeholder="Type text to convert to speech…"
            rows={4}
            className="w-full resize-none rounded-md bg-secondary border border-panel-border text-sm text-foreground placeholder:text-muted-foreground/50 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-1.5 border-panel-border text-xs"
            disabled={!text.trim() || ttsState === "generating"}
            onClick={previewSpeech}
          >
            <Volume2 className="w-3.5 h-3.5" />
            Preview
          </Button>
          <Button
            size="sm"
            className="flex-1 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs"
            disabled={!text.trim() || ttsState === "generating"}
            onClick={generateSpeech}
          >
            {ttsState === "generating" ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</>
            ) : (
              <><Volume2 className="w-3.5 h-3.5" /> Generate</>
            )}
          </Button>
        </div>

        {/* Add to Timeline — only shown once audio is actually generated */}
        {ttsState === "ready" && audioUrl && (
          <Button
            size="sm"
            className="w-full gap-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs"
            onClick={addToTimeline}
          >
            <Plus className="w-3.5 h-3.5" /> Add to Timeline
          </Button>
        )}
      </div>
    </div>
  );
}
