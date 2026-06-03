/**
 * Save / Load project as a self-contained JSON file.
 *
 * Version 3 adds:
 *   - scenes[] array (labels, durations, bg, lottieUrl, bgImageUrl, transitions, thumbnails)
 *   - sceneId on every track so multi-scene assignments round-trip correctly
 *   - activeSceneId
 *   - sceneCanvasData (per-scene canvas JSON snapshots)
 *   - ttsParams on audio tracks
 *   - audioFilterKeys / audioCleaningKeys / processedAudioSrc
 *   - trimmed flag on tracks
 *   - lock state (lockMovementX/Y, lockRotation, lockScalingX/Y) on fabric objects
 *   - imageFilters properly re-applied on load
 *   - canvasWidth / canvasHeight restored on the canvas
 */

import type { Canvas as FabricCanvas } from "fabric";
import {
  FabricImage,
  IText,
  Rect,
  Circle,
  Ellipse,
  Triangle,
  Polygon,
  Path,
  Line,
  filters,
} from "fabric";
import type { TrackObject } from "../types";
import type { SceneItem } from "../stores/slices/sceneSlice";

// ─── Image filter helpers (mirrors canvasSlice.ts) ────────────────────────────

const buildImageFilters = (filterKeys: string[]) => {
  const map: Record<string, () => any> = {
    grayscale:  () => new filters.Grayscale(),
    sepia:      () => new filters.Sepia(),
    vintage:    () => new filters.Vintage(),
    blur:       () => new filters.Blur({ blur: 0.2 }),
    contrast:   () => new filters.Contrast({ contrast: 0.2 }),
    brightness: () => new filters.Brightness({ brightness: 0.1 }),
  };
  return filterKeys.map((k) => map[k]).filter(Boolean).map((f) => f());
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface SavedDrawing {
  _customId: string;
  path: any[];
  stroke: string;
  strokeWidth: number;
  strokeLineCap: string;
  strokeLineJoin: string;
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  opacity: number;
  pathOffset?: { x: number; y: number };
}

interface SavedFabricObject {
  fabricType: string;
  customType: string;
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  opacity: number;
  flipX: boolean;
  flipY: boolean;
  // lock state
  locked?: boolean;
  // image
  src?: string;
  width?: number;
  height?: number;
  isBackground?: boolean;
  // text
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  underline?: boolean;
  fill?: string;
  // shape
  shapeType?: string;
  shapeFill?: string;
  radius?: number;
  rx?: number;
  ry?: number;
  pathData?: string;
  points?: { x: number; y: number }[];
  stroke?: string;
  strokeWidth?: number;
  strokeDashArray?: number[];
  // line endpoints
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  // character / prop
  assetName?: string;
  dbScale?: number;
  charW?: number;
  charH?: number;
  propOffsetX?: number;
  propOffsetY?: number;
  // image filters
  imageFilterKeys?: string[];
}

interface SavedTrack {
  id: string;
  name: string;
  type: string;
  color: string;
  startTime: number;
  endTime: number;
  mediaOffset?: number;
  mediaDuration?: number;
  volume?: number;
  keyframes: any[];
  initialState: any;
  imageFilters?: string[];
  characterAnimation?: string;
  pathAnimation?: any;
  pendingPathAction?: any;
  sequenceAction?: any;
  audioSrc?: string;
  fabricObject?: SavedFabricObject | null;
  // v3 additions
  sceneId?: string;
  ttsParams?: { text: string; lang: string; pitch: number; rate: number } | null;
  audioFilterKeys?: string[];
  audioCleaningKeys?: string[];
  processedAudioSrc?: string | null;
  originalMediaOffset?: number;
  trimmed?: boolean;
}

/** Saved scene (mirrors SceneItem minus transient runtime fields) */
interface SavedScene {
  id: string;
  label: string;
  duration: number;
  bg: string;
  bgImageUrl?: string;
  lottieUrl?: string;
  lottieEmoji?: string;
  thumbnail?: string;
  transition?: "none" | "fade" | "slide" | "zoom" | "wipe";
}

export interface ProjectSave {
  version: number;
  projectName: string;
  canvasWidth: number;
  canvasHeight: number;
  duration: number;
  savedAt: string;
  tracks: SavedTrack[];
  drawings: SavedDrawing[];
  // v3 additions
  scenes?: SavedScene[];
  activeSceneId?: string;
  sceneCanvasData?: Record<string, string>;
}

// ── Pending character/prop restore info (returned to CanvasEditor) ────────────
export interface PendingArmature {
  trackId: string;
  assetName: string;
  customType: "character" | "prop";
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  opacity: number;
  characterAnimation?: string;
}

// ─── Serialize helpers ────────────────────────────────────────────────────────

function serializeFabricObject(obj: any): SavedFabricObject | null {
  if (!obj) return null;

  const isLocked = !!(obj.lockMovementX);

  const base: SavedFabricObject = {
    fabricType:  obj.type     ?? "unknown",
    customType:  obj.customType ?? obj.type ?? "unknown",
    left:    obj.left    ?? 0,
    top:     obj.top     ?? 0,
    scaleX:  obj.scaleX  ?? 1,
    scaleY:  obj.scaleY  ?? 1,
    angle:   obj.angle   ?? 0,
    opacity: obj.opacity ?? 1,
    flipX:   obj.flipX   ?? false,
    flipY:   obj.flipY   ?? false,
    locked:  isLocked,
    isBackground: obj.customType === "background",
  };

  const ct = obj.customType ?? obj.type;

  // ── Character ──────────────────────────────────────────────────────────────
  if (ct === "character") {
    base.assetName = obj._assetName ?? obj.characterAnimation ?? "Idle";
    base.dbScale   = obj.dbScale;
    base.charW     = obj.charW ?? obj.width;
    base.charH     = obj.charH ?? obj.height;
    return base;
  }

  // ── Prop ───────────────────────────────────────────────────────────────────
  if (ct === "prop") {
    base.assetName   = obj._assetName ?? "";
    base.dbScale     = obj.dbScale;
    base.propOffsetX = obj.propOffsetX;
    base.propOffsetY = obj.propOffsetY;
    base.width       = obj.width;
    base.height      = obj.height;
    return base;
  }

  // ── Image / background ─────────────────────────────────────────────────────
  if (ct === "image" || ct === "background") {
    const el = obj._originalElement ?? obj._element ?? obj.getElement?.();
    base.src    = el?.src ?? obj.src ?? null;
    base.width  = obj.width;
    base.height = obj.height;
    // Save active filter keys (stored as _imageFilters by setImageFilters)
    const fk: string[] = obj._imageFilters ?? [];
    if (fk.length > 0) base.imageFilterKeys = fk;
    return base;
  }

  // ── Text ───────────────────────────────────────────────────────────────────
  if (obj.type === "i-text" || ct === "text") {
    base.text       = obj.text ?? "";
    base.fontSize   = obj.fontSize   ?? 36;
    base.fontFamily = obj.fontFamily ?? "Arial";
    base.fontWeight = obj.fontWeight ?? "normal";
    base.fontStyle  = obj.fontStyle  ?? "normal";
    base.underline  = obj.underline  ?? false;
    base.fill       = obj.fill ?? "#ffffff";
    return base;
  }

  // ── Video ──────────────────────────────────────────────────────────────────
  if (ct === "video") {
    const el = (obj as any)._element as HTMLVideoElement | null;
    base.src    = el?.src ?? null;
    base.width  = obj.width;
    base.height = obj.height;
    return base;
  }

  // ── Shapes ─────────────────────────────────────────────────────────────────
  if (obj.type === "circle") {
    base.shapeType = "circle";
    base.shapeFill = obj.fill;
    base.radius    = obj.radius;
    base.stroke    = obj.stroke;
    base.strokeWidth = obj.strokeWidth;
  } else if (obj.type === "rect") {
    base.shapeType      = "rect";
    base.shapeFill      = obj.fill;
    base.width          = obj.width;
    base.height         = obj.height;
    base.rx             = obj.rx;
    base.ry             = obj.ry;
    base.stroke         = obj.stroke;
    base.strokeWidth    = obj.strokeWidth;
    base.strokeDashArray = obj.strokeDashArray ? [...obj.strokeDashArray] : undefined;
  } else if (obj.type === "triangle") {
    base.shapeType = "triangle";
    base.shapeFill = obj.fill;
    base.width     = obj.width;
    base.height    = obj.height;
    base.stroke    = obj.stroke;
    base.strokeWidth = obj.strokeWidth;
  } else if (obj.type === "ellipse") {
    base.shapeType = "ellipse";
    base.shapeFill = obj.fill;
    base.rx        = obj.rx;
    base.ry        = obj.ry;
    base.stroke    = obj.stroke;
    base.strokeWidth = obj.strokeWidth;
  } else if (obj.type === "polygon") {
    base.shapeType = "polygon";
    base.shapeFill = obj.fill;
    base.points    = obj.points ? [...obj.points] : [];
    base.stroke    = obj.stroke;
    base.strokeWidth = obj.strokeWidth;
    base.strokeDashArray = obj.strokeDashArray ? [...obj.strokeDashArray] : undefined;
  } else if (obj.type === "path") {
    base.shapeType   = "path";
    base.shapeFill   = obj.fill;
    base.stroke      = obj.stroke;
    base.strokeWidth = obj.strokeWidth;
    base.strokeDashArray = obj.strokeDashArray ? [...obj.strokeDashArray] : undefined;
    base.pathData    = obj.path ? JSON.stringify(obj.path) : "";
  } else if (obj.type === "line") {
    base.shapeType   = "line";
    base.stroke      = obj.stroke;
    base.strokeWidth = obj.strokeWidth;
    base.strokeDashArray = obj.strokeDashArray ? [...obj.strokeDashArray] : undefined;
    base.shapeFill   = obj.fill;
    base.x1 = obj.x1;
    base.y1 = obj.y1;
    base.x2 = obj.x2;
    base.y2 = obj.y2;
  }

  return base;
}

function serializeDrawings(canvas: FabricCanvas): SavedDrawing[] {
  return canvas
    .getObjects()
    .filter((o: any) => o.customType === "drawing")
    .map((o: any) => ({
      _customId:      o._customId ?? `d_${Date.now()}`,
      path:           JSON.parse(JSON.stringify(o.path ?? [])),
      stroke:         o.stroke         ?? "#ffffff",
      strokeWidth:    o.strokeWidth    ?? 6,
      strokeLineCap:  o.strokeLineCap  ?? "round",
      strokeLineJoin: o.strokeLineJoin ?? "round",
      left:    o.left    ?? 0,
      top:     o.top     ?? 0,
      scaleX:  o.scaleX  ?? 1,
      scaleY:  o.scaleY  ?? 1,
      angle:   o.angle   ?? 0,
      opacity: o.opacity ?? 1,
      pathOffset: o.pathOffset ? { ...o.pathOffset } : undefined,
    }));
}

// ─── Save ─────────────────────────────────────────────────────────────────────

export function saveProject(
  canvas: FabricCanvas | null,
  tracks: TrackObject[],
  projectName: string,
  duration: number,
  scenes?: SceneItem[],
  activeSceneId?: string,
  sceneCanvasData?: Record<string, string>,
) {
  if (!canvas) return;

  const savedTracks: SavedTrack[] = tracks.map((t) => ({
    id:            t.id,
    name:          t.name,
    type:          t.type,
    color:         t.color,
    startTime:     t.startTime,
    endTime:       t.endTime,
    mediaOffset:   t.mediaOffset,
    mediaDuration: t.mediaDuration,
    volume:        t.volume,
    keyframes:     JSON.parse(JSON.stringify(t.keyframes)),
    initialState:  { ...t.initialState },
    imageFilters:  t.imageFilters ? [...t.imageFilters] : undefined,
    characterAnimation: (t as any).characterAnimation,
    pathAnimation:      t.pathAnimation ? JSON.parse(JSON.stringify(t.pathAnimation)) : null,
    pendingPathAction:  (t as any).pendingPathAction  ?? null,
    sequenceAction:     (t as any).sequenceAction     ?? null,
    audioSrc:           t.audioSrc ?? undefined,
    fabricObject:       t.type !== "audio" ? serializeFabricObject(t.fabricObject) : null,
    // v3 fields
    sceneId:            t.sceneId ?? undefined,
    ttsParams:          (t as any).ttsParams ?? null,
    audioFilterKeys:    (t as any).audioFilterKeys   ?? undefined,
    audioCleaningKeys:  (t as any).audioCleaningKeys ?? undefined,
    // Processed audio is a blob URL — not persistable, skip
    processedAudioSrc:  null,
    originalMediaOffset: (t as any).originalMediaOffset ?? undefined,
    trimmed:            (t as any).trimmed ?? undefined,
  }));

  // Serialize scenes (strip runtime-only fields like trackIds)
  const savedScenes: SavedScene[] | undefined = scenes?.map((s) => ({
    id:          s.id,
    label:       s.label,
    duration:    s.duration,
    bg:          s.bg,
    bgImageUrl:  s.bgImageUrl,
    lottieUrl:   s.lottieUrl,
    lottieEmoji: s.lottieEmoji,
    thumbnail:   s.thumbnail,
    transition:  s.transition,
  }));

  const save: ProjectSave = {
    version:     3,
    projectName,
    canvasWidth:  canvas.getWidth(),
    canvasHeight: canvas.getHeight(),
    duration,
    savedAt:      new Date().toISOString(),
    tracks:       savedTracks,
    drawings:     serializeDrawings(canvas),
    scenes:       savedScenes,
    activeSceneId,
    sceneCanvasData,
  };

  const blob = new Blob([JSON.stringify(save, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${projectName.replace(/\s+/g, "_")}_save.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Rebuild fabric objects ───────────────────────────────────────────────────

async function rebuildFabricObject(saved: SavedFabricObject): Promise<any | null> {
  const ct = saved.customType ?? saved.fabricType;

  // Characters and props are handled separately (need PIXI / CanvasEditor context)
  if (ct === "character" || ct === "prop") return null;

  // ── Image / background ─────────────────────────────────────────────────────
  if (ct === "image" || ct === "background") {
    if (!saved.src) return null;
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const fi = new FabricImage(img, {
          left:    saved.left,
          top:     saved.top,
          scaleX:  saved.scaleX,
          scaleY:  saved.scaleY,
          angle:   saved.angle,
          opacity: saved.opacity,
          flipX:   saved.flipX,
          flipY:   saved.flipY,
        });
        // Restore image filters
        const fk = saved.imageFilterKeys ?? [];
        if (fk.length > 0) {
          (fi as any).filters = buildImageFilters(fk);
          (fi as any).applyFilters();
          (fi as any)._imageFilters = fk;
        }
        // Restore lock state
        if (saved.locked) applyLockState(fi, true);
        resolve(fi);
      };
      img.onerror = () => resolve(null);
      img.src = saved.src!;
    });
  }

  // ── Video ──────────────────────────────────────────────────────────────────
  if (ct === "video") {
    if (!saved.src) return null;
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.src = saved.src!;
      video.crossOrigin = "anonymous";
      video.muted = true;
      video.playsInline = true;
      video.style.display = "none";
      video.width  = 480;
      video.height = 360;
      document.body.appendChild(video);
      const onReady = () => {
        const fi = new FabricImage(video as any, {
          left:    saved.left,
          top:     saved.top,
          scaleX:  saved.scaleX,
          scaleY:  saved.scaleY,
          angle:   saved.angle,
          opacity: saved.opacity,
          objectCaching: false,
        });
        (fi as any).customType  = "video";
        (fi as any)._element    = video;
        if (saved.locked) applyLockState(fi, true);
        resolve(fi);
      };
      if (video.readyState >= 1) onReady();
      else video.onloadedmetadata = onReady;
      video.load();
    });
  }

  // ── Text ───────────────────────────────────────────────────────────────────
  if (ct === "text" || saved.fabricType === "i-text") {
    const it = new IText(saved.text ?? "", {
      left:       saved.left,
      top:        saved.top,
      scaleX:     saved.scaleX,
      scaleY:     saved.scaleY,
      angle:      saved.angle,
      opacity:    saved.opacity,
      fontSize:   saved.fontSize   ?? 36,
      fontFamily: saved.fontFamily ?? "Arial",
      fontWeight: saved.fontWeight as any ?? "normal",
      fontStyle:  saved.fontStyle  as any ?? "normal",
      underline:  saved.underline  ?? false,
      fill:       saved.fill ?? "#ffffff",
    });
    if (saved.locked) applyLockState(it, true);
    return it;
  }

  // ── Shapes ─────────────────────────────────────────────────────────────────
  const base = {
    left:    saved.left,
    top:     saved.top,
    scaleX:  saved.scaleX,
    scaleY:  saved.scaleY,
    angle:   saved.angle,
    opacity: saved.opacity,
    flipX:   saved.flipX,
    flipY:   saved.flipY,
  };
  const st = saved.shapeType ?? saved.fabricType;
  let shape: any = null;

  if (st === "circle") {
    shape = new Circle({
      ...base,
      radius: saved.radius ?? 50,
      fill:   saved.shapeFill ?? "#4ecdc4",
      stroke: saved.stroke,
      strokeWidth: saved.strokeWidth,
    });
  } else if (st === "triangle") {
    shape = new Triangle({
      ...base,
      width:  saved.width  ?? 100,
      height: saved.height ?? 100,
      fill:   saved.shapeFill ?? "#4ecdc4",
      stroke: saved.stroke,
      strokeWidth: saved.strokeWidth,
    });
  } else if (st === "ellipse") {
    shape = new Ellipse({
      ...base,
      rx:     saved.rx ?? 70,
      ry:     saved.ry ?? 40,
      fill:   saved.shapeFill ?? "#4ecdc4",
      stroke: saved.stroke,
      strokeWidth: saved.strokeWidth,
    });
  } else if (st === "polygon") {
    shape = new Polygon(saved.points ?? [], {
      ...base,
      fill:   saved.shapeFill ?? "#4ecdc4",
      stroke: saved.stroke,
      strokeWidth: saved.strokeWidth,
      strokeDashArray: saved.strokeDashArray,
    });
  } else if (st === "line") {
    const x1 = saved.x1 ?? (saved.left ?? 0);
    const y1 = saved.y1 ?? (saved.top  ?? 0);
    const x2 = saved.x2 ?? (saved.left ?? 0) + 120;
    const y2 = saved.y2 ?? (saved.top  ?? 0);
    shape = new Line([x1, y1, x2, y2], {
      ...base,
      stroke:          saved.stroke       ?? "#ffffff",
      strokeWidth:     saved.strokeWidth  ?? 6,
      fill:            saved.shapeFill    ?? "",
      strokeLineCap:   "round" as any,
      strokeDashArray: saved.strokeDashArray,
    });
  } else if (st === "rect") {
    shape = new Rect({
      ...base,
      width:           saved.width  ?? 100,
      height:          saved.height ?? 100,
      fill:            saved.shapeFill ?? "#4ecdc4",
      rx:              saved.rx ?? 0,
      ry:              saved.ry ?? 0,
      stroke:          saved.stroke,
      strokeWidth:     saved.strokeWidth,
      strokeDashArray: saved.strokeDashArray ?? (saved.stroke ? [4, 4] : undefined),
    });
  } else if (st === "path") {
    const pathData = saved.pathData ? JSON.parse(saved.pathData) : [];
    shape = new Path(pathData, {
      ...base,
      fill:            saved.shapeFill ?? "",
      stroke:          saved.stroke,
      strokeWidth:     saved.strokeWidth,
      strokeLineCap:   "round",
      strokeLineJoin:  "round",
      strokeDashArray: saved.strokeDashArray,
    });
  }

  if (shape && saved.locked) applyLockState(shape, true);
  return shape ?? null;
}

/** Apply locked state to a Fabric object (mirrors toggleLock in canvasSlice) */
function applyLockState(obj: any, locked: boolean) {
  obj.set({
    lockMovementX: locked,
    lockMovementY: locked,
    lockRotation:  locked,
    lockScalingX:  locked,
    lockScalingY:  locked,
    selectable: true,
    evented:    true,
    borderColor: locked ? "#ff4444" : "#4ecdc4",
    cornerColor: locked ? "#ff4444" : "#ffffff",
  });
}

function restoreDrawings(canvas: FabricCanvas, drawings: SavedDrawing[]) {
  canvas.getObjects()
    .filter((o: any) => o.customType === "drawing")
    .forEach((o: any) => canvas.remove(o));

  drawings.forEach((d) => {
    const p = new Path(d.path as any, {
      stroke:         d.stroke,
      strokeWidth:    d.strokeWidth,
      fill:           "",
      strokeLineCap:  d.strokeLineCap  as any,
      strokeLineJoin: d.strokeLineJoin as any,
      selectable: false,
      evented:    false,
      left:    d.left,
      top:     d.top,
      scaleX:  d.scaleX,
      scaleY:  d.scaleY,
      angle:   d.angle,
      opacity: d.opacity,
    });
    (p as any).customType = "drawing";
    (p as any)._customId  = d._customId;
    if (d.pathOffset) (p as any).pathOffset = { ...d.pathOffset };
    canvas.add(p);
  });
}

// ─── Load ─────────────────────────────────────────────────────────────────────

export async function loadProject(
  file: File,
  canvas: FabricCanvas | null,
  callbacks: {
    setProjectName:    (n: string) => void;
    setDuration:       (d: number) => void;
    clearCanvas:       () => void;
    addTrack:          (t: TrackObject) => void;
    saveCheckpoint:    () => void;
    // v3 callbacks (optional so old callers don't break)
    setScenes?:        (scenes: SceneItem[]) => void;
    setActiveSceneId?: (id: string) => void;
    saveSceneCanvasData?: (id: string, json: string) => void;
    resizeCanvas?:     (w: number, h: number) => void;
  }
): Promise<{ warnings: string[]; pendingArmatures: PendingArmature[] }> {
  const warnings: string[]          = [];
  const pendingArmatures: PendingArmature[] = [];

  const text = await file.text();
  const save: ProjectSave = JSON.parse(text);

  if (!save.version || !save.tracks) throw new Error("Invalid save file.");

  callbacks.clearCanvas();
  callbacks.setProjectName(save.projectName);
  callbacks.setDuration(save.duration);

  // ── Restore canvas dimensions ─────────────────────────────────────────────
  if (canvas && save.canvasWidth && save.canvasHeight) {
    if (callbacks.resizeCanvas) {
      callbacks.resizeCanvas(save.canvasWidth, save.canvasHeight);
    } else {
      // Direct resize if no callback provided
      canvas.setWidth(save.canvasWidth);
      canvas.setHeight(save.canvasHeight);
    }
  }

  // ── Restore scenes (v3) ───────────────────────────────────────────────────
  if (save.scenes && save.scenes.length > 0 && callbacks.setScenes) {
    callbacks.setScenes(save.scenes as SceneItem[]);
  }
  if (save.activeSceneId && callbacks.setActiveSceneId) {
    callbacks.setActiveSceneId(save.activeSceneId);
  }
  // Restore per-scene canvas snapshots
  if (save.sceneCanvasData && callbacks.saveSceneCanvasData) {
    for (const [sceneId, json] of Object.entries(save.sceneCanvasData)) {
      callbacks.saveSceneCanvasData(sceneId, json);
    }
  }

  if (!canvas) return { warnings: ["Canvas not ready."], pendingArmatures: [] };

  for (const st of save.tracks) {
    // ── Audio ──────────────────────────────────────────────────────────────
    if (st.type === "audio") {
      // ── TTS track ────────────────────────────────────────────────────────
      if (st.ttsParams && st.audioSrc === "tts://") {
        callbacks.addTrack({
          id: st.id, name: st.name, type: "audio", color: st.color,
          startTime: st.startTime, endTime: st.endTime,
          keyframes: st.keyframes, initialState: st.initialState,
          fabricObject: null, audioElement: null,
          audioSrc: "tts://",
          mediaDuration: st.mediaDuration,
          volume: st.volume ?? 1,
          ttsParams: st.ttsParams,
          sceneId: st.sceneId,
        } as any);
        continue;
      }

      // ── Regular audio track ───────────────────────────────────────────────
      if (!st.audioSrc) {
        warnings.push(`Audio "${st.name}": media src missing — re-upload the file.`);
        continue;
      }
      const audio = new Audio(st.audioSrc);
      audio.preload = "auto";
      audio.crossOrigin = "anonymous";
      const audioTrack: any = {
        id: st.id, name: st.name, type: "audio", color: st.color,
        startTime: st.startTime, endTime: st.endTime,
        mediaOffset: st.mediaOffset, mediaDuration: st.mediaDuration,
        volume: st.volume ?? 1,
        keyframes: st.keyframes, initialState: st.initialState,
        fabricObject: null, audioElement: audio, audioSrc: st.audioSrc,
        sceneId: st.sceneId,
        trimmed: st.trimmed,
        // Audio filter state — note processedAudioSrc is not restored
        // since blob URLs don't survive serialization; keys are kept so
        // the UI can show which filters were applied.
        audioFilterKeys:     st.audioFilterKeys   ?? [],
        audioCleaningKeys:   st.audioCleaningKeys ?? [],
        processedAudioSrc:   null,
        originalMediaOffset: st.originalMediaOffset ?? undefined,
      };
      callbacks.addTrack(audioTrack);
      continue;
    }

    const fo = st.fabricObject;
    const ct = fo?.customType ?? "";

    // ── Character ──────────────────────────────────────────────────────────
    if (ct === "character") {
      const proxy = new Rect({
        left: fo!.left, top: fo!.top,
        width:  fo!.charW ?? 103,
        height: fo!.charH ?? 300,
        scaleX: fo!.scaleX, scaleY: fo!.scaleY,
        angle:  fo!.angle,  opacity: fo!.opacity,
        fill:        "rgba(100,100,255,0.0)",
        stroke:      "transparent",
        strokeWidth: 1,
        strokeDashArray: [4, 4],
        rx: 4, ry: 4,
      });
      (proxy as any)._proxyStroke = "rgba(100,100,255,0.5)";
      (proxy as any)._proxyFill   = "rgba(100,100,255,0.08)";
      (proxy as any)._customId    = st.id;
      (proxy as any)._assetName   = st.name;
      (proxy as any).customType   = "character";
      (proxy as any).dbScale      = fo!.dbScale;
      (proxy as any).charW        = fo!.charW ?? 103;
      (proxy as any).charH        = fo!.charH ?? 300;
      canvas.add(proxy);

      const track: any = {
        id: st.id, name: st.name, type: "visual", color: st.color,
        startTime: st.startTime, endTime: st.endTime,
        keyframes: st.keyframes, initialState: st.initialState,
        fabricObject: proxy,
        audioElement: null,
        sceneId: st.sceneId,
        trimmed: st.trimmed,
      };
      track.characterAnimation = st.characterAnimation;
      track.pathAnimation      = st.pathAnimation   ?? null;
      track.pendingPathAction  = st.pendingPathAction ?? null;
      track.sequenceAction     = st.sequenceAction  ?? null;
      callbacks.addTrack(track);

      pendingArmatures.push({
        trackId: st.id,
        assetName: fo!.assetName ?? st.characterAnimation ?? "Idle",
        customType: "character",
        left: fo!.left, top: fo!.top,
        scaleX: fo!.scaleX, scaleY: fo!.scaleY,
        angle:  fo!.angle,  opacity: fo!.opacity,
        characterAnimation: st.characterAnimation,
      });
      continue;
    }

    // ── Prop ───────────────────────────────────────────────────────────────
    if (ct === "prop") {
      const isChair = fo!.assetName === "chair";

      if (isChair) {
        const chairObj = await rebuildFabricObject({ ...fo!, customType: "image", src: "/chair_new.png" });
        if (chairObj) {
          (chairObj as any)._customId  = st.id;
          (chairObj as any)._assetName = st.name;
          (chairObj as any).customType = "prop";
          canvas.add(chairObj);
        }
        callbacks.addTrack({
          id: st.id, name: st.name, type: "visual" as any, color: st.color,
          startTime: st.startTime, endTime: st.endTime,
          keyframes: st.keyframes, initialState: st.initialState,
          fabricObject: chairObj as any, audioElement: null,
          sceneId: st.sceneId,
          trimmed: st.trimmed,
        } as any);
        continue;
      }

      const proxy = new Rect({
        left: fo!.left, top: fo!.top,
        width: fo!.width ?? 120, height: fo!.height ?? 100,
        scaleX: fo!.scaleX, scaleY: fo!.scaleY,
        angle:  fo!.angle,  opacity: fo!.opacity,
        fill:        "rgba(249,115,22,0.0)",
        stroke:      "transparent",
        strokeWidth: 1, strokeDashArray: [4, 4],
        rx: 4, ry: 4,
      });
      (proxy as any)._proxyStroke = "rgba(249,115,22,0.5)";
      (proxy as any)._proxyFill   = "rgba(249,115,22,0.08)";
      (proxy as any)._customId    = st.id;
      (proxy as any)._assetName   = st.name;
      (proxy as any).customType   = "prop";
      (proxy as any).dbScale      = fo!.dbScale;
      (proxy as any).propOffsetX  = fo!.propOffsetX;
      (proxy as any).propOffsetY  = fo!.propOffsetY;
      canvas.add(proxy);

      const track: any = {
        id: st.id, name: st.name, type: "visual", color: st.color,
        startTime: st.startTime, endTime: st.endTime,
        keyframes: st.keyframes, initialState: st.initialState,
        fabricObject: proxy, audioElement: null,
        sceneId: st.sceneId,
        trimmed: st.trimmed,
      };
      track.characterAnimation = st.characterAnimation;
      track.pathAnimation      = st.pathAnimation   ?? null;
      track.pendingPathAction  = st.pendingPathAction ?? null;
      track.sequenceAction     = st.sequenceAction  ?? null;
      callbacks.addTrack(track);

      pendingArmatures.push({
        trackId: st.id,
        assetName: fo!.assetName ?? st.name,
        customType: "prop",
        left: fo!.left, top: fo!.top,
        scaleX: fo!.scaleX, scaleY: fo!.scaleY,
        angle:  fo!.angle,  opacity: fo!.opacity,
        characterAnimation: st.characterAnimation,
      });
      continue;
    }

    // ── Video ──────────────────────────────────────────────────────────────
    if (st.type === "video") {
      let fabricObject: any = null;
      if (fo?.src) {
        try { fabricObject = await rebuildFabricObject(fo); } catch { /**/ }
      }
      if (!fo?.src) {
        warnings.push(`Video "${st.name}": media src missing — re-upload the file.`);
      }
      if (fabricObject) {
        (fabricObject as any)._customId = st.id;
        canvas.add(fabricObject);
      }
      const track: any = {
        id: st.id, name: st.name, type: "video", color: st.color,
        startTime: st.startTime, endTime: st.endTime,
        mediaOffset: st.mediaOffset, mediaDuration: st.mediaDuration,
        volume: st.volume ?? 1,
        keyframes: st.keyframes, initialState: st.initialState,
        fabricObject, audioElement: null, audioSrc: st.audioSrc,
        sceneId: st.sceneId,
        trimmed: st.trimmed,
      };
      callbacks.addTrack(track);
      continue;
    }

    // ── Visual (image, shape, text, background) ────────────────────────────
    let fabricObject: any = null;
    if (fo) {
      try { fabricObject = await rebuildFabricObject(fo); } catch { /**/ }
    }
    if (fabricObject) {
      (fabricObject as any)._customId  = st.id;
      (fabricObject as any)._assetName = st.name;
      (fabricObject as any).customType = fo?.customType ?? "visual";

      if (fo?.isBackground) {
        (fabricObject as any).customType  = "background";
        (fabricObject as any).selectable  = false;
        (fabricObject as any).evented     = false;
        canvas.add(fabricObject);
        canvas.sendObjectToBack(fabricObject);
      } else {
        canvas.add(fabricObject);
      }
    }

    const track: any = {
      id: st.id, name: st.name, type: st.type, color: st.color,
      startTime: st.startTime, endTime: st.endTime,
      mediaOffset:  st.mediaOffset,
      mediaDuration: st.mediaDuration,
      volume:       st.volume,
      keyframes:    st.keyframes,
      initialState: st.initialState,
      imageFilters: st.imageFilters,
      fabricObject, audioElement: null, audioSrc: st.audioSrc,
      sceneId: st.sceneId,
      trimmed: st.trimmed,
    };
    track.characterAnimation = st.characterAnimation;
    track.pathAnimation      = st.pathAnimation   ?? null;
    track.pendingPathAction  = st.pendingPathAction ?? null;
    track.sequenceAction     = st.sequenceAction  ?? null;
    callbacks.addTrack(track);
  }

  restoreDrawings(canvas, save.drawings ?? []);
  canvas.requestRenderAll();
  callbacks.saveCheckpoint();

  return { warnings, pendingArmatures };
}