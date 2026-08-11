import * as THREE from 'three';
import { Mobject, MobjectStyle } from '../../core/Mobject';
import { VGroup } from '../../core/VGroup';
import { VMobject } from '../../core/VMobject';
import type { RateFunction } from '../Animation';

interface RevealedPart {
  mobject: VMobject;
  source: VMobject;
  color: string;
  style: MobjectStyle;
  transformSubpathLengths: number[] | undefined;
}

export interface VectorPathRevealOptions {
  lagRatio?: number;
  outlineStrokeWidth?: number;
  outlineColor?: string;
  rateFunc: RateFunction;
  reverseFamily?: boolean;
  drawBorderThenFill?: boolean;
}

/**
 * Manim-style vector creation for a family of point-bearing VMobject leaves.
 *
 * The outline phase slices the actual cubic Bézier geometry. This matters for
 * compound glyphs: renderer dashes share a material between contours and
 * cannot represent independent partial geometry without holes flashing or a
 * contour inheriting another contour's length.
 */
export class VectorPathReveal {
  private readonly _root: Mobject;
  private readonly _requestedLagRatio: number | undefined;
  private readonly _outlineStrokeWidth: number;
  private readonly _outlineColor: string | undefined;
  private readonly _rateFunc: RateFunction;
  private readonly _reverseFamily: boolean;
  private readonly _drawBorderThenFill: boolean;
  private _parts: RevealedPart[] = [];
  private _lagRatio: number = 0;

  constructor(root: Mobject, options: VectorPathRevealOptions) {
    this._root = root;
    this._requestedLagRatio = options.lagRatio;
    this._outlineStrokeWidth = options.outlineStrokeWidth ?? 2;
    this._outlineColor = options.outlineColor;
    this._rateFunc = options.rateFunc;
    this._reverseFamily = options.reverseFamily ?? false;
    this._drawBorderThenFill = options.drawBorderThenFill ?? true;
  }

  get partCount(): number {
    return this._parts.length;
  }

  get lagRatio(): number {
    return this._lagRatio;
  }

  begin(): boolean {
    this.restore();
    this._parts = this._collectParts();
    if (this._reverseFamily) this._parts.reverse();
    if (this._parts.length === 0) return false;

    this._lagRatio = this._requestedLagRatio ?? Math.min(4 / Math.max(1, this._parts.length), 0.2);

    for (const part of this._parts) this._applyPart(part, 0);
    return true;
  }

  /**
   * Interpolate from raw timeline alpha. Easing is deliberately applied after
   * the per-member lag shift, matching Animation.get_sub_alpha in Manim CE.
   */
  interpolate(rawAlpha: number): void {
    const clampedAlpha = clamp01(rawAlpha);
    for (let index = 0; index < this._parts.length; index++) {
      this._applyPart(this._parts[index], this._subAlpha(clampedAlpha, index));
    }
  }

  /**
   * Restore exact geometry, transform topology, and style. Safe before begin()
   * and during backward-seek reset.
   */
  restore(clearSnapshots: boolean = true): void {
    for (const part of this._parts) {
      this._restoreGeometry(part);
      this._restoreStyle(part);
    }
    if (clearSnapshots) this._parts = [];
  }

  /** Leave remover animations invisible, but with valid full geometry/style. */
  hide(): void {
    for (const part of this._parts) {
      this._restoreGeometry(part);
      this._restoreStyle(part);
      part.mobject.setFillOpacity(0);
      part.mobject.setStrokeOpacity(0);
    }
  }

  private _collectParts(): RevealedPart[] {
    const parts: RevealedPart[] = [];
    for (const member of this._root.getFamily()) {
      if (!(member instanceof VMobject) || member instanceof VGroup) continue;
      if (member.getLocalPoints().length < 4) continue;

      const topology = member as unknown as { _transformSubpathLengths?: number[] };
      parts.push({
        mobject: member,
        source: member.copy(),
        color: member.color,
        // Several geometry constructors historically assigned the public
        // fill/stroke fields directly. Capture those live authoritative values
        // instead of trusting potentially stale style metadata.
        style: {
          ...member.style,
          fillColor: member.fillColor ?? member.color,
          fillOpacity: member.fillOpacity,
          strokeColor: member.strokeColor ?? member.color,
          strokeOpacity: member.opacity,
          strokeWidth: member.strokeWidth,
        },
        transformSubpathLengths: topology._transformSubpathLengths
          ? [...topology._transformSubpathLengths]
          : undefined,
      });
    }
    return parts;
  }

  private _subAlpha(rawAlpha: number, index: number): number {
    const fullLength = (this._parts.length - 1) * this._lagRatio + 1;
    const shifted = rawAlpha * fullLength - index * this._lagRatio;
    return clamp01(this._rateFunc(clamp01(shifted)));
  }

  private _applyPart(part: RevealedPart, alpha: number): void {
    // Finish on the exact captured values. Interpolating to alpha=1 can leave
    // tiny IEEE-754 residue (for example 0.00001 becoming
    // 0.000010000000000065512), which makes a completed Write differ from its
    // source style and accumulates across later transforms.
    if (alpha >= 1) {
      this._restoreGeometry(part);
      this._restoreStyle(part);
      return;
    }

    if (!this._drawBorderThenFill) {
      part.mobject.pointwiseBecomePartial(part.source, 0, alpha);
      this._restoreStyle(part);
      return;
    }

    const outlineColor = this._getOutlineColor(part);

    if (alpha < 0.5) {
      part.mobject.pointwiseBecomePartial(part.source, 0, alpha * 2);
      part.mobject.setColor(outlineColor);
      part.mobject.fillColor = outlineColor;
      part.mobject.strokeColor = outlineColor;
      part.mobject.setFillOpacity(0);
      part.mobject.setStrokeOpacity(1);
      part.mobject.setStrokeWidth(this._outlineStrokeWidth);
      return;
    }

    const styleAlpha = (alpha - 0.5) * 2;
    this._restoreGeometry(part);

    const originalFillColor = part.style.fillColor ?? part.color;
    const originalStrokeColor = part.style.strokeColor ?? part.color;
    part.mobject.setColor(interpolateColor(outlineColor, part.color, styleAlpha));
    part.mobject.fillColor = interpolateColor(outlineColor, originalFillColor, styleAlpha);
    part.mobject.strokeColor = interpolateColor(outlineColor, originalStrokeColor, styleAlpha);
    part.mobject.setFillOpacity((part.style.fillOpacity ?? part.mobject.fillOpacity) * styleAlpha);
    part.mobject.setStrokeOpacity(1 + ((part.style.strokeOpacity ?? 1) - 1) * styleAlpha);
    part.mobject.setStrokeWidth(
      this._outlineStrokeWidth +
        ((part.style.strokeWidth ?? part.mobject.strokeWidth) - this._outlineStrokeWidth) *
          styleAlpha,
    );
  }

  private _restoreGeometry(part: RevealedPart): void {
    part.mobject.setPoints3D(part.source.getLocalPoints());
    part.mobject.setTransformSubpathLengths(part.transformSubpathLengths);
  }

  private _restoreStyle(part: RevealedPart): void {
    part.mobject.setColor(part.color);
    if (part.style.fillColor !== undefined) part.mobject.fillColor = part.style.fillColor;
    if (part.style.strokeColor !== undefined) part.mobject.strokeColor = part.style.strokeColor;
    part.mobject.setFillOpacity(part.style.fillOpacity ?? part.mobject.fillOpacity);
    part.mobject.setStrokeOpacity(part.style.strokeOpacity ?? part.mobject.opacity);
    part.mobject.setStrokeWidth(part.style.strokeWidth ?? part.mobject.strokeWidth);
  }

  private _getOutlineColor(part: RevealedPart): string {
    if (this._outlineColor !== undefined) return this._outlineColor;
    if ((part.style.strokeWidth ?? 0) > 0) return part.style.strokeColor ?? part.color;
    return part.color;
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function interpolateColor(start: string, end: string, alpha: number): string {
  return `#${new THREE.Color()
    .lerpColors(new THREE.Color(start), new THREE.Color(end), clamp01(alpha))
    .getHexString()}`;
}
