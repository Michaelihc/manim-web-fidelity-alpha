/**
 * TransformMatchingAbstractBase - Abstract base for matching transform animations.
 *
 * Provides the common structure for animations that match parts between source
 * and target mobjects, transforming matched parts smoothly while fading
 * in/out unmatched parts.
 *
 * Subclasses must implement:
 * - `_getSubmobjects(vmobject)` - How to decompose a mobject into matchable parts
 * - `_getKey(vmobject)` - How to compute the matching key for a part
 *
 * @example
 * ```typescript
 * class TransformMatchingCustom extends TransformMatchingAbstractBase {
 *   protected _getSubmobjects(vmobject: VMobject): VMobject[] {
 *     return vmobject.children.filter(c => c instanceof VMobject) as VMobject[];
 *   }
 *   protected _getKey(vmobject: VMobject): string {
 *     return myCustomKeyFunction(vmobject);
 *   }
 * }
 * ```
 */

import { VMobject } from '../../core/VMobject';
import type { Mobject } from '../../core/Mobject';
import { Animation, AnimationOptions } from '../Animation';
import { lerpPoint } from '../../utils/math';
import { alignCompoundPathsForTransform } from '../../core/VMobjectTransformAlignment';
import {
  applyPaintOpacityFactor,
  capturePaintOpacity,
  interpolatePaintOpacity,
  restorePaintOpacity,
  type PaintOpacitySnapshot,
} from './PaintOpacity';

export interface TransformMatchingBaseOptions extends AnimationOptions {
  /** Key function to extract identifier for matching */
  keyFunc?: (vmobject: VMobject) => string;
  /** Fade duration as fraction of total duration (0-0.5). Default: 0.25 */
  fadeRatio?: number;
}

interface MatchedPart {
  source: VMobject;
  target: VMobject;
  startPoints: number[][];
  targetPoints: number[][];
  alignedSubpathLengths?: number[];
  startPaint: PaintOpacitySnapshot;
  targetPaint: PaintOpacitySnapshot;
}

interface FadingPart {
  mobject: VMobject;
  paint: PaintOpacitySnapshot;
}

export abstract class TransformMatchingAbstractBase extends Animation {
  /** The target mobject to transform into */
  readonly target: VMobject;

  /** Optional key function for matching */
  readonly keyFunc?: (vmobject: VMobject) => string;

  /** Fade duration ratio */
  readonly fadeRatio: number;

  /** Matched parts that will transform */
  protected _matchedParts: MatchedPart[] = [];

  /** Source parts that will fade out (no match in target) */
  protected _fadeOutParts: FadingPart[] = [];

  /** Target parts that will fade in (no match in source) */
  protected _fadeInParts: FadingPart[] = [];

  /** Parents of temporary unmatched-target copies. */
  private _fadeInParents = new Map<VMobject, Mobject>();

  /** Exact source family paint values for backward seeking/reset. */
  private _sourcePaint: PaintOpacitySnapshot = [];

  constructor(source: VMobject, target: VMobject, options: TransformMatchingBaseOptions = {}) {
    super(source, options);
    this.target = target;
    this.keyFunc = options.keyFunc;
    this.fadeRatio = Math.min(0.5, Math.max(0, options.fadeRatio ?? 0.25));
  }

  /**
   * Get the submobjects/parts to match from a given VMobject.
   * Subclasses must implement this to define how mobjects are decomposed.
   */
  protected abstract _getSubmobjects(vmobject: VMobject): VMobject[];

  /**
   * Get a matching key for a VMobject part.
   * Parts with the same key will be matched together.
   * Subclasses must implement this.
   */
  protected abstract _getKey(vmobject: VMobject): string;

  /**
   * Match submobjects between source and target.
   * Uses key-based exact matching by default. Subclasses can override
   * to add additional matching strategies (e.g., similarity-based).
   */
  protected _matchParts(): void {
    const sourceParts = this._getSubmobjects(this.mobject as VMobject);
    const targetParts = this._getSubmobjects(this.target);

    const usedSourceIndices = new Set<number>();
    const usedTargetIndices = new Set<number>();

    // Group by key
    const sourceByKey = new Map<string, { vmob: VMobject; index: number }[]>();
    const targetByKey = new Map<string, { vmob: VMobject; index: number }[]>();

    const keyFn = this.keyFunc ?? ((vmob: VMobject) => this._getKey(vmob));

    sourceParts.forEach((vmob, index) => {
      const key = keyFn(vmob);
      if (!sourceByKey.has(key)) sourceByKey.set(key, []);
      sourceByKey.get(key)!.push({ vmob, index });
    });

    targetParts.forEach((vmob, index) => {
      const key = keyFn(vmob);
      if (!targetByKey.has(key)) targetByKey.set(key, []);
      targetByKey.get(key)!.push({ vmob, index });
    });

    // Match by key
    for (const [key, sources] of sourceByKey) {
      const targets = targetByKey.get(key);
      if (targets) {
        const matchCount = Math.min(sources.length, targets.length);
        for (let i = 0; i < matchCount; i++) {
          this._addMatchedPart(sources[i].vmob, targets[i].vmob);
          usedSourceIndices.add(sources[i].index);
          usedTargetIndices.add(targets[i].index);
        }
      }
    }

    // Unmatched sources fade out
    for (let i = 0; i < sourceParts.length; i++) {
      if (!usedSourceIndices.has(i)) {
        const vmob = sourceParts[i];
        this._fadeOutParts.push({
          mobject: vmob,
          paint: capturePaintOpacity(vmob),
        });
      }
    }

    // Unmatched targets fade in
    for (let i = 0; i < targetParts.length; i++) {
      if (!usedTargetIndices.has(i)) {
        const vmob = targetParts[i];
        const copy = vmob.copy() as VMobject;
        const paint = capturePaintOpacity(copy);
        applyPaintOpacityFactor(paint, 0);
        const parent = this.mobject.parent;
        if (parent) {
          parent.add(copy);
          this._fadeInParents.set(copy, parent);
        }
        this._fadeInParts.push({
          mobject: copy,
          paint,
        });
      }
    }
  }

  /**
   * Add a matched pair of source and target parts.
   * Aligns their points so they can be smoothly interpolated.
   */
  protected _addMatchedPart(source: VMobject, target: VMobject): void {
    const srcCopy = source.copy() as VMobject;
    const tgtCopy = target.copy() as VMobject;

    const srcLengths = source.getEffectiveSubpathLengths?.();
    const tgtLengths = target.getEffectiveSubpathLengths?.();
    const alignedCompound = alignCompoundPathsForTransform(
      srcCopy.getLocalPoints(),
      srcLengths,
      tgtCopy.getLocalPoints(),
      tgtLengths,
      source.getSubpathOrientationSigns?.(srcLengths),
      target.getSubpathOrientationSigns?.(tgtLengths),
    );

    if (alignedCompound) {
      this._matchedParts.push({
        source,
        target,
        startPoints: alignedCompound.srcAlignedPoints,
        targetPoints: alignedCompound.tgtAlignedPoints,
        alignedSubpathLengths: alignedCompound.alignedSubpathLengths,
        startPaint: capturePaintOpacity(source),
        targetPaint: capturePaintOpacity(target),
      });

      source.setPoints(alignedCompound.srcAlignedPoints);
      source.setTransformSubpathLengths(alignedCompound.alignedSubpathLengths);
    } else {
      srcCopy.alignPoints(tgtCopy);

      this._matchedParts.push({
        source,
        target,
        startPoints: srcCopy.getLocalPoints(),
        targetPoints: tgtCopy.getLocalPoints(),
        alignedSubpathLengths: undefined,
        startPaint: capturePaintOpacity(source),
        targetPaint: capturePaintOpacity(target),
      });

      // Set source to have aligned points
      source.setPoints(srcCopy.getLocalPoints());
      source.setTransformSubpathLengths(undefined);
    }
  }

  override begin(): void {
    this._detachFadeInCopies();
    this._matchedParts = [];
    this._fadeOutParts = [];
    this._fadeInParts = [];
    super.begin();
    this._sourcePaint = capturePaintOpacity(this.mobject);
    this._matchParts();
  }

  interpolate(alpha: number): void {
    // Interpolate matched parts
    for (const part of this._matchedParts) {
      const points: number[][] = [];
      for (let i = 0; i < part.startPoints.length; i++) {
        points.push(lerpPoint(part.startPoints[i], part.targetPoints[i], alpha));
      }
      part.source.setPoints(points);
      part.source.setTransformSubpathLengths(part.alignedSubpathLengths);
      interpolatePaintOpacity(part.startPaint, part.targetPaint, alpha);
    }

    // Handle fading parts with adjusted timing
    // Fade out happens in first portion, fade in happens in last portion
    const fadeOutAlpha = this.fadeRatio === 0 ? 1 : Math.min(1, alpha / this.fadeRatio);
    const fadeInStart = 1 - this.fadeRatio;
    const fadeInAlpha =
      this.fadeRatio === 0 ? 1 : Math.max(0, (alpha - fadeInStart) / this.fadeRatio);

    for (const part of this._fadeOutParts) {
      applyPaintOpacityFactor(part.paint, 1 - Math.min(1, fadeOutAlpha));
    }

    for (const part of this._fadeInParts) {
      applyPaintOpacityFactor(part.paint, Math.min(1, fadeInAlpha));
    }
  }

  override finish(): void {
    // Finalize matched parts
    for (const part of this._matchedParts) {
      part.source.setPoints(part.targetPoints);
      part.source.setTransformSubpathLengths(undefined);
      interpolatePaintOpacity(part.startPaint, part.targetPaint, 1);
      part.source.color = part.target.color;
    }

    // Finalize fading parts
    for (const part of this._fadeOutParts) {
      applyPaintOpacityFactor(part.paint, 0);
    }

    for (const part of this._fadeInParts) {
      restorePaintOpacity(part.paint);
    }

    super.finish();
  }

  override reset(): void {
    this._detachFadeInCopies();
    super.reset();
    restorePaintOpacity(this._sourcePaint);
    this._matchedParts = [];
    this._fadeOutParts = [];
    this._fadeInParts = [];
  }

  private _detachFadeInCopies(): void {
    for (const [copy, parent] of this._fadeInParents) parent.remove(copy);
    this._fadeInParents.clear();
  }

  override getAllMobjects(): readonly Mobject[] {
    return [this.mobject, this.target];
  }
}
