import type { PathPoint } from "../types";

/**
 * Sample N evenly-spaced points along a SVG path element.
 */
export function samplePathPoints(svgPath: SVGPathElement, samples = 300): PathPoint[] {
  const totalLength = svgPath.getTotalLength();
  const points: PathPoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const pt = svgPath.getPointAtLength((i / samples) * totalLength);
    points.push({ x: pt.x, y: pt.y });
  }
  return points;
}

/**
 * Given an array of sampled path points, return the cumulative arc-lengths.
 */
export function buildCumulativeLengths(points: PathPoint[]): number[] {
  const lengths: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    lengths.push(lengths[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  return lengths;
}

/**
 * Given sampled points + cumulative lengths, find the interpolated position
 * at a fractional distance t ∈ [0,1] along the path.
 */
export function getPositionAtT(
  points: PathPoint[],
  cumulativeLengths: number[],
  t: number
): { x: number; y: number; angle: number } {
  if (points.length < 2) return { x: points[0]?.x ?? 0, y: points[0]?.y ?? 0, angle: 0 };

  const totalLen = cumulativeLengths[cumulativeLengths.length - 1];
  const target = Math.max(0, Math.min(1, t)) * totalLen;

  // Binary-search for the segment
  let lo = 0;
  let hi = cumulativeLengths.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cumulativeLengths[mid] <= target) lo = mid;
    else hi = mid;
  }

  const segLen = cumulativeLengths[hi] - cumulativeLengths[lo];
  const alpha = segLen > 0 ? (target - cumulativeLengths[lo]) / segLen : 0;

  const x = points[lo].x + alpha * (points[hi].x - points[lo].x);
  const y = points[lo].y + alpha * (points[hi].y - points[lo].y);

  // Direction angle (degrees)
  const dx = points[hi].x - points[lo].x;
  const dy = points[hi].y - points[lo].y;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  return { x, y, angle };
}

/**
 * Smooth an array of PathPoints using a simple moving-average.
 */
export function smoothPoints(points: PathPoint[], windowSize = 5): PathPoint[] {
  const half = Math.floor(windowSize / 2);
  return points.map((_, i) => {
    let sx = 0, sy = 0, count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(points.length - 1, i + half); j++) {
      sx += points[j].x;
      sy += points[j].y;
      count++;
    }
    return { x: sx / count, y: sy / count };
  });
}

/**
 * Convert an array of PathPoints to an SVG path "d" string (for rendering).
 */
export function pointsToSvgD(points: PathPoint[]): string {
  if (points.length === 0) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}
