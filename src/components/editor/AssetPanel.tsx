import { useState, useRef, useEffect, useCallback } from "react";
import {
  useEditorStore,
  sampleAssets,
  fontStyles,
} from "@/stores/editorStore";
import type { Asset } from "@/types";
import { cn } from "../../utils/utils";
import { SceneManagerPanel } from "@/components/editor/SceneManagerPanel";
import {
  Box,
  Image as ImageIcon,
  Type,
  Music,
  Upload,
  Video,
  Layers,
  MousePointer2,
  ChevronLeft,
  Pencil,
  Eraser,
  Film,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Tab type ────────────────────────────────────────────────────────────────
type PanelTab = "elements" | "text" | "media" | "characters" | "draw" | "scenes";

// ─── Character / Prop data ────────────────────────────────────────────────────
type CharacterGroup = { label: string; color: string; assets: Asset[] };

const propGroups: CharacterGroup[] = [
  {
    label: "Props",
    color: "#f97316",
    assets: [
      { id: "prop-chair", name: "chair", type: "prop" as any, icon: "🪑", color: "#8b5cf6" },
    ],
  },
];

const characterGroups: CharacterGroup[] = [
  {
    label: "Locomotion",
    color: "#6366f1",
    assets: [
      { id: "char-idle", name: "Idle", type: "character", icon: "🧍", color: "#6366f1" },
      { id: "char-walk", name: "walk", type: "character", icon: "🚶", color: "#22c55e" },
      { id: "char-run",  name: "run",  type: "character", icon: "🏃", color: "#f97316" },
      { id: "char-jump", name: "jump", type: "character", icon: "🦘", color: "#ec4899" },
    ],
  },
  {
    label: "Gestures",
    color: "#06b6d4",
    assets: [
      { id: "char-wave",       name: "wave",       type: "character", icon: "👋", color: "#06b6d4" },
      { id: "char-handshake",  name: "handshake",  type: "character", icon: "🤝", color: "#06b6d4" },
      { id: "char-point",      name: "point",      type: "character", icon: "👉", color: "#06b6d4" },
      { id: "char-nod",        name: "nod",        type: "character", icon: "🙂", color: "#06b6d4" },
      { id: "char-shake_head", name: "shake_head", type: "character", icon: "🙅", color: "#06b6d4" },
    ],
  },
  {
    label: "Posture",
    color: "#8b5cf6",
    assets: [
      { id: "char-sit_down", name: "sit_down", type: "character", icon: "🪑", color: "#8b5cf6" },
      { id: "char-sit_idle", name: "sit_idle", type: "character", icon: "😌", color: "#8b5cf6" },
    ],
  },
];

const characterAssets: Asset[] = characterGroups.flatMap(g => g.assets);

// ─── Shape definitions ────────────────────────────────────────────────────────
const SHAPE_GROUPS = [
  {
    label: "Basic",
    shapes: [
      { name: "Rectangle", icon: "▬", viewBox: "0 0 56 40", path: <rect x="2" y="2" width="52" height="36" rx="3" /> },
      { name: "Square",    icon: "■", viewBox: "0 0 44 44", path: <rect x="2" y="2" width="40" height="40" rx="3" /> },
      { name: "Circle",    icon: "●", viewBox: "0 0 44 44", path: <circle cx="22" cy="22" r="20" /> },
      { name: "Ellipse",   icon: "⬬", viewBox: "0 0 56 36", path: <ellipse cx="28" cy="18" rx="26" ry="16" /> },
      { name: "Triangle",  icon: "▲", viewBox: "0 0 44 40", path: <polygon points="22,2 42,38 2,38" /> },
      { name: "Line",      icon: "─", viewBox: "0 0 44 20", path: <line x1="2" y1="10" x2="42" y2="10" strokeWidth="4" strokeLinecap="round" /> },
    ],
  },
  {
    label: "Polygons",
    shapes: [
      { name: "Diamond",  icon: "◆", viewBox: "0 0 44 56", path: <polygon points="22,2 42,28 22,54 2,28" /> },
      { name: "Pentagon", icon: "⬠", viewBox: "0 0 44 44", path: <polygon points="22,2 42,16 34,40 10,40 2,16" /> },
      { name: "Hexagon",  icon: "⬡", viewBox: "0 0 44 44", path: <polygon points="22,2 40,12 40,32 22,42 4,32 4,12" /> },
      { name: "Octagon",  icon: "⯃", viewBox: "0 0 44 44", path: <polygon points="14,2 30,2 42,14 42,30 30,42 14,42 2,30 2,14" /> },
    ],
  },
  {
    label: "Stars & Special",
    shapes: [
      { name: "Star",   icon: "★", viewBox: "0 0 44 44", path: <polygon points="22,2 27,17 43,17 30,26 35,42 22,33 9,42 14,26 1,17 17,17" /> },
      { name: "Star6",  icon: "✶", viewBox: "0 0 44 44", path: <polygon points="22,2 26,16 39,8 32,20 44,22 32,24 39,36 26,28 22,42 18,28 5,36 12,24 0,22 12,20 5,8 18,16" /> },
      { name: "Heart",  icon: "♥", viewBox: "0 0 44 40", path: <path d="M22,36 C22,36 2,22 2,12 C2,6 7,2 13,2 C17,2 21,5 22,7 C23,5 27,2 31,2 C37,2 42,6 42,12 C42,22 22,36 22,36Z" /> },
      { name: "Arrow",  icon: "➤", viewBox: "0 0 56 36", path: <polygon points="2,10 34,10 34,2 54,18 34,34 34,26 2,26" /> },
    ],
  },
];

// ─── Lottie Scenes ────────────────────────────────────────────────────────────
// Free Lottie JSON animations from LottieFiles CDN (no API key needed)
interface LottieScene {
  id: string;
  label: string;
  emoji: string;
  category: string;
  url: string;  // public CDN url
  bg: string;   // thumbnail bg color
}

const LOTTIE_SCENES: LottieScene[] = [
  {
    id: "Moving-Scene",
    label: "Moving scene",
    emoji: "🌳",
    category: "Nature",
    url: "wmremove-transformed.json",
    bg: "#fbbf24",
  },
  {
    id: "Cloud",
    label: "Cloud",
    emoji: "☁️",
    category: "Nature",
    url: "cloud.json",
    bg: "#bfdbfe",
  },
  {
    id: "night-sky",
    label: "Night Sky",
    emoji: "🌌",
    category: "Nature",
    url: "https://assets2.lottiefiles.com/packages/lf20_kcsr6fcp.json",
    bg: "#0f0c29",
  },
  {
    id: "sunset",
    label: "Sunset",
    emoji: "🌅",
    category: "Nature",
    url: "https://assets9.lottiefiles.com/packages/lf20_xlmz9xwm.json",
    bg: "#f97316",
  },
  {
    id: "rain",
    label: "Rainy Day",
    emoji: "🌧️",
    category: "Nature",
    url: "https://assets5.lottiefiles.com/packages/lf20_twijbubv.json",
    bg: "#1e3a5f",
  },
  {
    id: "snow",
    label: "Snowfall",
    emoji: "❄️",
    category: "Nature",
    url: "https://assets3.lottiefiles.com/packages/lf20_mniampqn.json",
    bg: "#c7d2fe",
  },
  {
    id: "fire",
    label: "Campfire",
    emoji: "🔥",
    category: "Nature",
    url: "https://assets3.lottiefiles.com/packages/lf20_udwmgzci.json",
    bg: "#1c0a00",
  },
  {
    id: "ocean",
    label: "Ocean",
    emoji: "🌊",
    category: "Nature",
    url: "https://assets4.lottiefiles.com/packages/lf20_qwL4H3.json",
    bg: "#0ea5e9",
  },
  {
    id: "city-night",
    label: "City Night",
    emoji: "🌃",
    category: "Urban",
    url: "https://assets2.lottiefiles.com/packages/lf20_3rwasyjy.json",
    bg: "#1e1b4b",
  },
  {
    id: "space",
    label: "Space",
    emoji: "🚀",
    category: "Sci-Fi",
    url: "https://assets2.lottiefiles.com/packages/lf20_yvw0ishb.json",
    bg: "#020617",
  },
  {
    id: "confetti",
    label: "Confetti",
    emoji: "🎉",
    category: "Celebration",
    url: "https://assets3.lottiefiles.com/packages/lf20_u4yrau84.json",
    bg: "#fef9c3",
  },
  {
    id: "aurora",
    label: "Aurora",
    emoji: "🌠",
    category: "Nature",
    url: "https://assets10.lottiefiles.com/packages/lf20_pqnfmone.json",
    bg: "#064e3b",
  },
  {
    id: "forest",
    label: "Forest",
    emoji: "🌲",
    category: "Nature",
    url: "https://assets5.lottiefiles.com/packages/lf20_syqnfe7c.json",
    bg: "#14532d",
  },
  {
    id: "clouds",
    label: "Clouds",
    emoji: "☁️",
    category: "Nature",
    url: "https://assets4.lottiefiles.com/packages/lf20_vclwmbg7.json",
    bg: "#bfdbfe",
  },
];

const SCENE_CATEGORIES = ["All", ...Array.from(new Set(LOTTIE_SCENES.map(s => s.category)))];

// ─── LottieThumb: tiny canvas preview of a Lottie animation ──────────────────
function LottieThumb({ url, bg }: { url: string; bg: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let destroyed = false;
    setLoaded(false);
    setError(false);

    const load = async () => {
      try {
        // Dynamically import lottie-web so the main bundle doesn't grow
        const lottie = (await import("lottie-web")).default;
        if (destroyed || !containerRef.current) return;

        animRef.current = lottie.loadAnimation({
          container: containerRef.current,
          renderer: "svg",
          loop: true,
          autoplay: true,
          path: url,
        });

        animRef.current.addEventListener("data_ready", () => {
          if (!destroyed) setLoaded(true);
        });
        animRef.current.addEventListener("data_failed", () => {
          if (!destroyed) setError(true);
        });
      } catch {
        if (!destroyed) setError(true);
      }
    };

    load();

    return () => {
      destroyed = true;
      animRef.current?.destroy();
      animRef.current = null;
    };
  }, [url]);

  return (
    <div
      className="w-full h-full relative overflow-hidden"
      style={{ background: bg }}
    >
      {!loaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-white/60" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-2xl opacity-60">
          🎬
        </div>
      )}
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ opacity: loaded ? 1 : 0, transition: "opacity 0.3s" }}
      />
    </div>
  );
}

// ─── ScenesPanel ──────────────────────────────────────────────────────────────
function ScenesPanel() {
  const [category, setCategory] = useState("All");

  const filtered = category === "All"
    ? LOTTIE_SCENES
    : LOTTIE_SCENES.filter(s => s.category === category);

  const handleDragStart = (e: React.DragEvent, scene: LottieScene) => {
    // Pass as an asset with type "scene" so CanvasEditor knows how to handle it
    const asset = {
      id:   `scene-${scene.id}`,
      name: scene.label,
      type: "scene",
      src:  scene.url,
      bg:   scene.bg,
      color: scene.bg,
      icon:  scene.emoji,
    };
    e.dataTransfer.setData("asset", JSON.stringify(asset));
  };

  return (
    <div className="space-y-3">
      {/* Category filter */}
      <div className="flex flex-wrap gap-1.5">
        {SCENE_CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={cn(
              "px-2.5 py-1 rounded-full text-[10px] font-medium transition-all border",
              category === cat
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-secondary/40 text-muted-foreground border-panel-border hover:text-foreground"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Scene grid */}
      <div className="grid grid-cols-2 gap-2">
        {filtered.map(scene => (
          <div
            key={scene.id}
            draggable
            onDragStart={(e) => handleDragStart(e, scene)}
            className="group relative rounded-xl overflow-hidden border-2 border-panel-border hover:border-primary/60 transition-all cursor-grab active:cursor-grabbing select-none"
          >
            {/* Lottie preview thumbnail */}
            <div className="aspect-video w-full pointer-events-none">
              <LottieThumb url={scene.url} bg={scene.bg} />
            </div>

            {/* Label */}
            <div className="absolute inset-x-0 bottom-0 bg-black/60 backdrop-blur-sm px-2 py-1.5 flex items-center gap-1.5">
              <span className="text-sm leading-none">{scene.emoji}</span>
              <span className="text-[10px] font-medium text-white truncate">{scene.label}</span>
            </div>

            {/* Drag hint overlay */}
            <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/10 transition-colors pointer-events-none flex items-center justify-center">
              <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-semibold text-white bg-black/50 px-2 py-1 rounded-full">
                drag to canvas
              </span>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground text-center pt-1">
        {LOTTIE_SCENES.length} free animated scenes · drag onto canvas
      </p>
    </div>
  );
}

// ─── ShapesPanel ──────────────────────────────────────────────────────────────
function ShapesPanel() {
  const [shapeColor, setShapeColor] = useState("#4ecdc4");

  const PRESET_COLORS = [
    "#ef4444","#f97316","#eab308","#22c55e",
    "#06b6d4","#3b82f6","#8b5cf6","#ec4899",
    "#ffffff","#94a3b8","#374151","#000000",
  ];

  const handleAddShape = (shapeName: string) => {
    const asset: Asset = {
      id: `shape-${shapeName.toLowerCase()}-${Date.now()}`,
      name: shapeName,
      type: "item",
      color: shapeColor,
      icon: "",
    };
    if ((window as any).__addShapeToCanvas) {
      (window as any).__addShapeToCanvas(asset);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Shape Color</p>
        <div className="grid grid-cols-6 gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setShapeColor(c)}
              className="w-7 h-7 rounded-md border-2 transition-transform hover:scale-110"
              style={{
                backgroundColor: c,
                borderColor: shapeColor === c ? "white" : "transparent",
                boxShadow: shapeColor === c ? `0 0 0 1px rgba(255,255,255,0.3)` : undefined,
              }}
            />
          ))}
          <div
            className="relative w-7 h-7 rounded-md overflow-hidden border-2 transition-transform hover:scale-110"
            style={{ borderColor: PRESET_COLORS.includes(shapeColor) ? "transparent" : "white", background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }}
          >
            <input
              type="color"
              value={shapeColor}
              onChange={(e) => setShapeColor(e.target.value)}
              className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded border border-panel-border flex-shrink-0" style={{ backgroundColor: shapeColor }} />
          <span className="text-xs font-mono text-muted-foreground">{shapeColor}</span>
        </div>
      </div>

      {SHAPE_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{group.label}</p>
          <div className="grid grid-cols-3 gap-2">
            {group.shapes.map((shape) => (
              <button
                key={shape.name}
                onClick={() => handleAddShape(shape.name)}
                title={shape.name}
                className="group flex flex-col items-center gap-1.5 p-2 rounded-lg bg-secondary/60 border border-panel-border hover:border-primary/50 hover:bg-secondary transition-all active:scale-95"
              >
                <svg
                  viewBox={shape.viewBox}
                  className="w-8 h-8"
                  style={{ fill: shape.name === "Line" ? "none" : shapeColor, stroke: shape.name === "Line" ? shapeColor : "none", overflow: "visible" }}
                >
                  {shape.path}
                </svg>
                <span className="text-[9px] text-muted-foreground group-hover:text-foreground transition-colors leading-none">{shape.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── AssetPanel ───────────────────────────────────────────────────────────────
export function AssetPanel() {
  const [isOpen, setIsOpen] = useState(true);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const isDraggingV = useRef(false);
  const dragStartY  = useRef(0);
  const dragStartH  = useRef(0);
  const panelRef    = useRef<HTMLDivElement>(null);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingV.current = true;
    dragStartY.current  = e.clientY;
    dragStartH.current  = panelRef.current?.offsetHeight ?? window.innerHeight;

    const onMove = (ev: MouseEvent) => {
      if (!isDraggingV.current) return;
      const delta = ev.clientY - dragStartY.current;
      const newH  = Math.max(120, Math.min(window.innerHeight - 40, dragStartH.current + delta));
      setPanelHeight(newH);
    };
    const onUp = () => {
      isDraggingV.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  useEffect(() => {
    const checkScreenSize = () => setIsOpen(window.innerWidth >= 768);
    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);
    return () => window.removeEventListener("resize", checkScreenSize);
  }, []);

  const [textContent, setTextContent] = useState("Hello");
  const [textColor, setTextColor]     = useState("#FFFFFF");
  const [fontSize, setFontSize]       = useState(32);
  const [fontFamily, setFontFamily]   = useState("Arial");
  const [activeAssetType, setActiveAssetType] = useState<"item" | "background">("item");
  const [activeTab, setActiveTab]     = useState<PanelTab>("elements");

  const {
    addAudioTrack, tracks, addUploadedAsset, removeUploadedAsset, addVideoTrack,
    uploadedAssets, drawingEnabled, drawingColor, drawingBrushSize,
    setDrawingEnabled, setDrawingColor, setDrawingBrushSize,
    eraserEnabled, eraserSize, setEraserEnabled, setEraserSize,
  } = useEditorStore();

  const audioAssets   = uploadedAssets.filter((a) => a.type === "audio");
  const videoAssets   = uploadedAssets.filter((a) => a.type === "video");
  const filteredAssets = sampleAssets.filter((a) => a.type === activeAssetType);

  const handleDragStart = (e: React.DragEvent, asset: Asset) => {
    e.dataTransfer.setData("asset", JSON.stringify(asset));
  };

  const handleSetBackground = (color: string) => {
    (window as any).__setBackground?.(color);
  };

  const handleRemoveBackground = () => {
    (window as any).__removeBackground?.();
  };

  const handleAddText = () => {
    (window as any).__addTextToCanvas?.(textContent, textColor, fontSize, fontFamily);
  };

  const handleMediaUpload = (e: React.ChangeEvent<HTMLInputElement>, type: "audio" | "video" | "image" | "gif") => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file, index) => {
      const url   = URL.createObjectURL(file);
      const isMp3 = file.type === "audio/mpeg" || file.name.toLowerCase().endsWith(".mp3");
      const isMp4 = file.type === "video/mp4"  || file.name.toLowerCase().endsWith(".mp4");
      const isJpeg = file.type === "image/jpeg" || file.name.toLowerCase().endsWith(".jpg") || file.name.toLowerCase().endsWith(".jpeg");
      const isPng  = file.type === "image/png"  || file.name.toLowerCase().endsWith(".png");
      const isGif  = file.type === "image/gif"  || file.name.toLowerCase().endsWith(".gif");

      if (type === "audio" && isMp3) {
        addUploadedAsset({ id: `audio-${Date.now()}-${index}`, name: file.name, type: "audio", src: url, color: "", icon: "🎵" });
      } else if (type === "image" && (isJpeg || isPng)) {
        addUploadedAsset({ id: `image-${Date.now()}-${index}`, name: file.name, type: "item", color: "", icon: "🖼️", src: url });
      } else if (type === "gif" && isGif) {
        addUploadedAsset({ id: `gif-${Date.now()}-${index}`, name: file.name, type: "item", color: "", icon: "🎞️", src: url, isGif: true } as any);
      } else if (type === "video" && isMp4) {
        addUploadedAsset({ id: `video-${Date.now()}-${index}`, name: file.name, type: "video", src: url, color: "", icon: "🎥" });
      }
    });
    e.target.value = "";
  };

  const handleLeftNavClick = (tab: PanelTab) => {
    if (activeTab === tab) {
      setIsOpen(s => !s);
    } else {
      if (activeTab === "draw" && tab !== "draw") {
        setDrawingEnabled(false);
        setEraserEnabled(false);
      }
      setActiveTab(tab);
      setIsOpen(true);
    }
  };

  const drawColors = ["#ffffff","#f87171","#fbbf24","#34d399","#60a5fa","#a78bfa","#f472b6","#111827"];

  return (
    <div
      ref={panelRef}
      style={panelHeight !== null ? { height: panelHeight } : undefined}
      className={`relative flex ${panelHeight !== null ? "" : "h-full"} ${isOpen ? "w-80" : "w-[80px]"} bg-panel border-r border-panel-border transition-all duration-300 ease-in-out overflow-hidden flex-row`}
    >
      {/* Close button */}
      <div className={"absolute top-2 right-0 z-20 transition-all duration-50 ease-in-out" + (isOpen ? " opacity-100 visible" : " opacity-0 invisible")}>
        <button
          onClick={() => setIsOpen(false)}
          className="w-10 h-10 flex items-center justify-center bg-panel rounded-md shadow-sm transition-transform duration-100 hover:scale-105"
          aria-label="Close panel"
        >
          <ChevronLeft className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>

      {/* ── Left nav rail ── */}
      <div className="w-[80px] px-4 flex flex-col items-center py-4 border-r border-panel-border bg-panel gap-4">
        <NavButton active={activeTab === "elements"}   onClick={() => handleLeftNavClick("elements")}   icon={<Box className="w-5 h-5" />}    label="Elements" />
        <NavButton active={activeTab === "text"}       onClick={() => handleLeftNavClick("text")}       icon={<Type className="w-5 h-5" />}   label="Text" />
        <NavButton active={activeTab === "scenes"}     onClick={() => handleLeftNavClick("scenes")}     icon={<Film className="w-5 h-5" />}   label="Scenes" />
        <NavButton active={activeTab === "characters"} onClick={() => handleLeftNavClick("characters")} icon={<Layers className="w-5 h-5" />} label="Characters" />
        <NavButton active={activeTab === "media"}      onClick={() => handleLeftNavClick("media")}      icon={<Upload className="w-5 h-5" />} label="Uploads" />
        <NavButton active={activeTab === "draw"}       onClick={() => handleLeftNavClick("draw")}       icon={<Pencil className="w-5 h-5" />} label="Draw" />
      </div>

      {/* ── Panel content ── */}
      <div className={`flex-1 flex flex-col h-full bg-secondary/10 overflow-hidden transition-all duration-100 ease-in-out ${isOpen ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2 pointer-events-none"}`}>

        {/* ELEMENTS */}
        {activeTab === "elements" && (
          <div className="flex flex-col h-full">
            <div className="p-4 border-b border-panel-border">
              <h2 className="font-semibold text-foreground mb-4">Elements</h2>
              <div className="flex bg-secondary/50 p-1 rounded-lg">
                <button onClick={() => setActiveAssetType("item")} className={cn("flex-1 text-xs py-1.5 rounded-md transition-all", activeAssetType === "item" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground")}>Shapes</button>
                <button onClick={() => setActiveAssetType("background")} className={cn("flex-1 text-xs py-1.5 rounded-md transition-all", activeAssetType === "background" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground")}>Backgrounds</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
              {activeAssetType === "item" ? (
                <ShapesPanel />
              ) : (
                <div className="space-y-4">
                  <Button variant="outline" size="sm" onClick={handleRemoveBackground} className="w-full text-xs text-red-400 hover:text-red-500 hover:bg-red-500/10 border-red-500/20">Remove Background</Button>
                  <div className="grid grid-cols-3 gap-2">
                    {filteredAssets.map((asset) => (
                      <button key={asset.id} onClick={() => handleSetBackground(asset.color)} className="aspect-square rounded-md border border-transparent hover:scale-105 transition-transform" style={{ backgroundColor: asset.color }} />
                    ))}
                    <div className="relative aspect-square rounded-md overflow-hidden bg-gradient-to-br from-red-500 via-yellow-500 to-blue-500 hover:scale-105 transition-transform cursor-pointer">
                      <input type="color" onChange={(e) => handleSetBackground(e.target.value)} className="opacity-0 absolute inset-0 w-full h-full cursor-pointer" />
                    </div>
                  </div>
                  <div className="pt-2 border-t border-panel-border">
                    <p className="text-xs text-muted-foreground mb-2">Uploaded Images</p>
                    <div className="grid grid-cols-2 gap-2">
                      {uploadedAssets.filter(a => a.type === "item").map((asset) => (
                        <div key={asset.id} draggable onDragStart={(e) => handleDragStart(e, asset)} className="group relative aspect-square rounded-xl bg-secondary border border-panel-border hover:border-primary/50 cursor-grab active:cursor-grabbing overflow-hidden transition-all">
                          <img src={asset.src} alt={asset.name} className="w-full h-full object-cover" />
                          <div className="absolute inset-x-0 bottom-0 bg-black/60 p-1 translate-y-full group-hover:translate-y-0 transition-transform">
                            <p className="text-[10px] text-white text-center truncate">{asset.name}</p>
                          </div>
                        </div>
                      ))}
                      <label className="cursor-pointer aspect-square rounded-xl border-2 border-dashed border-panel-border hover:border-primary/50 flex flex-col items-center justify-center bg-secondary/20 hover:bg-secondary/40 transition-all">
                        <Upload className="w-6 h-6 text-muted-foreground mb-2" />
                        <span className="text-[10px] text-muted-foreground">Upload</span>
                        <input type="file" accept=".png,.jpg,.jpeg" onChange={(e) => handleMediaUpload(e, "image")} className="hidden" />
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SCENES — full SceneManagerPanel (storyboard + animated BG library) */}
        {activeTab === "scenes" && (
          <div className="flex flex-col h-full overflow-hidden">
            <SceneManagerPanel />
          </div>
        )}

        {/* TEXT */}
        {activeTab === "text" && (
          <div className="p-4 flex flex-col h-full">
            <h2 className="font-semibold text-foreground mb-6">Add Text</h2>
            <div className="space-y-6 overflow-y-auto custom-scrollbar">
              <div className="space-y-2">
                <Label className="text-xs">Content</Label>
                <Input value={textContent} onChange={(e) => setTextContent(e.target.value)} className="bg-secondary border-panel-border" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Color</Label>
                  <div className="flex gap-2">
                    <div className="w-9 h-9 rounded border border-panel-border overflow-hidden shrink-0 relative">
                      <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="absolute w-[150%] h-[150%] -top-1/4 -left-1/4 cursor-pointer" />
                    </div>
                    <Input value={textColor} onChange={(e) => setTextColor(e.target.value)} className="flex-1 bg-secondary text-xs font-mono" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Size</Label>
                  <Input type="number" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="bg-secondary" />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Font Family</Label>
                <Select value={fontFamily} onValueChange={setFontFamily}>
                  <SelectTrigger className="bg-secondary border-panel-border"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {fontStyles.map((f) => (
                      <SelectItem key={f} value={f}><span style={{ fontFamily: f }}>{f}</span></SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleAddText} className="w-full mt-4" size="lg">Add Text to Canvas</Button>
            </div>
          </div>
        )}

        {/* MEDIA */}
        {activeTab === "media" && (
          <div className="flex flex-col h-full">
            <div className="p-4 border-b border-panel-border">
              <h2 className="font-semibold text-foreground">Media</h2>
              <p className="text-xs text-muted-foreground mt-1">Images, GIFs, Audio &amp; Video</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
              <div className="flex flex-col gap-2 mb-6">
                <UploadButton label="Upload Image" icon={<ImageIcon className="w-5 h-5 text-emerald-400" />} accept=".png,.jpg,.jpeg" onChange={(e) => handleMediaUpload(e, "image")} />
                <UploadButton label="Upload GIF"   icon={<span className="text-lg leading-none">🎞️</span>}    accept=".gif,image/gif"   onChange={(e) => handleMediaUpload(e, "gif")} />
                <UploadButton label="Upload Audio" icon={<Music className="w-5 h-5 text-purple-400" />}      accept="audio/mpeg,.mp3"  onChange={(e) => handleMediaUpload(e, "audio")} />
                <UploadButton label="Upload Video" icon={<Video className="w-5 h-5 text-blue-400" />}        accept="video/mp4,.mp4"   onChange={(e) => handleMediaUpload(e, "video")} />
              </div>

              {uploadedAssets.filter(a => a.type === "item").length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Images &amp; GIFs</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {uploadedAssets.filter(a => a.type === "item").map((asset) => (
                      <div key={asset.id} draggable onDragStart={(e) => handleDragStart(e, asset)} className="group relative aspect-square rounded-xl bg-secondary border border-panel-border hover:border-primary/50 cursor-grab active:cursor-grabbing overflow-hidden transition-all" title={`Drag to canvas · ${asset.name}`}>
                        <img src={asset.src} alt={asset.name} className="w-full h-full object-cover" style={{ imageRendering: (asset as any).isGif ? "auto" : undefined }} />
                        {(asset as any).isGif && <div className="absolute top-1 left-1 bg-black/70 text-[9px] font-bold text-pink-300 px-1.5 py-0.5 rounded-full leading-none border border-pink-400/30">GIF</div>}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeUploadedAsset(asset.id);
                          }}
                          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-red-600 hover:bg-red-700 text-white rounded-full p-1 transition-colors"
                          title="Delete this image"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="absolute inset-x-0 bottom-0 bg-black/60 p-1 translate-y-full group-hover:translate-y-0 transition-transform">
                          <p className="text-[10px] text-white text-center truncate">{asset.name}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Audio Library</h3>
                <div className="space-y-2">
                  {audioAssets.length === 0 && <p className="text-xs text-muted-foreground italic">No audio uploaded yet</p>}
                  {audioAssets.map((asset) => (
                    <button key={asset.id} onClick={() => addAudioTrack(asset.name, asset.src!)} className="w-full flex items-center gap-3 p-2 rounded bg-secondary/40 text-xs border border-transparent hover:border-purple-500/30 hover:bg-secondary/60 transition-colors text-left" title="Click to add to timeline">
                      <Music className="w-3 h-3 text-purple-400 shrink-0" />
                      <span className="truncate">{asset.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Video Library</h3>
                <div className="space-y-2">
                  {videoAssets.length === 0 && <p className="text-xs text-muted-foreground italic">No videos uploaded yet</p>}
                  {videoAssets.map((asset) => (
                    <div key={asset.id} className="flex gap-1">
                      <button onClick={() => addVideoTrack(asset.name, asset.src!)} className="flex-1 flex items-center gap-3 p-2 rounded bg-secondary/40 text-xs border border-transparent hover:border-blue-500/30 hover:bg-secondary/60 transition-colors text-left truncate" title="Click to add to timeline">
                        <Video className="w-3 h-3 text-blue-400 shrink-0" />
                        <span className="truncate">{asset.name}</span>
                      </button>
                      <div draggable onDragStart={(e) => handleDragStart(e, asset)} className="p-2 rounded bg-secondary/40 text-xs border border-transparent hover:bg-secondary/60 cursor-grab active:cursor-grabbing flex items-center justify-center" title="Drag to canvas">
                        <MousePointer2 className="w-3 h-3 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DRAW */}
        {activeTab === "draw" && (
          <div className="flex flex-col h-full">
            <div className="p-4 border-b border-panel-border">
              <h2 className="font-semibold text-foreground">Draw</h2>
              <p className="text-xs text-muted-foreground mt-1">Freehand pencil &amp; eraser</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Active Tool</Label>
                <div className="grid grid-cols-3 gap-1 p-1 bg-secondary rounded-lg">
                  <button onClick={() => { setDrawingEnabled(false); setEraserEnabled(false); }} className={cn("flex flex-col items-center gap-1 py-2 px-1 rounded-md text-xs transition-all", !drawingEnabled ? "bg-background text-foreground shadow-sm font-medium" : "text-muted-foreground hover:text-foreground")}><MousePointer2 className="h-4 w-4" /><span>Select</span></button>
                  <button onClick={() => { setDrawingEnabled(true); setEraserEnabled(false); }} className={cn("flex flex-col items-center gap-1 py-2 px-1 rounded-md text-xs transition-all", drawingEnabled && !eraserEnabled ? "bg-primary text-primary-foreground shadow-sm font-medium" : "text-muted-foreground hover:text-foreground")}><Pencil className="h-4 w-4" /><span>Pen</span></button>
                  <button onClick={() => { setDrawingEnabled(true); setEraserEnabled(true); }} className={cn("flex flex-col items-center gap-1 py-2 px-1 rounded-md text-xs transition-all", drawingEnabled && eraserEnabled ? "bg-destructive text-destructive-foreground shadow-sm font-medium" : "text-muted-foreground hover:text-foreground")}><Eraser className="h-4 w-4" /><span>Eraser</span></button>
                </div>
                <p className="text-[10px] text-center text-muted-foreground">
                  {!drawingEnabled && "Click Pen or Eraser to start drawing"}
                  {drawingEnabled && !eraserEnabled && "🖊 Draw on the canvas"}
                  {drawingEnabled && eraserEnabled && "⬜ Click & drag to erase strokes"}
                </p>
              </div>

              {drawingEnabled && !eraserEnabled && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Brush Size</Label>
                    <span className="text-xs text-muted-foreground font-mono">{drawingBrushSize}px</span>
                  </div>
                  <div className="flex items-center justify-center h-10 bg-secondary rounded-md">
                    <div className="rounded-full bg-foreground/80" style={{ width: Math.min(drawingBrushSize, 36), height: Math.min(drawingBrushSize, 36) }} />
                  </div>
                  <input type="range" min={1} max={60} value={drawingBrushSize} onChange={(e) => setDrawingBrushSize(Number(e.target.value))} className="w-full accent-primary" style={{ cursor: "pointer" }} />
                  <div className="flex justify-between text-xs text-muted-foreground"><span>1px</span><span>60px</span></div>
                </div>
              )}

              {drawingEnabled && eraserEnabled && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Eraser Size</Label>
                    <span className="text-xs text-muted-foreground font-mono">{eraserSize}px</span>
                  </div>
                  <div className="flex items-center justify-center h-12 bg-secondary rounded-md">
                    <div className="rounded-full border-2 border-destructive/70 bg-destructive/10" style={{ width: Math.min(eraserSize, 44), height: Math.min(eraserSize, 44) }} />
                  </div>
                  <input type="range" min={4} max={120} value={eraserSize} onChange={(e) => setEraserSize(Number(e.target.value))} className="w-full accent-destructive" style={{ cursor: "pointer" }} />
                  <div className="flex justify-between text-xs text-muted-foreground"><span>4px</span><span>120px</span></div>
                </div>
              )}

              {drawingEnabled && !eraserEnabled && (
                <div className="space-y-2">
                  <Label className="text-xs">Color</Label>
                  <div className="grid grid-cols-4 gap-2">
                    {drawColors.map((color) => (
                      <button key={color} onClick={() => setDrawingColor(color)} className={cn("h-8 w-8 rounded border transition-all", drawingColor === color ? "border-primary ring-2 ring-primary/40 scale-110" : "border-panel-border hover:scale-105")} style={{ backgroundColor: color }} />
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded border border-panel-border overflow-hidden shrink-0 relative">
                      <input type="color" value={drawingColor} onChange={(e) => setDrawingColor(e.target.value)} className="absolute w-[150%] h-[150%] -top-1/4 -left-1/4 cursor-pointer" />
                    </div>
                    <Input value={drawingColor} onChange={(e) => setDrawingColor(e.target.value)} className="flex-1 bg-secondary text-xs font-mono" />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* CHARACTERS */}
        {activeTab === "characters" && (
          <div className="flex flex-col h-full">
            <div className="p-4 border-b border-panel-border">
              <h2 className="font-semibold text-foreground">Characters & Props</h2>
              <p className="text-xs text-muted-foreground mt-1">11 animations · 1 prop — drag onto canvas</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-5">
              {propGroups.map((group) => (
                <div key={group.label}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: group.color }}>{group.label}</span>
                    <div className="flex-1 h-px" style={{ backgroundColor: group.color + "22" }} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {group.assets.map((asset) => (
                      <div key={asset.id} draggable onDragStart={(e) => handleDragStart(e, asset)}
                        className="group flex items-center gap-2 p-2.5 rounded-lg border cursor-grab active:cursor-grabbing transition-all select-none"
                        style={{ backgroundColor: (asset.color ?? "#f97316") + "0d", borderColor: (asset.color ?? "#f97316") + "33" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = (asset.color ?? "#f97316") + "88"; (e.currentTarget as HTMLElement).style.backgroundColor = (asset.color ?? "#f97316") + "1a"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = (asset.color ?? "#f97316") + "33"; (e.currentTarget as HTMLElement).style.backgroundColor = (asset.color ?? "#f97316") + "0d"; }}
                      >
                        <div className="w-9 h-9 rounded-md flex items-center justify-center text-xl shrink-0" style={{ backgroundColor: (asset.color ?? "#f97316") + "22" }}>{asset.icon}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium leading-tight truncate capitalize" style={{ color: asset.color ?? "#e2e8f0" }}>{asset.name.replace(/_/g, " ")}</p>
                          <p className="text-[9px] mt-0.5" style={{ color: (asset.color ?? "#f97316") + "bb" }}>✦ dbl-click for actions</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {characterGroups.map((group) => (
                <div key={group.label}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: group.color }}>{group.label}</span>
                    <div className="flex-1 h-px" style={{ backgroundColor: group.color + "22" }} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {group.assets.map((asset) => (
                      <div key={asset.id} draggable onDragStart={(e) => handleDragStart(e, asset)}
                        className="group flex items-center gap-2 p-2.5 rounded-lg border cursor-grab active:cursor-grabbing transition-all select-none"
                        style={{ backgroundColor: (asset.color ?? "#6366f1") + "0d", borderColor: (asset.color ?? "#6366f1") + "33" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = (asset.color ?? "#6366f1") + "88"; (e.currentTarget as HTMLElement).style.backgroundColor = (asset.color ?? "#6366f1") + "1a"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = (asset.color ?? "#6366f1") + "33"; (e.currentTarget as HTMLElement).style.backgroundColor = (asset.color ?? "#6366f1") + "0d"; }}
                      >
                        <div className="w-9 h-9 rounded-md flex items-center justify-center text-xl shrink-0" style={{ backgroundColor: (asset.color ?? "#6366f1") + "22" }}>{asset.icon}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium leading-tight truncate capitalize" style={{ color: asset.color ?? "#e2e8f0" }}>{asset.name.replace(/_/g, " ")}</p>
                          <p className="text-[9px] text-muted-foreground mt-0.5">drag to canvas</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div onMouseDown={onResizeMouseDown} className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize z-30 group flex items-center justify-center" title="Drag to resize panel height">
        <div className="w-10 h-1 rounded-full bg-panel-border group-hover:bg-primary/50 transition-colors" />
      </div>
    </div>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────
function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={cn("flex flex-col items-center justify-center w-full h-12 rounded-xl transition-all", active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}>
      {icon}
      <span className="text-[10px] mt-1 font-medium">{label}</span>
    </button>
  );
}

function UploadButton({ label, icon, accept, onChange }: { label: string; icon: React.ReactNode; accept: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-row items-center justify-center gap-4 p-4 rounded-xl border border-dashed border-panel-border bg-secondary/10 hover:bg-secondary/30 hover:border-primary/50 transition-all cursor-pointer" onClick={() => inputRef.current?.click()}>
      {icon}
      <span className="text-[0.85rem] font-medium">{label}</span>
      <input ref={inputRef} type="file" accept={accept} multiple onChange={onChange} className="hidden" />
    </div>
  );
}