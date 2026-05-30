/**
 * Save / Load project as a self-contained JSON file.
 *
 * Everything is saved — including DragonBones characters and props.
 * Characters/props are restored by re-calling loadCharacter/loadProp with the
 * saved asset name and position, so no armature binary needs to be bundled.
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
} from "fabric";
import type { TrackObject } from "../types";

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
  // character / prop
  assetName?: string;   // the animation / prop name used to re-create the armature
  dbScale?: number;
  charW?: number;
  charH?: number;
  propOffsetX?: number;
  propOffsetY?: number;
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

  const base: SavedFabricObject = {
    fabricType: obj.type ?? "unknown",
    customType: obj.customType ?? obj.type ?? "unknown",
    left:    obj.left    ?? 0,
    top:     obj.top     ?? 0,
    scaleX:  obj.scaleX  ?? 1,
    scaleY:  obj.scaleY  ?? 1,
    angle:   obj.angle   ?? 0,
    opacity: obj.opacity ?? 1,
    flipX:   obj.flipX   ?? false,
    flipY:   obj.flipY   ?? false,
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
    base.assetName    = obj._assetName ?? "";
    base.dbScale      = obj.dbScale;
    base.propOffsetX  = obj.propOffsetX;
    base.propOffsetY  = obj.propOffsetY;
    base.width        = obj.width;
    base.height       = obj.height;
    return base;
  }

  // ── Image / background ─────────────────────────────────────────────────────
  if (ct === "image" || ct === "background") {
    const el = obj._originalElement ?? obj._element ?? obj.getElement?.();
    base.src    = el?.src ?? obj.src ?? null;
    base.width  = obj.width;
    base.height = obj.height;
    return base;
  }

  // ── Text ───────────────────────────────────────────────────────────────────
  if (obj.type === "i-text" || ct === "text") {
    base.text       = obj.text ?? "";
    base.fontSize   = obj.fontSize ?? 36;
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
  if (obj.type === "circle")   { base.shapeType = "circle";   base.shapeFill = obj.fill; base.radius = obj.radius; }
  else if (obj.type === "rect")  {
    base.shapeType = "rect";   base.shapeFill = obj.fill;
    base.width = obj.width;    base.height = obj.height;
    base.rx    = obj.rx;       base.ry = obj.ry;
    base.stroke = obj.stroke;  base.strokeWidth = obj.strokeWidth;
  }
  else if (obj.type === "triangle") { base.shapeType = "triangle"; base.shapeFill = obj.fill; base.width = obj.width; base.height = obj.height; }
  else if (obj.type === "ellipse")  { base.shapeType = "ellipse";  base.shapeFill = obj.fill; base.rx = obj.rx; base.ry = obj.ry; }
  else if (obj.type === "polygon")  { base.shapeType = "polygon";  base.shapeFill = obj.fill; base.points = obj.points ? [...obj.points] : []; }
  else if (obj.type === "path")     {
    base.shapeType = "path";   base.shapeFill = obj.fill;
    base.stroke = obj.stroke;  base.strokeWidth = obj.strokeWidth;
    base.pathData = obj.path ? JSON.stringify(obj.path) : "";
  }
  else if (obj.type === "line")     { base.shapeType = "line"; base.stroke = obj.stroke; base.strokeWidth = obj.strokeWidth; base.shapeFill = obj.fill; }

  return base;
}

function serializeDrawings(canvas: FabricCanvas): SavedDrawing[] {
  return canvas
    .getObjects()
    .filter((o: any) => o.customType === "drawing")
    .map((o: any) => ({
      _customId:      o._customId ?? `d_${Date.now()}`,
      path:           JSON.parse(JSON.stringify(o.path ?? [])),
      stroke:         o.stroke ?? "#ffffff",
      strokeWidth:    o.strokeWidth ?? 6,
      strokeLineCap:  o.strokeLineCap  ?? "round",
      strokeLineJoin: o.strokeLineJoin ?? "round",
      left:    o.left    ?? 0,
      top:     o.top     ?? 0,
      scaleX:  o.scaleX  ?? 1,
      scaleY:  o.scaleY  ?? 1,
      angle:   o.angle   ?? 0,
      opacity: o.opacity ?? 1,
    }));
}

// ─── Save ─────────────────────────────────────────────────────────────────────

export function saveProject(
  canvas: FabricCanvas | null,
  tracks: TrackObject[],
  projectName: string,
  duration: number
) {
  if (!canvas) return;

  const savedTracks: SavedTrack[] = tracks.map((t) => ({
    id:              t.id,
    name:            t.name,
    type:            t.type,
    color:           t.color,
    startTime:       t.startTime,
    endTime:         t.endTime,
    mediaOffset:     t.mediaOffset,
    mediaDuration:   t.mediaDuration,
    volume:          t.volume,
    keyframes:       JSON.parse(JSON.stringify(t.keyframes)),
    initialState:    { ...t.initialState },
    imageFilters:    t.imageFilters ? [...t.imageFilters] : undefined,
    characterAnimation: (t as any).characterAnimation,
    pathAnimation:      t.pathAnimation ? JSON.parse(JSON.stringify(t.pathAnimation)) : null,
    pendingPathAction:  (t as any).pendingPathAction  ?? null,
    sequenceAction:     (t as any).sequenceAction     ?? null,
    audioSrc:        t.audioSrc ?? undefined,
    fabricObject:    t.type !== "audio" ? serializeFabricObject(t.fabricObject) : null,
  }));

  const save: ProjectSave = {
    version:     2,
    projectName,
    canvasWidth:  canvas.getWidth(),
    canvasHeight: canvas.getHeight(),
    duration,
    savedAt:     new Date().toISOString(),
    tracks:      savedTracks,
    drawings:    serializeDrawings(canvas),
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
          left: saved.left, top: saved.top,
          scaleX: saved.scaleX, scaleY: saved.scaleY,
          angle: saved.angle, opacity: saved.opacity,
          flipX: saved.flipX, flipY: saved.flipY,
        });
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
      video.width = 480; video.height = 360;
      document.body.appendChild(video);
      const onReady = () => {
        const fi = new FabricImage(video as any, {
          left: saved.left, top: saved.top,
          scaleX: saved.scaleX, scaleY: saved.scaleY,
          angle: saved.angle, opacity: saved.opacity,
          objectCaching: false,
        });
        (fi as any).customType = "video";
        (fi as any)._element   = video;
        resolve(fi);
      };
      if (video.readyState >= 1) onReady();
      else video.onloadedmetadata = onReady;
      video.load();
    });
  }

  // ── Text ───────────────────────────────────────────────────────────────────
  if (ct === "text" || saved.fabricType === "i-text") {
    return new IText(saved.text ?? "", {
      left: saved.left, top: saved.top,
      scaleX: saved.scaleX, scaleY: saved.scaleY,
      angle: saved.angle, opacity: saved.opacity,
      fontSize: saved.fontSize ?? 36,
      fontFamily: saved.fontFamily ?? "Arial",
      fontWeight: saved.fontWeight as any ?? "normal",
      fontStyle:  saved.fontStyle  as any ?? "normal",
      underline:  saved.underline  ?? false,
      fill: saved.fill ?? "#ffffff",
    });
  }

  // ── Shapes ─────────────────────────────────────────────────────────────────
  const base = {
    left: saved.left, top: saved.top,
    scaleX: saved.scaleX, scaleY: saved.scaleY,
    angle: saved.angle, opacity: saved.opacity,
    flipX: saved.flipX, flipY: saved.flipY,
  };
  const st = saved.shapeType ?? saved.fabricType;

  if (st === "circle")   return new Circle({ ...base, radius: saved.radius ?? 50, fill: saved.shapeFill ?? "#4ecdc4" });
  if (st === "triangle") return new Triangle({ ...base, width: saved.width ?? 100, height: saved.height ?? 100, fill: saved.shapeFill ?? "#4ecdc4" });
  if (st === "ellipse")  return new Ellipse({ ...base, rx: saved.rx ?? 70, ry: saved.ry ?? 40, fill: saved.shapeFill ?? "#4ecdc4" });
  if (st === "polygon")  return new Polygon(saved.points ?? [], { ...base, fill: saved.shapeFill ?? "#4ecdc4" });
  if (st === "rect") {
    return new Rect({
      ...base,
      width: saved.width ?? 100, height: saved.height ?? 100,
      fill: saved.shapeFill ?? "#4ecdc4",
      rx: saved.rx ?? 0, ry: saved.ry ?? 0,
      stroke: saved.stroke, strokeWidth: saved.strokeWidth,
      strokeDashArray: saved.stroke ? [4, 4] : undefined,
    });
  }
  if (st === "path") {
    const pathData = saved.pathData ? JSON.parse(saved.pathData) : [];
    return new Path(pathData, {
      ...base, fill: saved.shapeFill ?? "",
      stroke: saved.stroke, strokeWidth: saved.strokeWidth,
      strokeLineCap: "round", strokeLineJoin: "round",
    });
  }

  return null;
}

function restoreDrawings(canvas: FabricCanvas, drawings: SavedDrawing[]) {
  canvas.getObjects()
    .filter((o: any) => o.customType === "drawing")
    .forEach((o: any) => canvas.remove(o));

  drawings.forEach((d) => {
    const p = new Path(d.path as any, {
      stroke: d.stroke, strokeWidth: d.strokeWidth, fill: "",
      strokeLineCap: d.strokeLineCap as any, strokeLineJoin: d.strokeLineJoin as any,
      selectable: false, evented: false,
      left: d.left, top: d.top, scaleX: d.scaleX, scaleY: d.scaleY,
      angle: d.angle, opacity: d.opacity,
    });
    (p as any).customType = "drawing";
    (p as any)._customId  = d._customId;
    canvas.add(p);
  });
}

// ─── Load ─────────────────────────────────────────────────────────────────────

export async function loadProject(
  file: File,
  canvas: FabricCanvas | null,
  callbacks: {
    setProjectName: (n: string) => void;
    setDuration:    (d: number) => void;
    clearCanvas:    () => void;
    addTrack:       (t: TrackObject) => void;
    saveCheckpoint: () => void;
  }
): Promise<{ warnings: string[]; pendingArmatures: PendingArmature[] }> {
  const warnings: string[] = [];
  const pendingArmatures: PendingArmature[] = [];

  const text = await file.text();
  const save: ProjectSave = JSON.parse(text);

  if (!save.version || !save.tracks) throw new Error("Invalid save file.");

  callbacks.clearCanvas();
  callbacks.setProjectName(save.projectName);
  callbacks.setDuration(save.duration);

  if (!canvas) return { warnings: ["Canvas not ready."], pendingArmatures: [] };

  for (const st of save.tracks) {
    // ── Audio ──────────────────────────────────────────────────────────────
    if (st.type === "audio") {
      if (!st.audioSrc) {
        warnings.push(`Audio "${st.name}": media src missing — re-upload the file.`);
        continue;
      }
      const audio = new Audio(st.audioSrc);
      audio.preload = "auto";
      audio.crossOrigin = "anonymous";
      callbacks.addTrack({
        id: st.id, name: st.name, type: "audio", color: st.color,
        startTime: st.startTime, endTime: st.endTime,
        mediaOffset: st.mediaOffset, mediaDuration: st.mediaDuration,
        volume: st.volume ?? 1,
        keyframes: st.keyframes, initialState: st.initialState,
        fabricObject: null, audioElement: audio, audioSrc: st.audioSrc,
      });
      continue;
    }

    const fo = st.fabricObject;
    const ct = fo?.customType ?? "";

    // ── Character ──────────────────────────────────────────────────────────
    if (ct === "character") {
      // Create placeholder proxy rect now; CanvasEditor will swap in the
      // real DragonBones display via restoreCharactersAndProps()
      const proxy = new Rect({
        left: fo!.left, top: fo!.top,
        width:  fo!.charW ?? 103,
        height: fo!.charH ?? 300,
        scaleX: fo!.scaleX, scaleY: fo!.scaleY,
        angle: fo!.angle,   opacity: fo!.opacity,
        fill:        "rgba(100,100,255,0.08)",
        stroke:      "rgba(100,100,255,0.5)",
        strokeWidth: 1,
        strokeDashArray: [4, 4],
        rx: 4, ry: 4,
      });
      (proxy as any)._customId  = st.id;
      (proxy as any)._assetName = st.name;
      (proxy as any).customType = "character";
      (proxy as any).dbScale    = fo!.dbScale;
      (proxy as any).charW      = fo!.charW ?? 103;
      (proxy as any).charH      = fo!.charH ?? 300;
      canvas.add(proxy);

      const track: TrackObject = {
        id: st.id, name: st.name, type: "visual" as any, color: st.color,
        startTime: st.startTime, endTime: st.endTime,
        keyframes: st.keyframes, initialState: st.initialState,
        fabricObject: proxy as any,
        audioElement: null,
      } as any;
      (track as any).characterAnimation = st.characterAnimation;
      (track as any).pathAnimation      = st.pathAnimation   ?? null;
      (track as any).pendingPathAction  = st.pendingPathAction ?? null;
      (track as any).sequenceAction     = st.sequenceAction  ?? null;
      callbacks.addTrack(track);

      pendingArmatures.push({
        trackId: st.id,
        assetName: fo!.assetName ?? st.characterAnimation ?? "Idle",
        customType: "character",
        left: fo!.left, top: fo!.top,
        scaleX: fo!.scaleX, scaleY: fo!.scaleY,
        angle: fo!.angle,   opacity: fo!.opacity,
        characterAnimation: st.characterAnimation,
      });
      continue;
    }

    // ── Prop ───────────────────────────────────────────────────────────────
    if (ct === "prop") {
      const isChair = fo!.assetName === "chair";

      if (isChair) {
        // Chair is a plain image — restore normally
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
        } as any);
        continue;
      }

      // Non-chair prop: placeholder proxy, real display loaded by CanvasEditor
      const proxy = new Rect({
        left: fo!.left, top: fo!.top,
        width: fo!.width ?? 120, height: fo!.height ?? 100,
        scaleX: fo!.scaleX, scaleY: fo!.scaleY,
        angle: fo!.angle, opacity: fo!.opacity,
        fill:        "rgba(249,115,22,0.08)",
        stroke:      "rgba(249,115,22,0.5)",
        strokeWidth: 1, strokeDashArray: [4, 4],
        rx: 4, ry: 4,
      });
      (proxy as any)._customId    = st.id;
      (proxy as any)._assetName   = st.name;
      (proxy as any).customType   = "prop";
      (proxy as any).dbScale      = fo!.dbScale;
      (proxy as any).propOffsetX  = fo!.propOffsetX;
      (proxy as any).propOffsetY  = fo!.propOffsetY;
      canvas.add(proxy);

      const track: TrackObject = {
        id: st.id, name: st.name, type: "visual" as any, color: st.color,
        startTime: st.startTime, endTime: st.endTime,
        keyframes: st.keyframes, initialState: st.initialState,
        fabricObject: proxy as any, audioElement: null,
      } as any;
      (track as any).characterAnimation = st.characterAnimation;
      (track as any).pathAnimation      = st.pathAnimation   ?? null;
      (track as any).pendingPathAction  = st.pendingPathAction ?? null;
      (track as any).sequenceAction     = st.sequenceAction  ?? null;
      callbacks.addTrack(track);

      pendingArmatures.push({
        trackId: st.id,
        assetName: fo!.assetName ?? st.name,
        customType: "prop",
        left: fo!.left, top: fo!.top,
        scaleX: fo!.scaleX, scaleY: fo!.scaleY,
        angle: fo!.angle,   opacity: fo!.opacity,
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
      const track: TrackObject = {
        id: st.id, name: st.name, type: "video", color: st.color,
        startTime: st.startTime, endTime: st.endTime,
        mediaOffset: st.mediaOffset, mediaDuration: st.mediaDuration,
        volume: st.volume ?? 1,
        keyframes: st.keyframes, initialState: st.initialState,
        fabricObject, audioElement: null, audioSrc: st.audioSrc,
      } as any;
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
        (fabricObject as any).customType = "background";
        (fabricObject as any).selectable = false;
        (fabricObject as any).evented    = false;
        canvas.add(fabricObject);
        canvas.sendObjectToBack(fabricObject);
      } else {
        canvas.add(fabricObject);
      }
    }

    const track: TrackObject = {
      id: st.id, name: st.name, type: st.type as any, color: st.color,
      startTime: st.startTime, endTime: st.endTime,
      mediaOffset: st.mediaOffset, mediaDuration: st.mediaDuration,
      volume: st.volume,
      keyframes: st.keyframes, initialState: st.initialState,
      imageFilters: st.imageFilters,
      fabricObject, audioElement: null, audioSrc: st.audioSrc,
    } as any;
    (track as any).characterAnimation = st.characterAnimation;
    (track as any).pathAnimation      = st.pathAnimation   ?? null;
    (track as any).pendingPathAction  = st.pendingPathAction ?? null;
    (track as any).sequenceAction     = st.sequenceAction  ?? null;
    callbacks.addTrack(track);
  }

  restoreDrawings(canvas, save.drawings ?? []);
  canvas.requestRenderAll();
  callbacks.saveCheckpoint();

  return { warnings, pendingArmatures };
}