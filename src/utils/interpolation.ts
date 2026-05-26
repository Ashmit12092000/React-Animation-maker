import type { Keyframe } from '../types';

const easingFunctions = {
  linear: (t: number) => t,
  'ease-in': (t: number) => t * t,
  'ease-out': (t: number) => t * (2 - t),
  'ease-in-out': (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
};

export function interpolateProperties(keyframes: Keyframe[], time: number) {
  if (keyframes.length === 0) return null;

  const sortedKeyframes = [...keyframes].sort((a, b) => a.time - b.time);

  if (time <= sortedKeyframes[0].time) {
    return sortedKeyframes[0].properties;
  }

  if (time >= sortedKeyframes[sortedKeyframes.length - 1].time) {
    return sortedKeyframes[sortedKeyframes.length - 1].properties;
  }

  let prevKeyframe = sortedKeyframes[0];
  let nextKeyframe = sortedKeyframes[sortedKeyframes.length - 1];

  for (let i = 0; i < sortedKeyframes.length - 1; i++) {
    if (time >= sortedKeyframes[i].time && time <= sortedKeyframes[i + 1].time) {
      prevKeyframe = sortedKeyframes[i];
      nextKeyframe = sortedKeyframes[i + 1];
      break;
    }
  }

  const duration = nextKeyframe.time - prevKeyframe.time;
  const elapsed = time - prevKeyframe.time;
  const t = duration > 0 ? elapsed / duration : 0;

  const easingFn = easingFunctions[prevKeyframe.easing] || easingFunctions.linear;
  const easedT = easingFn(t);

  const interpolated: any = {};
  for (const key in prevKeyframe.properties) {
    const start = prevKeyframe.properties[key as keyof typeof prevKeyframe.properties];
    const end = nextKeyframe.properties[key as keyof typeof nextKeyframe.properties];
    interpolated[key] = start + (end - start) * easedT;
  }

  return interpolated;
}