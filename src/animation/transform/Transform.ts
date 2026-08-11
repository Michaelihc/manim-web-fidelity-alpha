/**
 * Transform animation - morphs one mobject into another.
 */

import { Mobject } from '../../core/Mobject';
import { VMobject } from '../../core/VMobject';
import { VGroup } from '../../core/VGroup';
import { PMobject } from '../../mobjects/point/PMobject';
import { Animation, AnimationOptions, AnimationScene } from '../Animation';
import { ImageMobject } from '../../mobjects/image';
import { MathTexImage } from '../../mobjects/text/MathTexImage';
import { Text } from '../../mobjects/text/Text';
import { FadeMorphStrategy } from './FadeMorphStrategy';
import { MorphStrategy } from './MorphStrategy';
import { PointCloudMorphStrategy } from './PointCloudMorphStrategy';
import { PointMorphStrategy } from './PointMorphStrategy';
import { ShapeMorphStrategy } from './ShapeMorphStrategy';
import { canMorphByPoints } from './TransformPairing';

export class Transform extends Animation {
  readonly target: Mobject;
  private _strategy: MorphStrategy | null = null;

  constructor(mobject: Mobject, target: Mobject, options: AnimationOptions = {}) {
    super(mobject, options);
    this.target = target;
  }

  private _shapeMorphEligible(): boolean {
    const sameDisplayType =
      (this.mobject instanceof Text && this.target instanceof Text) ||
      (this.mobject instanceof ImageMobject && this.target instanceof ImageMobject) ||
      (this.mobject instanceof MathTexImage && this.target instanceof MathTexImage);
    return (
      sameDisplayType &&
      this.mobject.getDisplayMeshLength() === 1 &&
      this.target.getDisplayMeshLength() === 1
    );
  }

  private _vmobjectMorphEligible(): boolean {
    if (!(this.mobject instanceof VMobject && this.target instanceof VMobject)) return false;
    return (
      (this.mobject instanceof VGroup && this.target instanceof VGroup) ||
      canMorphByPoints(this.mobject, this.target)
    );
  }

  private _selectStrategy(): MorphStrategy {
    if (this._shapeMorphEligible()) return new ShapeMorphStrategy();
    if (this._vmobjectMorphEligible()) return new PointMorphStrategy();
    if (this.mobject instanceof PMobject && this.target instanceof PMobject) {
      return new PointCloudMorphStrategy();
    }
    return new FadeMorphStrategy();
  }

  override begin(): void {
    super.begin();
    this._strategy = this._selectStrategy();
    this._strategy.begin(this, this.mobject, this.target);
  }

  override interpolate(alpha: number): void {
    if (!this._strategy) throw new Error('Transform.interpolate requires strategy');
    this._strategy.interpolate(this, this.mobject, this.target, alpha);
  }

  override finish(): void {
    if (!this._strategy) throw new Error('Transform.finish requires strategy');
    this._strategy.finish(this, this.mobject, this.target);
    super.finish();
  }

  /**
   * Include the target in render-readiness discovery.
   *
   * Scene implementations can use this Manim-like family hook to await lazy
   * targets (notably MathTex) before begin() freezes transform geometry.
   */
  getAllMobjects(): readonly Mobject[] {
    return [this.mobject, this.target];
  }

  override reset(): void {
    if (this.mobject instanceof VGroup) {
      // Family alignment may have appended placeholder leaves.
      // Animation.reset() restores aggregate VGroup points and therefore
      // requires the original child partition to be back in place first.
      this._strategy?.reset?.(this, this.mobject, this.target);
      super.reset();
    } else {
      // PMobject and textured strategies restore state that the base snapshot
      // cannot represent (per-point alpha, texture/content, target parenting).
      super.reset();
      this._strategy?.reset?.(this, this.mobject, this.target);
    }
    this._strategy = null;
  }
}

export function transform(
  mobject: Mobject,
  target: Mobject,
  options?: AnimationOptions,
): Transform {
  return new Transform(mobject, target, options);
}

/**
 * Like Transform but also swaps `mobject` for `target` in the scene when done.
 * Matches Python manim's ReplacementTransform: after the animation, the scene
 * contains `target` and not the original `mobject`.
 */
export class ReplacementTransform extends Transform {
  private _sourceZIndex: number | null = null;

  override begin(): void {
    // Point morphing interpolates the live source's z-index toward the target,
    // so preserve its semantic scene layer before the strategy mutates it.
    this._sourceZIndex = this.mobject.zIndex;
    super.begin();
  }

  override cleanUpFromScene(scene: AnimationScene): void {
    super.cleanUpFromScene(scene);
    // renderOrder is a renderer-owned dense rank and is recomputed on every
    // scene render. Carry the source's semantic z-index instead so the target
    // continues to sort correctly after later scene changes and reranking.
    this.target.zIndex = this._sourceZIndex ?? this.mobject.zIndex;
    scene.remove(this.mobject);
    scene.add(this.target);
  }
}
export function replacementTransform(
  mobject: Mobject,
  target: Mobject,
  options?: AnimationOptions,
): ReplacementTransform {
  return new ReplacementTransform(mobject, target, options);
}
export interface MobjectWithTarget extends Mobject {
  targetCopy: Mobject | null;
}
export class MoveToTarget extends Transform {
  constructor(mobject: MobjectWithTarget, options: AnimationOptions = {}) {
    if (!mobject.targetCopy)
      throw new Error(
        'MoveToTarget requires mobject.targetCopy to be set. Use mobject.generateTarget() first.',
      );
    super(mobject, mobject.targetCopy, options);
  }
}
export function moveToTarget(mobject: MobjectWithTarget, options?: AnimationOptions): MoveToTarget {
  return new MoveToTarget(mobject, options);
}
