import * as THREE from 'three';
import { Mobject } from '../../core/Mobject';
import { lerp } from '../../utils/math';

interface PaintOpacityState {
  readonly mobject: Mobject;
  readonly fillColor: string;
  readonly fillOpacity: number;
  readonly strokeColor: string;
  readonly strokeOpacity: number;
  readonly strokeWidth: number;
}

/**
 * Frozen fill/stroke opacity values for a mobject family.
 *
 * Opacity animation code must not use `mobject.opacity` as a visual-opacity
 * proxy: that legacy property controls only the stroke channel.  In
 * particular, MathTex glyphs are normally fill-only.
 */
export type PaintOpacitySnapshot = readonly PaintOpacityState[];

export function capturePaintOpacity(root: Mobject): PaintOpacitySnapshot {
  return root.getFamily().map((mobject) => ({
    mobject,
    fillColor: mobject.fillColor ?? mobject.color,
    fillOpacity: mobject.fillOpacity,
    strokeColor: mobject.strokeColor ?? mobject.color,
    strokeOpacity: mobject.opacity,
    strokeWidth: mobject.strokeWidth,
  }));
}

function setOwnPaintOpacity(mobject: Mobject, fillOpacity: number, strokeOpacity: number): void {
  // Group/VGroup setters intentionally recurse.  A family snapshot contains
  // every node independently, so bypass recursion here to avoid a parent's
  // value overwriting distinct child values.
  Mobject.prototype.setFillOpacity.call(mobject, fillOpacity);
  Mobject.prototype.setStrokeOpacity.call(mobject, strokeOpacity);
}

function stateAt(snapshot: PaintOpacitySnapshot, index: number): PaintOpacityState {
  return snapshot[index] ?? snapshot[0];
}

function interpolateColor(start: string, end: string, alpha: number): string {
  return `#${new THREE.Color()
    .lerpColors(new THREE.Color(start), new THREE.Color(end), alpha)
    .getHexString()}`;
}

/**
 * Apply captured paint to another family, optionally scaled toward transparent.
 */
export function applyPaintOpacitySnapshot(
  destination: PaintOpacitySnapshot,
  paint: PaintOpacitySnapshot,
  opacityFactor: number = 1,
): void {
  if (destination.length === 0 || paint.length === 0) return;
  const clamped = Math.max(0, Math.min(1, opacityFactor));
  for (let index = 0; index < destination.length; index++) {
    const output = destination[index].mobject;
    const state = stateAt(paint, index);
    output.fillColor = state.fillColor;
    output.strokeColor = state.strokeColor;
    Mobject.prototype.setStrokeWidth.call(output, state.strokeWidth);
    setOwnPaintOpacity(output, state.fillOpacity * clamped, state.strokeOpacity * clamped);
  }
}

/** Apply each captured family's opacity scaled toward transparent. */
export function applyPaintOpacityFactor(snapshot: PaintOpacitySnapshot, factor: number): void {
  applyPaintOpacitySnapshot(snapshot, snapshot, factor);
}

/** Restore an exact family snapshot, preserving independent fill/stroke values. */
export function restorePaintOpacity(snapshot: PaintOpacitySnapshot): void {
  applyPaintOpacitySnapshot(snapshot, snapshot);
}

/**
 * Interpolate paint values from one family snapshot onto the source family.
 *
 * Matching animations pair like-shaped parts, so preorder is stable in the
 * common family case.  If family sizes differ, unmatched nodes retain their
 * own channel ratios while converging to the target root's paint values.
 */
export function interpolatePaintOpacity(
  source: PaintOpacitySnapshot,
  target: PaintOpacitySnapshot,
  alpha: number,
): void {
  if (source.length === 0 || target.length === 0) return;
  const clamped = Math.max(0, Math.min(1, alpha));
  for (let index = 0; index < source.length; index++) {
    const start = source[index];
    const end = stateAt(target, index);
    start.mobject.fillColor = interpolateColor(start.fillColor, end.fillColor, clamped);
    start.mobject.strokeColor = interpolateColor(start.strokeColor, end.strokeColor, clamped);
    Mobject.prototype.setStrokeWidth.call(
      start.mobject,
      lerp(start.strokeWidth, end.strokeWidth, clamped),
    );
    setOwnPaintOpacity(
      start.mobject,
      lerp(start.fillOpacity, end.fillOpacity, clamped),
      lerp(start.strokeOpacity, end.strokeOpacity, clamped),
    );
  }
}

/** Interpolate both fill and stroke colors toward one target color. */
export function interpolatePaintColor(
  snapshot: PaintOpacitySnapshot,
  targetColor: string,
  alpha: number,
): void {
  const clamped = Math.max(0, Math.min(1, alpha));
  for (const state of snapshot) {
    state.mobject.fillColor = interpolateColor(state.fillColor, targetColor, clamped);
    state.mobject.strokeColor = interpolateColor(state.strokeColor, targetColor, clamped);
  }
}

/**
 * Scale the family's current paint values.
 *
 * Used after a canonical Transform interpolation to add a cross-fade envelope
 * without replacing the Transform's own fill/stroke interpolation.
 */
export function scaleCurrentPaintOpacity(root: Mobject, factor: number): void {
  const clamped = Math.max(0, Math.min(1, factor));
  for (const mobject of root.getFamily()) {
    setOwnPaintOpacity(mobject, mobject.fillOpacity * clamped, mobject.opacity * clamped);
  }
}
