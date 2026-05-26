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

(window as any).PIXI = PIXI;

declare const dragonBones: any;

export function CanvasEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixiCanvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const pixiAppRef = useRef<PIXI.Application | null>(null);


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
        
        // Ensure ticker is running
        if (!pixiApp.ticker.started) {
          pixiApp.ticker.start();
          console.log("Started PIXI ticker");
        }
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
        const armature = (obj as any).armature;
        if (armature) {
          // Center the armature within the proxy rect
          const proxyW = (obj.width || 200) * (obj.scaleX || 1);
          const proxyH = (obj.height || 200) * (obj.scaleY || 1);
          armature.x = (obj.left || 0) + proxyW / 2;
          armature.y = (obj.top || 0) + proxyH / 2;
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
        const armature = (target as any).armature;
        if (armature) {
          const proxyW = (target.width || 200) * (target.scaleX || 1);
          const proxyH = (target.height || 200) * (target.scaleY || 1);
          armature.x = (target.left || 0) + proxyW / 2;
          armature.y = (target.top || 0) + proxyH / 2;
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

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.isDrawingMode = drawingEnabled;
    canvas.selection = !drawingEnabled;

    if (drawingEnabled) {
      if (!canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      }
      canvas.freeDrawingBrush.color = drawingColor;
      canvas.freeDrawingBrush.width = drawingBrushSize;
    }
  }, [drawingEnabled, drawingColor, drawingBrushSize]);

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
      const SKE_URL = "/dragonbones/characte_2_ske.json";
      const TEX_URL = "/dragonbones/characte_2_tex.json";
      const IMG_URL = "/dragonbones/characte_2_tex.png";
      const ARMATURE_NAME = "Armature";

      // Cache loaded data on the window to avoid re-fetching
      const cache = (window as any).__dbCache || ((window as any).__dbCache = {});

      // Create proxy rect immediately and add to timeline synchronously
      // This ensures character appears in timeline even if PIXI loading fails
      const proxySize = 200;
      const proxy = new Rect({
        left: baseLeft,
        top: baseTop,
        width: proxySize,
        height: proxySize,
        fill: "#6464FF",
        opacity: 0.15,
        stroke: "#6464FF",
        strokeWidth: 2,
        strokeDashArray: [6, 4],
        rx: 4,
        ry: 4,
      });

      // Add to canvas and timeline immediately (synchronous)
      addObjectToCanvas(proxy, id, asset);

      // Then asynchronously load and render the PIXI armature
      const buildCharacter = (skeData: any, texData: any, texture: PIXI.Texture) => {
        try {
          const pixiApp = pixiAppRef.current;
          if (!pixiApp) {
            console.warn("PIXI app not available, character will display as proxy only");
            return;
          }

          console.log("Building character with armature:", ARMATURE_NAME, "from data:", skeData.name);

          // Reuse or create a singleton factory (dragonBones expects one per armature dataset)
          let factory: any = (window as any).__dbFactory;
          if (!factory) {
            factory = dragonBones.PixiFactory.factory;
            (window as any).__dbFactory = factory;
          }

          const dataName = skeData.name;
          
          // Check if data already exists
          if (!factory.getDragonBonesData(dataName)) {
            console.log("Parsing DragonBones data:", dataName);
            factory.parseDragonBonesData(skeData);
            factory.parseTextureAtlasData(texData, texture);
          } else {
            console.log("DragonBones data already exists:", dataName);
          }

          // Get first armature name from skeleton
          const firstArmatureName = skeData.armature?.[0]?.name || ARMATURE_NAME;
          console.log("Available armatures:", skeData.armature?.map((a: any) => a.name));
          
          const armatureDisplay = factory.buildArmatureDisplay(firstArmatureName, dataName);
          if (!armatureDisplay) {
            console.error(`Failed to build ArmatureDisplay for armature '${firstArmatureName}' in data '${dataName}'`);
            return;
          }

          console.log("Built armature successfully, available animations:", Object.keys(armatureDisplay.animation.animations));

          // Map asset names to animation names
          const animationNameMap: Record<string, string> = {
            'stand': 'Idle',
            'walk': 'walk',
            'run': 'run'
          };

          const animationName = animationNameMap[asset.name] || asset.name;

          // Try to play the animation if it exists
          if (armatureDisplay.animation.animations[animationName]) {
            console.log(`Playing animation: '${animationName}'`);
            armatureDisplay.animation.play(animationName, 0); // 0 = loop forever
          } else {
            console.warn(`Animation '${animationName}' not found for asset '${asset.name}'`);
            // Try to play first available animation
            const animations = Object.keys(armatureDisplay.animation.animations);
            if (animations.length > 0) {
              console.log(`Playing default animation: '${animations[0]}'`);
              armatureDisplay.animation.play(animations[0], 0);
            }
          }

          // Position the armature at the center of the proxy
          armatureDisplay.x = baseLeft + 100;  // center of proxySize=200
          armatureDisplay.y = baseTop + 100;
          armatureDisplay.scale.set(1);
          
          console.log(`Positioning armature at (${armatureDisplay.x}, ${armatureDisplay.y})`);
          
          pixiApp.stage.addChild(armatureDisplay);
          console.log("Armature added to PIXI stage, total children:", pixiApp.stage.children.length);

          // Store reference to armature so it moves with the proxy
          (proxy as any).armature = armatureDisplay;

        } catch (e) {
          console.error("Error building DragonBones armature:", e);
          console.warn("Character added to timeline and canvas but PIXI rendering failed");
        }
      };

      const loadAndBuild = async () => {
        try {
          console.log("Starting DragonBones asset loading...");
          // Use PIXI v8 Assets API (replaces the removed v5 loader)
          if (!cache.skeData) {
            console.log("Loading skeleton and texture data from:", SKE_URL, TEX_URL);
            const [skeData, texData] = await Promise.all([
              fetch(SKE_URL).then(r => r.json()),
              fetch(TEX_URL).then(r => r.json()),
            ]);
            cache.skeData = skeData;
            cache.texData = texData;
            console.log("Skeleton and texture data loaded successfully");
          }
          if (!cache.texture) {
            console.log("Loading texture image from:", IMG_URL);
            try {
              cache.texture = await PIXI.Assets.load(IMG_URL);
              console.log("Texture loaded successfully");
            } catch (imgErr) {
              console.warn("PIXI.Assets.load failed, trying alternative method:", imgErr);
              // Fallback: Load image using direct fetch and create PIXI texture
              const response = await fetch(IMG_URL);
              if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.statusText}`);
              }
              const blob = await response.blob();
              const objectUrl = URL.createObjectURL(blob);
              try {
                cache.texture = await PIXI.Assets.load(objectUrl);
                console.log("Texture loaded via blob URL");
              } finally {
                URL.revokeObjectURL(objectUrl);
              }
            }
          }
          buildCharacter(cache.skeData, cache.texData, cache.texture);
        } catch (err) {
          console.error("Failed to load DragonBones assets:", err);
          console.warn("Character has been added to timeline and canvas as a proxy. PIXI rendering failed.");
        }
      };

      loadAndBuild();
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
    </div>
  );
}
