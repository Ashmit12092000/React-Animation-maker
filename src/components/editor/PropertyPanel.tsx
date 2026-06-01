import { useEffect, useState } from "react";
import { useEditorStore, fontStyles } from "@/stores/editorStore";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Move, RotateCw, Maximize2, Eye } from "lucide-react";
import { TTSPanel } from "./TTSPanel";
import { LayersPanel } from "./LayersPanel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function PropertyPanel() {
  const [isOpen, setIsOpen] = useState(true);

  // Auto-open on desktop, close on mobile
  useEffect(() => {
    const checkScreenSize = () => {
      const isDesktop = window.innerWidth >= 768;
      setIsOpen(isDesktop);
    };
    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);
    return () => window.removeEventListener("resize", checkScreenSize);
  }, []);

  const {
    selectedObject,
    selectedObjectId,
    tracks,
    canvas,
    flipObject,
    updateTrack,
    updateObjectProperty,
    setImageFilters,
  } = useEditorStore();

  const [properties, setProperties] = useState({
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    opacity: 1,
    fill: "#000000" as any,
    fontSize: 32,
    fontFamily: "Arial",
    name: "",
    imageFilters: [] as string[],
  });

  const syncProperties = () => {
    if (selectedObject) {
      const track = selectedObjectId
        ? tracks.find((t) => t.id === selectedObjectId)
        : null;
      const imageFilters =
        track?.imageFilters || (selectedObject as any)._imageFilters || [];
      setProperties({
        left: Math.round(selectedObject.left || 0),
        top: Math.round(selectedObject.top || 0),
        scaleX: Number((selectedObject.scaleX || 1).toFixed(2)),
        scaleY: Number((selectedObject.scaleY || 1).toFixed(2)),
        angle: Math.round(selectedObject.angle || 0),
        opacity: Math.max(selectedObject.opacity ?? 1, 0.001),
        fill: selectedObject.fill || "#000000",
        fontSize: (selectedObject as any).fontSize || 32,
        fontFamily: (selectedObject as any).fontFamily || "Arial",
        name:
          (selectedObject as any)._assetName ||
          (selectedObject as any).name ||
          "",
        imageFilters,
      });
    } else {
      // reset all properties when nothing is selected to avoid showing stale values
      setProperties({
        left: 0,
        top: 0,
        scaleX: 1,
        scaleY: 1,
        angle: 0,
        opacity: 1,
        fill: "#000000",
        fontSize: 32,
        fontFamily: "Arial",
        name: "",
        imageFilters: [],
      });
    }
  };

  useEffect(() => {
    syncProperties();
  }, [selectedObject, selectedObjectId]);

  // Real-time updates during object modifications
  useEffect(() => {
    if (!canvas || !selectedObject) return;

    const handleUpdate = (e: any) => {
      if (e.target === selectedObject) {
        syncProperties();
      }
    };

    canvas.on("object:moving", handleUpdate);
    canvas.on("object:scaling", handleUpdate);
    canvas.on("object:rotating", handleUpdate);

    return () => {
      canvas.off("object:moving", handleUpdate);
      canvas.off("object:scaling", handleUpdate);
      canvas.off("object:rotating", handleUpdate);
    };
  }, [canvas, selectedObject]);

  const updateProperty = (prop: string, value: number | string) => {
    if (!selectedObject) return;

    let finalValue = value;
    if (prop === "opacity" && typeof value === "number") {
      finalValue = Math.max(value, 0.001);
    }

    // Update local state immediately for UI responsiveness
    setProperties((prev) => ({ ...prev, [prop]: finalValue }));

    // Send to store to handle History, Coordinates, and Keyframes
    updateObjectProperty(prop, finalValue);
  };

  const updateName = (newName: string) => {
    if (!selectedObject) return;
    (selectedObject as any)._assetName = newName;
    if (selectedObjectId) {
      updateTrack(selectedObjectId, { name: newName });
    }
    setProperties((prev) => ({ ...prev, name: newName }));
    canvas?.renderAll();
  };

  const objectName = selectedObject
    ? (selectedObject as any)._assetName || "Object"
    : "Object";

  // Live visual updates (no history) while dragging
  const handleSliderChange = (prop: string, v: number) => {
    // update UI immediately
    setProperties((prev) => ({ ...prev, [prop]: v }));

    // apply to canvas object for instant visual feedback (no checkpoint)
    if (selectedObject && canvas) {
      selectedObject.set(prop as any, v as any);
      // ensure coords update when relevant
      if (prop === "angle") selectedObject.setCoords();
      canvas.requestRenderAll();
    }
  };

  // Commit change once on release (creates checkpoint + keyframe)
  const handleSliderCommit = (prop: string, v: number) => {
    updateObjectProperty(prop, v);
  };

  const filterOptions = [
    { key: "grayscale", label: "Grayscale" },
    { key: "sepia", label: "Sepia" },
    { key: "vintage", label: "Vintage" },
    { key: "blur", label: "Blur" },
    { key: "contrast", label: "Contrast" },
    { key: "brightness", label: "Brightness" },
  ];

  const isImage =
    !!selectedObject &&
    (selectedObject as any).customType !== "video" &&
    (((selectedObject as any).type === "image") ||
      (selectedObject as any).customType === "image" ||
      (selectedObject as any).customType === "background");

  const toggleFilter = (key: string) => {
    if (!selectedObject) return;
    const nextFilters = properties.imageFilters.includes(key)
      ? properties.imageFilters.filter((f) => f !== key)
      : [...properties.imageFilters, key];
    setProperties((prev) => ({ ...prev, imageFilters: nextFilters }));
    setImageFilters(nextFilters);
  };

  return (
    <div className="relative h-full">
      {/* Canva-style toggle button 
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className={`
          absolute top-1/2 -translate-y-1/2 z-50
          w-9 h-14 flex items-center justify-center
          bg-panel border border-panel-border rounded-l-lg shadow-md
          transition-all duration-300 ease-in-out
          ${isOpen ? "right-64" : "right-0"}
        `}
        aria-label="Toggle properties panel"
      >
        {isOpen ? (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronLeft className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
      */}

      {/* Property Panel */}
      <div
        className={`
          relative top-0 right-0 h-full w-64 bg-panel border-l border-panel-border
          transition-transform duration-300 ease-in-out
          ${isOpen ? "translate-x-0" : "translate-x-full"}
        `}
      >
        <div className="flex flex-col h-full bg-secondary/10 overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b border-panel-border">
            <h2 className="text-sm font-semibold text-foreground">
              Properties
            </h2>

            {/* Editable name */}
            {selectedObject ? (
              <div className="mt-1">
                <Input
                  value={properties.name}
                  placeholder="Object Name"
                  onChange={(e) => updateName(e.target.value)}
                  className="h-8 text-sm bg-secondary border-panel-border"
                  disabled={!selectedObject}
                />
                <p className="text-xs text-primary mt-1">Name</p>
              </div>
            ) : null}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
            {selectedObject ? (
              <>
                {/* Position */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Move className="w-4 h-4" />
                    <span className="text-xs font-medium uppercase tracking-wide">
                      Position
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">X</Label>
                      <Input
                        type="number"
                        value={properties.left}
                        onChange={(e) =>
                          updateProperty("left", Number(e.target.value))
                        }
                        className="h-8 bg-secondary border-panel-border text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Y</Label>
                      <Input
                        type="number"
                        value={properties.top}
                        onChange={(e) =>
                          updateProperty("top", Number(e.target.value))
                        }
                        className="h-8 bg-secondary border-panel-border text-sm"
                      />
                    </div>
                  </div>
                </div>

                {/* Size */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Maximize2 className="w-4 h-4" />
                    <span className="text-xs font-medium uppercase tracking-wide">
                      Size
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Width
                      </Label>
                      <Input
                        type="number"
                        value={Math.round(
                          selectedObject?.getScaledWidth() || 0,
                        )}
                        onChange={(e) => {
                          if (!selectedObject || !canvas) return;
                          const newWidth = Number(e.target.value);
                          const baseWidth = selectedObject.width || 1;
                          const newScaleX = newWidth / baseWidth;
                          updateProperty("scaleX", newScaleX);
                        }}
                        className="h-8 bg-secondary border-panel-border text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Height
                      </Label>
                      <Input
                        type="number"
                        value={Math.round(
                          selectedObject?.getScaledHeight() || 0,
                        )}
                        onChange={(e) => {
                          if (!selectedObject || !canvas) return;
                          const newHeight = Number(e.target.value);
                          const baseHeight = selectedObject.height || 1;
                          const newScaleY = newHeight / baseHeight;
                          updateProperty("scaleY", newScaleY);
                        }}
                        className="h-8 bg-secondary border-panel-border text-sm"
                      />
                    </div>
                  </div>
                </div>

                {/* Scale */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Maximize2 className="w-4 h-4" />
                    <span className="text-xs font-medium uppercase tracking-wide">
                      Scale
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Scale X
                      </Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={properties.scaleX}
                        onChange={(e) =>
                          updateProperty("scaleX", Number(e.target.value))
                        }
                        className="h-8 bg-secondary border-panel-border text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Scale Y
                      </Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={properties.scaleY}
                        onChange={(e) =>
                          updateProperty("scaleY", Number(e.target.value))
                        }
                        className="h-8 bg-secondary border-panel-border text-sm"
                      />
                    </div>
                  </div>
                </div>
                {/* Rotation */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <RotateCw className="w-4 h-4" />
                    <span className="text-xs font-medium uppercase tracking-wide">
                      Rotation
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <Label className="text-xs text-muted-foreground">
                        Angle
                      </Label>
                      <span className="text-xs text-foreground">
                        {properties.angle}°
                      </span>
                    </div>
                    <Slider
                      value={[properties.angle]}
                      onValueChange={([v]) => handleSliderChange("angle", v)}
                      onValueCommit={([v]) => handleSliderCommit("angle", v)}
                      min={0}
                      max={360}
                      step={1}
                      className="py-2"
                    />
                  </div>
                </div>

                {/* Opacity */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Eye className="w-4 h-4" />
                    <span className="text-xs font-medium uppercase tracking-wide">
                      Opacity
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <Label className="text-xs text-muted-foreground">
                        Value
                      </Label>
                      <span className="text-xs text-foreground">
                        {Math.round(properties.opacity * 100)}%
                      </span>
                    </div>
                    <Slider
                      value={[properties.opacity]}
                      onValueChange={([v]) => handleSliderChange("opacity", v)}
                      onValueCommit={([v]) => handleSliderCommit("opacity", v)}
                      min={0}
                      max={1}
                      step={0.01}
                      className="py-2"
                    />
                  </div>
                </div>

                {isImage && (
                  <div className="space-y-3">
                    <span className="text-xs font-medium uppercase tracking-wide">
                      Image Filters
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      {filterOptions.map((filter) => {
                        const isActive = properties.imageFilters.includes(filter.key);
                        return (
                          <Button
                            key={filter.key}
                            size="sm"
                            variant={isActive ? "default" : "outline"}
                            onClick={() => toggleFilter(filter.key)}
                          >
                            {filter.label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Controls */}
                <div className="space-y-3">
                  <span className="text-xs font-medium uppercase tracking-wide">
                    Controls
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => flipObject("horizontal")}>
                      Flip H
                    </Button>
                    <Button size="sm" onClick={() => flipObject("vertical")}>
                      Flip V
                    </Button>
                  </div>
                </div>

                {/* Shape Color */}
                {(selectedObject?.type === "rect" ||
                  selectedObject?.type === "circle") && (
                  <div className="space-y-3">
                    <span className="text-xs font-medium uppercase tracking-wide">
                      Color
                    </span>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={properties.fill}
                        onChange={(e) => updateProperty("fill", e.target.value)}
                        className="w-8 h-8 rounded border border-panel-border cursor-pointer"
                      />
                      <Input
                        value={properties.fill}
                        onChange={(e) => updateProperty("fill", e.target.value)}
                        className="h-8 text-xs bg-secondary border-panel-border flex-1"
                      />
                    </div>
                  </div>
                )}

                {/* Text Properties */}
                {selectedObject?.type === "i-text" && (
                  <div className="space-y-3">
                    <span className="text-xs font-medium uppercase tracking-wide">
                      Text
                    </span>

                    <Input
                      type="number"
                      value={properties.fontSize}
                      onChange={(e) =>
                        updateProperty("fontSize", Number(e.target.value))
                      }
                      className="h-8 bg-secondary border-panel-border text-sm"
                    />

                    <Select
                      value={properties.fontFamily}
                      onValueChange={(value) =>
                        updateProperty("fontFamily", value)
                      }
                    >
                      <SelectTrigger className="h-8 text-sm bg-secondary border-panel-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {fontStyles.map((font) => (
                          <SelectItem
                            key={font}
                            value={font}
                            style={{ fontFamily: font }}
                          >
                            {font}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            ) : (
              // Empty/default view when nothing is selected
              <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
                No object selected
              </div>
            )}

            {/* TTS Panel — always visible at bottom */}
            <div className="mt-4 pt-4 border-t border-panel-border">
              <LayersPanel />
            </div>

            {/* TTS Panel — always visible at bottom */}
            <div className="mt-4 pt-4 border-t border-panel-border">
              <TTSPanel />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}