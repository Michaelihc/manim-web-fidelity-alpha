/**
 * Matching-based Transform animations for manimweb.
 * These animations match parts between source and target mobjects,
 * transforming matching parts smoothly while fading in/out unmatched parts.
 *
 * Uses the Hungarian (Kuhn-Munkres) algorithm for optimal O(n^3) assignment
 * instead of greedy matching, ensuring globally optimal submobject pairing.
 */

import { VMobject } from '../../core/VMobject';
import { VGroup } from '../../core/VGroup';
import type { Mobject } from '../../core/Mobject';
import { Animation, AnimationOptions, type AnimationScene } from '../Animation';
import { hungarian, hungarianFromSimilarity } from '../../utils/hungarian';
import { lerpPoint } from '../../utils/math';
import { Transform } from './Transform';
import { shapeSimilarity, centerDistance } from './TransformMatchingShared';
import {
  applyPaintOpacityFactor,
  capturePaintOpacity,
  interpolatePaintOpacity,
  restorePaintOpacity,
  scaleCurrentPaintOpacity,
  type PaintOpacitySnapshot,
} from './PaintOpacity';

interface PaintMatchedPart {
  source: VMobject;
  target: VMobject;
  startPoints: number[][];
  targetPoints: number[][];
  alignedSubpathLengths?: number[];
  startPaint: PaintOpacitySnapshot;
  targetPaint: PaintOpacitySnapshot;
}

interface PaintFadingPart {
  mobject: VMobject;
  paint: PaintOpacitySnapshot;
}

// ============================================================================
// TransformMatchingShapes
// ============================================================================

export interface TransformMatchingShapesOptions extends AnimationOptions {
  /** Minimum similarity threshold for matching (0-1). Default: 0.5 */
  matchThreshold?: number;
  /** Key function to extract identifier for matching. If provided, uses this instead of shape similarity */
  keyFunc?: (vmobject: VMobject) => string;
  /** Fade duration as fraction of total duration (0-0.5). Default: 0.25 */
  fadeRatio?: number;
}

/**
 * TransformMatchingShapes animation - transforms matching shapes between mobjects.
 *
 * Uses the Hungarian algorithm for optimal shape matching:
 * - When a keyFunc is provided: exact key-based matching (same as before)
 * - When no keyFunc: builds a similarity matrix and uses the Hungarian algorithm
 *   to find the globally optimal one-to-one assignment that maximizes total
 *   similarity, subject to a minimum threshold.
 *
 * Matched shapes transform smoothly, while unmatched shapes fade in/out.
 */
export class TransformMatchingShapes extends Animation {
  /** The target mobject to transform into */
  readonly target: VMobject;

  /** Minimum similarity threshold for matching */
  readonly matchThreshold: number;

  /** Optional key function for matching */
  readonly keyFunc?: (vmobject: VMobject) => string;

  /** Fade duration ratio */
  readonly fadeRatio: number;

  /** Matched parts that will transform */
  private _matchedParts: PaintMatchedPart[] = [];

  /** Source parts that will fade out (no match in target) */
  private _fadeOutParts: PaintFadingPart[] = [];

  /** Target parts that will fade in (no match in source) */
  private _fadeInParts: PaintFadingPart[] = [];

  /** Parents of temporary unmatched-target copies. */
  private _fadeInParents = new Map<VMobject, Mobject>();

  /** Exact source family paint values for backward seeking/reset. */
  private _sourcePaint: PaintOpacitySnapshot = [];

  constructor(source: VMobject, target: VMobject, options: TransformMatchingShapesOptions = {}) {
    super(source, options);
    this.target = target;
    this.matchThreshold = options.matchThreshold ?? 0.5;
    this.keyFunc = options.keyFunc;
    this.fadeRatio = Math.min(0.5, Math.max(0, options.fadeRatio ?? 0.25));
  }

  /**
   * Get submobjects from a VMobject (or treat as single if no children)
   */
  private _getSubmobjects(vmobject: VMobject): VMobject[] {
    const children = vmobject.children.filter((c) => c instanceof VMobject) as VMobject[];
    if (children.length > 0) {
      return children;
    }
    // Treat the mobject itself as a single submobject
    return [vmobject];
  }

  /**
   * Match submobjects between source and target using optimal assignment.
   */
  private _matchSubmobjects(): void {
    const sourceSubmobs = this._getSubmobjects(this.mobject as VMobject);
    const targetSubmobs = this._getSubmobjects(this.target);

    const usedSourceIndices = new Set<number>();
    const usedTargetIndices = new Set<number>();

    // If key function provided, use exact matching (deterministic, no optimization needed)
    if (this.keyFunc) {
      const sourceByKey = new Map<string, { vmob: VMobject; index: number }[]>();
      const targetByKey = new Map<string, { vmob: VMobject; index: number }[]>();

      sourceSubmobs.forEach((vmob, index) => {
        const key = this.keyFunc!(vmob);
        if (!sourceByKey.has(key)) sourceByKey.set(key, []);
        sourceByKey.get(key)!.push({ vmob, index });
      });

      targetSubmobs.forEach((vmob, index) => {
        const key = this.keyFunc!(vmob);
        if (!targetByKey.has(key)) targetByKey.set(key, []);
        targetByKey.get(key)!.push({ vmob, index });
      });

      // Match by key
      for (const [key, sources] of sourceByKey) {
        const targets = targetByKey.get(key);
        if (targets) {
          const matchCount = Math.min(sources.length, targets.length);
          for (let i = 0; i < matchCount; i++) {
            const src = sources[i];
            const tgt = targets[i];
            this._addMatchedPart(src.vmob, tgt.vmob);
            usedSourceIndices.add(src.index);
            usedTargetIndices.add(tgt.index);
          }
        }
      }
    } else {
      // Build similarity matrix and use Hungarian algorithm for optimal matching
      const simMatrix: number[][] = Array.from({ length: sourceSubmobs.length }, (_, si) =>
        Array.from({ length: targetSubmobs.length }, (_, ti) =>
          shapeSimilarity(sourceSubmobs[si], targetSubmobs[ti]),
        ),
      );

      const result = hungarianFromSimilarity(simMatrix, this.matchThreshold);

      for (let si = 0; si < sourceSubmobs.length; si++) {
        const ti = result.assignments[si];
        if (ti >= 0) {
          this._addMatchedPart(sourceSubmobs[si], targetSubmobs[ti]);
          usedSourceIndices.add(si);
          usedTargetIndices.add(ti);
        }
      }
    }

    // Collect unmatched source submobjects (will fade out)
    for (let i = 0; i < sourceSubmobs.length; i++) {
      if (!usedSourceIndices.has(i)) {
        const vmob = sourceSubmobs[i];
        this._fadeOutParts.push({
          mobject: vmob,
          paint: capturePaintOpacity(vmob),
        });
      }
    }

    // Collect unmatched target submobjects (will fade in)
    for (let i = 0; i < targetSubmobs.length; i++) {
      if (!usedTargetIndices.has(i)) {
        const vmob = targetSubmobs[i];
        // Add to scene as copy, starting invisible
        const copy = vmob.copy() as VMobject;
        const paint = capturePaintOpacity(copy);
        applyPaintOpacityFactor(paint, 0);

        // A detached/top-level source still needs a render owner during the
        // animation. Attach copies to the source itself in that case; cleanup
        // detaches them before swapping the scene root to the exact target.
        const parent = this.mobject.parent ?? this.mobject;
        parent.add(copy);
        this._fadeInParents.set(copy, parent);

        this._fadeInParts.push({
          mobject: copy,
          paint,
        });
      }
    }
  }

  /**
   * Add a matched pair
   */
  private _addMatchedPart(source: VMobject, target: VMobject): void {
    const srcCopy = source.copy() as VMobject;
    const tgtCopy = target.copy() as VMobject;
    srcCopy.alignPoints(tgtCopy);

    this._matchedParts.push({
      source,
      target,
      startPoints: srcCopy.getLocalPoints(),
      targetPoints: tgtCopy.getLocalPoints(),
      startPaint: capturePaintOpacity(source),
      targetPaint: capturePaintOpacity(target),
    });

    // Set source to have aligned points
    source.setPoints(srcCopy.getLocalPoints());
  }

  override begin(): void {
    this._detachFadeInCopies();
    this._matchedParts = [];
    this._fadeOutParts = [];
    this._fadeInParts = [];
    super.begin();
    this._sourcePaint = capturePaintOpacity(this.mobject);
    this._matchSubmobjects();
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
    // Fade out happens in first half, fade in happens in second half
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

  override cleanUpFromScene(scene: AnimationScene): void {
    super.cleanUpFromScene(scene);
    this._detachFadeInCopies();
    scene.remove(this.mobject);
    scene.add(this.target);
  }
}

/**
 * Create a TransformMatchingShapes animation.
 * @param source The source VMobject
 * @param target The target VMobject
 * @param options Animation options
 */
export function transformMatchingShapes(
  source: VMobject,
  target: VMobject,
  options?: TransformMatchingShapesOptions,
): TransformMatchingShapes {
  return new TransformMatchingShapes(source, target, options);
}

// ============================================================================
// TransformMatchingTex
// ============================================================================

export interface TransformMatchingTexOptions extends AnimationOptions {
  /** Key function to extract identifier for matching. Default uses LaTeX string comparison */
  keyFunc?: (vmobject: VMobject) => string;
  /** Fade duration as fraction of total duration (0-0.5). Default: 0.25 */
  fadeRatio?: number;
  /** Transform unmatched parts (true) or fade them (false). Default: false */
  transformMismatches?: boolean;
}

interface LatexKeyedVMobject extends VMobject {
  getLatex(): string;
}

interface MultipartLatexVMobject extends LatexKeyedVMobject {
  getPartCount(): number;
  getPart(index: number): VMobject;
}

interface ActiveMismatchTransform {
  animation: Transform;
  source: VMobject;
}

function getLatexString(vmobject: VMobject): string | undefined {
  const candidate = vmobject as unknown as Partial<LatexKeyedVMobject>;
  return typeof candidate.getLatex === 'function' ? candidate.getLatex() : undefined;
}

/**
 * Deep-copy a vector tree without invoking a self-rendering VGroup subclass
 * constructor such as MathTex.copy(). The result is an animation snapshot, so
 * retaining the generic VGroup/VMobject structure is sufficient.
 */
function copyVmobjectTree(vmobject: VMobject): VMobject {
  if (!(vmobject instanceof VGroup)) return vmobject.copy() as VMobject;

  const copy = new VGroup();
  copy.position.copy(vmobject.position);
  copy.rotation.copy(vmobject.rotation);
  copy.scaleVector.copy(vmobject.scaleVector);
  copy.color = vmobject.color;
  copy.fillColor = vmobject.fillColor ?? vmobject.color;
  copy.strokeColor = vmobject.strokeColor ?? vmobject.color;
  copy.setStrokeOpacity(vmobject.opacity);
  copy.setFillOpacity(vmobject.fillOpacity);
  copy.setStrokeWidth(vmobject.strokeWidth);

  for (const child of vmobject.children) {
    if (child instanceof VMobject) copy.add(copyVmobjectTree(child));
  }
  return copy;
}

/**
 * Snapshot `target` with geometry expressed in `parent`'s local frame.
 * This preserves top-level MathTex position/scale when a semantic part is
 * temporarily attached under the source tree.
 */
function copyVmobjectIntoParentFrame(target: VMobject, parent: Mobject | null): VMobject {
  const copy = copyVmobjectTree(target);
  const targetToParent = parent
    ? parent._worldMatrix().clone().invert().multiply(target._worldMatrix())
    : target._worldMatrix();
  copy.normalizeTransform(targetToParent);
  return copy;
}

/**
 * Extract an exact semantic TeX key. Unannotated vector objects deliberately
 * receive identity keys instead of shape-derived keys: equal dimensions and
 * point counts do not imply equal TeX.
 */
function defaultTexKey(vmobject: VMobject): string {
  return getLatexString(vmobject) ?? `unkeyed:${vmobject.id}`;
}

/**
 * TransformMatchingTex animation - transforms matching TeX parts between expressions.
 *
 * Parts are matched by their LaTeX content using key-based exact matching.
 * When `transformMismatches` is enabled, unmatched parts are optimally paired
 * using the Hungarian algorithm with position-based cost (center distance),
 * ensuring the closest unmatched source/target parts are transformed together.
 *
 * @example
 * ```typescript
 * // Animate from "x^2 + y^2" to "x^2 + y^2 = r^2"
 * // The "x^2 + y^2" part will transform smoothly
 * // The "= r^2" part will fade in
 * const anim = transformMatchingTex(formula1, formula2);
 * ```
 */
export class TransformMatchingTex extends Animation {
  /** The target mobject to transform into */
  readonly target: VMobject;

  /** Key function for matching */
  readonly keyFunc: (vmobject: VMobject) => string;

  /** Fade duration ratio */
  readonly fadeRatio: number;

  /** Whether to transform mismatches instead of fading */
  readonly transformMismatches: boolean;

  /** Canonical transforms for exact semantic-key matches. */
  private _matchedTransforms: Transform[] = [];

  /** Source parts that will fade out (no match in target) */
  private _fadeOutParts: PaintFadingPart[] = [];

  /** Target parts that will fade in (no match in source) */
  private _fadeInParts: PaintFadingPart[] = [];

  /** Parent used to render and later detach each temporary fade-in copy. */
  private _fadeInParents = new Map<VMobject, Mobject>();

  /** Canonical transforms for mismatches, with the existing cross-fade envelope. */
  private _mismatchedTransforms: ActiveMismatchTransform[] = [];

  /** Exact source family paint values for backward seeking/reset. */
  private _sourcePaint: PaintOpacitySnapshot = [];

  constructor(source: VMobject, target: VMobject, options: TransformMatchingTexOptions = {}) {
    super(source, options);
    this.target = target;
    this.keyFunc = options.keyFunc ?? defaultTexKey;
    this.fadeRatio = Math.min(0.5, Math.max(0, options.fadeRatio ?? 0.25));
    this.transformMismatches = options.transformMismatches ?? false;
  }

  /**
   * Get submobjects from a TeX mobject
   */
  private _getTexParts(vmobject: VMobject): VMobject[] {
    const multipart = vmobject as unknown as Partial<MultipartLatexVMobject>;
    if (typeof multipart.getPartCount === 'function' && typeof multipart.getPart === 'function') {
      const declaredParts: VMobject[] = [];
      const partCount = multipart.getPartCount();
      try {
        for (let index = 0; index < partCount; index++) {
          const part = multipart.getPart(index);
          if (!(part instanceof VMobject)) {
            throw new Error(`TeX part ${index} is not a VMobject.`);
          }
          declaredParts.push(part);
        }
      } catch {
        // A single-string MathTex reports one logical part but intentionally
        // rejects getPart(); in that case the root itself is the semantic part.
        declaredParts.length = 0;
      }
      if (declaredParts.length > 0) return declaredParts;
    }

    // A semantic part owns its descendants. Do not flatten through glyph paths.
    if (getLatexString(vmobject) !== undefined) return [vmobject];

    // Generic wrappers may contain semantic MathTex/part nodes.
    const children = vmobject.children.filter((c) => c instanceof VMobject) as VMobject[];
    if (children.length > 0) {
      const result: VMobject[] = [];
      for (const child of children) {
        result.push(...this._getTexParts(child));
      }
      return result;
    }

    return [vmobject];
  }

  /**
   * Match TeX parts between source and target.
   *
   * Phase 1: Exact key-based matching (LaTeX string comparison).
   * Phase 2 (if transformMismatches): Use Hungarian algorithm with center-distance
   *   cost to optimally pair remaining unmatched source and target parts.
   */
  private _matchTexParts(): void {
    const sourceParts = this._getTexParts(this.mobject as VMobject);
    const targetParts = this._getTexParts(this.target);

    const usedSourceIndices = new Set<number>();
    const usedTargetIndices = new Set<number>();

    // Phase 1: Group parts by key and match exact keys
    const sourceByKey = new Map<string, { vmob: VMobject; index: number }[]>();
    const targetByKey = new Map<string, { vmob: VMobject; index: number }[]>();

    sourceParts.forEach((vmob, index) => {
      const key = this.keyFunc(vmob);
      if (!sourceByKey.has(key)) sourceByKey.set(key, []);
      sourceByKey.get(key)!.push({ vmob, index });
    });

    targetParts.forEach((vmob, index) => {
      const key = this.keyFunc(vmob);
      if (!targetByKey.has(key)) targetByKey.set(key, []);
      targetByKey.get(key)!.push({ vmob, index });
    });

    // Match by key
    for (const [key, sources] of sourceByKey) {
      const targets = targetByKey.get(key);
      if (targets) {
        const matchCount = Math.min(sources.length, targets.length);
        for (let i = 0; i < matchCount; i++) {
          const src = sources[i];
          const tgt = targets[i];
          this._addMatchedPart(src.vmob, tgt.vmob);
          usedSourceIndices.add(src.index);
          usedTargetIndices.add(tgt.index);
        }
      }
    }

    // Collect unmatched parts
    const unmatchedSourceIndices: number[] = [];
    const unmatchedTargetIndices: number[] = [];

    for (let i = 0; i < sourceParts.length; i++) {
      if (!usedSourceIndices.has(i)) {
        unmatchedSourceIndices.push(i);
      }
    }

    for (let i = 0; i < targetParts.length; i++) {
      if (!usedTargetIndices.has(i)) {
        unmatchedTargetIndices.push(i);
      }
    }

    if (
      this.transformMismatches &&
      unmatchedSourceIndices.length > 0 &&
      unmatchedTargetIndices.length > 0
    ) {
      // Phase 2: Use Hungarian algorithm to optimally pair unmatched parts
      // by minimizing total center distance (closest parts get paired)
      const unmatchedSources = unmatchedSourceIndices.map((i) => sourceParts[i]);
      const unmatchedTargets = unmatchedTargetIndices.map((i) => targetParts[i]);

      const costMatrix: number[][] = Array.from({ length: unmatchedSources.length }, (_, si) =>
        Array.from({ length: unmatchedTargets.length }, (_, ti) =>
          centerDistance(unmatchedSources[si], unmatchedTargets[ti]),
        ),
      );

      const result = hungarian(costMatrix);

      const pairedSourceSet = new Set<number>();
      const pairedTargetSet = new Set<number>();

      for (let si = 0; si < unmatchedSources.length; si++) {
        const ti = result.assignments[si];
        if (ti >= 0 && ti < unmatchedTargets.length) {
          this._addMismatchedPair(unmatchedSources[si], unmatchedTargets[ti]);
          pairedSourceSet.add(si);
          pairedTargetSet.add(ti);
        }
      }

      // Remaining unmatched sources fade out
      for (let si = 0; si < unmatchedSources.length; si++) {
        if (!pairedSourceSet.has(si)) {
          const vmob = unmatchedSources[si];
          this._fadeOutParts.push({
            mobject: vmob,
            paint: capturePaintOpacity(vmob),
          });
        }
      }

      // Remaining unmatched targets fade in
      for (let ti = 0; ti < unmatchedTargets.length; ti++) {
        if (!pairedTargetSet.has(ti)) {
          this._addFadeInPart(unmatchedTargets[ti]);
        }
      }
    } else {
      // No transformMismatches: all unmatched sources fade out, targets fade in
      for (const si of unmatchedSourceIndices) {
        const vmob = sourceParts[si];
        this._fadeOutParts.push({
          mobject: vmob,
          paint: capturePaintOpacity(vmob),
        });
      }

      for (const ti of unmatchedTargetIndices) {
        this._addFadeInPart(targetParts[ti]);
      }
    }
  }

  /**
   * Add a matched pair
   */
  private _addMatchedPart(source: VMobject, target: VMobject): void {
    const targetSnapshot = copyVmobjectIntoParentFrame(target, source.parent);
    const transform = new Transform(source, targetSnapshot);
    transform.begin();
    this._matchedTransforms.push(transform);
  }

  /**
   * Add a mismatched pair for transformation
   */
  private _addMismatchedPair(source: VMobject, target: VMobject): void {
    const targetSnapshot = copyVmobjectIntoParentFrame(target, source.parent);
    const transform = new Transform(source, targetSnapshot);
    transform.begin();
    this._mismatchedTransforms.push({
      animation: transform,
      source,
    });
  }

  /**
   * Add a fade-in part
   */
  private _addFadeInPart(vmob: VMobject): void {
    const parent = this.mobject.parent ?? this.mobject;
    const copy = copyVmobjectIntoParentFrame(vmob, parent);
    const paint = capturePaintOpacity(copy);
    applyPaintOpacityFactor(paint, 0);
    parent.add(copy);
    this._fadeInParents.set(copy, parent);

    this._fadeInParts.push({
      mobject: copy,
      paint,
    });
  }

  private _detachFadeInCopies(): void {
    for (const [copy, parent] of this._fadeInParents) {
      parent.remove(copy);
    }
    this._fadeInParents.clear();
  }

  override begin(): void {
    this._detachFadeInCopies();
    this._matchedTransforms = [];
    this._mismatchedTransforms = [];
    this._fadeOutParts = [];
    this._fadeInParts = [];
    super.begin();
    this._sourcePaint = capturePaintOpacity(this.mobject);
    this._matchTexParts();
  }

  interpolate(alpha: number): void {
    for (const transform of this._matchedTransforms) {
      transform.interpolate(alpha);
    }

    for (const part of this._mismatchedTransforms) {
      part.animation.interpolate(alpha);
      scaleCurrentPaintOpacity(part.source, Math.abs(2 * alpha - 1));
    }

    // Handle fading parts
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
    for (const transform of this._matchedTransforms) {
      transform.finish();
    }

    for (const part of this._mismatchedTransforms) {
      part.animation.finish();
    }

    for (const part of this._fadeOutParts) {
      applyPaintOpacityFactor(part.paint, 0);
    }

    for (const part of this._fadeInParts) {
      restorePaintOpacity(part.paint);
    }

    super.finish();
  }

  override cleanUpFromScene(scene: AnimationScene): void {
    super.cleanUpFromScene(scene);
    this._detachFadeInCopies();
    scene.remove(this.mobject);
    scene.add(this.target);
  }

  override getAllMobjects(): readonly Mobject[] {
    return [this.mobject, this.target];
  }

  override reset(): void {
    for (const transform of this._matchedTransforms) transform.reset();
    for (const part of this._mismatchedTransforms) part.animation.reset();
    this._detachFadeInCopies();
    super.reset();
    restorePaintOpacity(this._sourcePaint);
    this._matchedTransforms = [];
    this._mismatchedTransforms = [];
    this._fadeOutParts = [];
    this._fadeInParts = [];
  }
}

/**
 * Create a TransformMatchingTex animation.
 * @param source The source TeX/MathTex VMobject
 * @param target The target TeX/MathTex VMobject
 * @param options Animation options
 */
export function transformMatchingTex(
  source: VMobject,
  target: VMobject,
  options?: TransformMatchingTexOptions,
): TransformMatchingTex {
  return new TransformMatchingTex(source, target, options);
}
