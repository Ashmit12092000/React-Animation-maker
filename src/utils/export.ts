import type { Canvas as FabricCanvas } from 'fabric';
import type { TrackObject } from '../types';

export function exportSceneJSON(canvas: FabricCanvas | null, tracks: TrackObject[], projectName: string) {
  if (!canvas) return;

  const duration = Math.max(...tracks.map(t => t.endTime), 0);

  const sceneData = {
    projectName,
    width: 960,
    height: 540,
    duration,
    objects: canvas.getObjects().map((obj: any) => {
      const baseObj = {
        type: obj.customType || 'generic',
        left: obj.left,
        top: obj.top,
        scaleX: obj.scaleX,
        scaleY: obj.scaleY,
        angle: obj.angle,
        opacity: obj.opacity,
        asset: obj._originalElement?.src || null,
        name: obj._assetName || null,
      };

      if (obj.type === 'i-text') {
        return {
          ...baseObj,
          text: obj.text,
          fontSize: obj.fontSize,
          fontFamily: obj.fontFamily,
          fill: obj.fill,
        };
      } else if (obj.type === 'rect' || obj.type === 'circle') {
        return {
          ...baseObj,
          fill: obj.fill,
          width: obj.width,
          height: obj.height,
          rx: obj.rx,
          ry: obj.ry,
        };
      }

      return baseObj;
    }),
    timeline: tracks.map(track => ({
      id: track.id,
      name: track.name,
      startTime: track.startTime,
      endTime: track.endTime,
      keyframes: track.keyframes
    }))
  };

  const blob = new Blob([JSON.stringify(sceneData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectName.replace(/\s+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}