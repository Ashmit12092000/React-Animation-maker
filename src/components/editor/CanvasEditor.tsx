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

// Fabric v6: custom properties must be registered on the class so they are
// included automatically in toObject() / toJSON() / clone() round-trips.
// This replaces the old `canvas.toJSON(["_customId", ...])` API which no
// longer accepts arguments in v6.
FabricObject.customProperties = [
  ...(FabricObject.customProperties ?? []),
  "_customId",
  "_assetName",
  "customType",
  "_imageFilters",
  "propName",
];
import * as PIXI from "pixi.js";
import { useEditorStore, type Asset } from "@/stores/editorStore";
import { setSceneRestoring, isSceneRestoring } from "@/stores/slices/trackSlice";
import { ContextMenu } from "./ContextMenu";
import { AudioFilterPanel } from "./AudioFilterPanel";
import { PathDrawOverlay } from "./PathDrawOverlay";
import { PropActionPopup } from "./PropActionPopup";
import { BackgroundCropModal } from "./BackgroundCropModal";
import { loadCharacter, loadProp, hookPixiTicker } from "@/lib/dragonbonesRenderer";
import { createAnimatedGif, AnimatedGifImage } from "@/utils/gifRenderer";

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

  // ── Background crop modal state ──────────────────────────────────────────
  const [bgCropTarget, setBgCropTarget] = useState<HTMLImageElement | null>(null);
  const [audioFilterPanel, setAudioFilterPanel] = useState<{ trackId: string; trackName: string; mediaOffset: number; clipDuration: number } | null>(null);


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
    pendingArmatures,
    setPendingArmatures,
    // ── Scene system ──
    activeSceneId,
    scenes,
    saveSceneCanvasData,
    getSceneCanvasData,
    updateSceneThumbnail,
    updateSceneBgImage,
    setSceneBg,
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
        // Expose on window so canvasSlice can trigger an immediate render
        // after property changes (e.g. flip) without waiting for the next tick
        (window as any).__pixiApp = pixiApp;

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

    // Helper: show/hide dotted proxy border based on selection state
    const showProxyBorder = (obj: FabricObject) => {
      if ((obj as any)._proxyStroke) {
        obj.set({ stroke: (obj as any)._proxyStroke, fill: (obj as any)._proxyFill });
        obj.dirty = true;
      }
    };
    const hideProxyBorder = (obj: FabricObject) => {
      if ((obj as any)._proxyStroke) {
        obj.set({ stroke: "transparent", fill: "rgba(0,0,0,0)" });
        obj.dirty = true;
      }
    };

    canvas.on("selection:created", (e) => {
      handleSelectionLocks();

      const obj = e.selected?.[0];
      if (obj) {
        setSelectedObject((obj as any)._customId || null, obj);
        showProxyBorder(obj);
        canvas.requestRenderAll();
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
        showProxyBorder(obj);
      }
      // Hide border on any proxy that was just deselected
      e.deselected?.forEach((deselObj: FabricObject) => hideProxyBorder(deselObj));
      canvas.requestRenderAll();
      const bg = canvas
        .getObjects()
        .find((o) => (o as any).customType === "background");
      if (bg) canvas.sendObjectToBack(bg);
    });

    canvas.on("selection:cleared", () => {
      setSelectedObject(null, null);
      // Hide the dotted border on all proxy rects when nothing is selected
      canvas.getObjects().forEach((o: FabricObject) => hideProxyBorder(o));
      canvas.requestRenderAll();
    });

    // Boundary Constraints
    canvas.on("object:moving", (e) => {
      const obj = e.target;
      if (!obj) return;

      if ((obj as any).customType === 'character') {
        const display = (obj as any).armatureDisplay;
        if (display) {
          const dbScale    = (obj as any).dbScale ?? 1;
          const charW      = (obj as any).charW   ?? (obj.width  || 103);
          const charH      = (obj as any).charH   ?? (obj.height || 300);
          const userScaleX = obj.scaleX || 1;
          const userScaleY = obj.scaleY || 1;
          const flipSignX  = obj.flipX ? -1 : 1;
          const flipSignY  = obj.flipY ? -1 : 1;
          display.scale.x  = dbScale * userScaleX * flipSignX;
          display.scale.y  = dbScale * userScaleY * flipSignY;
          display.x = (obj.left || 0) + (charW * userScaleX) / 2;
          display.y = (obj.top  || 0) +  charH * userScaleY;
          display.alpha = obj.opacity ?? 1;
        }
      }

      if ((obj as any).customType === 'prop') {
        const display = (obj as any).armatureDisplay;
        if (display) {
          const dbScale    = (obj as any).dbScale ?? 1;
          const userScaleX = obj.scaleX || 1;
          const userScaleY = obj.scaleY || 1;
          const userScale  = Math.max(userScaleX, userScaleY);
          const baseOffX   = (obj as any).propOffsetX ?? 0;
          const baseOffY   = (obj as any).propOffsetY ?? 0;
          const flipSignX  = obj.flipX ? -1 : 1;
          const flipSignY  = obj.flipY ? -1 : 1;
          display.scale.x  = dbScale * userScale * flipSignX;
          display.scale.y  = dbScale * userScale * flipSignY;
          if (obj.flipX) {
            const proxyW = (obj as any).propW ?? (obj.width || 120);
            display.x = (obj.left || 0) + proxyW * userScale - baseOffX * userScale;
          } else {
            display.x = (obj.left || 0) + baseOffX * userScale;
          }
          display.y = (obj.top  || 0) + baseOffY * userScale;
          display.alpha = obj.opacity ?? 1;
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
          const dbScale    = (target as any).dbScale ?? 1;
          const charW      = (target as any).charW   ?? (target.width  || 103);
          const charH      = (target as any).charH   ?? (target.height || 300);
          const userScaleX = target.scaleX || 1;
          const userScaleY = target.scaleY || 1;
          const flipSignX  = target.flipX ? -1 : 1;
          const flipSignY  = target.flipY ? -1 : 1;
          display.scale.x  = dbScale * userScaleX * flipSignX;
          display.scale.y  = dbScale * userScaleY * flipSignY;
          display.x = target.flipX
            ? (target.left || 0) + (charW * userScaleX) / 2 + charW * userScaleX * 0
            : (target.left || 0) + (charW * userScaleX) / 2;
          display.y = (target.top || 0) + charH * userScaleY;
          // Apply opacity from proxy to armature display
          display.alpha = target.opacity ?? 1;
        }
      }

      if (target && (target as any).customType === "prop") {
        const display = (target as any).armatureDisplay;
        if (display) {
          const dbScale   = (target as any).dbScale ?? 1;
          const userScaleX = target.scaleX || 1;
          const userScaleY = target.scaleY || 1;
          const userScale = Math.max(userScaleX, userScaleY);
          const baseOffX  = (target as any).propOffsetX ?? 0;
          const baseOffY  = (target as any).propOffsetY ?? 0;
          const flipSignX = target.flipX ? -1 : 1;
          const flipSignY = target.flipY ? -1 : 1;
          display.scale.x = dbScale * userScale * flipSignX;
          display.scale.y = dbScale * userScale * flipSignY;
          if (target.flipX) {
            const proxyW = (target as any).propW ?? (target.width || 120);
            display.x = (target.left || 0) + proxyW * userScale - baseOffX * userScale;
          } else {
            display.x = (target.left || 0) + baseOffX * userScale;
          }
          display.y = (target.top || 0) + baseOffY * userScale;
          // Apply opacity from proxy to armature display
          display.alpha = target.opacity ?? 1;
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

      // Eraser strokes should not be added as objects — remove and return
      if (store.eraserEnabled) {
        canvas.remove(path);
        canvas.renderAll();
        return;
      }

      // Save a checkpoint BEFORE this drawing is committed so undo removes it
      store.saveCheckpoint();

      // Mark as a drawing — do NOT add to timeline
      const pathId = `drawing_${Date.now()}`;
      (path as any)._customId = pathId;
      (path as any)._assetName = "Drawing";
      (path as any).customType = "drawing";
      (path as any).fill = "";

      // ── Make selectable SYNCHRONOUSLY, before React re-renders ────────────
      // setCoords() refreshes Fabric's internal hit-test bounding boxes so
      // clicks on the stroke register immediately.
      path.set({ selectable: true, evented: true });
      path.setCoords();

      // Exit drawing mode right here on the canvas object — don't wait for
      // the useEffect that reacts to drawingEnabled state change.
      canvas.isDrawingMode = false;
      canvas.selection = true;

      // Auto-select the new stroke so the user can immediately interact with it
      canvas.setActiveObject(path);
      canvas.requestRenderAll();

      // Sync React state last — this just updates the toolbar UI (Pen → Select)
      // and triggers the useEffect which will call setCoords() again (harmless).
      store.setDrawingEnabled(false);
    });

    // Add cleanup for removed objects
   canvas.on("object:removed", (e) => {
      const obj = e.target;

      // ── Animated GIF cleanup ─────────────────────────────────────────────
      if (obj && (obj as any).customType === "gif") {
        if (obj instanceof AnimatedGifImage) obj.stop();
      }

      // ── Lottie scene cleanup ─────────────────────────────────────────────
      // Only destroy when the track is actually deleted, not when the timeline
      // temporarily removes the object (which also fires object:removed).
      if (obj && (obj as any).customType === "scene") {
        const anim = (obj as any)._lottieAnim;
        if (anim) {
          const sceneId = (obj as any)._customId;
          const trackStillExists = !!useEditorStore.getState().tracks.find((t) => t.id === sceneId);
          if (!trackStillExists) {
            try { anim.destroy(); } catch (_) {}
            (obj as any)._lottieAnim = null;
          }
          // If track still exists, leave anim alive — it will be re-synced.
        }
      }

      // ── DragonBones armature cleanup (character & prop) ──────────────────
      if (obj && ((obj as any).customType === "character" || (obj as any).customType === "prop")) {
        const display = (obj as any).armatureDisplay;
        if (display) {
          // Use the _pendingDelete flag (set by removeTrack / deleteSelected BEFORE
          // canvas.remove) to distinguish a real deletion from a temporary
          // remove/re-add the timeline does while scrubbing.
          const isPendingDelete = !!(obj as any)._pendingDelete;
          const customId = (obj as any)._customId;
          const trackStillExists = !!useEditorStore.getState().tracks.find((t) => t.id === customId);
          if (isPendingDelete || !trackStillExists) {
            const pixiApp = pixiAppRef.current;
            if (pixiApp && pixiApp.stage.children.includes(display)) {
              pixiApp.stage.removeChild(display);
            }
            try { display.dispose(); } catch (_) {}
            armatureDisplaysRef.current = armatureDisplaysRef.current.filter((d) => d !== display);
            (obj as any).armatureDisplay = null;
          }
          // If track still exists and not pending delete, keep the display alive —
          // it will be re-synced by applyKeyframesAtTime on the next frame.
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
      // Keep isDrawingMode=true so upperCanvasEl stays active (pointer-events on,
      // cursor visible). We use a transparent PencilBrush so the stroke is invisible,
      // then on mouse:move we erase drawing objects under the pointer in real time.
      canvas.isDrawingMode = true;
      canvas.selection = false;

      const pencil = new fabric.PencilBrush(canvas);
      pencil.color = "rgba(0,0,0,0)"; // invisible stroke
      pencil.width = 1;
      canvas.freeDrawingBrush = pencil;

      const eraserCursor = makeEraserCursor(eraserSize);
      const upperElLocal = (canvas as any).upperCanvasEl as HTMLElement | undefined;
      const lowerElLocal = (canvas as any).lowerCanvasEl as HTMLElement | undefined;
      const wrapperElLocal = (canvas as any).wrapperEl as HTMLElement | undefined;
      if (upperElLocal) upperElLocal.style.cursor = eraserCursor;
      if (lowerElLocal) lowerElLocal.style.cursor = eraserCursor;
      if (wrapperElLocal) wrapperElLocal.style.cursor = eraserCursor;
      canvas.defaultCursor = eraserCursor;
      canvas.freeDrawingCursor = eraserCursor;

      let isErasing = false;

      const eraseAtPoint = (ex: number, ey: number) => {
        const r = eraserSize / 2;
        const drawings = canvas.getObjects().filter(
          (obj) => (obj as any).customType === "drawing"
        ) as Path[];

        if (drawings.length === 0) return;

        drawings.forEach((pathObj, pi) => {
          const rawPath: any[] = (pathObj as any).path || [];
          if (!rawPath.length) return;

          const matrix = pathObj.calcTransformMatrix();
          const invMatrix = fabric.util.invertTransform(matrix);
          // Convert canvas point → object-local space
          const localEraser = fabric.util.transformPoint({ x: ex, y: ey }, invMatrix);
          // Fabric v6 stores raw path commands relative to pathOffset (bbox center),
          // so we must add pathOffset to align with the raw path coordinate space.
          const pathOffset = (pathObj as any).pathOffset as { x: number; y: number } | undefined;
          const lx = localEraser.x + (pathOffset?.x ?? 0);
          const ly = localEraser.y + (pathOffset?.y ?? 0);

          const scaleX = Math.sqrt(matrix[0] ** 2 + matrix[1] ** 2);
          const scaleY = Math.sqrt(matrix[2] ** 2 + matrix[3] ** 2);
          const localR = r / ((scaleX + scaleY) / 2);

          const pointInEraser = (px: number, py: number) => {
            const dx = px - lx, dy = py - ly;
            return dx * dx + dy * dy <= localR * localR;
          };

          const segmentHit = (x1: number, y1: number, x2: number, y2: number) => {
            const dx = x2 - x1, dy = y2 - y1;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const steps = Math.max(1, Math.ceil(dist / 2));
            for (let i = 0; i <= steps; i++) {
              if (pointInEraser(x1 + dx * i / steps, y1 + dy * i / steps)) return true;
            }
            return false;
          };

          const keepSegments: any[][] = [];
          let currentSegment: any[] = [];
          let cx = 0, cy = 0;
          let erased = false;

          rawPath.forEach((cmd: any[]) => {
            const type = cmd[0];
            if (type === "M") {
              if (currentSegment.length > 0) keepSegments.push(currentSegment);
              cx = cmd[1]; cy = cmd[2];
              if (pointInEraser(cx, cy)) { erased = true; currentSegment = []; }
              else currentSegment = [["M", cx, cy]];
            } else if (type === "L") {
              const nx = cmd[1], ny = cmd[2];
              if (segmentHit(cx, cy, nx, ny)) {
                erased = true;
                if (currentSegment.length > 0) keepSegments.push(currentSegment);
                currentSegment = [];
              } else {
                if (currentSegment.length === 0) currentSegment.push(["M", nx, ny]);
                else currentSegment.push(["L", nx, ny]);
              }
              cx = nx; cy = ny;
            } else if (type === "Q") {
              const [, qcx, qcy, qex, qey] = cmd;
              if (segmentHit(cx, cy, qcx, qcy) || segmentHit(qcx, qcy, qex, qey)) {
                erased = true;
                if (currentSegment.length > 0) keepSegments.push(currentSegment);
                currentSegment = [];
              } else {
                if (currentSegment.length === 0) currentSegment.push(["M", qex, qey]);
                else currentSegment.push(["Q", qcx, qcy, qex, qey]);
              }
              cx = qex; cy = qey;
            } else if (type === "C") {
              const [, c1x, c1y, c2x, c2y, ex2, ey2] = cmd;
              if (segmentHit(cx, cy, c1x, c1y) || segmentHit(c1x, c1y, c2x, c2y) || segmentHit(c2x, c2y, ex2, ey2)) {
                erased = true;
                if (currentSegment.length > 0) keepSegments.push(currentSegment);
                currentSegment = [];
              } else {
                if (currentSegment.length === 0) currentSegment.push(["M", ex2, ey2]);
                else currentSegment.push(["C", c1x, c1y, c2x, c2y, ex2, ey2]);
              }
              cx = ex2; cy = ey2;
            } else if (type === "z" || type === "Z") {
              if (currentSegment.length > 0) keepSegments.push(currentSegment);
              currentSegment = [];
            }
          });

          if (currentSegment.length > 0) keepSegments.push(currentSegment);
          if (!erased) return;

          // The raw path coords are in path-space (relative to pathOffset / bbox center).
          // To place reconstructed paths correctly on canvas we must transform each point
          // back through the original object's transform matrix.
          const transformPoint = (px: number, py: number): [number, number] => {
            const pt = fabric.util.transformPoint(
              { x: px - (pathOffset?.x ?? 0), y: py - (pathOffset?.y ?? 0) },
              matrix
            );
            return [pt.x, pt.y];
          };

          const remapCmd = (cmd: any[]): any[] => {
            const t = cmd[0];
            if (t === "M" || t === "L") {
              const [rx, ry] = transformPoint(cmd[1], cmd[2]);
              return [t, rx, ry];
            } else if (t === "Q") {
              const [c1x, c1y] = transformPoint(cmd[1], cmd[2]);
              const [ex2, ey2] = transformPoint(cmd[3], cmd[4]);
              return [t, c1x, c1y, ex2, ey2];
            } else if (t === "C") {
              const [c1x, c1y] = transformPoint(cmd[1], cmd[2]);
              const [c2x, c2y] = transformPoint(cmd[3], cmd[4]);
              const [ex2, ey2] = transformPoint(cmd[5], cmd[6]);
              return [t, c1x, c1y, c2x, c2y, ex2, ey2];
            }
            return cmd;
          };

          canvas.remove(pathObj);
          keepSegments.filter(seg => seg.length > 1).forEach(seg => {
            const remappedSeg = seg.map(remapCmd);
            const newPath = new Path(remappedSeg as any, {
              stroke: pathObj.stroke,
              strokeWidth: pathObj.strokeWidth,
              fill: "",
              strokeLineCap: "round",
              strokeLineJoin: "round",
              selectable: false,
              evented: false,
            });
            (newPath as any).customType = "drawing";
            (newPath as any)._customId = `drawing_${Date.now()}_${Math.random()}`;
            canvas.add(newPath);
          });
          canvas.renderAll();
        });
      };

      // Fabric swallows mouse:down/move in isDrawingMode — use raw DOM events instead
      const domTarget = ((canvas as any).upperCanvasEl as HTMLCanvasElement);

      const getPoint = (e: MouseEvent) => {
        const rect = domTarget.getBoundingClientRect();
        const scaleX = canvas.getWidth()  / rect.width;
        const scaleY = canvas.getHeight() / rect.height;
        return {
          x: (e.clientX - rect.left) * scaleX,
          y: (e.clientY - rect.top)  * scaleY,
        };
      };

      const onMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        // Save checkpoint BEFORE erasing begins so the action is fully undoable
        useEditorStore.getState().saveCheckpoint();
        isErasing = true;
        const p = getPoint(e);
        console.log("[ERASER] DOWN", p.x.toFixed(1), p.y.toFixed(1), "drawings:", canvas.getObjects().filter((o:any)=>o.customType==="drawing").length);
        eraseAtPoint(p.x, p.y);
      };

      const onMouseMove = (e: MouseEvent) => {
        if (!isErasing) return;
        const p = getPoint(e);
        eraseAtPoint(p.x, p.y);
      };

      const onMouseUp = () => { isErasing = false; };

      // Discard the invisible pencil stroke fabric creates
      const onPathCreated = (opt: any) => {
        if (opt.path) { canvas.remove(opt.path); canvas.renderAll(); }
      };

      domTarget.addEventListener("mousedown", onMouseDown);
      window.addEventListener("mousemove",    onMouseMove);
      window.addEventListener("mouseup",      onMouseUp);
      canvas.on("path:created", onPathCreated);

      return () => {
        domTarget.removeEventListener("mousedown", onMouseDown);
        window.removeEventListener("mousemove",    onMouseMove);
        window.removeEventListener("mouseup",      onMouseUp);
        canvas.off("path:created", onPathCreated);
        canvas.selection = true;
        canvas.defaultCursor = "default";
        canvas.freeDrawingCursor = "crosshair";
        if (upperElLocal) upperElLocal.style.cursor = "";
        if (lowerElLocal) lowerElLocal.style.cursor = "";
        if (wrapperElLocal) wrapperElLocal.style.cursor = "";
      };
    }

    // ── DRAWING MODE ───────────────────────────────────────────────────────
    if (drawingEnabled && !eraserEnabled) {
      canvas.isDrawingMode = true;
      canvas.selection = false;
      const pencil = new fabric.PencilBrush(canvas);
      pencil.color = drawingColor;
      pencil.width = drawingBrushSize;
      canvas.freeDrawingBrush = pencil;

      // Lock drawing objects so they don't interfere with new strokes
      canvas.getObjects().forEach((obj) => {
        if ((obj as any).customType === "drawing") {
          obj.set({ selectable: false, evented: false });
        }
      });
      canvas.discardActiveObject();

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

    // Make existing hand-drawn objects selectable so user can pick them and apply Draw Path.
    // setCoords() is required so Fabric updates its internal hit-testing bounding boxes.
    canvas.getObjects().forEach((obj) => {
      if ((obj as any).customType === "drawing") {
        obj.set({ selectable: true, evented: true });
        obj.setCoords();
      }
    });
    canvas.requestRenderAll();
  }, [drawingEnabled, drawingColor, drawingBrushSize, eraserEnabled, eraserSize]);

  // ── Restore DragonBones characters/props after loading a save file ─────────
  useEffect(() => {
    if (!pendingArmatures || pendingArmatures.length === 0) return;
    const canvas = fabricRef.current;
    const pixiApp = pixiAppRef.current;
    if (!canvas || !pixiApp) return;

    (async () => {
      for (const pa of pendingArmatures) {
        try {
          if (pa.customType === "character") {
            // ── Deduplication guard ────────────────────────────────────────────────────
            // The scene-switch afterLoad may have already linked a display to this
            // proxy concurrently. If so, reuse it and skip creating a new one.
            const proxyBefore = canvas.getObjects().find((o: any) => o._customId === pa.trackId);
            if (proxyBefore && (proxyBefore as any).armatureDisplay) {
              const existingDisplay = (proxyBefore as any).armatureDisplay;
              existingDisplay.visible = true;
              const anim = pa.characterAnimation ?? pa.assetName;
              if (anim && existingDisplay.animation.animationNames.includes(anim)) {
                existingDisplay.animation.play(anim, 0);
              }
              useEditorStore.getState().updateTrack(pa.trackId, { characterAnimation: pa.characterAnimation ?? pa.assetName });
              continue;
            }

            const { display } = await loadCharacter(pa.assetName);

            const CHAR_DB_HEIGHT = 945;
            const CHAR_DB_WIDTH  = 324;
            const targetHeight   = 300;
            const dbScale        = targetHeight / CHAR_DB_HEIGHT;
            const charW          = Math.round(CHAR_DB_WIDTH * dbScale);
            const charH          = targetHeight;

            display.scale.set(dbScale);
            display.zIndex = 10;

            // Re-query proxy after async loadCharacter — canvas may have changed.
            // Also do a post-await dedup: scene-switch afterLoad may have linked
            // a display while we were awaiting, so never put two on stage.
            const proxy = canvas.getObjects().find((o: any) => o._customId === pa.trackId);
            if (proxy && (proxy as any).armatureDisplay) {
              // Discard the redundant display we just created
              try { pixiApp.stage.removeChild(display); display.dispose(); } catch (_) {}
              const existingDisplay = (proxy as any).armatureDisplay;
              existingDisplay.visible = true;
              const anim = pa.characterAnimation ?? pa.assetName;
              if (anim && existingDisplay.animation.animationNames.includes(anim)) {
                existingDisplay.animation.play(anim, 0);
              }
              useEditorStore.getState().updateTrack(pa.trackId, { characterAnimation: pa.characterAnimation ?? pa.assetName });
              continue;
            }

            pixiApp.stage.addChild(display);
            armatureDisplaysRef.current.push(display);

            // Find the proxy rect on canvas and attach display to it
            if (proxy) {
              (proxy as any).armatureDisplay = display;
              (proxy as any).dbScale         = dbScale;
              (proxy as any).charW           = charW;
              (proxy as any).charH           = charH;
              display.x = (proxy.left ?? pa.left) + charW / 2;
              display.y = (proxy.top  ?? pa.top)  + charH;
            }

            // Switch to saved animation
            const anim = pa.characterAnimation ?? pa.assetName;
            if (anim && display.animation.animationNames.includes(anim)) {
              display.animation.play(anim, 0);
            }
            useEditorStore.getState().updateTrack(pa.trackId, { characterAnimation: pa.characterAnimation ?? pa.assetName });

          } else if (pa.customType === "prop" && pa.assetName !== "chair") {
            // Dedup guard for props (same logic as characters above)
            const proxyBefore = canvas.getObjects().find((o: any) => o._customId === pa.trackId);
            if (proxyBefore && (proxyBefore as any).armatureDisplay) {
              const existingDisplay = (proxyBefore as any).armatureDisplay;
              existingDisplay.visible = true;
              const anim = pa.characterAnimation;
              if (anim && existingDisplay.animation.animationNames.includes(anim)) {
                existingDisplay.animation.play(anim, 0);
              }
              continue;
            }

            const { display, dbScale, proxyW, proxyH, offsetX, offsetY } = await loadProp(pa.assetName as any);

            display.zIndex = 0;

            // Post-await dedup for props
            const proxy = canvas.getObjects().find((o: any) => o._customId === pa.trackId);
            if (proxy && (proxy as any).armatureDisplay) {
              try { pixiApp.stage.removeChild(display); display.dispose(); } catch (_) {}
              const existingDisplay = (proxy as any).armatureDisplay;
              existingDisplay.visible = true;
              const anim = pa.characterAnimation;
              if (anim && existingDisplay.animation.animationNames.includes(anim)) {
                existingDisplay.animation.play(anim, 0);
              }
              continue;
            }

            pixiApp.stage.addChild(display);
            armatureDisplaysRef.current.push(display);

            if (proxy) {
              proxy.set({ width: proxyW, height: proxyH });
              proxy.setCoords();
              (proxy as any).armatureDisplay = display;
              (proxy as any).dbScale         = dbScale;
              (proxy as any).propOffsetX     = offsetX;
              (proxy as any).propOffsetY     = offsetY;
              display.x = (proxy.left ?? pa.left) + offsetX;
              display.y = (proxy.top  ?? pa.top)  + offsetY;
            }

            const anim = pa.characterAnimation;
            if (anim && display.animation.animationNames.includes(anim)) {
              display.animation.play(anim, 0);
            }
          }
        } catch (err) {
          console.error("[Restore] Failed to restore armature", pa.assetName, err);
        }
      }
      canvas.requestRenderAll();
      // Clear the queue
      setPendingArmatures([]);
    })();
  }, [pendingArmatures]);

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
        // Don't overwrite customType if it was already set (e.g. "gif" before this call)
        if (!(obj as any).customType) {
          (obj as any).customType = objAsset.type;
        }

        fabricRef.current!.add(obj);
        fabricRef.current!.bringObjectToFront(obj);
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
        if (asset.src && (asset as any).isGif) {
          // ── Animated GIF via gifuct-js ─────────────────────────────────────
          // Fetch the raw GIF bytes, decode all frames, and create an
          // AnimatedGifImage that overrides _renderFill to draw the current
          // frame each tick. objectCaching must be false so Fabric redraws it.
          (async () => {
            try {
              const resp = await fetch(asset.src!);
              const blob = await resp.blob();
              const gifImg = await createAnimatedGif(blob, {
                left: baseLeft,
                top:  baseTop,
              });
              (gifImg as any).customType = "gif";
              addObjectToCanvas(gifImg, id, asset);
              // Start the per-frame loop (must be called after adding to canvas)
              if (fabricRef.current) gifImg.play(fabricRef.current);
            } catch (err) {
              console.error("[GIF] Failed to load animated GIF:", err);
            }
          })();
          return;
        }

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
      // Stroke is hidden by default and only shown when the object is selected.
      const proxy = new Rect({
        left:        baseLeft,
        top:         baseTop,
        width:       charW,
        height:      charH,
        fill:        "rgba(100,100,255,0.0)",
        stroke:      "transparent",
        strokeWidth: 1,
        strokeDashArray: [4, 4],
        rx: 4,
        ry: 4,
      });
      (proxy as any)._proxyStroke = "rgba(100,100,255,0.5)";
      (proxy as any)._proxyFill   = "rgba(100,100,255,0.08)";
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
        img.src = "chair_new.png";
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
        fill:        "rgba(249,115,22,0.0)",
        stroke:      "transparent",
        strokeWidth: 1,
        strokeDashArray: [4, 4],
        rx: 4,
        ry: 4,
      });
      (proxy as any)._proxyStroke = "rgba(249,115,22,0.5)";
      (proxy as any)._proxyFill   = "rgba(249,115,22,0.08)";
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
      } else if ((asset as any).type === "scene") {
        // ── Lottie animated scene ─────────────────────────────────────────
        // Render Lottie into an offscreen canvas, then wrap it in a
        // FabricImage with objectCaching:false so Fabric repaints every frame.
        (async () => {
          try {
            const lottie = (await import("lottie-web")).default;

            const SIZE = 320;
            const offscreen = document.createElement("canvas");
            offscreen.width  = SIZE;
            offscreen.height = SIZE;

            // lottie-web "canvas" renderer draws into our offscreen canvas
            const anim = lottie.loadAnimation({
              renderer:   "canvas",
              loop:       true,
              autoplay:   true,
              path:       (asset as any).src,
              rendererSettings: {
                context:          offscreen.getContext("2d")!,
                scaleMode:        "noScale",
                clearCanvas:      true,
                progressiveLoad:  false,
              },
            } as any);

            await new Promise<void>((resolve, reject) => {
              anim.addEventListener("data_ready",  () => resolve());
              anim.addEventListener("data_failed", () => reject(new Error("Lottie load failed")));
              setTimeout(() => reject(new Error("Lottie timeout")), 10000);
            });

            const fabricScene = new FabricImage(offscreen as any, {
              left:          baseLeft,
              top:           baseTop,
              objectCaching: false,
            });
            fabricScene.scale(1);
            fabricScene.setCoords();

            (fabricScene as any)._customId  = id;
            (fabricScene as any).customType = "scene";
            (fabricScene as any)._lottieAnim = anim;

            fabricRef.current!.add(fabricScene);
            fabricRef.current!.setActiveObject(fabricScene);

            // Drive Fabric repaints from Lottie's enterFrame event
            anim.addEventListener("enterFrame", () => {
              fabricRef.current?.requestRenderAll();
            });

            const initialState = {
              left:   fabricScene.left   || 0,
              top:    fabricScene.top    || 0,
              scaleX: fabricScene.scaleX || 1,
              scaleY: fabricScene.scaleY || 1,
              angle:  fabricScene.angle  || 0,
              opacity: fabricScene.opacity ?? 1,
            };

            addTrack({
              id,
              name:         asset.name,
              fabricObject: fabricScene,
              startTime:    0,
              endTime:      5,
              keyframes:    [],
              color:        "purple",
              initialState,
              type:         "visual",
            });

            setSelectedObject(id, fabricScene);
            fabricRef.current!.renderAll();
          } catch (err) {
            console.error("[Lottie] Failed to load scene:", err);
          }
        })();
        return;
      } else {
        // Background Logic — replace the existing background rect rather than
        // stacking a new one on top of it.
        const canvas = fabricRef.current;
        const existingBg = canvas
          .getObjects()
          .find((o: any) => (o as any).customType === "background");

        saveCheckpoint();

        if (existingBg) {
          // Just swap the fill on the rect that's already there.
          existingBg.set({ fill: asset.color });
          canvas.renderAll();
        } else {
          const bg = new Rect({
            left: 0,
            top: 0,
            width: canvasRef.current?.width || 960,
            height: canvasRef.current?.height || 540,
            fill: asset.color,
            selectable: false,
            evented: false,
            hasControls: false,
            hasBorders: false,
            lockMovementX: true,
            lockMovementY: true,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true,
          });

          // Required so every downstream guard (removeBackground, scene
          // reconciliation, serialisation filters) can identify this rect.
          (bg as any).customType = "background";
          canvas.add(bg);
          canvas.sendObjectToBack(bg);
          canvas.renderAll();
        }

        // Persist the chosen colour into the scene store so that the
        // scene-switch reconciler re-applies the correct colour (not a stale
        // one) whenever the user leaves and returns to this scene.
        const { activeSceneId: sceneId } = useEditorStore.getState();
        useEditorStore.getState().setSceneBg(sceneId, asset.color!);
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

    // ── Persist the chosen colour into the scene store ─────────────────────
    // Without this, sc.bg stays stale. On scene switch the reconcile code in
    // afterLoad re-applies the old sc.bg over the newly chosen colour, making
    // the background appear to "revert" whenever you leave and return to the
    // scene.  Keeping the store in sync means the reconcile always reinforces
    // the correct colour rather than overwriting it.
    const { activeSceneId: sceneId } = useEditorStore.getState();
    useEditorStore.getState().setSceneBg(sceneId, color);
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

  // ── Scene switch: save current canvas → restore new scene canvas ────────────
  const prevSceneIdRef = useRef<string | null>(null);
  const sceneInitializedRef = useRef<Set<string>>(new Set());

  // ── Synchronous sceneRestoring guard ────────────────────────────────────────
  // RAF ticks (from the Fabric render loop and ScenePreviewPlayer) can fire in
  // the gap between React committing a new `activeSceneId` prop and the
  // useEffect below actually running. If those ticks call applyKeyframesAtTime
  // while the canvas is being cleared/repopulated they re-add stale fabricObject
  // refs as ghost objects.
  //
  // Setting isSceneRestoring=true DURING RENDER (i.e. synchronously, before any
  // RAF can fire) closes that window completely. React renders are synchronous
  // within a commit phase, so this executes before the browser gets a chance to
  // schedule another animation frame.
  //
  // We use a ref to remember the scene id we armed the flag for, so we only
  // call setSceneRestoring(true) once per scene transition (not on every render).
  const guardedSceneIdRef = useRef<string | null>(null);
  if (activeSceneId !== prevSceneIdRef.current && activeSceneId !== guardedSceneIdRef.current) {
    // Only arm when there is actually a saved canvas to restore — brand-new
    // scenes skip the loadFromJSON path entirely and never need the guard.
    guardedSceneIdRef.current = activeSceneId;
    setSceneRestoring(true);
  }

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (prevSceneIdRef.current === activeSceneId) return;

    const prevId = prevSceneIdRef.current;

    // ── 1. ALWAYS clear stale selection before switching scenes ────────────
    canvas.discardActiveObject();
    setSelectedObject(null, null);

    // Hide ALL PIXI armature displays immediately on scene switch.
    // afterLoad / the new-scene branch will selectively re-show the ones that
    // belong to the incoming scene, preventing cross-scene bleed.
    armatureDisplaysRef.current.forEach(d => { d.visible = false; });

    // ── 2. Save the leaving scene's canvas + thumbnail ─────────────────────
    if (prevId) {
      try {
        // Between setActiveScene() and this effect running, a RAF tick may
        // have added objects from the INCOMING scene onto the canvas (because
        // applyKeyframesAtTime reads activeSceneId from Zustand, which has
        // already updated). Serialize only objects that belong to prevId's
        // tracks so the saved JSON is clean.
        const store = useEditorStore.getState();
        const prevTrackIds = new Set(
          store.tracks
            .filter(t => t.sceneId === prevId)
            .map(t => t.id)
        );

        const all = canvas.getObjects();
        const intruders = all.filter(obj => {
          const cid  = (obj as any)._customId;
          const ctype = (obj as any).customType;
          if (ctype === "background" || ctype === "drawing") return false;
          if (!cid) return false;
          return !prevTrackIds.has(cid);
        });

        // Temporarily remove intruders, serialize, then restore
        intruders.forEach(obj => canvas.remove(obj));
        const json = JSON.stringify(canvas.toJSON());
        saveSceneCanvasData(prevId, json);
        const thumb = canvas.toDataURL({ format: "png", multiplier: 0.2 });
        updateSceneThumbnail(prevId, thumb);
        intruders.forEach(obj => canvas.add(obj));
      } catch (e) {
        console.warn("[Scene] Failed to save canvas snapshot", e);
      }
    }

    prevSceneIdRef.current = activeSceneId;

    // ── 3. Restore or initialise the incoming scene ───────────────────────
    const saved = getSceneCanvasData(activeSceneId);

    // Called once the canvas is fully repopulated after loadFromJSON resolves.
    //
    // IMPORTANT: In Fabric v6, loadFromJSON(json, reviver?) returns a Promise.
    // The second argument is a per-object REVIVER, not a done-callback.
    // We must chain .then(afterLoad) on the returned Promise — passing afterLoad
    // as the second arg to loadFromJSON would call it once per deserialized
    // object (with wrong arguments and a partially-populated canvas), which is
    // why the old approach silently broke all scene-restore logic.
    const afterLoad = () => {
      const store = useEditorStore.getState();
      const sceneTracks = store.tracks.filter(t => t.sceneId === activeSceneId);
      const canvasObjects = canvas.getObjects();

      sceneTracks.forEach(track => {
        // ── Re-link fabricObject to the fresh instance created by loadFromJSON ─
        // loadFromJSON creates brand-new Fabric object instances; the old refs
        // stored in tracks are stale and no longer on canvas after restore.
        const matches = canvasObjects.filter(
          (o: any) => o._customId === track.id
        );
        // Remove ghost duplicates (should never happen, but guard anyway)
        if (matches.length > 1) {
          matches.slice(0, -1).forEach(ghost => canvas.remove(ghost));
        }
        const freshObj = matches[matches.length - 1] as any;
        if (freshObj && freshObj !== track.fabricObject) {
          store.updateTrack(track.id, { fabricObject: freshObj });
        }

        // ── Re-attach PIXI armature display for character / prop tracks ────────
        // The PIXI display is still alive on pixiApp.stage (we never destroy it
        // on scene switch), but freshObj.armatureDisplay is null because it's a
        // brand-new Fabric object. Without re-linking, applyKeyframesAtTime
        // can't drive the DragonBones position or animation.
        if (!freshObj) return;
        const ct = freshObj.customType ?? "";
        if (ct !== "character" && ct !== "prop") return;
        const pixiApp = pixiAppRef.current;
        if (!pixiApp) return;

        const existingDisplay = armatureDisplaysRef.current.find(d => {
          // Match by proximity to the fresh proxy's saved position.
          const dx = Math.abs(d.x - (freshObj.left ?? 0));
          const dy = Math.abs(d.y - (freshObj.top  ?? 0));
          const alreadyClaimed = canvasObjects.some(
            (o: any) => o !== freshObj && o.armatureDisplay === d
          );
          return !alreadyClaimed && dx < 300 && dy < 600;
        });

        if (existingDisplay) {
          freshObj.armatureDisplay = existingDisplay;
          // Copy cached size/scale metadata from the now-stale old proxy
          const old = track.fabricObject as any;
          if (old) {
            if (old.dbScale     != null) freshObj.dbScale     = old.dbScale;
            if (old.charW       != null) freshObj.charW       = old.charW;
            if (old.charH       != null) freshObj.charH       = old.charH;
            if (old.propOffsetX != null) freshObj.propOffsetX = old.propOffsetX;
            if (old.propOffsetY != null) freshObj.propOffsetY = old.propOffsetY;
          }
          existingDisplay.visible = true;
          // Restore the saved animation — the display may have been left in a
          // different animation by preview playback (e.g. mid-walk when the
          // preview ended). Always replay the track's stored animation so the
          // character looks correct when returning to the canvas.
          const savedAnim = track.characterAnimation;
          if (
            savedAnim &&
            existingDisplay.animation.animationNames.includes(savedAnim) &&
            existingDisplay.animation.lastAnimationName !== savedAnim
          ) {
            existingDisplay.animation.play(savedAnim, 0);
          }
        } else {
          // Fallback: queue a full armature re-load — but only if the initial
          // load's pendingArmatures list isn't already going to handle this
          // trackId. Checking current store pendingArmatures prevents a second
          // concurrent load that would spawn a duplicate PIXI display.
          const currentPending = useEditorStore.getState().pendingArmatures ?? [];
          const alreadyQueued = currentPending.some((p: any) => p.trackId === track.id);
          if (!alreadyQueued) {
            const pa: import("../../utils/saveLoad").PendingArmature = {
              trackId:            track.id,
              assetName:          (freshObj._assetName ?? "") as string,
              customType:         ct as "character" | "prop",
              left:               freshObj.left   ?? 0,
              top:                freshObj.top    ?? 0,
              scaleX:             freshObj.scaleX ?? 1,
              scaleY:             freshObj.scaleY ?? 1,
              angle:              freshObj.angle  ?? 0,
              opacity:            freshObj.opacity ?? 1,
              characterAnimation: track.characterAnimation ?? undefined,
            };
            setPendingArmatures([pa]);
          }
        }
      });

      // Restore complete — applyKeyframesAtTime may resume calling canvas.add()
      setSceneRestoring(false);

      // Fix background — always reconcile the canvas background with the
      // scene store's current state.  This covers three cases:
      //   1. No bgObj at all → create a solid colour rect.
      //   2. bgObj is a colour Rect → update its fill to sc.bg.
      //   3. bgObj is a FabricImage but sc.bgImageUrl is now undefined (the
      //      user switched to solid colour after the last snapshot was saved) →
      //      replace the stale image with a fresh solid colour rect so the
      //      background does not bleed across from the old state.
      const sc = useEditorStore.getState().scenes.find(s => s.id === activeSceneId);
      if (sc) {
        const bgObj = canvas.getObjects().find((o: any) => (o as any).customType === "background");
        const bgIsImage = bgObj && (bgObj as any).type === "image";

        if (!bgObj) {
          // Case 1 — no background object; create one.
          const bg = new Rect({
            left: 0, top: 0,
            width: canvas.getWidth(), height: canvas.getHeight(),
            fill: sc.bg,
            selectable: false, evented: false,
            lockMovementX: true, lockMovementY: true,
            lockScalingX: true, lockScalingY: true,
            lockRotation: true, hasControls: false, hasBorders: false,
          });
          (bg as any).customType = "background";
          canvas.add(bg);
          canvas.sendObjectToBack(bg);
        } else if (bgIsImage && !sc.bgImageUrl) {
          // Case 3 — stale image background but scene now wants solid colour.
          // Remove the image and lay down a solid rect instead.
          canvas.remove(bgObj);
          const bg = new Rect({
            left: 0, top: 0,
            width: canvas.getWidth(), height: canvas.getHeight(),
            fill: sc.bg,
            selectable: false, evented: false,
            lockMovementX: true, lockMovementY: true,
            lockScalingX: true, lockScalingY: true,
            lockRotation: true, hasControls: false, hasBorders: false,
          });
          (bg as any).customType = "background";
          canvas.add(bg);
          canvas.sendObjectToBack(bg);
        } else if (!bgIsImage) {
          // Case 2 — existing colour rect; update fill.
          (bgObj as any).set({ fill: sc.bg });
          (bgObj as any).dirty = true;
        }
      }

      // Immediately position all objects at the current scrub position so that
      // path-animated objects (plain and character) snap to the right spot and
      // kick off their DragonBones animations without waiting for the next tick.
      useEditorStore.getState().applyKeyframesAtTime(
        useEditorStore.getState().currentTime
      );

      // Hide proxy borders on all character/prop rects — loadFromJSON may have
      // restored the old (visible) stroke from the saved JSON snapshot.
      canvas.getObjects().forEach((o: any) => {
        if (o.customType === "character" || o.customType === "prop") {
          if (!o._proxyStroke) {
            // Back-fill metadata for objects saved before this fix
            o._proxyStroke = o.customType === "character"
              ? "rgba(100,100,255,0.5)"
              : "rgba(249,115,22,0.5)";
            o._proxyFill = o.customType === "character"
              ? "rgba(100,100,255,0.08)"
              : "rgba(249,115,22,0.08)";
          }
          o.set({ stroke: "transparent", fill: "rgba(0,0,0,0)" });
          o.dirty = true;
        }
      });

      canvas.renderAll();
    };

    if (saved) {
      // sceneRestoring was already set to true synchronously during render
      // (before this effect ran) to block any RAF ticks that fired in between.
      // We call it again here as a belt-and-suspenders safety net in case the
      // render-time guard was somehow skipped (e.g. StrictMode double-invoke).
      setSceneRestoring(true);
      // Clear first — Fabric v6 loadFromJSON appends rather than replaces,
      // so without this objects from the previous scene linger as ghosts.
      canvas.remove(...canvas.getObjects());
      // loadFromJSON returns a Promise in Fabric v6; chain .then() for the
      // done-callback (second arg is reviver, not completion callback).
      canvas.loadFromJSON(saved).then(afterLoad).catch((e: unknown) => {
        setSceneRestoring(false);
        console.warn("[Scene] Failed to restore canvas snapshot", e);
      });
    } else {
      // No saved JSON for this scene — always clear the canvas and lay down a
      // fresh background. We intentionally do NOT check sceneInitializedRef
      // here: if we skipped this path the canvas would keep whatever objects
      // the previous scene (or preview) left on it, causing cross-scene bleed.
      setSceneRestoring(false);
      sceneInitializedRef.current.add(activeSceneId);
      canvas.remove(...canvas.getObjects());

      const sc = useEditorStore.getState().scenes.find(s => s.id === activeSceneId);
      if (sc) {
        if (sc.bgImageUrl) {
          // Scene was created with an uploaded image — load it as a FabricImage background
          const img = new Image();
          img.onload = () => {
            const canvasW = canvas.getWidth();
            const canvasH = canvas.getHeight();
            const naturalW = img.naturalWidth || img.width || 1;
            const naturalH = img.naturalHeight || img.height || 1;
            const scale = Math.max(canvasW / naturalW, canvasH / naturalH);
            const renderedW = naturalW * scale;
            const renderedH = naturalH * scale;
            const fabricImg = new FabricImage(img, {
              left: (canvasW - renderedW) / 2,
              top:  (canvasH - renderedH) / 2,
              scaleX: scale,
              scaleY: scale,
              originX: "left",
              originY: "top",
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
            (fabricImg as any).customType = "background";
            canvas.add(fabricImg);
            canvas.moveObjectTo(fabricImg, 0);
            canvas.renderAll();
          };
          img.crossOrigin = "anonymous";
          img.src = sc.bgImageUrl;
        } else {
          const bg = new Rect({
            left: 0, top: 0,
            width: canvas.getWidth(), height: canvas.getHeight(),
            fill: sc.bg,
            selectable: false, evented: false,
            lockMovementX: true, lockMovementY: true,
            lockScalingX: true, lockScalingY: true,
            lockRotation: true, hasControls: false, hasBorders: false,
          });
          (bg as any).customType = "background";
          canvas.add(bg);
          canvas.sendObjectToBack(bg);
        }
      }
      canvas.renderAll();
    }
  }, [activeSceneId, saveSceneCanvasData, getSceneCanvasData, updateSceneThumbnail, setSelectedObject]);

  // When scene bg changes (from Backgrounds tab), update canvas background live.
  // Handles three sub-cases:
  //   a. bgObj is a colour Rect  → update fill directly.
  //   b. bgObj is a FabricImage but sc.bgImageUrl is now gone (user switched to
  //      solid colour) → replace the image with a solid rect immediately so the
  //      old image does not linger until the next scene restore cycle.
  //   c. No bgObj at all → create a fresh solid rect.
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    // ── Guard: skip while a scene switch is in flight ────────────────────────
    // prevSceneIdRef trails activeSceneId until the switch effect runs. If we
    // mutate the canvas background during that window we corrupt the snapshot
    // being serialised for the leaving scene, causing its bg colour to bleed
    // into the incoming scene on every subsequent switch.
    if (isSceneRestoring || prevSceneIdRef.current !== activeSceneId) return;
    const sc = scenes.find(s => s.id === activeSceneId);
    if (!sc) return;
    const bgObj = canvas.getObjects().find((o: any) => (o as any).customType === "background");
    const bgIsImage = bgObj && (bgObj as any).type === "image";

    if (bgIsImage && !sc.bgImageUrl) {
      // Sub-case b: stale image, scene now wants solid colour.
      canvas.remove(bgObj);
      const bg = new Rect({
        left: 0, top: 0,
        width: canvas.getWidth(), height: canvas.getHeight(),
        fill: sc.bg,
        selectable: false, evented: false,
        lockMovementX: true, lockMovementY: true,
        lockScalingX: true, lockScalingY: true,
        lockRotation: true, hasControls: false, hasBorders: false,
      });
      (bg as any).customType = "background";
      canvas.add(bg);
      canvas.sendObjectToBack(bg);
      canvas.renderAll();
    } else if (bgObj && !bgIsImage) {
      // Sub-case a: existing colour rect, just update the fill.
      (bgObj as any).set({ fill: sc.bg });
      (bgObj as any).dirty = true;
      canvas.renderAll();
    } else if (!bgObj) {
      // Sub-case c: no background at all — create one.
      const bg = new Rect({
        left: 0, top: 0,
        width: canvas.getWidth(), height: canvas.getHeight(),
        fill: sc.bg,
        selectable: false, evented: false,
        lockMovementX: true, lockMovementY: true,
        lockScalingX: true, lockScalingY: true,
        lockRotation: true, hasControls: false, hasBorders: false,
      });
      (bg as any).customType = "background";
      canvas.add(bg);
      canvas.sendObjectToBack(bg);
      canvas.renderAll();
    }
  }, [scenes, activeSceneId]);

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

  // Sync Lottie scene animations with timeline playback
  useEffect(() => {
    tracks.forEach((track) => {
      if (track.type !== "visual" || !track.fabricObject) return;
      const anim = (track.fabricObject as any)._lottieAnim;
      if (!anim) return;

      const isWithinTrack = currentTime >= track.startTime && currentTime <= track.endTime;

      if (!isWithinTrack) {
        // Outside track range — pause and hide
        if (!anim.isPaused) anim.pause();
        if (track.fabricObject.opacity !== 0) {
          track.fabricObject.set({ opacity: 0 });
        }
        return;
      }

      // Restore opacity when back in range
      const savedOpacity = (track.initialState as any)?.opacity ?? 1;
      if ((track.fabricObject.opacity ?? 1) === 0) {
        track.fabricObject.set({ opacity: savedOpacity });
      }

      // Seek to the correct frame based on currentTime
      const elapsed = currentTime - track.startTime;
      const totalFrames = anim.totalFrames;
      const duration = anim.getDuration(false); // seconds
      const targetFrame = duration > 0
        ? ((elapsed % duration) / duration) * totalFrames
        : 0;

      if (isPlaying) {
        if (anim.isPaused) anim.play();
      } else {
        // Scrubbing — seek to exact frame
        if (!anim.isPaused) anim.pause();
        anim.goToAndStop(targetFrame, true);
        fabricRef.current?.requestRenderAll();
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
        <canvas ref={canvasRef} className="block" data-canvas-role="fabric" />
        <canvas 
          ref={pixiCanvasRef} 
          className="absolute top-0 left-0 pointer-events-none block" 
          style={{ backgroundColor: 'transparent' }}
          data-canvas-role="pixi"
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
          onOpenAudioFilters={() => {
            const store = useEditorStore.getState();
            const track = store.tracks.find(t => t.id === store.selectedObjectId);
            if (track) setAudioFilterPanel({
              trackId: track.id,
              trackName: track.name,
              mediaOffset: track.mediaOffset ?? 0,
              clipDuration: track.endTime - track.startTime,
            });
          }}
          onSetAsBackground={() => {
            const store = useEditorStore.getState();
            const obj = store.selectedObject;
            if (!obj) return;
            // Fabric stores the underlying HTMLImageElement on ._element
            const imgEl: HTMLImageElement | null =
              (obj as any)._element ??
              (obj as any)._originalElement ??
              null;
            if (imgEl instanceof HTMLImageElement) {
              setBgCropTarget(imgEl);
            } else {
              // Fallback: export the fabric object as a data URL
              const dataUrl = (obj as any).toDataURL?.({ format: "png" });
              if (dataUrl) {
                const img = new Image();
                img.onload = () => setBgCropTarget(img);
                img.src = dataUrl;
              }
            }
          }}
        />
      )}

      {/* Audio Filter Panel */}
      {audioFilterPanel && (
        <AudioFilterPanel
          trackId={audioFilterPanel.trackId}
          trackName={audioFilterPanel.trackName}
          mediaOffset={audioFilterPanel.mediaOffset}
          clipDuration={audioFilterPanel.clipDuration}
          onClose={() => setAudioFilterPanel(null)}
        />
      )}

      {/* Background crop modal */}
      {bgCropTarget && fabricRef.current && (
        <BackgroundCropModal
          imageElement={bgCropTarget}
          canvasWidth={fabricRef.current.getWidth()}
          canvasHeight={fabricRef.current.getHeight()}
          onClose={() => setBgCropTarget(null)}
          onApply={(offsetX, offsetY, scale) => {
            setBgCropTarget(null);
            const store = useEditorStore.getState();
            const { selectedObject, canvas } = store;
            if (!selectedObject || !canvas) return;

            store.saveCheckpoint();

            // Handle any existing background:
            // - If it is an image/gif → detach it back to a normal moveable asset
            // - If it is a solid colour Rect → remove it entirely
            const existingBgs = canvas.getObjects().filter(
              (o) => (o as any).customType === "background" && o !== selectedObject
            );
            existingBgs.forEach((oldBg) => {
              const isImageBg =
                (oldBg as any).type === "image" ||
                (oldBg as any).customType === "gif" ||
                typeof (oldBg as any).getSrc === "function";

              if (isImageBg) {
                // Detach: restore to a normal selectable asset at a sensible size
                (oldBg as any).customType = "item";
                const naturalW = (oldBg as any).width  || 1;
                const naturalH = (oldBg as any).height || 1;
                const targetSize = 200;
                const normalScale = Math.min(
                  targetSize / naturalW,
                  targetSize / naturalH,
                );
                const canvasW2 = canvas.getWidth();
                const canvasH2 = canvas.getHeight();
                oldBg.set({
                  selectable: true,
                  evented: true,
                  hasControls: true,
                  hasBorders: true,
                  lockMovementX: false,
                  lockMovementY: false,
                  lockScalingX: false,
                  lockScalingY: false,
                  lockRotation: false,
                  originX: "left",
                  originY: "top",
                  scaleX: normalScale,
                  scaleY: normalScale,
                  left: canvasW2 / 2 - (naturalW * normalScale) / 2,
                  top:  canvasH2 / 2 - (naturalH * normalScale) / 2,
                });
                oldBg.setCoords();
              } else {
                // Solid colour Rect — just remove it
                canvas.remove(oldBg);
              }
            });

            const canvasW = canvas.getWidth();
            const canvasH = canvas.getHeight();
            const naturalW = (selectedObject as any).width || 1;
            const naturalH = (selectedObject as any).height || 1;

            // scale is already in real canvas units from the modal
            const renderedW = naturalW * scale;
            const renderedH = naturalH * scale;

            // Save current transform so detachBackground can restore it
            (selectedObject as any)._preBackgroundState = {
              scaleX: selectedObject.scaleX ?? 1,
              scaleY: selectedObject.scaleY ?? 1,
              left:   selectedObject.left   ?? 0,
              top:    selectedObject.top    ?? 0,
            };
            (selectedObject as any).customType = "background";
            selectedObject.set({
              selectable: false,
              evented: false,
              hasControls: false,
              hasBorders: false,
              lockMovementX: true,
              lockMovementY: true,
              lockScalingX: true,
              lockScalingY: true,
              lockRotation: true,
              originX: "left",
              originY: "top",
              scaleX: scale,
              scaleY: scale,
              left: (canvasW - renderedW) / 2 + offsetX,
              top:  (canvasH - renderedH) / 2 + offsetY,
            });
            selectedObject.setCoords();
            canvas.moveObjectTo(selectedObject, 0);
            canvas.renderAll();
            store.captureState(store.selectedObjectId!);

            // Persist the new background image URL into the scene store so it
            // survives scene switches and initial loads.
            const imgSrc =
              (selectedObject as any)._element?.src ||
              (selectedObject as any)._originalElement?.src ||
              (selectedObject as any).getSrc?.() ||
              null;
            if (imgSrc) {
              updateSceneBgImage(store.activeSceneId, imgSrc);
            }
          }}
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