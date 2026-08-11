/**
 * Show a fixed-width window traveling over a VMobject's actual Bézier path.
 *
 * The previous implementation sampled control points into a detached Three.js
 * line.  Besides making the speed depend on point density, that lost parent
 * transforms and joined compound contours.  Manim's implementation is a
 * partial-path animation, so keep the operation in VMobject geometry instead.
 */

import { Mobject } from '../../core/Mobject';
import { VGroup } from '../../core/VGroup';
import { VMobject } from '../../core/VMobject';
import { Animation, type AnimationOptions } from '../Animation';
import { linear } from '../../rate-functions';

export interface ShowPassingFlashOptions extends AnimationOptions {
  /** Optional stroke color override. By default the source stroke is preserved. */
  color?: string;
  /** Width of the moving window as a proportion of the full path. Default: 0.2. */
  timeWidth?: number;
  /** Optional stroke-width override. By default the source width is preserved. */
  strokeWidth?: number;
}

export interface PassingFlashPart {
  readonly mobject: VMobject;
  readonly source: VMobject;
  readonly color: string;
  readonly fillColor: string;
  readonly fillOpacity: number;
  readonly strokeColor: string;
  readonly strokeOpacity: number;
  readonly strokeWidth: number;
  readonly transformSubpathLengths: number[] | undefined;
}

export class ShowPassingFlash extends Animation {
  /** Color override, or the root's stroke color when no override was supplied. */
  readonly flashColor: string;

  /** Width of the moving path interval. */
  readonly timeWidth: number;

  /** Stroke-width override, or the root's current stroke width. */
  readonly flashStrokeWidth: number;

  protected readonly _hasColorOverride: boolean;
  protected readonly _hasStrokeWidthOverride: boolean;
  protected _parts: PassingFlashPart[] = [];
  private _fallbackOpacity = 1;

  constructor(mobject: Mobject, options: ShowPassingFlashOptions = {}) {
    super(mobject, {
      duration: options.duration ?? 1,
      rateFunc: options.rateFunc ?? linear,
    });

    const timeWidth = options.timeWidth ?? 0.2;
    if (!Number.isFinite(timeWidth) || timeWidth < 0 || timeWidth > 1) {
      throw new RangeError(`ShowPassingFlash timeWidth must be in [0, 1], got ${timeWidth}.`);
    }

    this.timeWidth = timeWidth;
    this._hasColorOverride = options.color !== undefined;
    this._hasStrokeWidthOverride = options.strokeWidth !== undefined;
    this.flashColor = options.color ?? mobject.strokeColor ?? mobject.color;
    this.flashStrokeWidth = options.strokeWidth ?? mobject.strokeWidth;
    this.remover = true;
  }

  override begin(): void {
    this._restoreParts();
    this._parts = [];
    super.begin();

    this._fallbackOpacity = this.mobject.opacity;
    for (const member of this.mobject.getFamily()) {
      // VGroup.getLocalPoints() is an aggregate view of its descendants, not
      // geometry owned by the container. Partializing that aggregate would
      // change its length and violate VGroup's child-partition invariant.
      if (
        !(member instanceof VMobject) ||
        member instanceof VGroup ||
        member.getLocalPoints().length < 4
      ) {
        continue;
      }
      const topology = member as unknown as { _transformSubpathLengths?: number[] };
      this._parts.push({
        mobject: member,
        source: member.copy(),
        color: member.color,
        fillColor: member.fillColor ?? member.color,
        fillOpacity: member.fillOpacity,
        strokeColor: member.strokeColor ?? member.color,
        strokeOpacity: member.opacity,
        strokeWidth: member.strokeWidth,
        transformSubpathLengths: topology._transformSubpathLengths
          ? [...topology._transformSubpathLengths]
          : undefined,
      });
    }

    this._applyAtAlpha(0);
  }

  /**
   * Manim's bounds move from [-timeWidth, 0] to [1, 1 + timeWidth].
   * Clamping creates a natural grow-in and shrink-out without opacity tricks.
   */
  protected _boundsAt(alpha: number): readonly [number, number] {
    const clamped = clamp01(alpha);
    const upper = clamped * (1 + this.timeWidth);
    return [clamp01(upper - this.timeWidth), clamp01(upper)];
  }

  protected _applyPart(part: PassingFlashPart, lower: number, upper: number, _alpha: number): void {
    part.mobject.pointwiseBecomePartial(part.source, lower, upper);
    part.mobject.setFill(undefined, 0);
    part.mobject.setStroke(
      this._hasColorOverride ? this.flashColor : part.strokeColor,
      this._hasStrokeWidthOverride ? this.flashStrokeWidth : part.strokeWidth,
      part.strokeOpacity,
    );
  }

  protected _applyAtAlpha(alpha: number): void {
    if (this._parts.length === 0) {
      // A non-vector object has no meaningful partial path. Keep the fallback
      // deterministic and non-flashing while still honoring remover semantics.
      this.mobject.setStrokeOpacity(this._fallbackOpacity * Math.sin(Math.PI * clamp01(alpha)));
      return;
    }

    const [lower, upper] = this._boundsAt(alpha);
    for (const part of this._parts) this._applyPart(part, lower, upper, alpha);
  }

  interpolate(alpha: number): void {
    this._applyAtAlpha(alpha);
  }

  protected _restorePart(part: PassingFlashPart): void {
    part.mobject.setPoints3D(part.source.getLocalPoints());
    part.mobject.setTransformSubpathLengths(part.transformSubpathLengths);
    part.mobject.setColor(part.color);
    part.mobject.fillColor = part.fillColor;
    part.mobject.strokeColor = part.strokeColor;
    part.mobject.setFillOpacity(part.fillOpacity);
    part.mobject.setStroke(part.strokeColor, part.strokeWidth, part.strokeOpacity);
  }

  protected _restoreParts(): void {
    for (const part of this._parts) this._restorePart(part);
  }

  override finish(): void {
    this._applyAtAlpha(1);
    super.finish();
  }

  override reset(): void {
    // Keep the live capture across the base reset.  The base class may restore
    // the root from its structural snapshot; the flash's per-leaf capture is
    // still the authoritative source for independent fill/stroke paint.
    const parts = [...this._parts];
    super.reset();
    for (const part of parts) this._restorePart(part);
    this._parts = [];
    this.mobject.setStrokeOpacity(this._fallbackOpacity);
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function showPassingFlash(
  mobject: Mobject,
  options?: ShowPassingFlashOptions,
): ShowPassingFlash {
  return new ShowPassingFlash(mobject, options);
}
