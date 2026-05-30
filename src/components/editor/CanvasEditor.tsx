import { useEffect, useRef, useCallback, useState } from "react";
import * as fabric from "fabric";
import {
  Canvas as FabricCanvas,
  Rect,
  Circle,
  FabricObject,
  IText,
  FabricImage,
  ActiveSelection,
  Ellipse,
  Triangle,
  Polygon,
  Path,
} from "fabric";
import * as PIXI from "pixi.js";
import { useEditorStore, type Asset } from "@/stores/editorStore";
import { ContextMenu } from "./ContextMenu";
import { PathDrawOverlay } from "./PathDrawOverlay";
import { PropActionPopup } from "./PropActionPopup";
import { loadCharacter, loadProp, hookPixiTicker } from "@/lib/dragonbonesRenderer";

(window as any).PIXI = PIXI;

export function CanvasEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixiCanvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const pixiAppRef = useRef<PIXI.Application | null>(null);
  const armatureDisplaysRef = useRef<import("dragonbones-pixijs").PixiArmatureDisplay[]>([]);

  // ── Prop action popup state ──────────────────────────────────────────────
  const [propPopup, setPropPopup] = useState<{
    propName: string;
    position: { x: number; y: number };
    canvasEl: HTMLCanvasElement | null;
    propTrackId: string;
  } | null>(null);


  const {
    currentTime,
    setCanvas,
    setSelectedObject,
    addTrack,
    deleteSelected,
    copyObject,
    pasteObject,
    addUploadedAsset, // <-- new
    tracks,
    isPlaying,
    addKeyframeAtCurrentTime,
    captureState,
    contextMenu,    // Use store state
    setContextMenu, // Use store action
    drawingEnabled,
    drawingColor,
    drawingBrushSize,
    eraserEnabled,
    eraserSize,
  } = useEditorStore();
  // read saveCheckpoint directly when needed
  const { saveCheckpoint } = useEditorStore.getState
    ? useEditorStore.getState()
    : { saveCheckpoint: () => { } };

  useEffect(() => {
    if (!canvasRef.current || !pixiCanvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: 960,
      height: 540,
      backgroundColor: "#1a1a2e",
      selection: true,
      preserveObjectStacking: true,
      fireRightClick: true,
      stopContextMenu: true,
    });

    // Initialize PIXI app using modern v8 API
    (async () => {
      try {
        const pixiApp = new PIXI.Application();
        await pixiApp.init({
          width: 960,
          height: 540,
          canvas: pixiCanvasRef.current,
          antialias: true,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
          backgroundColor: 0x000000,
          backgroundAlpha: 0,
        });
        
        console.log("PIXI app initialized successfully");
        
        // Ensure the PIXI canvas is transparent
        if (pixiCanvasRef.current) {
          pixiCanvasRef.current.style.backgroundColor = 'transparent';
        }
        
        pixiAppRef.current = pixiApp;

        // Enable zIndex-based sorting so characters always render above props
        pixiApp.stage.sortableChildren = true;
        
        // Ensure ticker is running
        if (!pixiApp.ticker.started) {
          pixiApp.ticker.start();
          console.log("Started PIXI ticker");
        }
        
        // Tick the DragonBones factory on every frame (official runtime requirement)
        hookPixiTicker(pixiApp);
      } catch (err) {
        console.error("Failed to initialize PIXI app:", err);
      }
    })();

    fabricRef.current = canvas;
    setCanvas(canvas);

    const renderLoop = () => {
      if (canvas) {
        canvas.requestRenderAll();
        fabric.util.requestAnimFrame(renderLoop);
      }
    };
    fabric.util.requestAnimFrame(renderLoop);

    // --- Helper: Check for Locked Objects in Selection ---
    const handleSelectionLocks = () => {
      const activeObj = canvas.getActiveObject();
      if (!activeObj) return;

      // If multiple items are selected (ActiveSelection)
      if (activeObj.type === "activeSelection") {
        const group = activeObj as ActiveSelection;
        // Check if ANY child inside the group is locked
        const hasLockedObject = group
          .getObjects()
          .some((obj) => obj.lockMovementX || obj.lockMovementY);

        // If yes, lock the ENTIRE group movement/scaling/rotation
        group.set({
          lockMovementX: hasLockedObject,
          lockMovementY: hasLockedObject,
          lockRotation: hasLockedObject,
          lockScalingX: hasLockedObject,
          lockScalingY: hasLockedObject,
        });
      }
    };

    // --- Event Listeners ---

    // 1. Mouse Down: Handle Context Menu & Selection
    canvas.on("mouse:down", (opt) => {
      if (!(opt.e instanceof MouseEvent)) return;

      // Handle Right Click (Context Menu)
      if (opt.e.button === 2) {
        opt.e.preventDefault();
        opt.e.stopPropagation(); // FIX: Stop bubbling to prevent immediate close

        // Select the object right-clicked on
        if (opt.target) {
          canvas.setActiveObject(opt.target);
          setSelectedObject((opt.target as any)._customId, opt.target);
          canvas.renderAll();
        } else {
          canvas.discardActiveObject();
          setSelectedObject(null, null);
          canvas.renderAll();
        }

        // Re-check locks in case we just right-clicked a group
        handleSelectionLocks();

        setContextMenu({
          visible: true,
          x: opt.e.clientX,
          y: opt.e.clientY - 50,
        });
      } else {
        // Hide menu on left click
        setContextMenu({ visible: false, x: 0, y: 0 });
      }
    });

    canvas.on("selection:created", (e) => {
      handleSelectionLocks();

      const obj = e.selected?.[0];
      if (obj) {
        setSelectedObject((obj as any)._customId || null, obj);
      }

      // Ensure background stays back
      const bg = canvas
        .getObjects()
        .find((o) => (o as any).customType === "background");
      if (bg) canvas.sendObjectToBack(bg);
    });

    // ── Double-click on a prop → open PropActionPopup ───────────────────────
    canvas.on("mouse:dblclick", (opt) => {
      const target = opt.target;
      if (!target || (target as any).customType !== "prop") return;

      const propName: string = (target as any)._assetName ?? (target as any).propName ?? "";
      if (!propName) return;

      // Canvas centre of the prop proxy in canvas coords
      const cx = (target.left ?? 0) + (target.getScaledWidth() ?? 0) / 2;
      const cy = (target.top ?? 0);

      setPropPopup({
        propName,
        position: { x: cx, y: cy },
        canvasEl: canvasRef.current,
        propTrackId: (target as any)._customId ?? "",
      });
    });

    canvas.on("selection:updated", (e) => {
      handleSelectionLocks();
      const obj = e.selected?.[0];
      if (obj) {
        setSelectedObject((obj as any)._customId || null, obj);
      }
      const bg = canvas
        .getObjects()
        .find((o) => (o as any).customType === "background");
      if (bg) canvas.sendObjectToBack(bg);
    });

    canvas.on("selection:cleared", () => {
      setSelectedObject(null, null);
    });

    // Boundary Constraints
    canvas.on("object:moving", (e) => {
      const obj = e.target;
      if (!obj) return;

      if ((obj as any).customType === 'character') {
        const display = (obj as any).armatureDisplay;
        if (display) {
          const dbScale = (obj as any).dbScale ?? 1;
          const charW   = (obj as any).charW   ?? (obj.width  || 103);
          const charH   = (obj as any).charH   ?? (obj.height || 300);
          const userScaleX = obj.scaleX || 1;
          const userScaleY = obj.scaleY || 1;
          display.x = (obj.left || 0) + (charW * userScaleX) / 2;
          display.y = (obj.top  || 0) +  charH * userScaleY;
          display.scale.set(dbScale * Math.max(userScaleX, userScaleY));
        }
      }

      if ((obj as any).customType === 'prop') {
        const display = (obj as any).armatureDisplay;
        if (display) {
          const dbScale    = (obj as any).dbScale ?? 1;
          const userScale  = Math.max(obj.scaleX || 1, obj.scaleY || 1);
          const baseOffX   = (obj as any).propOffsetX ?? 0;
          const baseOffY   = (obj as any).propOffsetY ?? 0;
          display.x = (obj.left || 0) + baseOffX * userScale;
          display.y = (obj.top  || 0) + baseOffY * userScale;
          display.scale.set(dbScale * userScale);
        }
      }

      const cvs = obj.canvas!;
      const scaledWidth = obj.getScaledWidth();
      const scaledHeight = obj.getScaledHeight();

      // Simple boundary check
      if (obj.left! < 0) obj.left = 0;
      if (obj.top! < 0) obj.top = 0;
      if (obj.left! + scaledWidth > cvs.getWidth())
        obj.left = cvs.getWidth() - scaledWidth;
      if (obj.top! + scaledHeight > cvs.getHeight())
        obj.top = cvs.getHeight() - scaledHeight;
    });

    // 4. Object Modified/Added: Layer Management
    canvas.on("object:modified", (e) => {
      const target = e.target;
      if (target && (target as any)._customId) {
        // Use captureState instead of addKeyframeAtCurrentTime to support Undo without explicit animation
        captureState((target as any)._customId);
      }

      // Sync PIXI DragonBones armature position after move/scale
      if (target && (target as any).customType === "character") {
        const display = (target as any).armatureDisplay;
        if (display) {
          const dbScale = (target as any).dbScale ?? 1;
          const charW   = (target as any).charW   ?? (target.width  || 103);
          const charH   = (target as any).charH   ?? (target.height || 300);
          const userScaleX = target.scaleX || 1;
          const userScaleY = target.scaleY || 1;
          display.x = (target.left || 0) + (charW * userScaleX) / 2;
          display.y = (target.top  || 0) +  charH * userScaleY;
          display.scale.set(dbScale * Math.max(userScaleX, userScaleY));
        }
      }

      if (target && (target as any).customType === "prop") {
        const display = (target as any).armatureDisplay;
        if (display) {
          const dbScale   = (target as any).dbScale ?? 1;
          const userScale = Math.max(target.scaleX || 1, target.scaleY || 1);
          const baseOffX  = (target as any).propOffsetX ?? 0;
          const baseOffY  = (target as any).propOffsetY ?? 0;
          display.x = (target.left || 0) + baseOffX * userScale;
          display.y = (target.top  || 0) + baseOffY * userScale;
          display.scale.set(dbScale * userScale);
        }
      }

      const bg = canvas
        .getObjects()
        .find((o) => (o as any).customType === "background");
      if (bg) canvas.sendObjectToBack(bg);
    });

    canvas.on("object:added", () => {
      const bg = canvas
        .getObjects()
        .find((o) => (o as any).customType === "background");
      if (bg) canvas.sendObjectToBack(bg);
    });

    canvas.on("path:created", (opt) => {
      const path = opt.path;
      if (!path) return;

      const store = useEditorStore.getState();
      if (!store.drawingEnabled) return;

      // ── Eraser mode: EraserBrush handles erasing internally on the path objects.
      // The "path" emitted here is the eraser stroke itself — we don't want to add
      // it as a drawing track. Fabric's EraserBrush has already applied clip masks.
      if (store.eraserEnabled) {
        // Don't add to timeline — eraser strokes are not drawable objects
        return;
      }

      const pathId = `drawing_${Date.now()}`;
      (path as any)._customId = pathId;
      (path as any)._assetName = "Drawing";
      (path as any).customType = "drawing";
      (path as any).selectable = true;
      (path as any).evented = true;
      (path as any).stroke = store.drawingColor;
      (path as any).strokeWidth = store.drawingBrushSize;
      (path as any).fill = "";

      store.saveCheckpoint();
      store.addTrack({
        id: pathId,
        name: "Drawing",
        fabricObject: path,
        startTime: store.currentTime,
        endTime: store.currentTime + 5,
        keyframes: [],
        color: "green",
        initialState: {
          left: path.left || 0,
          top: path.top || 0,
          scaleX: path.scaleX || 1,
          scaleY: path.scaleY || 1,
          angle: path.angle || 0,
          opacity: path.opacity ?? 1,
        },
        type: "visual",
      });

      store.setSelectedObject(pathId, path, "object");
    });

    // Add cleanup for removed objects
   canvas.on("object:removed", (e) => {
      const obj = e.target;

      // ── DragonBones armature cleanup (character & prop) ──────────────────
      if (obj && ((obj as any).customType === "character" || (obj as any).customType === "prop")) {
        const display = (obj as any).armatureDisplay;
        if (display) {
          const pixiApp = pixiAppRef.current;
          if (pixiApp && pixiApp.stage.children.includes(display)) {
            pixiApp.stage.removeChild(display);
          }
          try { display.dispose(); } catch (_) {}
          // Remove from the tracking ref
          armatureDisplaysRef.current = armatureDisplaysRef.current.filter((d) => d !== display);
          (obj as any).armatureDisplay = null;
        }
      }

      if (obj && (obj as any).customType === "video") {
        const trackId = (obj as any)._customId;
        
        // 1. Check if the track still exists in the global store
        const trackExists = useEditorStore.getState().tracks.some((t) => t.id === trackId);

        // Only destroy the DOM element if track not in the store
        if (!trackExists) {
          const videoEl = (obj as any)._element as HTMLVideoElement;
          if (videoEl) {
            videoEl.pause();
            videoEl.src = "";
            videoEl.load();
            if (videoEl.parentNode) {
              videoEl.parentNode.removeChild(videoEl);
            }
          }
        }
      }
    });

    return () => {
      canvas.dispose();
      setCanvas(null);
    };
  }, [setCanvas, setSelectedObject]);

  // ── Helper: build a circular SVG cursor for the eraser ──────────────────
  const makeEraserCursor = (size: number) => {
    const r = Math.max(4, Math.round(size / 2));
    const dim = r * 2 + 4; // +4px padding so the ring isn't clipped
    const cx = r + 2;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${dim}' height='${dim}'><circle cx='${cx}' cy='${cx}' r='${r}' fill='rgba(255,255,255,0.15)' stroke='white' stroke-width='1.5'/><line x1='${cx}' y1='${cx - r + 3}' x2='${cx}' y2='${cx + r - 3}' stroke='white' stroke-width='1'/><line x1='${cx - r + 3}' y1='${cx}' x2='${cx + r - 3}' y2='${cx}' stroke='white' stroke-width='1'/></svg>`;
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${cx} ${cx}, crosshair`;
  };

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const upperEl = (canvas as any).upperCanvasEl as HTMLElement | undefined;

    // ── ERASER MODE ────────────────────────────────────────────────────────
    if (drawingEnabled && eraserEnabled) {
      // Use Fabric's built-in EraserBrush — it erases at the object/path level
      // so strokes survive the render loop (destination-out on lowerCanvasEl doesn't).
      try {
        const EraserBrush = (fabric as any).EraserBrush;
        if (EraserBrush) {
          const eraser = new EraserBrush(canvas);
          eraser.width = eraserSize;
          canvas.freeDrawingBrush = eraser;
        } else {
          // Fallback: use PencilBrush with canvas background color to simulate erasing
          const pencil = new fabric.PencilBrush(canvas);
          pencil.color = "#1a1a2e"; // match canvas background
          pencil.width = eraserSize;
          canvas.freeDrawingBrush = pencil;
        }
      } catch {
        // If EraserBrush fails, fallback gracefully
        const pencil = new fabric.PencilBrush(canvas);
        pencil.color = "#1a1a2e";
        pencil.width = eraserSize;
        canvas.freeDrawingBrush = pencil;
      }
      canvas.isDrawingMode = true;
      canvas.selection = false;

      // Show eraser cursor
      if (upperEl) {
        upperEl.style.cursor = makeEraserCursor(eraserSize);
      }
      return;
    }

    // ── DRAWING MODE ───────────────────────────────────────────────────────
    if (drawingEnabled && !eraserEnabled) {
      canvas.isDrawingMode = true;
      canvas.selection = false;
      const pencil = new fabric.PencilBrush(canvas);
      pencil.color = drawingColor;
      pencil.width = drawingBrushSize;
      canvas.freeDrawingBrush = pencil;

      // Show pencil crosshair cursor
      if (upperEl) {
        upperEl.style.cursor = "crosshair";
      }
      return;
    }

    // ── DEFAULT (no drawing) ───────────────────────────────────────────────
    canvas.isDrawingMode = false;
    canvas.selection = true;
    if (upperEl) {
      upperEl.style.cursor = "";
    }
  }, [drawingEnabled, drawingColor, drawingBrushSize, eraserEnabled, eraserSize]);

  // Context Menu Logging
  useEffect(() => {
    // console.log("Context menu state changed:", contextMenu);
  }, [contextMenu]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (
        (e.target as HTMLElement).tagName === "INPUT" ||
        (e.target as HTMLElement).tagName === "TEXTAREA"
      )
        return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "c") copyObject();
        else if (e.key === "v") pasteObject();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelected();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [copyObject, pasteObject, deleteSelected]);

  const createVideoElement = (url: string) => {
    const video = document.createElement("video");
    // const source = document.createElement("source"); // Not strictly necessary for blob URLs

    video.src = url;
    video.crossOrigin = "anonymous";
    video.muted = true; // Important for auto-play policies
    video.playsInline = true;
    video.loop = false; // Usually editor tracks shouldn't loop by default
    video.style.display = "none";

    // FIX 2: Pre-set dimensions to help Fabric if metadata is slow
    video.width = 480;
    video.height = 360;

    document.body.appendChild(video);
    return video;
  };

  const addAssetToCanvas = useCallback(
    (asset: Asset) => {
      if (!fabricRef.current) return;

      const id = `${asset.id}-${Date.now()}`;
      const baseLeft = 100 + Math.random() * 200;
      const baseTop = 100 + Math.random() * 200;

      const addObjectToCanvas = (
        obj: FabricObject,
        objId: string,
        objAsset: Asset,
      ) => {
        (obj as any)._customId = objId;
        (obj as any)._assetName = objAsset.name;
        (obj as any).customType = objAsset.type;

        fabricRef.current!.add(obj);
        fabricRef.current!.setActiveObject(obj);
        fabricRef.current!.renderAll();

        const initialState = {
          left: obj.left || 0,
          top: obj.top || 0,
          scaleX: obj.scaleX || 1,
          scaleY: obj.scaleY || 1,
          angle: obj.angle || 0,
          opacity: obj.opacity ?? 1,
        };

        const isImage =
          (obj as any).type === "image" || (obj as any).customType === "image";

        addTrack({
          id: objId,
          name: objAsset.name,
          fabricObject: obj,
          startTime: 0,
          endTime: 5,
          keyframes: [],
          color: "green",
          initialState,
          type: "visual",
          imageFilters: isImage ? (obj as any)._imageFilters || [] : undefined,
        });

        setSelectedObject(objId, obj);
      };

      if (asset.type === "item") {
        if (asset.src) {
          const img = new Image();
          img.onload = () => {
            const targetSize = 200;
            // Use runtime fabric.Image constructor
            const fabricImg = new FabricImage(img, {
              left: baseLeft,
              top: baseTop,
            });
            const scale = Math.min(
              targetSize / (img.width || targetSize),
              targetSize / (img.height || targetSize),
            );
            fabricImg.scale(scale);
            fabricImg.setCoords();
            addObjectToCanvas(fabricImg, id, asset);
          };
          img.src = asset.src!;
        } else {
          // ── Full shape library ────────────────────────────────────────────
          const cx = baseLeft + 80;
          const cy = baseTop + 80;
          const color = asset.color || "#4ecdc4";
          let obj: FabricObject;

          const makePolygon = (sides: number, radius: number) => {
            const pts = Array.from({ length: sides }, (_, i) => {
              const angle = (i * 2 * Math.PI) / sides - Math.PI / 2;
              return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
            });
            return new Polygon(pts, { fill: color, left: cx - radius, top: cy - radius });
          };

          const makeStar = (points: number, outerR: number, innerR: number) => {
            const pts: { x: number; y: number }[] = [];
            for (let i = 0; i < points * 2; i++) {
              const angle = (i * Math.PI) / points - Math.PI / 2;
              const r = i % 2 === 0 ? outerR : innerR;
              pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
            }
            return new Polygon(pts, { fill: color, left: cx - outerR, top: cy - outerR });
          };

          switch (asset.name) {
            case "Circle":
              obj = new Circle({ left: cx - 50, top: cy - 50, radius: 50, fill: color });
              break;
            case "Square":
              obj = new Rect({ left: cx - 50, top: cy - 50, width: 100, height: 100, fill: color, rx: 4, ry: 4 });
              break;
            case "Rectangle":
              obj = new Rect({ left: cx - 70, top: cy - 40, width: 140, height: 80, fill: color, rx: 4, ry: 4 });
              break;
            case "Triangle":
              obj = new Triangle({ left: cx - 55, top: cy - 50, width: 110, height: 100, fill: color });
              break;
            case "Ellipse":
              obj = new Ellipse({ left: cx - 70, top: cy - 40, rx: 70, ry: 40, fill: color });
              break;
            case "Pentagon":
              obj = makePolygon(5, 55);
              break;
            case "Hexagon":
              obj = makePolygon(6, 55);
              break;
            case "Octagon":
              obj = makePolygon(8, 55);
              break;
            case "Star":
              obj = makeStar(5, 55, 22);
              break;
            case "Star6":
              obj = makeStar(6, 55, 27);
              break;
            case "Arrow": {
              // Right-pointing arrow as SVG path
              const aw = 110, ah = 80, hw = 55, hh = 35, tw = 60, th = 28;
              const ax = cx - aw / 2, ay = cy - ah / 2;
              obj = new Path(
                `M ${ax} ${ay + (ah - th) / 2}` +
                `L ${ax + tw} ${ay + (ah - th) / 2}` +
                `L ${ax + tw} ${ay}` +
                `L ${ax + aw} ${ay + ah / 2}` +
                `L ${ax + tw} ${ay + ah}` +
                `L ${ax + tw} ${ay + (ah + th) / 2}` +
                `L ${ax} ${ay + (ah + th) / 2} Z`,
                { fill: color }
              );
              break;
            }
            case "Heart": {
              // Heart shape as SVG path centered at cx,cy
              obj = new Path(
                `M ${cx} ${cy + 30}` +
                `C ${cx - 60} ${cy - 10}, ${cx - 80} ${cy - 55}, ${cx} ${cy - 30}` +
                `C ${cx + 80} ${cy - 55}, ${cx + 60} ${cy - 10}, ${cx} ${cy + 30} Z`,
                { fill: color }
              );
              break;
            }
            case "Diamond":
              obj = new Polygon(
                [{ x: cx, y: cy - 60 }, { x: cx + 50, y: cy }, { x: cx, y: cy + 60 }, { x: cx - 50, y: cy }],
                { fill: color, left: cx - 50, top: cy - 60 }
              );
              break;
            case "Line":
              obj = new fabric.Line([cx - 60, cy, cx + 60, cy], {
                stroke: color,
                strokeWidth: 6,
                fill: color,
                strokeLineCap: "round",
              });
              break;
            default:
              obj = new Rect({ left: cx - 50, top: cy - 50, width: 100, height: 100, fill: color, rx: 4, ry: 4 });
          }
          addObjectToCanvas(obj, id, asset);
        }
    } else if (asset.type === "character") {
      // DragonBones AABB for this character: ~324w × 945h (feet at y=0)
      // Target: fit 300px tall on the 960×540 canvas
      const CHAR_DB_HEIGHT = 945;
      const CHAR_DB_WIDTH  = 324;
      const targetHeight   = 300;
      const dbScale        = targetHeight / CHAR_DB_HEIGHT;
      const charW          = Math.round(CHAR_DB_WIDTH * dbScale);  // ≈103px
      const charH          = targetHeight;

      // Semi-transparent proxy rect so the user can see/select/move the character.
      // The actual pixels are rendered by PIXI on the overlay canvas.
      const proxy = new Rect({
        left:        baseLeft,
        top:         baseTop,
        width:       charW,
        height:      charH,
        fill:        "rgba(100,100,255,0.08)",
        stroke:      "rgba(100,100,255,0.5)",
        strokeWidth: 1,
        strokeDashArray: [4, 4],
        rx: 4,
        ry: 4,
      });
      addObjectToCanvas(proxy, id, asset);

      (async () => {
        try {
          const pixiApp = pixiAppRef.current;
          if (!pixiApp) {
            console.error("[DragonBones] PIXI app not ready");
            return;
          }

          // loadCharacter handles singleton factory — safe to call multiple times
          const { display } = await loadCharacter(asset.name);

          display.scale.set(dbScale);
          // DragonBones origin (y=0) is at the feet; offset down by charH
          display.x = (proxy.left ?? baseLeft) + charW / 2;
          display.y = (proxy.top  ?? baseTop)  + charH;

          // Characters always render above props
          display.zIndex = 10;
          pixiApp.stage.addChild(display);

          // Store reference so we can sync position on move/scale
          (proxy as any).armatureDisplay = display;
          (proxy as any).dbScale         = dbScale;
          (proxy as any).charW           = charW;
          (proxy as any).charH           = charH;
          armatureDisplaysRef.current.push(display);

          // Record the initial animation name in the track so the popup knows
          // what state the character is currently in
          const startAnim = display.animation.lastAnimationName ?? asset.name;
          useEditorStore.getState().updateTrack(id, { characterAnimation: startAnim });

        } catch (err) {
          console.error("[DragonBones] Failed to load character:", err);
        }
      })();
    } else if (asset.type === ("prop" as any)) {
      // ── Prop armature (chair, tshirt, car, food, long_broom, cup) ───────────

      // ── Special case: chair uses a plain image (no DragonBones armature) ───
      if (asset.name === "chair") {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          // Target height matches the DragonBones chair proxy height (160px on 540px canvas)
          const TARGET_H = 160;
          const scale = TARGET_H / img.naturalHeight;
          const fabricImg = new FabricImage(img, {
            left: baseLeft,
            top:  baseTop,
            scaleX: scale,
            scaleY: scale,
          });
          // Mark as prop so PropActionPopup, applyKeyframesAtTime, etc. all work
          (fabricImg as any).customType = "prop";
          addObjectToCanvas(fabricImg, id, asset);
        };
        img.onerror = () => console.error("[Chair] Failed to load chair_new.png");
        img.src = "/chair_new.png";
        return; // skip DragonBones path below
      }

      // Build a placeholder proxy rect first; swap in the PIXI display async.
      const PLACEHOLDER_W = 120;
      const PLACEHOLDER_H = 100;

      const proxy = new Rect({
        left:        baseLeft,
        top:         baseTop,
        width:       PLACEHOLDER_W,
        height:      PLACEHOLDER_H,
        fill:        "rgba(249,115,22,0.08)",
        stroke:      "rgba(249,115,22,0.5)",
        strokeWidth: 1,
        strokeDashArray: [4, 4],
        rx: 4,
        ry: 4,
      });
      addObjectToCanvas(proxy, id, asset);

      (async () => {
        try {
          const pixiApp = pixiAppRef.current;
          if (!pixiApp) { console.error("[DragonBones] PIXI app not ready for prop"); return; }

          const { display, dbScale, proxyW, proxyH, offsetX, offsetY } = await loadProp(asset.name as any);

          // Resize the proxy to match the actual prop dimensions
          proxy.set({ width: proxyW, height: proxyH });
          proxy.setCoords();
          fabricRef.current?.renderAll();

          display.scale.set(dbScale);
          // Armature root is NOT at the AABB top-left.
          // display.x/y = proxy.left/top MINUS the scaled root offset.
          display.x = (proxy.left ?? baseLeft) + offsetX;
          display.y = (proxy.top  ?? baseTop)  + offsetY;

          // Props always render below characters
          display.zIndex = 0;
          pixiApp.stage.addChild(display);

          (proxy as any).armatureDisplay  = display;
          (proxy as any).dbScale          = dbScale;
          (proxy as any).propW            = proxyW;
          (proxy as any).propH            = proxyH;
          (proxy as any).propOffsetX      = offsetX;
          (proxy as any).propOffsetY      = offsetY;
          armatureDisplaysRef.current.push(display);

          const startAnim = display.animation.lastAnimationName ?? "";
          useEditorStore.getState().updateTrack(id, { characterAnimation: startAnim });

          console.log(`[DragonBones] Prop '${asset.name}' added to canvas`);
        } catch (err) {
          console.error("[DragonBones] Failed to load prop:", err);
        }
      })();
    } else if (asset.type === "video") {
        const videoEl = createVideoElement(asset.src!);

        // FIX 3: Robust Metadata Handling
        const onMetadataLoaded = () => {
          const width = videoEl.videoWidth || 480;
          const height = videoEl.videoHeight || 360;

          // Explicitly set element dimensions for Fabric
          videoEl.width = width;
          videoEl.height = height;

          const targetSize = 200;
          const fitScale = Math.min(targetSize / width, targetSize / height);

          // Use runtime fabric.Image for video element
          const fabricVideo = new FabricImage(videoEl as any, {
            left: baseLeft,
            top: baseTop,
            scaleX: fitScale,
            scaleY: fitScale,
            objectCaching: false,
          });
          // Custom properties for the track
          (fabricVideo as any)._customId = id;
          (fabricVideo as any).customType = "video";
          (fabricVideo as any)._element = videoEl; // Store ref to DOM element

          fabricRef.current!.add(fabricVideo);
          fabricRef.current!.setActiveObject(fabricVideo);

          // Store initial state for keyframe interpolation
          const initialState = {
            left: fabricVideo.left || 0,
            top: fabricVideo.top || 0,
            scaleX: fabricVideo.scaleX || 1,
            scaleY: fabricVideo.scaleY || 1,
            angle: fabricVideo.angle || 0,
            opacity: fabricVideo.opacity ?? 1,
          };

          addTrack({
            id,
            name: asset.name,
            fabricObject: fabricVideo,
            startTime: currentTime, // Start at playhead
            endTime: currentTime + videoEl.duration, // Use actual video duration
            keyframes: [],
            color: "green",
            initialState,
            type: "video",
            mediaDuration: videoEl.duration, // Max length
            mediaOffset: 0, // Where in the video file do we start playing?
          });

          // Try to play immediately to see the first frame
          videoEl.play().catch((e) => console.log("Autoplay blocked", e));
        };

        // Check if metadata is already there
        if (videoEl.readyState >= 1) {
          onMetadataLoaded();
        } else {
          videoEl.onloadedmetadata = onMetadataLoaded;
        }
      } else {
        // Background Logic
        const bg = new Rect({
          left: 0,
          top: 0,
          width: canvasRef.current?.width || 960,
          height: canvasRef.current?.height || 540,
          fill: asset.color,
          selectable: true,
          evented: false,
          hasControls: false,
          hasBorders: true,
          lockMovementX: true,
          lockMovementY: true,
          lockScalingX: true,
          lockScalingY: true,
          lockRotation: true,
        });

        // checkpoint before adding/modifying background
        saveCheckpoint();
        fabricRef.current.add(bg);
        fabricRef.current.moveObjectTo(bg, 0);
      }
    },
    [addTrack, setSelectedObject, currentTime],
  );

  const setBackground = useCallback((color: string) => {
    if (!fabricRef.current) return;

    const canvas = fabricRef.current;
    const existingBg = canvas
      .getObjects()
      .find((o: any) => (o as any).customType === "background");

    if (existingBg) {
      saveCheckpoint();
      existingBg.set({ fill: color });
      canvas.renderAll();
    } else {
      saveCheckpoint();
      const bg = new Rect({
        left: 0,
        top: 0,
        width: canvasRef.current?.width || 960,
        height: canvasRef.current?.height || 540,
        fill: color,
        selectable: false,
        evented: false,
        lockMovementX: true,
        lockMovementY: true,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        hasControls: false,
        hasBorders: false,
      });

      (bg as any).customType = "background";
      canvas.add(bg);
      canvas.sendObjectToBack(bg);
    }
  }, []);

  const addTextToCanvas = useCallback(
    (text: string, color: string, fontSize: number, fontFamily: string) => {
      if (!fabricRef.current) return;

      const id = `text-${Date.now()}`;
      const canvasWidth = canvasRef.current?.width || 960;
      const canvasHeight = canvasRef.current?.height || 540;
      const baseLeft = canvasWidth / 2 - (text.length * fontSize) / 4;
      const baseTop = canvasHeight / 2 - fontSize / 2;

      const textObj = new IText(text, {
        left: baseLeft,
        top: baseTop,
        fill: color,
        fontSize: fontSize,
        fontFamily: fontFamily,
      });

      (textObj as any)._customId = id;
      (textObj as any)._assetName = "Text";
      (textObj as any).customType = "text";

      fabricRef.current.add(textObj);
      fabricRef.current.setActiveObject(textObj);
      fabricRef.current.renderAll();

      const initialState = {
        left: textObj.left || 0,
        top: textObj.top || 0,
        scaleX: textObj.scaleX || 1,
        scaleY: textObj.scaleY || 1,
        angle: textObj.angle || 0,
        opacity: textObj.opacity ?? 1,
      };

      addTrack({
        id,
        name: "Text",
        fabricObject: textObj,
        startTime: 0,
        endTime: 5,
        keyframes: [],
        color: "green",
        initialState,
        type: "visual",
      });

      setSelectedObject(id, textObj);
    },
    [addTrack, setSelectedObject],
  );

  const removeBackground = useCallback(() => {
    if (!fabricRef.current) return;
    const canvas = fabricRef.current;
    const bg = canvas
      .getObjects()
      .find((o: any) => (o as any).customType === "background");
    if (bg) {
      saveCheckpoint();
      canvas.remove(bg);
      canvas.renderAll();
    }
  }, []);

  // Expose functions globally
  useEffect(() => {
    (window as any).__setBackground = setBackground;
    (window as any).__addTextToCanvas = addTextToCanvas;
    (window as any).__removeBackground = removeBackground;
    (window as any).__addShapeToCanvas = addAssetToCanvas;
    return () => {
      delete (window as any).__setBackground;
      delete (window as any).__addTextToCanvas;
      delete (window as any).__removeBackground;
      delete (window as any).__addShapeToCanvas;
    };
  }, [setBackground, addTextToCanvas, removeBackground]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();

      // 1. Handle Internal Asset Drag
      const assetData = e.dataTransfer.getData("asset");
      if (assetData) {
        try {
          const asset = JSON.parse(assetData) as Asset;
          addAssetToCanvas(asset);
          return;
        } catch (err) {
          console.error("Failed to parse asset data", err);
        }
      }

      // 2. Handle Video Track Drag from Media Tab
      const videoTrackId = e.dataTransfer.getData("video-track");
      if (videoTrackId) {
        const track = tracks.find((t) => t.id === videoTrackId);
        if (track && track.audioSrc) {
          // Create an asset from the track
          const asset: Asset = {
            id: track.id,
            name: track.name,
            type: "video",
            color: "#ffffff",
            icon: "",
            src: track.audioSrc,
          };
          addAssetToCanvas(asset);
        }
        return;
      }

      // 3. Handle External File Drag (Video/Image from Desktop)
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        const fileType = file.type.split("/")[0];

        if (fileType === "image" || fileType === "video") {
          const url = URL.createObjectURL(file);
          const asset: Asset = {
            id: `upload-${Date.now()}`,
            name: file.name,
            type: fileType === "video" ? "video" : "item",
            src: url,
            color: "#ffffff",
            icon: "",
          };

          addUploadedAsset(asset);

          addAssetToCanvas(asset);
        }
      }
    },
    [addAssetToCanvas, addUploadedAsset, tracks],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Sync video playback and scrubbing with timeline
  useEffect(() => {
    tracks.forEach((track) => {
      if (track.type === "video" && track.fabricObject) {
        const videoEl = (track.fabricObject as any)
          ._element as HTMLVideoElement;

        if (videoEl) {
          // bounds check
          const isWithinTrack =
            currentTime >= track.startTime && currentTime <= track.endTime;

          if (!isWithinTrack) {
            if (!videoEl.paused) videoEl.pause();
            videoEl.muted = true;
            return;
          }

          // Calculate where the video head should be (Clamped to file duration)
          // take offsets into account for split tracks
          const trackOffset = track.mediaOffset || 0;
          const relativeTime = currentTime - track.startTime;
          const targetFileTime = relativeTime + trackOffset;
          
          const targetTime = Math.min(targetFileTime, videoEl.duration || 0);

          if (isPlaying) {
            if (Math.abs(videoEl.currentTime - targetTime) > 0.2) {
              videoEl.currentTime = targetTime;
            }
            videoEl.muted = false;

            // Only call play if currently paused
            if (videoEl.paused) {
              videoEl.play().catch((e) => {
                if (e.name !== "AbortError")
                  console.log("Video play failed", e);
              });
            }
          } else {
            // Paused/Scrubbing: Strict sync
            if (!videoEl.paused) videoEl.pause();
            videoEl.muted = true;
            if (Math.abs(videoEl.currentTime - targetTime) > 0.05) {
              videoEl.currentTime = targetTime;
            }
          }
        }
      }
    });
  }, [currentTime, isPlaying, tracks]);
  return (
    <div
      className="flex-1 flex items-center justify-center bg-canvas p-4 overflow-hidden relative"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div className="relative rounded-lg overflow-hidden shadow-2xl ring-1 ring-border/50">
        <canvas ref={canvasRef} className="block" />
        <canvas 
          ref={pixiCanvasRef} 
          className="absolute top-0 left-0 pointer-events-none block" 
          style={{ backgroundColor: 'transparent' }}
        />
        <div className="absolute bottom-2 right-2 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
          960 × 540
        </div>
        {/* Path animation drawing overlay */}
        <PathDrawOverlay canvasWidth={960} canvasHeight={540} />
      </div>

      {contextMenu.visible && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu({ visible: false, x: 0, y: 0 })}
        />
      )}

      {/* Prop action popup — appears on double-click of cup/chair */}
      {propPopup && (
        <PropActionPopup
          propName={propPopup.propName}
          propPosition={propPopup.position}
          canvasEl={propPopup.canvasEl}
          propTrackId={propPopup.propTrackId}
          onClose={() => setPropPopup(null)}
        />
      )}
    </div>
  );
}