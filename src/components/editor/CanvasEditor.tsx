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

    // ── Real-time eraser via raw pointer events on the upper canvas ───────────
    // We bypass Fabric's drawing mode entirely for erasing, so no path artifacts.
    let eraserActive = false;
    let lastEraserX = 0;
    let lastEraserY = 0;

    const getCanvasPos = (e: PointerEvent) => {
      const rect = (canvas as any).upperCanvasEl
        ? (canvas as any).upperCanvasEl.getBoundingClientRect()
        : (canvasRef.current as HTMLCanvasElement).getBoundingClientRect();
      const scaleX = ((canvas as any).width || 960) / rect.width;
      const scaleY = ((canvas as any).height || 540) / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top)  * scaleY,
      };
    };

    const eraserPointerDown = (e: PointerEvent) => {
      const store = useEditorStore.getState();
      if (!store.drawingEnabled || !store.eraserEnabled) return;
      eraserActive = true;
      const pos = getCanvasPos(e);
      lastEraserX = pos.x;
      lastEraserY = pos.y;
      // Dot for click with no drag
      const lowerEl = (canvas as any).lowerCanvasEl as HTMLCanvasElement | undefined;
      if (lowerEl) {
        const ctx = lowerEl.getContext("2d")!;
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = "rgba(0,0,0,1)";
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, store.eraserSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };

    const eraserPointerMove = (e: PointerEvent) => {
      if (!eraserActive) return;
      const store = useEditorStore.getState();
      if (!store.drawingEnabled || !store.eraserEnabled) { eraserActive = false; return; }
      const pos = getCanvasPos(e);
      const lowerEl = (canvas as any).lowerCanvasEl as HTMLCanvasElement | undefined;
      if (lowerEl) {
        const ctx = lowerEl.getContext("2d")!;
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
        ctx.lineWidth = store.eraserSize;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(lastEraserX, lastEraserY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.restore();
      }
      lastEraserX = pos.x;
      lastEraserY = pos.y;
    };

    const eraserPointerUp = () => { eraserActive = false; };

    const upperEl: HTMLElement | undefined = (canvas as any).upperCanvasEl;
    if (upperEl) {
      upperEl.addEventListener("pointerdown", eraserPointerDown);
      upperEl.addEventListener("pointermove", eraserPointerMove);
      upperEl.addEventListener("pointerup",   eraserPointerUp);
      upperEl.addEventListener("pointerleave",eraserPointerUp);
    }

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

      // ── Eraser mode: handled via raw pointer events, not path:created ───────
      if (store.eraserEnabled) {
        canvas.remove(path); // discard any stray path if it somehow got created
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
      if (upperEl) {
        upperEl.removeEventListener("pointerdown", eraserPointerDown);
        upperEl.removeEventListener("pointermove", eraserPointerMove);
        upperEl.removeEventListener("pointerup",   eraserPointerUp);
        upperEl.removeEventListener("pointerleave",eraserPointerUp);
      }
      canvas.dispose();
      setCanvas(null);
    };
  }, [setCanvas, setSelectedObject]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // When eraser is active, disable Fabric's drawing mode entirely so our
    // raw pointerdown/move/up listeners on upperCanvasEl work unobstructed.
    if (eraserEnabled && drawingEnabled) {
      canvas.isDrawingMode = false;
      canvas.selection = false;
      return;
    }

    canvas.isDrawingMode = drawingEnabled;
    canvas.selection = !drawingEnabled;

    if (drawingEnabled && !eraserEnabled) {
      if (!canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      }
      canvas.freeDrawingBrush.color = drawingColor;
      canvas.freeDrawingBrush.width = drawingBrushSize;
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
          let obj: FabricObject;
          if (asset.name === "Circle") {
            obj = new Circle({
              left: baseLeft + 50,
              top: baseTop + 50,
              radius: 40,
              fill: asset.color,
            });
          } else {
            obj = new Rect({
              left: baseLeft + 50,
              top: baseTop + 50,
              width: 60,
              height: 60,
              fill: asset.color,
              rx: asset.name === "Star" ? 0 : 5,
              ry: asset.name === "Star" ? 0 : 5,
            });
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
    return () => {
      delete (window as any).__setBackground;
      delete (window as any).__addTextToCanvas;
      delete (window as any).__removeBackground;
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