/**
 * SceneManagerPanel.tsx
 *
 * Canva / Animaker‑style "Scenes" panel.
 * Lives inside the AssetPanel's "Scenes" tab content area.
 *
 * Features
 * ─────────
 * • Storyboard strip at the top — thumbnail cards, click to jump, drag to reorder
 * • "Add Scene" button creates a new blank scene
 * • Duplicate / Delete per scene (hover reveals controls)
 * • Inline rename (double-click the scene label)
 * • Background-colour picker per scene thumbnail
 * • Active scene highlighted with accent ring
 * • Lottie animated-background library below the storyboard strip
 * • Drag a Lottie scene onto a storyboard card to set its background
 * • Completely self-contained — no changes to CanvasEditor or TrackSlice required
 *   (uses window.__sceneManager bus to signal the host)
 */

import { useState, useRef, useCallback, useEffect, useId } from "react";
import { useEditorStore } from "@/stores/editorStore";
import {
  Plus,
  Copy,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Film,
  Palette,
  GripVertical,
} from "lucide-react";
import { cn } from "@/utils/utils";

import type { SceneItem } from "@/stores/slices/sceneSlice";

// ─── Lottie catalogue (same URLs already used in the project) ─────────────────

interface LottieEntry {
  id: string;
  label: string;
  emoji: string;
  category: string;
  url: string;
  bg: string;
}

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
  "#0f172a", "#1e293b", "#334155",
  "#fef9c3", "#f0fdf4", "#eff6ff",
  "#7c3aed", "#0ea5e9", "#10b981",
  "#f97316", "#ec4899", "#ffffff",
];

// ─── Tiny Lottie thumbnail ────────────────────────────────────────────────────

function LottieThumb({ url, bg }: { url: string; bg: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const animRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState(false);

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
        animRef.current.addEventListener("data_ready", () => { if (!dead) setReady(true); });
        animRef.current.addEventListener("data_failed",  () => { if (!dead) setErr(true); });
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

// ─── Scene Thumbnail Card ─────────────────────────────────────────────────────

interface SceneCardProps {
  scene: SceneItem;
  index: number;
  active: boolean;
  onClick: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRename: (label: string) => void;
  onBgChange: (bg: string) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onLottieDrop: (entry: LottieEntry) => void;
  isDragOver: boolean;
}

function SceneCard({
  scene, index, active,
  onClick, onDuplicate, onDelete, onRename, onBgChange,
  onDragStart, onDragOver, onDrop, onLottieDrop, isDragOver,
}: SceneCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(scene.label);
  const [showPicker, setShowPicker] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const commitRename = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed) onRename(trimmed);
    else setDraft(scene.label);
  };

  // Accept a Lottie asset dragged from the catalogue
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    // Check for catalogue drag (custom data type)
    const lottieRaw = e.dataTransfer.getData("lottie-entry");
    if (lottieRaw) {
      try { onLottieDrop(JSON.parse(lottieRaw)); } catch {}
      return;
    }
    onDrop(e);
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => { e.preventDefault(); onDragOver(e); }}
      onDrop={handleDrop}
      onClick={onClick}
      className={cn(
        "group relative flex-shrink-0 w-[88px] rounded-xl overflow-hidden cursor-pointer transition-all duration-150 select-none",
        "border-2",
        active
          ? "border-primary shadow-lg shadow-primary/30 scale-[1.03]"
          : "border-panel-border hover:border-primary/50",
        isDragOver && "ring-2 ring-cyan-400 ring-offset-1 ring-offset-panel"
      )}
    >
      {/* Thumbnail */}
      <div className="aspect-video w-full pointer-events-none">
        {scene.lottieUrl
          ? <LottieThumb url={scene.lottieUrl} bg={scene.bg} />
          : <div className="w-full h-full" style={{ background: scene.bg }} />
        }
      </div>

      {/* Scene number badge */}
      <div className="absolute top-1.5 left-1.5 w-4 h-4 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
        <span className="text-[8px] font-bold text-white leading-none">{index + 1}</span>
      </div>

      {/* BG emoji / indicator */}
      {scene.lottieEmoji && (
        <div className="absolute top-1.5 right-1.5 text-[10px] leading-none">{scene.lottieEmoji}</div>
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
      <div className="absolute inset-x-0 top-0 h-0 group-hover:h-auto overflow-hidden transition-all">
        <div className="flex items-center justify-end gap-0.5 p-1 bg-black/60 backdrop-blur-sm">
          {/* BG colour picker */}
          <button
            title="Scene background"
            onClick={e => { e.stopPropagation(); setShowPicker(p => !p); }}
            className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/20 transition-colors"
          >
            <Palette className="w-3 h-3 text-white" />
          </button>
          <button
            title="Duplicate scene"
            onClick={e => { e.stopPropagation(); onDuplicate(); }}
            className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/20 transition-colors"
          >
            <Copy className="w-3 h-3 text-white" />
          </button>
          <button
            title="Delete scene"
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="w-5 h-5 rounded flex items-center justify-center hover:bg-red-500/60 transition-colors"
          >
            <Trash2 className="w-3 h-3 text-white" />
          </button>
        </div>
      </div>

      {/* Colour picker popover */}
      {showPicker && (
        <div
          className="absolute z-30 top-full left-0 mt-1 p-2 bg-panel border border-panel-border rounded-xl shadow-xl w-[120px]"
          onClick={e => e.stopPropagation()}
        >
          <p className="text-[9px] text-muted-foreground mb-1.5">Scene BG</p>
          <div className="grid grid-cols-4 gap-1">
            {BG_PRESETS.map(c => (
              <button
                key={c}
                onClick={() => { onBgChange(c); setShowPicker(false); }}
                className="w-6 h-6 rounded border border-panel-border hover:scale-110 transition-transform"
                style={{ background: c }}
              />
            ))}
            <div className="relative w-6 h-6 rounded overflow-hidden border border-panel-border" style={{ background: "conic-gradient(red,yellow,lime,cyan,blue,magenta,red)" }}>
              <input type="color" onChange={e => { onBgChange(e.target.value); }} className="opacity-0 absolute inset-0 cursor-pointer" />
            </div>
          </div>
          <button onClick={() => setShowPicker(false)} className="mt-1.5 w-full text-[9px] text-muted-foreground hover:text-foreground">close</button>
        </div>
      )}

      {/* Drag handle icon */}
      <div className="absolute bottom-6 right-1 opacity-0 group-hover:opacity-40 transition-opacity pointer-events-none">
        <GripVertical className="w-3 h-3 text-white" />
      </div>
    </div>
  );
}

// ─── Lottie Catalogue Entry ───────────────────────────────────────────────────

function CatalogueEntry({ entry }: { entry: LottieEntry }) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("lottie-entry", JSON.stringify(entry));
    // Also set the standard "asset" key so CanvasEditor can still handle it
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
      className="group relative rounded-lg overflow-hidden border border-panel-border hover:border-primary/60 transition-all cursor-grab active:cursor-grabbing select-none"
    >
      <div className="aspect-video pointer-events-none">
        <LottieThumb url={entry.url} bg={entry.bg} />
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-black/60 backdrop-blur-sm px-1.5 py-1 flex items-center gap-1">
        <span className="text-[10px] leading-none">{entry.emoji}</span>
        <span className="text-[9px] font-medium text-white truncate">{entry.label}</span>
      </div>
      <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/10 transition-colors pointer-events-none flex items-center justify-center">
        <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[9px] font-semibold text-white bg-black/50 px-1.5 py-0.5 rounded-full">
          drag to scene
        </span>
      </div>
    </div>
  );
}

// ─── Main SceneManagerPanel ───────────────────────────────────────────────────

export function SceneManagerPanel() {
  const scenes        = useEditorStore(s => s.scenes);
  const activeId      = useEditorStore(s => s.activeSceneId);
  const addScene      = useEditorStore(s => s.addScene);
  const duplicateScene = useEditorStore(s => s.duplicateScene);
  const deleteScene   = useEditorStore(s => s.deleteScene);
  const renameScene   = useEditorStore(s => s.renameScene);
  const setSceneBg    = useEditorStore(s => s.setSceneBg);
  const reorderScenes = useEditorStore(s => s.reorderScenes);
  const setActiveScene = useEditorStore(s => s.setActiveScene);

  const [dragOverId, setDragOverId]   = useState<string | null>(null);
  const [dragSrcId, setDragSrcId]     = useState<string | null>(null);
  const [catCategory, setCatCategory] = useState("All");
  const stripRef = useRef<HTMLDivElement>(null);

  // Notify host via window bus whenever active scene changes
  useEffect(() => {
    (window as any).__sceneManager?.onSceneChange?.(activeId, scenes.find(s => s.id === activeId));
  }, [activeId, scenes]);

  // ── Storyboard actions ────────────────────────────────────────────────────

  const handleAddScene = () => {
    addScene();
    setTimeout(() => stripRef.current?.scrollTo({ left: 99999, behavior: "smooth" }), 50);
  };

  const setBg = (id: string, bg: string) => setSceneBg(id, bg);

  const setLottie = (id: string, entry: LottieEntry) =>
    setSceneBg(id, entry.bg, entry.url, entry.emoji);

  // ── Drag-to-reorder ───────────────────────────────────────────────────────

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

  // ── Scroll strip arrows ───────────────────────────────────────────────────

  const scrollStrip = (dir: -1 | 1) => {
    stripRef.current?.scrollBy({ left: dir * 200, behavior: "smooth" });
  };

  // ── Filtered catalogue ────────────────────────────────────────────────────

  const filteredCat = catCategory === "All"
    ? LOTTIE_CATALOGUE
    : LOTTIE_CATALOGUE.filter(e => e.category === catCategory);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full gap-0">

      {/* ── Section header ── */}
      <div className="px-4 pt-4 pb-3 border-b border-panel-border">
        <div className="flex items-center justify-between mb-0.5">
          <div className="flex items-center gap-2">
            <Film className="w-3.5 h-3.5 text-primary" />
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-foreground">Storyboard</h2>
          </div>
          <span className="text-[10px] text-muted-foreground">{scenes.length} scene{scenes.length !== 1 ? "s" : ""}</span>
        </div>
        <p className="text-[10px] text-muted-foreground">Click to select · double-click label to rename · drag to reorder</p>
      </div>

      {/* ── Storyboard strip ── */}
      <div className="relative px-3 py-3 border-b border-panel-border bg-secondary/20">
        {/* Left scroll */}
        <button
          onClick={() => scrollStrip(-1)}
          className="absolute left-0 top-0 bottom-0 z-10 w-6 flex items-center justify-center bg-gradient-to-r from-panel to-transparent hover:from-panel/80 transition-all"
        >
          <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
        </button>

        {/* Cards */}
        <div
          ref={stripRef}
          className="flex gap-2 overflow-x-auto px-5 scroll-smooth"
          style={{ scrollbarWidth: "none" }}
          onDragLeave={() => setDragOverId(null)}
        >
          {scenes.map((scene, i) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              index={i}
              active={scene.id === activeId}
              isDragOver={dragOverId === scene.id}
              onClick={() => setActiveScene(scene.id)}
              onDuplicate={() => duplicateScene(scene.id)}
              onDelete={() => deleteScene(scene.id)}
              onRename={label => renameScene(scene.id, label)}
              onBgChange={bg => setBg(scene.id, bg)}
              onDragStart={e => handleDragStart(e, scene.id)}
              onDragOver={e => handleDragOver(e, scene.id)}
              onDrop={e => handleDrop(e, scene.id)}
              onLottieDrop={entry => setLottie(scene.id, entry)}
            />
          ))}

          {/* Add scene card */}
          <button
            onClick={handleAddScene}
            className="flex-shrink-0 w-[88px] aspect-video rounded-xl border-2 border-dashed border-panel-border hover:border-primary/60 flex flex-col items-center justify-center gap-1 transition-all hover:bg-primary/5 group"
          >
            <Plus className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
            <span className="text-[9px] text-muted-foreground group-hover:text-primary transition-colors font-medium">Add Scene</span>
          </button>
        </div>

        {/* Right scroll */}
        <button
          onClick={() => scrollStrip(1)}
          className="absolute right-0 top-0 bottom-0 z-10 w-6 flex items-center justify-center bg-gradient-to-l from-panel to-transparent hover:from-panel/80 transition-all"
        >
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* ── Active scene info bar ── */}
      {(() => {
        const sc = scenes.find(s => s.id === activeId);
        if (!sc) return null;
        return (
          <div className="px-4 py-2 border-b border-panel-border bg-primary/5 flex items-center gap-2">
            <div className="w-4 h-4 rounded flex-shrink-0" style={{ background: sc.bg }} />
            <span className="text-[10px] font-semibold text-foreground truncate flex-1">{sc.label}</span>
            {sc.lottieEmoji && <span className="text-sm">{sc.lottieEmoji}</span>}
            <span className="text-[9px] text-muted-foreground flex-shrink-0">{(sc.duration / 1000).toFixed(1)}s</span>
          </div>
        );
      })()}

      {/* ── Animated Backgrounds catalogue ── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="px-4 pt-3 pb-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Animated Backgrounds</p>
          <p className="text-[9px] text-muted-foreground mb-2">Drag onto a scene card — or drag to canvas</p>

          {/* Category pills */}
          <div className="flex flex-wrap gap-1 mb-3">
            {CATALOGUE_CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setCatCategory(cat)}
                className={cn(
                  "px-2 py-0.5 rounded-full text-[9px] font-medium transition-all border",
                  catCategory === cat
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary/40 text-muted-foreground border-panel-border hover:text-foreground"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 px-3 pb-4">
          {filteredCat.map(entry => (
            <CatalogueEntry key={entry.id} entry={entry} />
          ))}
        </div>

        <p className="text-[9px] text-muted-foreground text-center pb-4">
          {LOTTIE_CATALOGUE.length} free animated scenes
        </p>
      </div>
    </div>
  );
}