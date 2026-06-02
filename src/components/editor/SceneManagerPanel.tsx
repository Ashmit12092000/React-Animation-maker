/**
 * SceneManagerPanel.tsx  — Canva / Animaker-style Scenes panel
 *
 * Tab layout (mirrors the Elements panel):
 *   [Storyboard]  [Backgrounds]
 *
 * Storyboard tab
 * ──────────────
 * • Horizontal scene strip — click to select, drag to reorder
 * • Per-scene: duplicate, delete, inline-rename (dbl-click), BG colour picker,
 *   duration edit (click the time badge), scene-transition picker
 * • "Add Scene" card at the end of the strip
 * • Active scene details card below strip
 * • Transition type is stored per-scene and shown as a small icon on the card
 *
 * Backgrounds tab
 * ───────────────
 * • Category filter pills (All / Nature / Urban / Sci-Fi / Celebration)
 * • 2-col grid of Lottie animated backgrounds — drag to canvas OR
 *   click "Apply" to set as the active scene's background
 * • Solid colour swatches + custom colour picker
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useEditorStore } from "@/stores/editorStore";
import {
  Plus, Copy, Trash2, ChevronLeft, ChevronRight,
  Loader2, Film, Palette, GripVertical, Layers,
  Image as ImageIcon, Check, Clock, Zap, Upload, X,
} from "lucide-react";
import { cn } from "@/utils/utils";
import type { SceneItem } from "@/stores/slices/sceneSlice";

// ─── Types ────────────────────────────────────────────────────────────────────

type SceneTab = "storyboard" | "backgrounds";

type TransitionType = "none" | "fade" | "slide" | "zoom" | "wipe";

interface LottieEntry {
  id: string;
  label: string;
  emoji: string;
  category: string;
  url: string;
  bg: string;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const LOTTIE_CATALOGUE: LottieEntry[] = [
  { id: "moving-scene", label: "Moving Scene",  emoji: "🌳", category: "Nature",      url: "wmremove-transformed.json", bg: "#fbbf24" },
  { id: "cloud",        label: "Cloud",          emoji: "☁️", category: "Nature",      url: "cloud.json",                bg: "#bfdbfe" },
  { id: "night-sky",   label: "Night Sky",       emoji: "🌌", category: "Nature",      url: "https://assets2.lottiefiles.com/packages/lf20_kcsr6fcp.json",  bg: "#0f0c29" },
  { id: "sunset",      label: "Sunset",          emoji: "🌅", category: "Nature",      url: "https://assets9.lottiefiles.com/packages/lf20_xlmz9xwm.json",  bg: "#f97316" },
  { id: "rain",        label: "Rainy Day",       emoji: "🌧️", category: "Nature",      url: "https://assets5.lottiefiles.com/packages/lf20_twijbubv.json",  bg: "#1e3a5f" },
  { id: "snow",        label: "Snowfall",        emoji: "❄️", category: "Nature",      url: "https://assets3.lottiefiles.com/packages/lf20_mniampqn.json",  bg: "#c7d2fe" },
  { id: "fire",        label: "Campfire",        emoji: "🔥", category: "Nature",      url: "https://assets3.lottiefiles.com/packages/lf20_udwmgzci.json",  bg: "#1c0a00" },
  { id: "ocean",       label: "Ocean",           emoji: "🌊", category: "Nature",      url: "https://assets4.lottiefiles.com/packages/lf20_qwL4H3.json",    bg: "#0ea5e9" },
  { id: "city-night",  label: "City Night",      emoji: "🌃", category: "Urban",       url: "https://assets2.lottiefiles.com/packages/lf20_3rwasyjy.json",  bg: "#1e1b4b" },
  { id: "space",       label: "Space",           emoji: "🚀", category: "Sci-Fi",      url: "https://assets2.lottiefiles.com/packages/lf20_yvw0ishb.json",  bg: "#020617" },
  { id: "confetti",    label: "Confetti",        emoji: "🎉", category: "Celebration", url: "https://assets3.lottiefiles.com/packages/lf20_u4yrau84.json",  bg: "#fef9c3" },
  { id: "aurora",      label: "Aurora",          emoji: "🌠", category: "Nature",      url: "https://assets10.lottiefiles.com/packages/lf20_pqnfmone.json", bg: "#064e3b" },
  { id: "forest",      label: "Forest",          emoji: "🌲", category: "Nature",      url: "https://assets5.lottiefiles.com/packages/lf20_syqnfe7c.json",  bg: "#14532d" },
  { id: "clouds",      label: "Clouds",          emoji: "☁️", category: "Nature",      url: "https://assets4.lottiefiles.com/packages/lf20_vclwmbg7.json",  bg: "#bfdbfe" },
];

const CATALOGUE_CATEGORIES = ["All", ...Array.from(new Set(LOTTIE_CATALOGUE.map(e => e.category)))];

const BG_PRESETS = [
  "#0f172a","#1e293b","#334155","#475569",
  "#fef9c3","#f0fdf4","#eff6ff","#fdf4ff",
  "#7c3aed","#0ea5e9","#10b981","#f97316",
  "#ec4899","#ffffff","#000000","#dc2626",
];

const TRANSITIONS: { type: TransitionType; label: string; icon: string }[] = [
  { type: "none",  label: "Cut",   icon: "⚡" },
  { type: "fade",  label: "Fade",  icon: "🌫️" },
  { type: "slide", label: "Slide", icon: "➡️" },
  { type: "zoom",  label: "Zoom",  icon: "🔍" },
  { type: "wipe",  label: "Wipe",  icon: "🪣" },
];

// ─── Lottie thumbnail ─────────────────────────────────────────────────────────

function LottieThumb({ url, bg }: { url: string; bg: string }) {
  const ref    = useRef<HTMLDivElement>(null);
  const animRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [err,   setErr]   = useState(false);

  useEffect(() => {
    let dead = false;
    setReady(false); setErr(false);
    (async () => {
      try {
        const lottie = (await import("lottie-web")).default;
        if (dead || !ref.current) return;
        animRef.current = lottie.loadAnimation({
          container: ref.current, renderer: "svg",
          loop: true, autoplay: true, path: url,
        });
        animRef.current.addEventListener("data_ready",  () => { if (!dead) setReady(true); });
        animRef.current.addEventListener("data_failed", () => { if (!dead) setErr(true); });
      } catch { if (!dead) setErr(true); }
    })();
    return () => { dead = true; animRef.current?.destroy(); animRef.current = null; };
  }, [url]);

  return (
    <div className="w-full h-full relative" style={{ background: bg }}>
      {!ready && !err && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-3 h-3 animate-spin text-white/50" />
        </div>
      )}
      {err && <div className="absolute inset-0 flex items-center justify-center text-lg opacity-40">🎬</div>}
      <div ref={ref} className="w-full h-full" style={{ opacity: ready ? 1 : 0, transition: "opacity .3s" }} />
    </div>
  );
}

// ─── Scene Card ───────────────────────────────────────────────────────────────

interface SceneCardProps {
  scene: SceneItem & { transition?: TransitionType };
  index: number;
  active: boolean;
  onClick: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRename: (label: string) => void;
  onBgChange: (bg: string) => void;
  onDurationChange: (ms: number) => void;
  onTransitionChange: (t: TransitionType) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onLottieDrop: (entry: LottieEntry) => void;
  isDragOver: boolean;
}

function SceneCard({
  scene, index, active,
  onClick, onDuplicate, onDelete, onRename, onBgChange,
  onDurationChange, onTransitionChange,
  onDragStart, onDragOver, onDrop, onLottieDrop, isDragOver,
}: SceneCardProps) {
  const [editing, setEditing]         = useState(false);
  const [draft, setDraft]             = useState(scene.label);
  const [showPicker, setShowPicker]   = useState(false);
  const [showDuration, setShowDuration] = useState(false);
  const [showTransition, setShowTransition] = useState(false);
  const [draftDuration, setDraftDuration]   = useState(String((scene.duration / 1000).toFixed(1)));
  const inputRef    = useRef<HTMLInputElement>(null);
  const durInputRef = useRef<HTMLInputElement>(null);

  const commitRename = () => {
    setEditing(false);
    const t = draft.trim();
    if (t) onRename(t); else setDraft(scene.label);
  };

  const commitDuration = () => {
    setShowDuration(false);
    const v = parseFloat(draftDuration);
    if (!isNaN(v) && v > 0) onDurationChange(Math.round(v * 1000));
    else setDraftDuration(String((scene.duration / 1000).toFixed(1)));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const lottieRaw = e.dataTransfer.getData("lottie-entry");
    if (lottieRaw) {
      try { onLottieDrop(JSON.parse(lottieRaw)); } catch {}
      return;
    }
    onDrop(e);
  };

  const transition = (scene as any).transition as TransitionType | undefined;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => { e.preventDefault(); onDragOver(e); }}
      onDrop={handleDrop}
      onClick={onClick}
      className={cn(
        "group relative flex-shrink-0 w-[90px] rounded-xl overflow-visible cursor-pointer transition-all duration-150 select-none",
        active
          ? "scale-[1.04]"
          : "hover:scale-[1.02]",
        isDragOver && "ring-2 ring-cyan-400 ring-offset-2 ring-offset-panel"
      )}
    >
      {/* Card body */}
      <div className={cn(
        "rounded-xl overflow-hidden border-2 transition-all duration-150",
        active ? "border-primary shadow-lg shadow-primary/30" : "border-panel-border hover:border-primary/50"
      )}>
        {/* Thumbnail */}
        <div className="aspect-video w-full pointer-events-none">
          {scene.thumbnail
            ? <img src={scene.thumbnail} className="w-full h-full object-cover" alt="" />
            : scene.lottieUrl
              ? <LottieThumb url={scene.lottieUrl} bg={scene.bg} />
              : <div className="w-full h-full" style={{ background: scene.bg }} />
          }
        </div>

        {/* Scene number badge */}
        <div className="absolute top-1.5 left-1.5 w-4 h-4 rounded-full bg-black/70 backdrop-blur-sm flex items-center justify-center z-10">
          <span className="text-[8px] font-bold text-white leading-none">{index + 1}</span>
        </div>

        {/* Lottie emoji */}
        {scene.lottieEmoji && (
          <div className="absolute top-1.5 right-1.5 text-[10px] leading-none z-10">{scene.lottieEmoji}</div>
        )}

        {/* Duration badge */}
        <button
          title="Edit duration"
          onClick={e => { e.stopPropagation(); setDraftDuration(String((scene.duration / 1000).toFixed(1))); setShowDuration(true); }}
          className="absolute bottom-6 left-1.5 z-10 bg-black/60 backdrop-blur-sm rounded px-1 py-0.5 flex items-center gap-0.5 hover:bg-primary/70 transition-colors"
        >
          <Clock className="w-2 h-2 text-white/70" />
          <span className="text-[8px] text-white/90 font-mono">{(scene.duration / 1000).toFixed(1)}s</span>
        </button>

        {/* Transition badge */}
        {transition && transition !== "none" && (
          <div className="absolute bottom-6 right-1.5 z-10 text-[9px] leading-none bg-black/60 backdrop-blur-sm rounded px-1 py-0.5">
            {TRANSITIONS.find(t => t.type === transition)?.icon}
          </div>
        )}

        {/* Label */}
        <div className="px-1.5 py-1 bg-panel/90 backdrop-blur-sm">
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") { setEditing(false); setDraft(scene.label); } }}
              className="w-full text-[9px] bg-transparent text-foreground outline-none border-b border-primary"
              autoFocus
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <p
              className="text-[9px] font-medium text-foreground/80 truncate"
              onDoubleClick={e => { e.stopPropagation(); setEditing(true); setDraft(scene.label); }}
            >
              {scene.label}
            </p>
          )}
        </div>

        {/* Hover action bar */}
        <div className="absolute inset-x-0 top-0 h-0 group-hover:h-auto overflow-hidden transition-all z-20">
          <div className="flex items-center justify-end gap-0.5 p-1 bg-black/70 backdrop-blur-sm">
            <button
              title="Background"
              onClick={e => { e.stopPropagation(); setShowPicker(p => !p); setShowTransition(false); }}
              className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/20 transition-colors"
            >
              <Palette className="w-3 h-3 text-white" />
            </button>
            <button
              title="Transition"
              onClick={e => { e.stopPropagation(); setShowTransition(p => !p); setShowPicker(false); }}
              className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/20 transition-colors"
            >
              <Zap className="w-3 h-3 text-white" />
            </button>
            <button
              title="Duplicate"
              onClick={e => { e.stopPropagation(); onDuplicate(); }}
              className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/20 transition-colors"
            >
              <Copy className="w-3 h-3 text-white" />
            </button>
            <button
              title="Delete"
              onClick={e => { e.stopPropagation(); onDelete(); }}
              className="w-5 h-5 rounded flex items-center justify-center hover:bg-red-500/60 transition-colors"
            >
              <Trash2 className="w-3 h-3 text-white" />
            </button>
          </div>
        </div>

        {/* Drag handle */}
        <div className="absolute bottom-7 right-1 opacity-0 group-hover:opacity-30 transition-opacity pointer-events-none z-10">
          <GripVertical className="w-3 h-3 text-white" />
        </div>
      </div>

      {/* ── Colour picker popover ── */}
      {showPicker && (
        <div
          className="absolute z-40 top-full left-0 mt-1.5 p-2.5 bg-panel border border-panel-border rounded-xl shadow-2xl w-[140px]"
          onClick={e => e.stopPropagation()}
        >
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Scene BG</p>
          <div className="grid grid-cols-4 gap-1 mb-2">
            {BG_PRESETS.map(c => (
              <button
                key={c}
                onClick={() => { onBgChange(c); setShowPicker(false); }}
                className={cn(
                  "w-6 h-6 rounded-md border hover:scale-110 transition-transform",
                  scene.bg === c ? "border-primary ring-1 ring-primary" : "border-panel-border"
                )}
                style={{ background: c }}
              />
            ))}
          </div>
          <div className="relative w-full h-6 rounded overflow-hidden border border-panel-border cursor-pointer" style={{ background: "conic-gradient(red,yellow,lime,cyan,blue,magenta,red)" }}>
            <input type="color" onChange={e => { onBgChange(e.target.value); }} className="opacity-0 absolute inset-0 cursor-pointer w-full h-full" />
          </div>
          <button onClick={() => setShowPicker(false)} className="mt-2 w-full text-[9px] text-muted-foreground hover:text-foreground text-center">Close</button>
        </div>
      )}

      {/* ── Duration editor popover ── */}
      {showDuration && (
        <div
          className="absolute z-40 top-full left-0 mt-1.5 p-2.5 bg-panel border border-panel-border rounded-xl shadow-2xl w-[130px]"
          onClick={e => e.stopPropagation()}
        >
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Duration (sec)</p>
          <input
            ref={durInputRef}
            type="number"
            min="0.5"
            max="60"
            step="0.5"
            value={draftDuration}
            onChange={e => setDraftDuration(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") commitDuration(); if (e.key === "Escape") setShowDuration(false); }}
            autoFocus
            className="w-full text-xs bg-secondary border border-panel-border rounded px-2 py-1 text-foreground outline-none focus:border-primary font-mono"
          />
          <div className="flex gap-1 mt-2">
            {[2, 3, 5, 8].map(s => (
              <button
                key={s}
                onClick={() => { setDraftDuration(String(s)); onDurationChange(s * 1000); setShowDuration(false); }}
                className={cn(
                  "flex-1 text-[9px] py-0.5 rounded border transition-all",
                  scene.duration === s * 1000
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-panel-border text-muted-foreground hover:text-foreground"
                )}
              >
                {s}s
              </button>
            ))}
          </div>
          <div className="flex gap-1 mt-2">
            <button onClick={() => setShowDuration(false)} className="flex-1 text-[9px] text-muted-foreground hover:text-foreground border border-panel-border rounded py-0.5">Cancel</button>
            <button onClick={commitDuration} className="flex-1 text-[9px] bg-primary text-primary-foreground rounded py-0.5">Set</button>
          </div>
        </div>
      )}

      {/* ── Transition picker popover ── */}
      {showTransition && (
        <div
          className="absolute z-40 top-full left-0 mt-1.5 p-2.5 bg-panel border border-panel-border rounded-xl shadow-2xl w-[150px]"
          onClick={e => e.stopPropagation()}
        >
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Transition In</p>
          <div className="space-y-0.5">
            {TRANSITIONS.map(t => (
              <button
                key={t.type}
                onClick={() => { onTransitionChange(t.type); setShowTransition(false); }}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[10px] transition-all",
                  transition === t.type
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-secondary text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="text-sm leading-none w-5 text-center">{t.icon}</span>
                <span className="font-medium">{t.label}</span>
                {transition === t.type && <Check className="w-3 h-3 ml-auto" />}
              </button>
            ))}
          </div>
          <button onClick={() => setShowTransition(false)} className="mt-2 w-full text-[9px] text-muted-foreground hover:text-foreground text-center">Close</button>
        </div>
      )}
    </div>
  );
}

// ─── Catalogue Entry ──────────────────────────────────────────────────────────

function CatalogueEntry({
  entry,
  onApply,
}: {
  entry: LottieEntry;
  onApply: (entry: LottieEntry) => void;
}) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("lottie-entry", JSON.stringify(entry));
    e.dataTransfer.setData("asset", JSON.stringify({
      id:    `scene-${entry.id}`,
      name:  entry.label,
      type:  "scene",
      src:   entry.url,
      bg:    entry.bg,
      color: entry.bg,
      icon:  entry.emoji,
    }));
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="group relative rounded-xl overflow-hidden border border-panel-border hover:border-primary/60 transition-all cursor-grab active:cursor-grabbing select-none"
    >
      <div className="aspect-video pointer-events-none">
        <LottieThumb url={entry.url} bg={entry.bg} />
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-black/70 backdrop-blur-sm px-1.5 py-1 flex items-center gap-1">
        <span className="text-[10px] leading-none">{entry.emoji}</span>
        <span className="text-[9px] font-medium text-white truncate flex-1">{entry.label}</span>
      </div>
      {/* Apply button on hover */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
        <button
          onClick={e => { e.stopPropagation(); onApply(entry); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-[9px] font-semibold text-white bg-primary px-2 py-1 rounded-full shadow-lg hover:bg-primary/80"
        >
          Apply to Scene
        </button>
      </div>
    </div>
  );
}

// ─── Add Scene Modal ──────────────────────────────────────────────────────────
// Like Canva/Animaker: blank scene, pick colour, or upload an image as background

function AddSceneModal({ onClose, onAdd }: {
  onClose: () => void;
  onAdd: (opts: { bg: string; thumbnail?: string; bgImageUrl?: string; label?: string }) => void;
}) {
  const [selectedBg, setSelectedBg] = useState("black");
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreviewImg(url);
    setBgImageUrl(url);
    setSelectedBg("#000000");
  };

  const handleAdd = () => {
    onAdd({ bg: selectedBg, thumbnail: previewImg ?? undefined, bgImageUrl: bgImageUrl ?? undefined });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-panel border border-panel-border rounded-2xl shadow-2xl w-[300px] p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[12px] font-bold text-foreground">Add New Scene</h3>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-secondary transition-colors">
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Preview */}
        <div
          className="w-full aspect-video rounded-xl mb-3 overflow-hidden border border-panel-border flex items-center justify-center"
          style={{ background: previewImg ? "#000" : selectedBg }}
        >
          {previewImg
            ? <img src={previewImg} className="w-full h-full object-cover" alt="preview" />
            : <span className="text-[10px] text-white/40">Preview</span>
          }
        </div>

        {/* Upload image button */}
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 py-2 mb-3 rounded-xl border-2 border-dashed border-panel-border hover:border-primary/60 hover:bg-primary/5 transition-all text-[10px] text-muted-foreground hover:text-primary"
        >
          <Upload className="w-3.5 h-3.5" />
          {previewImg ? "Change Background Image" : "Upload Background Image"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

        {/* Colour presets */}
        {!previewImg && (
          <>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Background Color</p>
            <div className="grid grid-cols-8 gap-1 mb-3">
              {BG_PRESETS.map(c => (
                <button
                  key={c}
                  onClick={() => setSelectedBg(c)}
                  className={cn(
                    "aspect-square rounded-md border transition-all hover:scale-110",
                    selectedBg === c ? "border-primary ring-1 ring-primary" : "border-panel-border"
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </>
        )}

        {previewImg && (
          <button
            onClick={() => { setPreviewImg(null); setBgImageUrl(null); setSelectedBg("#0f172a"); }}
            className="w-full text-[9px] text-red-400 hover:text-red-300 mb-3 text-center"
          >
            Remove image
          </button>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 text-[10px] rounded-xl border border-panel-border text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
          <button onClick={handleAdd} className="flex-1 py-2 text-[10px] rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/80 transition-colors">
            Add Scene
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Storyboard Tab ───────────────────────────────────────────────────────────

function StoryboardTab() {
  const scenes              = useEditorStore(s => s.scenes);
  const activeId            = useEditorStore(s => s.activeSceneId);
  const addScene            = useEditorStore(s => s.addScene);
  const duplicateScene      = useEditorStore(s => s.duplicateScene);
  const deleteScene         = useEditorStore(s => s.deleteScene);
  const renameScene         = useEditorStore(s => s.renameScene);
  const setSceneBg          = useEditorStore(s => s.setSceneBg);
  const reorderScenes       = useEditorStore(s => s.reorderScenes);
  const setActiveScene      = useEditorStore(s => s.setActiveScene);
  const updateSceneDuration = useEditorStore(s => s.updateSceneDuration);
  const updateSceneTransition = useEditorStore(s => s.updateSceneTransition);

  const [dragOverId, setDragOverId]   = useState<string | null>(null);
  const [dragSrcId, setDragSrcId]     = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (window as any).__sceneManager?.onSceneChange?.(activeId, scenes.find(s => s.id === activeId));
  }, [activeId, scenes]);

  const handleAddScene = () => setShowAddModal(true);

  const handleModalAdd = ({ bg, thumbnail, bgImageUrl }: { bg: string; thumbnail?: string; bgImageUrl?: string }) => {
    addScene({ bg, thumbnail, bgImageUrl });
    setTimeout(() => stripRef.current?.scrollTo({ left: 99999, behavior: "smooth" }), 50);
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDragSrcId(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    setDragOverId(id);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverId(null);
    if (!dragSrcId || dragSrcId === targetId) return;
    reorderScenes(dragSrcId, targetId);
    setDragSrcId(null);
  };

  const scrollStrip = (dir: -1 | 1) =>
    stripRef.current?.scrollBy({ left: dir * 200, behavior: "smooth" });

  const totalDuration = scenes.reduce((s, sc) => s + sc.duration, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Strip header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-1.5">
          <Film className="w-3.5 h-3.5 text-primary" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-foreground">Storyboard</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground font-mono">{(totalDuration / 1000).toFixed(1)}s total</span>
          <span className="text-[9px] bg-secondary rounded-full px-1.5 py-0.5 text-muted-foreground">{scenes.length}</span>
        </div>
      </div>
      <p className="text-[9px] text-muted-foreground px-4 pb-2">Click to select · dbl-click to rename · drag to reorder</p>

      {/* Horizontal scene strip */}
      <div className="relative px-3 pb-3 border-b border-panel-border">
        <button
          onClick={() => scrollStrip(-1)}
          className="absolute left-0 top-0 bottom-0 z-10 w-6 flex items-center justify-center bg-gradient-to-r from-panel to-transparent hover:from-panel/80"
        >
          <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
        </button>

        <div
          ref={stripRef}
          className="flex gap-3 overflow-x-auto px-5 pb-1 scroll-smooth"
          style={{ scrollbarWidth: "none" }}
          onDragLeave={() => setDragOverId(null)}
        >
          {scenes.map((scene, i) => (
            <SceneCard
              key={scene.id}
              scene={{ ...scene, transition: scene.transition }}
              index={i}
              active={scene.id === activeId}
              isDragOver={dragOverId === scene.id}
              onClick={() => setActiveScene(scene.id)}
              onDuplicate={() => duplicateScene(scene.id)}
              onDelete={() => deleteScene(scene.id)}
              onRename={label => renameScene(scene.id, label)}
              onBgChange={bg => setSceneBg(scene.id, bg)}
              onDurationChange={ms => updateSceneDuration(scene.id, ms)}
              onTransitionChange={t => updateSceneTransition(scene.id, t)}
              onDragStart={e => handleDragStart(e, scene.id)}
              onDragOver={e => handleDragOver(e, scene.id)}
              onDrop={e => handleDrop(e, scene.id)}
              onLottieDrop={entry => setSceneBg(scene.id, entry.bg, entry.url, entry.emoji)}
            />
          ))}

          {/* Add scene card */}
          <button
            onClick={handleAddScene}
            className="flex-shrink-0 w-[90px] aspect-video rounded-xl border-2 border-dashed border-panel-border hover:border-primary/60 flex flex-col items-center justify-center gap-1 transition-all hover:bg-primary/5 group self-start"
          >
            <Plus className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
            <span className="text-[9px] text-muted-foreground group-hover:text-primary transition-colors font-medium">Add Scene</span>
          </button>
        </div>

        <button
          onClick={() => scrollStrip(1)}
          className="absolute right-0 top-0 bottom-0 z-10 w-6 flex items-center justify-center bg-gradient-to-l from-panel to-transparent hover:from-panel/80"
        >
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Active scene details */}
      {(() => {
        const sc = scenes.find(s => s.id === activeId);
        if (!sc) return null;
        const scIdx = scenes.findIndex(s => s.id === activeId);
        return (
          <div className="px-4 py-3 border-b border-panel-border bg-primary/5">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-5 h-5 rounded-lg flex-shrink-0 border border-panel-border" style={{ background: sc.bg }} />
              <span className="text-[11px] font-semibold text-foreground flex-1 truncate">{sc.label}</span>
              {sc.lottieEmoji && <span className="text-base">{sc.lottieEmoji}</span>}
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-[9px]">
              <div className="bg-secondary/50 rounded-lg px-2 py-1.5 text-center">
                <p className="text-muted-foreground">Scene</p>
                <p className="font-bold text-foreground">{scIdx + 1} / {scenes.length}</p>
              </div>
              <div className="bg-secondary/50 rounded-lg px-2 py-1.5 text-center">
                <p className="text-muted-foreground">Duration</p>
                <p className="font-bold text-foreground font-mono">{(sc.duration / 1000).toFixed(1)}s</p>
              </div>
              <div className="bg-secondary/50 rounded-lg px-2 py-1.5 text-center">
                <p className="text-muted-foreground">Transition</p>
                <p className="font-bold text-foreground">{TRANSITIONS.find(t => t.type === (sc.transition ?? "none"))?.label ?? "Cut"}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Quick actions */}
      <div className="px-4 py-3 flex gap-2 border-b border-panel-border">
        <button
          onClick={() => setShowAddModal(true)}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-panel-border hover:border-primary/60 hover:bg-primary/5 transition-all text-[10px] text-muted-foreground hover:text-primary"
        >
          <Plus className="w-3 h-3" />
          Add Scene
        </button>
        {scenes.length > 0 && (
          <button
            onClick={() => duplicateScene(activeId)}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-panel-border hover:border-primary/40 hover:bg-secondary/40 transition-all text-[10px] text-muted-foreground hover:text-foreground"
          >
            <Copy className="w-3 h-3" />
            Duplicate
          </button>
        )}
      </div>

      {/* Scene list (timeline overview) */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 space-y-1">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground px-1 mb-2">Scene Overview</p>
        {scenes.map((sc, i) => (
          <div
            key={sc.id}
            onClick={() => setActiveScene(sc.id)}
            className={cn(
              "flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all group",
              sc.id === activeId
                ? "bg-primary/15 border border-primary/30"
                : "hover:bg-secondary/50 border border-transparent"
            )}
          >
            {/* Mini thumbnail — real canvas snap if available, else colour */}
            <div className="w-7 h-5 rounded-md flex-shrink-0 border border-panel-border overflow-hidden">
              {sc.thumbnail
                ? <img src={sc.thumbnail} className="w-full h-full object-cover" alt="" />
                : sc.lottieUrl
                  ? <LottieThumb url={sc.lottieUrl} bg={sc.bg} />
                  : <div className="w-full h-full" style={{ background: sc.bg }} />
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-medium text-foreground truncate">
                <span className="text-muted-foreground mr-1">{i + 1}.</span>
                {sc.label}
              </p>
            </div>
            <span className="text-[9px] text-muted-foreground font-mono flex-shrink-0">{(sc.duration / 1000).toFixed(1)}s</span>
            {sc.id === activeId && (
              <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
            )}
          </div>
        ))}
      </div>

      {/* Add Scene Modal */}
      {showAddModal && (
        <AddSceneModal onClose={() => setShowAddModal(false)} onAdd={handleModalAdd} />
      )}
    </div>
  );
}

// ─── Backgrounds Tab ──────────────────────────────────────────────────────────

function BackgroundsTab() {
  const [category, setCategory]     = useState("All");
  const activeId                    = useEditorStore(s => s.activeSceneId);
  const setSceneBg                  = useEditorStore(s => s.setSceneBg);
  const scenes                      = useEditorStore(s => s.scenes);
  const [appliedId, setAppliedId]   = useState<string | null>(null);
  const [bgMode, setBgMode]         = useState<"animated" | "solid">("animated");

  const activeScene = scenes.find(s => s.id === activeId);

  const filtered = category === "All"
    ? LOTTIE_CATALOGUE
    : LOTTIE_CATALOGUE.filter(e => e.category === category);

  const applyEntry = (entry: LottieEntry) => {
    setSceneBg(activeId, entry.bg, entry.url, entry.emoji);
    setAppliedId(entry.id);
    setTimeout(() => setAppliedId(null), 1500);
  };

  const applySolid = (color: string) => {
    setSceneBg(activeId, color, undefined, undefined);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Active scene target indicator */}
      {activeScene && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-panel-border bg-secondary/30">
          <ImageIcon className="w-3 h-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">Applying to:</span>
          <div className="w-3 h-3 rounded flex-shrink-0" style={{ background: activeScene.bg }} />
          <span className="text-[10px] font-semibold text-foreground truncate">{activeScene.label}</span>
        </div>
      )}

      {/* Mode toggle: Animated / Solid */}
      <div className="px-4 py-2.5 border-b border-panel-border">
        <div className="flex bg-secondary/50 p-1 rounded-lg">
          <button
            onClick={() => setBgMode("animated")}
            className={cn("flex-1 text-[10px] py-1.5 rounded-md transition-all flex items-center justify-center gap-1",
              bgMode === "animated" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Film className="w-3 h-3" /> Animated
          </button>
          <button
            onClick={() => setBgMode("solid")}
            className={cn("flex-1 text-[10px] py-1.5 rounded-md transition-all flex items-center justify-center gap-1",
              bgMode === "solid" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Palette className="w-3 h-3" /> Solid Color
          </button>
        </div>
      </div>

      {bgMode === "animated" ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Category pills */}
          <div className="flex flex-wrap gap-1 px-4 py-2.5 border-b border-panel-border">
            {CATALOGUE_CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={cn(
                  "px-2 py-0.5 rounded-full text-[9px] font-medium transition-all border",
                  category === cat
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary/40 text-muted-foreground border-panel-border hover:text-foreground"
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          <p className="text-[9px] text-muted-foreground px-4 py-1.5">Click Apply or drag to canvas</p>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="grid grid-cols-2 gap-2 px-3 pb-4 pt-1">
              {filtered.map(entry => (
                <div key={entry.id} className="relative">
                  {appliedId === entry.id && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 rounded-xl">
                      <div className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center">
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  )}
                  <CatalogueEntry entry={entry} onApply={applyEntry} />
                </div>
              ))}
            </div>
            <p className="text-[9px] text-muted-foreground text-center pb-4">{LOTTIE_CATALOGUE.length} free animated backgrounds</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Preset Colors</p>
          <div className="grid grid-cols-4 gap-2 mb-4">
            {BG_PRESETS.map(c => (
              <button
                key={c}
                onClick={() => applySolid(c)}
                className={cn(
                  "aspect-square rounded-xl border-2 hover:scale-110 transition-all",
                  activeScene?.bg === c ? "border-primary ring-2 ring-primary/30" : "border-panel-border"
                )}
                style={{ background: c }}
              />
            ))}
          </div>

          <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Custom Color</p>
          <div className="flex items-center gap-2">
            <div
              className="w-10 h-10 rounded-xl border-2 border-panel-border overflow-hidden flex-shrink-0 relative cursor-pointer hover:border-primary transition-colors"
              style={{ background: activeScene?.bg ?? "#000" }}
            >
              <input
                type="color"
                value={activeScene?.bg ?? "#000000"}
                onChange={e => applySolid(e.target.value)}
                className="opacity-0 absolute inset-0 cursor-pointer w-full h-full"
              />
            </div>
            <div className="flex-1">
              <p className="text-[9px] text-muted-foreground">Click to pick any colour</p>
              <p className="text-[10px] font-mono text-foreground">{activeScene?.bg ?? "#000000"}</p>
            </div>
          </div>

          {/* Remove BG option */}
          <button
            onClick={() => applySolid("#0f172a")}
            className="mt-4 w-full py-2 text-[10px] text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/40 rounded-lg hover:bg-red-500/5 transition-all flex items-center justify-center gap-1.5"
          >
            <Trash2 className="w-3 h-3" />
            Reset to Default
          </button>
        </div>
      )}
    </div>
  );
  }

// ─── Main export ──────────────────────────────────────────────────────────────

export function SceneManagerPanel() {
  const [tab, setTab] = useState<SceneTab>("storyboard");

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar — mirrors Elements panel style */}
      <div className="px-4 pt-3 pb-0 border-b border-panel-border">
        <div className="flex bg-secondary/50 p-1 rounded-lg mb-0">
          <button
            onClick={() => setTab("storyboard")}
            className={cn(
              "flex-1 text-[10px] py-1.5 rounded-md transition-all flex items-center justify-center gap-1.5",
              tab === "storyboard" ? "bg-background shadow text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Layers className="w-3 h-3" />
            Storyboard
          </button>
          <button
            onClick={() => setTab("backgrounds")}
            className={cn(
              "flex-1 text-[10px] py-1.5 rounded-md transition-all flex items-center justify-center gap-1.5",
              tab === "backgrounds" ? "bg-background shadow text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <ImageIcon className="w-3 h-3" />
            Backgrounds
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === "storyboard"  && <StoryboardTab />}
        {tab === "backgrounds" && <BackgroundsTab />}
      </div>
    </div>
  );
}