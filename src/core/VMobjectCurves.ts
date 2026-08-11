/**
 * Curve utility types and pure helper functions for VMobject.
 *
 * This module contains only items that do NOT need to construct VMobject
 * instances, avoiding circular dependency issues.
 *
 * Functions that create new VMobject instances (getNthCurve, curvesAsSubmobjects)
 * live in VMobject.ts and are re-exported from there.
 */

/**
 * 2D Point interface for backward compatibility
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Get the number of curve segments from a Bezier point array.
 * Each cubic Bezier segment uses 4 points (anchor, handle, handle, anchor),
 * with consecutive segments sharing anchors.
 * @param points - The 3D control points array
 * @returns Number of curve segments
 */
export function getNumCurvesFromPoints(points: number[][]): number {
  if (points.length < 4) return 0;
  return Math.floor((points.length - 1) / 3);
}

/**
 * Convert interpolation knots into a C1-continuous cubic Bézier chain.
 * End tangents use the nearest repeated knot, matching Manim's smooth-path
 * behavior for open VMobjects.
 */
export function smoothBezierPoints(points: number[][], tension: number = 0.5): number[][] {
  if (points.length < 2) return clonePoints(points);
  if (!Number.isFinite(tension) || tension < 0) {
    throw new RangeError('smoothBezierPoints tension must be a finite non-negative number.');
  }

  const result: number[][] = [];
  for (let index = 0; index < points.length - 1; index++) {
    const previous = points[Math.max(0, index - 1)];
    const start = points[index];
    const end = points[index + 1];
    const next = points[Math.min(points.length - 1, index + 2)];
    const dimensions = Math.max(previous.length, start.length, end.length, next.length, 3);
    const firstHandle: number[] = [];
    const secondHandle: number[] = [];

    for (let dimension = 0; dimension < dimensions; dimension++) {
      const p0 = previous[dimension] ?? 0;
      const p1 = start[dimension] ?? 0;
      const p2 = end[dimension] ?? 0;
      const p3 = next[dimension] ?? 0;
      firstHandle.push(p1 + ((p2 - p0) * tension) / 3);
      secondHandle.push(p2 - ((p3 - p1) * tension) / 3);
    }

    if (index === 0) result.push([...start]);
    result.push(firstHandle, secondHandle, [...end]);
  }
  return result;
}

function evaluateCubic(points: number[][], alpha: number): number[] {
  const [p0, p1, p2, p3] = points;
  const inverse = 1 - alpha;
  const result: number[] = [];
  const dimensions = Math.max(p0.length, p1.length, p2.length, p3.length, 3);
  for (let dimension = 0; dimension < dimensions; dimension++) {
    result.push(
      inverse ** 3 * (p0[dimension] ?? 0) +
        3 * inverse ** 2 * alpha * (p1[dimension] ?? 0) +
        3 * inverse * alpha ** 2 * (p2[dimension] ?? 0) +
        alpha ** 3 * (p3[dimension] ?? 0),
    );
  }
  return result;
}

interface ArcSample {
  point: number[];
  distance: number;
}

/**
 * Approximate an arc-length parameterized point on a compound cubic path.
 * Distances never bridge separate subpaths.
 */
export function pointAtBezierPathProportion(
  points: number[][],
  subpathLengths: number[] | undefined,
  proportion: number,
  samplesPerCurve: number = 32,
): number[] {
  if (!Number.isFinite(proportion)) {
    throw new RangeError('pointAtBezierPathProportion requires a finite proportion.');
  }
  if (!Number.isInteger(samplesPerCurve) || samplesPerCurve < 2) {
    throw new RangeError('samplesPerCurve must be an integer of at least 2.');
  }

  const lengths = resolveCubicSubpathLengths(points, subpathLengths);
  if (!lengths || lengths.length === 0) return points[0] ? [...points[0]] : [0, 0, 0];
  const samples: ArcSample[] = [];
  let sourceOffset = 0;
  let totalDistance = 0;

  for (const subpathLength of lengths) {
    const subpath = points.slice(sourceOffset, sourceOffset + subpathLength);
    let previousPoint: number[] | undefined;
    for (let curveOffset = 0; curveOffset + 3 < subpath.length; curveOffset += 3) {
      const cubic = subpath.slice(curveOffset, curveOffset + 4);
      for (
        let sampleIndex = curveOffset === 0 ? 0 : 1;
        sampleIndex <= samplesPerCurve;
        sampleIndex++
      ) {
        const point = evaluateCubic(cubic, sampleIndex / samplesPerCurve);
        if (previousPoint) {
          totalDistance += Math.hypot(
            point[0] - previousPoint[0],
            point[1] - previousPoint[1],
            (point[2] ?? 0) - (previousPoint[2] ?? 0),
          );
        }
        samples.push({ point, distance: totalDistance });
        previousPoint = point;
      }
    }
    sourceOffset += subpathLength;
  }

  if (samples.length === 0 || totalDistance === 0) {
    return samples[0]?.point ? [...samples[0].point] : [...points[0]];
  }
  const target = clampUnitInterval(proportion) * totalDistance;
  const upperIndex = samples.findIndex((sample) => sample.distance >= target);
  if (upperIndex <= 0) return [...samples[0].point];
  if (upperIndex === -1) return [...samples[samples.length - 1].point];

  const lower = samples[upperIndex - 1];
  const upper = samples[upperIndex];
  const span = upper.distance - lower.distance;
  if (span <= Number.EPSILON) return [...upper.point];
  return interpolatePoint(lower.point, upper.point, (target - lower.distance) / span);
}

export interface PartialBezierSubpathsResult {
  /** Cubic control points for the selected interval. */
  points: number[][];
  /** Compound-path topology for `points`, when the source has cubic geometry. */
  subpathLengths: number[] | undefined;
}

interface CubicCurve {
  points: number[][];
  subpathIndex: number;
}

function clonePoints(points: number[][]): number[][] {
  return points.map((point) => [...point]);
}

function clampUnitInterval(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function interpolatePoint(start: number[], end: number[], alpha: number): number[] {
  const dimensions = Math.max(start.length, end.length);
  const result: number[] = [];
  for (let dimension = 0; dimension < dimensions; dimension++) {
    const startValue = start[dimension] ?? 0;
    const endValue = end[dimension] ?? 0;
    result.push(startValue + (endValue - startValue) * alpha);
  }
  return result;
}

function splitCubicBezier(
  points: number[][],
  alpha: number,
): { left: number[][]; right: number[][] } {
  const p01 = interpolatePoint(points[0], points[1], alpha);
  const p12 = interpolatePoint(points[1], points[2], alpha);
  const p23 = interpolatePoint(points[2], points[3], alpha);
  const p012 = interpolatePoint(p01, p12, alpha);
  const p123 = interpolatePoint(p12, p23, alpha);
  const point = interpolatePoint(p012, p123, alpha);

  return {
    left: [[...points[0]], p01, p012, point],
    right: [point, p123, p23, [...points[3]]],
  };
}

/**
 * Return the exact cubic between local parameters `lower` and `upper`.
 *
 * The two de Casteljau splits preserve both the curve and its endpoint
 * derivatives. Equal bounds intentionally produce a four-point degenerate
 * cubic, matching Manim's partial-path endpoint behavior.
 */
function partialCubicBezier(points: number[][], lower: number, upper: number): number[][] {
  if (lower <= 0 && upper >= 1) return clonePoints(points);

  const rightOfLower = splitCubicBezier(points, lower).right;
  const localUpper = lower >= 1 ? 0 : (upper - lower) / (1 - lower);
  return splitCubicBezier(rightOfLower, clampUnitInterval(localUpper)).left;
}

function resolveCubicSubpathLengths(
  points: number[][],
  subpathLengths: number[] | undefined,
): number[] | undefined {
  if (subpathLengths === undefined) {
    if (points.length < 4 || (points.length - 1) % 3 !== 0) return undefined;
    return [points.length];
  }

  let totalLength = 0;
  for (const length of subpathLengths) {
    if (!Number.isInteger(length) || length < 4 || (length - 1) % 3 !== 0) {
      throw new RangeError(
        `Invalid cubic subpath length ${length}; expected a positive length of the form 3n + 1.`,
      );
    }
    totalLength += length;
  }

  if (totalLength !== points.length) {
    throw new RangeError(
      `Subpath lengths total ${totalLength}, but the VMobject contains ${points.length} points.`,
    );
  }
  return [...subpathLengths];
}

function collectCubicCurves(points: number[][], subpathLengths: number[]): CubicCurve[] {
  const curves: CubicCurve[] = [];
  let subpathOffset = 0;

  for (let subpathIndex = 0; subpathIndex < subpathLengths.length; subpathIndex++) {
    const subpathLength = subpathLengths[subpathIndex];
    for (let localOffset = 0; localOffset + 3 < subpathLength; localOffset += 3) {
      const curveStart = subpathOffset + localOffset;
      curves.push({
        points: clonePoints(points.slice(curveStart, curveStart + 4)),
        subpathIndex,
      });
    }
    subpathOffset += subpathLength;
  }

  return curves;
}

function curveIndexAndResidue(alpha: number, curveCount: number): [number, number] {
  if (alpha <= 0) return [0, 0];
  if (alpha >= 1) return [curveCount - 1, 1];

  const scaledAlpha = alpha * curveCount;
  const curveIndex = Math.floor(scaledAlpha);
  return [curveIndex, scaledAlpha - curveIndex];
}

/**
 * Extract an exact interval from one or more cubic Bézier subpaths.
 *
 * Progress is distributed by cubic-curve index, matching Manim's
 * `pointwise_become_partial`, rather than by sampled arc length. Compound
 * contours remain separate in the result: this function never synthesizes a
 * segment between the end of one contour and the start of the next.
 *
 * Inputs without valid cubic topology are copied unchanged because they have
 * no curve interval to select.
 */
export function partialBezierSubpaths(
  points: number[][],
  subpathLengths: number[] | undefined,
  lower: number,
  upper: number,
): PartialBezierSubpathsResult {
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
    throw new RangeError('Partial Bézier bounds must be finite numbers.');
  }

  const resolvedSubpathLengths = resolveCubicSubpathLengths(points, subpathLengths);
  if (resolvedSubpathLengths === undefined || resolvedSubpathLengths.length === 0) {
    return {
      points: clonePoints(points),
      subpathLengths: resolvedSubpathLengths,
    };
  }

  const clampedLower = clampUnitInterval(lower);
  const clampedUpper = clampUnitInterval(upper);
  if (clampedLower > clampedUpper) {
    throw new RangeError(
      `Partial Bézier lower bound ${lower} must not be greater than upper bound ${upper}.`,
    );
  }

  if (clampedLower <= 0 && clampedUpper >= 1) {
    return {
      points: clonePoints(points),
      subpathLengths: [...resolvedSubpathLengths],
    };
  }

  const curves = collectCubicCurves(points, resolvedSubpathLengths);
  if (curves.length === 0) {
    return {
      points: clonePoints(points),
      subpathLengths: [...resolvedSubpathLengths],
    };
  }

  const [lowerCurveIndex, lowerResidue] = curveIndexAndResidue(clampedLower, curves.length);
  const [upperCurveIndex, upperResidue] = curveIndexAndResidue(clampedUpper, curves.length);

  const resultPoints: number[][] = [];
  const resultSubpathLengths: number[] = [];
  let previousSubpathIndex = -1;

  for (let curveIndex = lowerCurveIndex; curveIndex <= upperCurveIndex; curveIndex++) {
    const curve = curves[curveIndex];
    const curveLower = curveIndex === lowerCurveIndex ? lowerResidue : 0;
    const curveUpper = curveIndex === upperCurveIndex ? upperResidue : 1;
    const partialCurve = partialCubicBezier(curve.points, curveLower, curveUpper);

    if (curve.subpathIndex !== previousSubpathIndex) {
      resultPoints.push(...partialCurve);
      resultSubpathLengths.push(4);
      previousSubpathIndex = curve.subpathIndex;
    } else {
      resultPoints.push(...partialCurve.slice(1));
      resultSubpathLengths[resultSubpathLengths.length - 1] += 3;
    }
  }

  return {
    points: resultPoints,
    subpathLengths: resultSubpathLengths,
  };
}
