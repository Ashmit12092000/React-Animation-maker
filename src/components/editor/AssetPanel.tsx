import { useState, useRef, useEffect, useCallback } from "react";
import {
  useEditorStore,
  sampleAssets, // Re-exported from updated editorStore
  fontStyles,   // Re-exported from updated editorStore
} from "@/stores/editorStore";
import type { Asset } from "@/types"; // Import Asset from types/index
import { cn } from "../../utils/utils";
import {
  Box,
  Image as ImageIcon,
  Type,
  Music,
  Upload,
  Video,
  Layers,
  Palette,
  MousePointer2,
  Menu,
  X,
  ChevronRight,
  ChevronLeft,
  Pencil,
} from "lucide-react"; // Added/Renamed icons for clarity
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

// 1. Define High-Level Categories
type PanelTab = "elements" | "text" | "media" | "characters" | "draw";

// icon field repurposed as emoji preview; name must match DragonBones animation name exactly
type CharacterGroup = { label: string; color: string; assets: Asset[] };

// ── Props ─────────────────────────────────────────────────────────────────────
const propGroups: CharacterGroup[] = [
  {
    label: "Props",
    color: "#f97316",
    assets: [
      { id: "prop-chair",      name: "chair",      type: "prop" as any, icon: "🪑", color: "#f97316" },
      { id: "prop-tshirt",     name: "tshirt",     type: "prop" as any, icon: "👕", color: "#f97316" },
      { id: "prop-car",        name: "car",         type: "prop" as any, icon: "🚗", color: "#f97316" },
      { id: "prop-food",       name: "food",        type: "prop" as any, icon: "🍽️", color: "#f97316" },
      { id: "prop-long_broom", name: "long_broom",  type: "prop" as any, icon: "🧹", color: "#f97316" },
      { id: "prop-cup",        name: "cup",         type: "prop" as any, icon: "☕", color: "#f97316" },
    ],
  },
];

const characterGroups: CharacterGroup[] = [
  {
    label: "Locomotion",
    color: "#6366f1",
    assets: [
      { id: 'char-idle',  name: 'Idle',  type: 'character', icon: '🧍', color: '#6366f1' },
      { id: 'char-walk',  name: 'walk',  type: 'character', icon: '🚶', color: '#22c55e' },
      { id: 'char-run',   name: 'run',   type: 'character', icon: '🏃', color: '#f97316' },
      { id: 'char-jump',  name: 'jump',  type: 'character', icon: '🦘', color: '#ec4899' },
    ],
  },
  {
    label: "Morning / Rest",
    color: "#f59e0b",
    assets: [
      { id: 'char-yawn',           name: 'yawn',           type: 'character', icon: '🥱', color: '#f59e0b' },
      { id: 'char-stretch',        name: 'stretch',        type: 'character', icon: '🙆', color: '#f59e0b' },
      { id: 'char-rub_eyes',       name: 'rub_eyes',       type: 'character', icon: '😴', color: '#f59e0b' },
      { id: 'char-swing_legs_out', name: 'swing_legs_out', type: 'character', icon: '🛏️', color: '#f59e0b' },
      { id: 'char-put_on_shirt',   name: 'put_on_shirt',   type: 'character', icon: '👕', color: '#f59e0b' },
    ],
  },
  {
    label: "Activity",
    color: "#10b981",
    assets: [
      { id: 'char-flip_food',   name: 'flip_food',   type: 'character', icon: '🍳', color: '#10b981' },
      { id: 'char-eat',         name: 'eat',         type: 'character', icon: '🍽️', color: '#10b981' },
      { id: 'char-drink',       name: 'drink',       type: 'character', icon: '☕', color: '#10b981' },
      { id: 'char-wipe_table',  name: 'wipe_table',  type: 'character', icon: '🧹', color: '#10b981' },
      { id: 'char-read_book',   name: 'read_book',   type: 'character', icon: '📖', color: '#10b981' },
      { id: 'char-look_up',     name: 'look_up',     type: 'character', icon: '👀', color: '#10b981' },
      { id: 'char-desk_stretch',name: 'desk_stretch',type: 'character', icon: '💺', color: '#10b981' },
      { id: 'char-pick_up_box', name: 'pick_up_box', type: 'character', icon: '📦', color: '#10b981' },
    ],
  },
  {
    label: "Posture",
    color: "#8b5cf6",
    assets: [
      { id: 'char-sit_down',    name: 'sit_down',    type: 'character', icon: '🪑', color: '#8b5cf6' },
      { id: 'char-cross_legs',  name: 'cross_legs',  type: 'character', icon: '🧘', color: '#8b5cf6' },
      { id: 'char-sit_idle',    name: 'sit_idle',    type: 'character', icon: '😌', color: '#8b5cf6' },
      { id: 'char-lay_down',    name: 'lay_down',    type: 'character', icon: '🛌', color: '#8b5cf6' },
      { id: 'char-pull_blanket',name: 'pull_blanket',type: 'character', icon: '🛏️', color: '#8b5cf6' },
      { id: 'char-fall_asleep', name: 'fall_asleep', type: 'character', icon: '💤', color: '#8b5cf6' },
    ],
  },
  {
    label: "Social",
    color: "#e879f9",
    assets: [
      { id: 'char-handshake',  name: 'handshake',  type: 'character', icon: '🤝', color: '#e879f9' },
      { id: 'char-wave',       name: 'wave',       type: 'character', icon: '👋', color: '#e879f9' },
      { id: 'char-point',      name: 'point',      type: 'character', icon: '👉', color: '#e879f9' },
      { id: 'char-nod',        name: 'nod',        type: 'character', icon: '🙂', color: '#e879f9' },
      { id: 'char-shake_head', name: 'shake_head', type: 'character', icon: '🙅', color: '#e879f9' },
    ],
  },
];

// Flat list for drag operations (used in drag handler)
const characterAssets: Asset[] = characterGroups.flatMap(g => g.assets);


export function AssetPanel() {
  const [isOpen, setIsOpen] = useState(true); 

  // ── Vertical resize ──────────────────────────────────────────────────────────
  // null = full height (h-full); number = explicit px height
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const isDraggingV = useRef(false);
  const dragStartY  = useRef(0);
  const dragStartH  = useRef(0);
  const panelRef    = useRef<HTMLDivElement>(null);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingV.current  = true;
    dragStartY.current   = e.clientY;
    dragStartH.current   = panelRef.current?.offsetHeight ?? window.innerHeight;

    const onMove = (ev: MouseEvent) => {
      if (!isDraggingV.current) return;
      const delta  = ev.clientY - dragStartY.current;
      const newH   = Math.max(120, Math.min(window.innerHeight - 40, dragStartH.current + delta));
      setPanelHeight(newH);
    };
    const onUp = () => {
      isDraggingV.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }, []);

  useEffect(() => {
    const checkScreenSize = () => {
      const isDesktop = window.innerWidth >= 768;
      setIsOpen(isDesktop); // Open on desktop, closed on mobile
    };
    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);
    return () => window.removeEventListener("resize", checkScreenSize);
  }, []);

  // -- Text State --
  const [textContent, setTextContent] = useState("Hello");
  const [textColor, setTextColor] = useState("#FFFFFF");
  const [fontSize, setFontSize] = useState(32);
  const [fontFamily, setFontFamily] = useState("Arial");

  // -- Asset State --
  const [activeAssetType, setActiveAssetType] = useState<"item" | "background">(
    "item",
  );

  // Ensure tab state is created before any early returns so hooks order is stable
  const [activeTab, setActiveTab] = useState<PanelTab>("elements");

  // -- Store Hooks --
  const {
    addAudioTrack,
    tracks,
    addUploadedAsset,
    addVideoTrack,
    uploadedAssets,
    drawingEnabled,
    drawingColor,
    drawingBrushSize,
    setDrawingEnabled,
    setDrawingColor,
    setDrawingBrushSize,
  } = useEditorStore(); // Add addVideoTrack
  
  // Use uploadedAssets for the library view, separated from active tracks
  const audioAssets = uploadedAssets.filter((a) => a.type === "audio");
  const videoAssets = uploadedAssets.filter((a) => a.type === "video");

  const filteredAssets = sampleAssets.filter((a) => a.type === activeAssetType);

  // --- Handlers (Kept mostly same, just organized) ---
  const handleDragStart = (e: React.DragEvent, asset: Asset) => {
    e.dataTransfer.setData("asset", JSON.stringify(asset));
  };

  const handleSetBackground = (color: string) => {
    const setBgFn = (window as any).__setBackground;
    if (setBgFn) setBgFn(color);
  };

  const handleRemoveBackground = () => {
    const removeBgFn = (window as any).__removeBackground;
    if (removeBgFn) removeBgFn();
  };

  const handleAddText = () => {
    const addTextFn = (window as any).__addTextToCanvas;
    if (addTextFn) addTextFn(textContent, textColor, fontSize, fontFamily);
  };

  const handleMediaUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: "audio" | "video" | "image",
  ) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file, index) => {
      const url = URL.createObjectURL(file);

      // Strict MIME/extension checks
      const isMp3 =
        file.type === "audio/mpeg" || file.name.toLowerCase().endsWith(".mp3");
      const isMp4 =
        file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4");
      const isJpeg =
        file.type === "image/jpeg" ||
        file.name.toLowerCase().endsWith(".jpg") ||
        file.name.toLowerCase().endsWith(".jpeg");
      const isPng =
        file.type === "image/png" || file.name.toLowerCase().endsWith(".png");

      if (type === "audio" && isMp3) {
        // Create asset for library
        const asset: Asset = {
          id: `audio-${Date.now()}-${index}`,
          name: file.name,
          type: "audio",
          src: url,
          color: "",
          icon: "🎵",
        };
        addUploadedAsset(asset);  
      } else if (type === "image" && (isJpeg || isPng)) {
        const asset: Asset = {
          id: `image-${Date.now()}-${index}`,
          name: file.name,
          type: "item",
          color: "",
          icon: "🖼️",
          src: url,
        };
        addUploadedAsset(asset);
      } else if (type === "video" && isMp4) {
        // Create asset for library
        const asset: Asset = {
          id: `video-${Date.now()}-${index}`,
          name: file.name,
          type: "video",
          src: url,
          color: "",
          icon: "🎥",
        };
        addUploadedAsset(asset);
      } else {
        console.warn("Unsupported file type:", file.name, file.type);
      }
    });
    e.target.value = "";
  };

  const handleLeftNavClick = (tab: PanelTab) => {
    if (activeTab === tab) {
      // toggle open/close but keep the active tab selected so reopening is instant
      setIsOpen((s) => !s);
    } else {
      // set the tab first so content exists for the open animation, then open
      setActiveTab(tab);
      setIsOpen(true);
    }
  };

  const drawColors = [
    "#ffffff",
    "#f87171",
    "#fbbf24",
    "#34d399",
    "#60a5fa",
    "#a78bfa",
    "#f472b6",
    "#111827",
  ];

  const drawSizes = [2, 4, 8, 12, 18];

  return (
    <div
      ref={panelRef}
      style={panelHeight !== null ? { height: panelHeight } : undefined}
      className={`relative flex ${panelHeight !== null ? "" : "h-full"} ${isOpen ? "w-80" : "w-[80px]"} bg-panel border-r border-panel-border transition-all duration-300 ease-in-out overflow-hidden flex-col`}
    >
      {/* Expand button when collapsed */}

      <div
        className={
          "absolute top-2 right-0 z-20 transition-all duration-50 ease-in-out" +
          (isOpen ? " opacity-100 visible" : " opacity-0 invisible")
        }
      >
        <button
          onClick={() => setIsOpen(false)}
          className={
            "w-10 h-10 flex items-center justify-center bg-panel rounded-md shadow-sm transition-transform duration-100 hover:scale-105"
          }
          aria-label="Close panel"
        >
          <ChevronLeft className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>

      {/* --- LEFT NAVIGATION RAIL (w-16) --- */}
      <div className="w-[80px] px-4 flex flex-col items-center py-4 border-r border-panel-border bg-panel gap-4">
        <NavButton
          active={activeTab === "elements"}
          onClick={() => handleLeftNavClick("elements")}
          icon={<Box className="w-5 h-5" />}
          label="Elements"
        />
        <NavButton
          active={activeTab === "text"}
          onClick={() => handleLeftNavClick("text")}
          icon={<Type className="w-5 h-5" />}
          label="Text"
        />
         <NavButton
          active={activeTab === "characters"}
          onClick={() => handleLeftNavClick("characters")}
          icon={<Layers className="w-5 h-5" />}
          label="Characters"
        />
        <NavButton
          active={activeTab === "media"}
          onClick={() => handleLeftNavClick("media")}
          icon={<Upload className="w-5 h-5" />}
          label="Uploads"
        />
        <NavButton
          active={activeTab === "draw"}
          onClick={() => handleLeftNavClick("draw")}
          icon={<Pencil className="w-5 h-5" />}
          label="Draw"
        />
      </div>

      <div
        className={`flex-1 flex flex-col h-full bg-secondary/10 overflow-hidden transition-all duration-100 ease-in-out ${
          isOpen
            ? "opacity-100 translate-x-0"
            : "opacity-0 -translate-x-2 pointer-events-none"
        }`}
      >
        {/* -- ELEMENTS PANEL -- */}
        {activeTab === "elements" && (
          <div className="flex flex-col h-full">
            <div className="p-4 border-b border-panel-border">
              <h2 className="font-semibold text-foreground mb-4">Elements</h2>
              {/* Sub-Tabs for Elements */}
              <div className="flex bg-secondary/50 p-1 rounded-lg">
                <button
                  onClick={() => setActiveAssetType("item")}
                  className={cn(
                    "flex-1 text-xs py-1.5 rounded-md transition-all",
                    activeAssetType === "item"
                      ? "bg-background shadow text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Items
                </button>
                <button
                  onClick={() => setActiveAssetType("background")}
                  className={cn(
                    "flex-1 text-xs py-1.5 rounded-md transition-all",
                    activeAssetType === "background"
                      ? "bg-background shadow text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Backgrounds
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              {activeAssetType === "item" ? (
                <div className="grid grid-cols-2 gap-3">
                  {/* Items Grid */}
                  {[...filteredAssets, ...uploadedAssets.filter(a => a.type === "item")].map((asset) => (
                    <div
                      key={asset.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, asset)}
                      className="group relative aspect-square rounded-xl bg-secondary border border-panel-border hover:border-primary/50 cursor-grab active:cursor-grabbing overflow-hidden transition-all"
                    >
                      {asset.src ? (
                        <img
                          src={asset.src}
                          alt={asset.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div
                          className="w-full h-full flex items-center justify-center text-3xl"
                          style={{ backgroundColor: asset.color + "33" }}
                        >
                          {asset.icon}
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-black/60 p-1 translate-y-full group-hover:translate-y-0 transition-transform">
                        <p className="text-[10px] text-white text-center truncate">
                          {asset.name}
                        </p>
                      </div>
                    </div>
                  ))}

                  {/* Quick Upload Button in Grid */}
                  <label className="cursor-pointer aspect-square rounded-xl border-2 border-dashed border-panel-border hover:border-primary/50 flex flex-col items-center justify-center bg-secondary/20 hover:bg-secondary/40 transition-all">
                    <Upload className="w-6 h-6 text-muted-foreground mb-2" />
                    <span className="text-[10px] text-muted-foreground">
                      Upload
                    </span>
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg"
                      onChange={(e) => handleMediaUpload(e, "image")}
                      className="hidden"
                    />
                  </label>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Backgrounds Logic */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRemoveBackground}
                    className="w-full text-xs text-red-400 hover:text-red-500 hover:bg-red-500/10 border-red-500/20"
                  >
                    Remove Background
                  </Button>
                  <div className="grid grid-cols-3 gap-2">
                    {/* Color Assets */}
                    {filteredAssets.map((asset) => (
                      <button
                        key={asset.id}
                        onClick={() => handleSetBackground(asset.color)}
                        className="aspect-square rounded-md border border-transparent hover:scale-105 transition-transform"
                        style={{ backgroundColor: asset.color }}
                      />
                    ))}
                    {/* Custom Color */}
                    <div className="relative aspect-square rounded-md overflow-hidden bg-gradient-to-br from-red-500 via-yellow-500 to-blue-500 hover:scale-105 transition-transform cursor-pointer">
                      <input
                        type="color"
                        onChange={(e) => handleSetBackground(e.target.value)}
                        className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* -- TEXT PANEL -- */}
        {activeTab === "text" && (
          <div className="p-4 flex flex-col h-full">
            <h2 className="font-semibold text-foreground mb-6">Add Text</h2>

            <div className="space-y-6 overflow-y-auto custom-scrollbar">
              <div className="space-y-2">
                <Label className="text-xs">Content</Label>
                <Input
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  className="bg-secondary border-panel-border"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Color</Label>
                  <div className="flex gap-2">
                    <div className="w-9 h-9 rounded border border-panel-border overflow-hidden shrink-0 relative">
                      <input
                        type="color"
                        value={textColor}
                        onChange={(e) => setTextColor(e.target.value)}
                        className="absolute w-[150%] h-[150%] -top-1/4 -left-1/4 cursor-pointer"
                      />
                    </div>
                    <Input
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="flex-1 bg-secondary text-xs font-mono"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Size</Label>
                  <Input
                    type="number"
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="bg-secondary"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Font Family</Label>
                <Select value={fontFamily} onValueChange={setFontFamily}>
                  <SelectTrigger className="bg-secondary border-panel-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fontStyles.map((f) => (
                      <SelectItem key={f} value={f}>
                        <span style={{ fontFamily: f }}>{f}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={handleAddText} className="w-full mt-4" size="lg">
                Add Text to Canvas
              </Button>
            </div>
          </div>
        )}

        {/* -- MEDIA PANEL (Combined Audio/Video) -- */}
        {activeTab === "media" && (
          <div className="flex flex-col h-full">
            <div className="p-4 border-b border-panel-border">
              <h2 className="font-semibold text-foreground">Media</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Audio & Video tracks
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
              {/* Upload Buttons */}
              <div className="flex flex-col gap-2 mb-6">
                <UploadButton
                  label="Upload Audio"
                  icon={<Music className="w-5 h-5 text-purple-400" />}
                  accept="audio/mpeg,.mp3"
                  onChange={(e) => handleMediaUpload(e, "audio")}
                />
                <UploadButton
                  label="Upload Video"
                  icon={<Video className="w-5 h-5 text-blue-400" />}
                  accept="video/mp4,.mp4"
                  onChange={(e) => handleMediaUpload(e, "video")}
                />
              </div>

              {/* Lists */}
              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                  Audio Library
                </h3>
                <div className="space-y-2">
                  {audioAssets.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">
                      No audio uploaded yet
                    </p>
                  )}
                  {audioAssets.map((asset) => (
                    <button
                      key={asset.id}
                      onClick={() => addAudioTrack(asset.name, asset.src!)}
                      className="w-full flex items-center gap-3 p-2 rounded bg-secondary/40 text-xs border border-transparent hover:border-purple-500/30 hover:bg-secondary/60 transition-colors text-left"
                      title="Click to add to timeline"
                    >
                      <Music className="w-3 h-3 text-purple-400 shrink-0" />
                      <span className="truncate">{asset.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                  Video Library
                </h3>
                <div className="space-y-2">
                  {videoAssets.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">
                      No videos uploaded yet
                    </p>
                  )}
                  {videoAssets.map((asset) => (
                    <div
                      key={asset.id}
                      className="flex gap-1"
                    >
                      <button
                        onClick={() => addVideoTrack(asset.name, asset.src!)}
                        className="flex-1 flex items-center gap-3 p-2 rounded bg-secondary/40 text-xs border border-transparent hover:border-blue-500/30 hover:bg-secondary/60 transition-colors text-left truncate"
                        title="Click to add to timeline"
                      >
                         <Video className="w-3 h-3 text-blue-400 shrink-0" />
                         <span className="truncate">{asset.name}</span>
                      </button>
                      <div
                        draggable
                        onDragStart={(e) => handleDragStart(e, asset)}
                        className="p-2 rounded bg-secondary/40 text-xs border border-transparent hover:bg-secondary/60 cursor-grab active:cursor-grabbing flex items-center justify-center"
                        title="Drag to canvas"
                      >
                         <MousePointer2 className="w-3 h-3 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "draw" && (
          <div className="flex flex-col h-full">
            <div className="p-4 border-b border-panel-border">
              <h2 className="font-semibold text-foreground">Draw</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Freehand pencil strokes
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
              <div className="space-y-2">
                <Label className="text-xs">Tool</Label>
                <Button
                  size="sm"
                  variant={drawingEnabled ? "default" : "outline"}
                  onClick={() => setDrawingEnabled(!drawingEnabled)}
                  className="w-full"
                >
                  {drawingEnabled ? "Drawing Enabled" : "Enable Drawing"}
                </Button>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Brush Size</Label>
                <div className="flex flex-wrap gap-2">
                  {drawSizes.map((size) => (
                    <Button
                      key={size}
                      size="sm"
                      variant={drawingBrushSize === size ? "default" : "outline"}
                      onClick={() => setDrawingBrushSize(size)}
                      className="px-3"
                    >
                      {size}px
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Color</Label>
                <div className="grid grid-cols-4 gap-2">
                  {drawColors.map((color) => (
                    <button
                      key={color}
                      onClick={() => setDrawingColor(color)}
                      className={cn(
                        "h-8 w-8 rounded border",
                        drawingColor === color
                          ? "border-primary ring-2 ring-primary/40"
                          : "border-panel-border",
                      )}
                      style={{ backgroundColor: color }}
                      aria-label={`Set draw color ${color}`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded border border-panel-border overflow-hidden shrink-0 relative">
                    <input
                      type="color"
                      value={drawingColor}
                      onChange={(e) => setDrawingColor(e.target.value)}
                      className="absolute w-[150%] h-[150%] -top-1/4 -left-1/4 cursor-pointer"
                    />
                  </div>
                  <Input
                    value={drawingColor}
                    onChange={(e) => setDrawingColor(e.target.value)}
                    className="flex-1 bg-secondary text-xs font-mono"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* -- CHARACTERS PANEL -- */}
        {activeTab === "characters" && (
          <div className="flex flex-col h-full">
            <div className="p-4 border-b border-panel-border">
              <h2 className="font-semibold text-foreground">Characters & Props</h2>
              <p className="text-xs text-muted-foreground mt-1">
                28 animations · 6 props — drag onto canvas
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-5">
              {/* ── Props ── */}
              {propGroups.map((group) => (
                <div key={group.label}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: group.color }}>
                      {group.label}
                    </span>
                    <div className="flex-1 h-px" style={{ backgroundColor: group.color + "22" }} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {group.assets.map((asset) => (
                      <div
                        key={asset.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, asset)}
                        className="group flex items-center gap-2 p-2.5 rounded-lg border cursor-grab active:cursor-grabbing transition-all select-none"
                        style={{ backgroundColor: (asset.color ?? "#f97316") + "0d", borderColor: (asset.color ?? "#f97316") + "33" }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.borderColor = (asset.color ?? "#f97316") + "88";
                          (e.currentTarget as HTMLElement).style.backgroundColor = (asset.color ?? "#f97316") + "1a";
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.borderColor = (asset.color ?? "#f97316") + "33";
                          (e.currentTarget as HTMLElement).style.backgroundColor = (asset.color ?? "#f97316") + "0d";
                        }}
                      >
                        <div className="w-9 h-9 rounded-md flex items-center justify-center text-xl shrink-0" style={{ backgroundColor: (asset.color ?? "#f97316") + "22" }}>
                          {asset.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium leading-tight truncate capitalize" style={{ color: asset.color ?? "#e2e8f0" }}>
                            {asset.name.replace(/_/g, " ")}
                          </p>
                          <p className="text-[9px] text-muted-foreground mt-0.5">drag to canvas</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {/* ── Character Animations ── */}
              {characterGroups.map((group) => (
                <div key={group.label}>
                  {/* Group header */}
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: group.color }}
                    />
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: group.color }}
                    >
                      {group.label}
                    </span>
                    <div className="flex-1 h-px" style={{ backgroundColor: group.color + '22' }} />
                  </div>

                  {/* Grid of animation cards */}
                  <div className="grid grid-cols-2 gap-2">
                    {group.assets.map((asset) => (
                      <div
                        key={asset.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, asset)}
                        className="group flex items-center gap-2 p-2.5 rounded-lg border cursor-grab active:cursor-grabbing transition-all select-none"
                        style={{
                          backgroundColor: (asset.color ?? '#6366f1') + '0d',
                          borderColor: (asset.color ?? '#6366f1') + '33',
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.borderColor = (asset.color ?? '#6366f1') + '88';
                          (e.currentTarget as HTMLElement).style.backgroundColor = (asset.color ?? '#6366f1') + '1a';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.borderColor = (asset.color ?? '#6366f1') + '33';
                          (e.currentTarget as HTMLElement).style.backgroundColor = (asset.color ?? '#6366f1') + '0d';
                        }}
                      >
                        <div
                          className="w-9 h-9 rounded-md flex items-center justify-center text-xl shrink-0"
                          style={{ backgroundColor: (asset.color ?? '#6366f1') + '22' }}
                        >
                          {asset.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className="text-[11px] font-medium leading-tight truncate capitalize"
                            style={{ color: asset.color ?? '#e2e8f0' }}
                          >
                            {asset.name.replace(/_/g, ' ')}
                          </p>
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

      {/* ── Vertical resize handle ── */}
      <div
        onMouseDown={onResizeMouseDown}
        className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize z-30 group flex items-center justify-center"
        title="Drag to resize panel height"
      >
        <div className="w-10 h-1 rounded-full bg-panel-border group-hover:bg-primary/50 transition-colors" />
      </div>
    </div>
  );
}

// --- Helper Components ---

function NavButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center w-full h-12 rounded-xl transition-all",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      {icon}
      <span className="text-[10px] mt-1 font-medium">{label}</span>
    </button>
  );
}

function UploadButton({
  label,
  icon,
  accept,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  accept: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className="flex flex-row items-center justify-center gap-4 p-4 rounded-xl border border-dashed border-panel-border bg-secondary/10 hover:bg-secondary/30 hover:border-primary/50 transition-all cursor-pointer"
      onClick={() => inputRef.current?.click()}
    >
      {icon}
      <span className="text-[0.85rem] font-medium">{label}</span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        onChange={onChange}
        className="hidden"
      />
    </div>
  );
}