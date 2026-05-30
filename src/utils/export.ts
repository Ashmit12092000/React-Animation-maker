import type { Canvas as FabricCanvas } from 'fabric';
import type { TrackObject } from '../types';

/**
 * Export the full scene as a self-contained JSON suitable for
 * external renderers / players.
 *
 * Captures ALL features:
 *  - characters (assetName, characterAnimation, pathAnimation,
 *                pendingPathAction, sequenceAction, dbScale)
 *  - props (assetName, dbScale, propOffsetX/Y)
 *  - all shape types (rect, circle, ellipse, triangle, polygon, path, line)
 *  - text (full font info)
 *  - images / backgrounds (src, flipX/Y)
 *  - audio tracks (src, volume, mediaOffset, mediaDuration)
 *  - video tracks (src, volume, mediaOffset, mediaDuration)
 *  - drawings (stroke path data)
 *  - full timeline metadata (type, color, initialState, imageFilters)
 *  - keyframes with easing
 */
export function exportSceneJSON(
  canvas: FabricCanvas | null,
  tracks: TrackObject[],
  projectName: string
) {
  if (!canvas) return;

  const duration = tracks.length > 0
    ? Math.max(...tracks.map(t => t.endTime), 0)
    : 0;

  // ── Serialize every canvas object ──────────────────────────────────────────
  const objects = canvas.getObjects().map((obj: any) => {
    const ct = obj.customType || obj.type || 'generic';

    const base: Record<string, any> = {
      type:    ct,
      name:    obj._assetName || obj.name || null,
      left:    obj.left,
      top:     obj.top,
      scaleX:  obj.scaleX,
      scaleY:  obj.scaleY,
      angle:   obj.angle,
      opacity: obj.opacity,
      flipX:   obj.flipX  ?? false,
      flipY:   obj.flipY  ?? false,
    };

    // ── Character ────────────────────────────────────────────────────────────
    if (ct === 'character') {
      return {
        ...base,
        assetName: obj._assetName ?? null,
        dbScale:   obj.dbScale    ?? null,
        charW:     obj.charW      ?? obj.width  ?? null,
        charH:     obj.charH      ?? obj.height ?? null,
      };
    }

    // ── Prop ─────────────────────────────────────────────────────────────────
    if (ct === 'prop') {
      return {
        ...base,
        assetName:   obj._assetName  ?? null,
        dbScale:     obj.dbScale     ?? null,
        propOffsetX: obj.propOffsetX ?? null,
        propOffsetY: obj.propOffsetY ?? null,
        width:       obj.width,
        height:      obj.height,
      };
    }

    // ── Image / background ───────────────────────────────────────────────────
    if (ct === 'image' || ct === 'background') {
      const el = obj._originalElement ?? obj._element ?? obj.getElement?.();
      return {
        ...base,
        src:          el?.src ?? obj.src ?? null,
        width:        obj.width,
        height:       obj.height,
        isBackground: ct === 'background',
      };
    }

    // ── Video ────────────────────────────────────────────────────────────────
    if (ct === 'video') {
      const el = obj._element as HTMLVideoElement | null;
      return {
        ...base,
        src:    el?.src ?? obj.src ?? null,
        width:  obj.width,
        height: obj.height,
      };
    }

    // ── Text ─────────────────────────────────────────────────────────────────
    if (obj.type === 'i-text' || ct === 'text') {
      return {
        ...base,
        text:       obj.text       ?? '',
        fontSize:   obj.fontSize   ?? 36,
        fontFamily: obj.fontFamily ?? 'Arial',
        fontWeight: obj.fontWeight ?? 'normal',
        fontStyle:  obj.fontStyle  ?? 'normal',
        underline:  obj.underline  ?? false,
        fill:       obj.fill       ?? '#ffffff',
      };
    }

    // ── Drawing (freehand path) ───────────────────────────────────────────────
    if (ct === 'drawing') {
      return {
        ...base,
        pathData:       JSON.stringify(obj.path ?? []),
        stroke:         obj.stroke         ?? '#ffffff',
        strokeWidth:    obj.strokeWidth    ?? 6,
        strokeLineCap:  obj.strokeLineCap  ?? 'round',
        strokeLineJoin: obj.strokeLineJoin ?? 'round',
        fill:           '',
      };
    }

    // ── Shapes ────────────────────────────────────────────────────────────────
    if (obj.type === 'circle') {
      return { ...base, shapeType: 'circle', fill: obj.fill, radius: obj.radius };
    }
    if (obj.type === 'ellipse') {
      return { ...base, shapeType: 'ellipse', fill: obj.fill, rx: obj.rx, ry: obj.ry };
    }
    if (obj.type === 'triangle') {
      return { ...base, shapeType: 'triangle', fill: obj.fill, width: obj.width, height: obj.height };
    }
    if (obj.type === 'polygon') {
      return { ...base, shapeType: 'polygon', fill: obj.fill, points: obj.points ? [...obj.points] : [] };
    }
    if (obj.type === 'rect') {
      return {
        ...base, shapeType: 'rect',
        fill: obj.fill, width: obj.width, height: obj.height,
        rx: obj.rx ?? 0, ry: obj.ry ?? 0,
        stroke: obj.stroke ?? null, strokeWidth: obj.strokeWidth ?? null,
      };
    }
    if (obj.type === 'path') {
      return {
        ...base, shapeType: 'path',
        pathData: JSON.stringify(obj.path ?? []),
        fill: obj.fill ?? '', stroke: obj.stroke ?? null,
        strokeWidth: obj.strokeWidth ?? null,
      };
    }
    if (obj.type === 'line') {
      return {
        ...base, shapeType: 'line',
        stroke: obj.stroke ?? '#ffffff', strokeWidth: obj.strokeWidth ?? 2,
        x1: obj.x1, y1: obj.y1, x2: obj.x2, y2: obj.y2,
      };
    }

    return base;
  });

  // ── Serialize every track (including audio) ─────────────────────────────────
  const timeline = tracks.map(track => ({
    id:          track.id,
    name:        track.name,
    type:        track.type,
    color:       track.color,
    startTime:   track.startTime,
    endTime:     track.endTime,
    initialState: track.initialState ?? null,
    imageFilters: track.imageFilters ?? null,
    keyframes:   track.keyframes.map(kf => ({
      id:         kf.id,
      time:       kf.time,
      properties: kf.properties,
      easing:     kf.easing,
    })),
    // Audio / video media
    audioSrc:      (track as any).audioSrc      ?? null,
    volume:        (track as any).volume        ?? null,
    mediaOffset:   (track as any).mediaOffset   ?? null,
    mediaDuration: (track as any).mediaDuration ?? null,
    // Character animation state
    characterAnimation: (track as any).characterAnimation ?? null,
    pathAnimation:      (track as any).pathAnimation      ?? null,
    pendingPathAction:  (track as any).pendingPathAction  ?? null,
    sequenceAction:     (track as any).sequenceAction     ?? null,
  }));

  const sceneData = {
    version:     1,
    exportedAt:  new Date().toISOString(),
    projectName,
    width:       canvas.getWidth()  || 960,
    height:      canvas.getHeight() || 540,
    duration,
    objects,
    timeline,
  };

  const blob = new Blob([JSON.stringify(sceneData, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${projectName.replace(/\s+/g, '_')}_export.json`;
  a.click();
  URL.revokeObjectURL(url);
}