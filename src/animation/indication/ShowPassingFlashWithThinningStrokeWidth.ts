/**
 * Passing flash whose tail is thinner than its leading edge.
 *
 * Each frame is divided into small exact Bézier intervals. The intervals are
 * child VMobjects in the source leaf's local coordinate frame, so nested
 * transforms and compound-path boundaries remain correct.
 */

import { Mobject } from '../../core/Mobject';
import { VMobject } from '../../core/VMobject';
import {
  ShowPassingFlash,
  type PassingFlashPart,
  type ShowPassingFlashOptions,
} from './ShowPassingFlash';

export interface ShowPassingFlashWithThinningStrokeWidthOptions extends ShowPassingFlashOptions {
  /** Minimum tail width as a proportion of the leading width. Default: 0.1. */
  minStrokeWidthRatio?: number;
  /** Number of exact path slices used for the taper. Default: 12. */
  taperSegments?: number;
}

interface TaperedPart {
  readonly sourcePart: PassingFlashPart;
  readonly segments: VMobject[];
}

export class ShowPassingFlashWithThinningStrokeWidth extends ShowPassingFlash {
  readonly minStrokeWidthRatio: number;
  readonly taperSegments: number;
  private _taperedParts: TaperedPart[] = [];

  constructor(mobject: Mobject, options: ShowPassingFlashWithThinningStrokeWidthOptions = {}) {
    super(mobject, options);
    const ratio = options.minStrokeWidthRatio ?? 0.1;
    const segmentCount = options.taperSegments ?? 12;
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      throw new RangeError(`minStrokeWidthRatio must be in [0, 1], got ${ratio}.`);
    }
    if (!Number.isInteger(segmentCount) || segmentCount < 2) {
      throw new RangeError(`taperSegments must be an integer of at least 2, got ${segmentCount}.`);
    }
    this.minStrokeWidthRatio = ratio;
    this.taperSegments = segmentCount;
  }

  override begin(): void {
    this._removeSegments();
    super.begin();

    this._taperedParts = this._parts.map((sourcePart) => {
      this._restorePart(sourcePart);
      sourcePart.mobject.setFill(undefined, 0);
      sourcePart.mobject.setStroke(undefined, undefined, 0);

      const segments = Array.from({ length: this.taperSegments }, () => {
        const segment = new VMobject();
        segment.setFill(undefined, 0);
        sourcePart.mobject.add(segment);
        return segment;
      });
      return { sourcePart, segments };
    });
    this.interpolate(0);
  }

  override interpolate(alpha: number): void {
    if (this._taperedParts.length === 0) {
      super.interpolate(alpha);
      return;
    }

    const [lower, upper] = this._boundsAt(alpha);
    const span = upper - lower;
    for (const { sourcePart, segments } of this._taperedParts) {
      const color = this._hasColorOverride ? this.flashColor : sourcePart.strokeColor;
      const fullWidth = this._hasStrokeWidthOverride
        ? this.flashStrokeWidth
        : sourcePart.strokeWidth;
      const opacity = sourcePart.strokeOpacity;

      segments.forEach((segment, index) => {
        const start = lower + (span * index) / segments.length;
        const end = lower + (span * (index + 1)) / segments.length;
        const progress = (index + 1) / segments.length;
        segment.pointwiseBecomePartial(sourcePart.source, start, end);
        segment.setFill(undefined, 0);
        segment.setStroke(
          color,
          fullWidth * (this.minStrokeWidthRatio + (1 - this.minStrokeWidthRatio) * progress),
          opacity,
        );
      });
    }
  }

  override reset(): void {
    this._removeSegments();
    super.reset();
  }

  private _removeSegments(): void {
    for (const { sourcePart, segments } of this._taperedParts) {
      sourcePart.mobject.remove(...segments);
      for (const segment of segments) segment.dispose();
    }
    this._taperedParts = [];
  }
}

export function showPassingFlashWithThinningStrokeWidth(
  mobject: Mobject,
  options?: ShowPassingFlashWithThinningStrokeWidthOptions,
): ShowPassingFlashWithThinningStrokeWidth {
  return new ShowPassingFlashWithThinningStrokeWidth(mobject, options);
}
