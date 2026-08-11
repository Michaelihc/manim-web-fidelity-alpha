/**
 * Base Animation class for all animations in manimweb.
 * Animations transform mobjects over time.
 */

import { Mobject } from '../core/Mobject';
import { VMobject } from '../core/VMobject';
import { RateFunction, smooth } from '../rate-functions';
import { logger } from '../utils/logger';
import typia from 'typia';

export type { RateFunction };

export interface AnimationOptions {
  /** Duration of the animation in seconds (default: 1) */
  duration?: number;
  /** Rate function controlling the animation's pacing (default: smooth) */
  rateFunc?: RateFunction;
  /** Shift direction for fade animations */
  shift?: [number, number, number];
}

/**
 * Minimal scene surface needed by Animation.cleanUpFromScene().
 * Declared here (not imported from core/Scene) to avoid a core→animation cycle.
 */
export interface AnimationScene {
  add(...mobjects: Mobject[]): void;
  remove(...mobjects: Mobject[]): void;
}

export abstract class Animation {
  /** The mobject being animated */
  readonly mobject: Mobject;

  /** Duration of the animation in seconds */
  readonly duration: number;

  /** Rate function controlling the animation's pacing */
  readonly rateFunc: RateFunction;

  /** Time when the animation started (set by Timeline) */
  protected _startTime: number | null = null;

  /** Whether the animation has finished */
  protected _isFinished: boolean = false;

  /** Track if begin() has been called */
  protected _hasBegun: boolean = false;

  /**
   * If true, the scene will remove this mobject after the animation finishes.
   * Used by FadeOut (like Python manim's remover=True).
   */
  remover: boolean = false;

  /**
   * Snapshot of the mobject's state before this animation first ran.
   * Captured on the first begin() call and used by reset() to restore
   * the mobject to its pre-animation visual state for clean re-seeking.
   */
  private _preAnimationState: Mobject | null = null;

  constructor(mobject: Mobject, options: AnimationOptions = {}) {
    // Validate options via typia to generate runtime assertions.
    typia.assert<AnimationOptions>(options);
    this.mobject = mobject;
    this.duration = options.duration ?? 1;
    this.rateFunc = options.rateFunc ?? smooth;
  }

  /**
   * Called when the animation starts.
   * Subclasses can override to set up initial state.
   * On the very first call, captures a snapshot of the mobject so that
   * reset() can restore it for clean backward seeking.
   */
  begin(): void {
    if (!this._preAnimationState) {
      // `copy()` is abstract on Mobject, so a bare `new Mobject()` (no concrete
      // subclass) has no `copy` on its prototype at runtime. Such bare mobjects
      // only ever come from animation tests; detect them by prototype lookup and
      // fall back to a minimal snapshot silently. Errors thrown from _inside_ a
      // real subclass's copy() are still surfaced loudly below.
      //
      // Cleanup owed: several animation tests construct bare Mobjects and
      // animate them. They should be migrated to concrete mobjects, after which
      // this prototype check and the _captureMinimalState fallback can go.
      const hasCopy = typeof (this.mobject as { copy?: () => Mobject }).copy === 'function';
      if (!hasCopy) {
        this._preAnimationState = this._captureMinimalState();
      } else {
        try {
          this._preAnimationState = this.mobject.copy();
        } catch (err) {
          logger.warn(
            'Animation.begin(): mobject.copy() failed, using minimal state snapshot. ' +
              'Backward seeking may not fully restore this mobject.',
            err,
          );
          this._preAnimationState = this._captureMinimalState();
        }
      }
    }
    this._hasBegun = true;
    this._isFinished = false;
  }

  /**
   * Capture a minimal snapshot when copy() is unavailable.
   * Creates a plain object that looks enough like a Mobject for reset() to use.
   */
  private _captureMinimalState(): Mobject {
    const m = this.mobject;
    // Create a minimal object with the properties reset() needs
    const snapshot = Object.create(null) as Record<string, unknown>;
    snapshot.position = m.position.clone();
    snapshot.rotation = m.rotation.clone();
    snapshot.scaleVector = m.scaleVector.clone();
    snapshot.color = m.color;
    snapshot.opacity = m.opacity;
    snapshot.strokeWidth = m.strokeWidth;
    snapshot.fillOpacity = m.fillOpacity;
    return snapshot as unknown as Mobject;
  }

  /**
   * Called when the animation ends.
   * Subclasses can override to clean up or finalize state.
   */
  finish(): void {
    this._isFinished = true;
  }

  /**
   * Hook called by Scene after the animation finishes, before the next play().
   * Default: removes `mobject` if `remover` is set (FadeOut, Write({remover:true})).
   * Override for animations that need to mutate scene membership — e.g.
   * ReplacementTransform swaps source for target.
   */
  cleanUpFromScene(scene: AnimationScene): void {
    if (this.remover) {
      scene.remove(this.mobject);
    }
  }

  /**
   * Return every mobject participating in this animation.
   *
   * Composite and transform animations override this Manim-compatible hook
   * so render-readiness and timeline visibility discovery do not mistake a
   * dummy/group mobject for the actual animated family.
   */
  getAllMobjects(): readonly Mobject[] {
    return [this.mobject];
  }

  /**
   * Apply the animation at a given progress value.
   * @param alpha Progress from 0 (start) to 1 (end)
   */
  abstract interpolate(alpha: number): void;

  /**
   * Convert timeline progress into subclass interpolation.
   *
   * Most animations ease the family as one unit. Creation animations override
   * this hook because Manim applies the rate function after computing each
   * lagged family member's local alpha.
   */
  protected _interpolateRawAlpha(rawAlpha: number): void {
    this.interpolate(this.rateFunc(rawAlpha));
  }

  /**
   * Dispatch uneased local progress through the animation's subclass hook.
   *
   * Composition animations must use this instead of applying rateFunc
   * themselves: creation animations intentionally ease after computing each
   * lagged family member's local progress.
   *
   * @internal
   */
  interpolateRawAlpha(rawAlpha: number): void {
    this._interpolateRawAlpha(Math.max(0, Math.min(1, rawAlpha)));
  }

  /**
   * Update the animation for the current frame.
   * @param _dt Time delta since last frame (unused, but available for subclasses)
   * @param currentTime Current time in the timeline
   */
  update(_dt: number, currentTime: number): void {
    if (this._startTime === null) {
      this._startTime = currentTime;
    }

    if (!this._hasBegun) {
      this.begin();
    }

    const elapsed = currentTime - this._startTime;
    const rawAlpha = this.duration > 0 ? Math.min(1, Math.max(0, elapsed / this.duration)) : 1;
    this.interpolateRawAlpha(rawAlpha);

    // Check if finished
    if (rawAlpha >= 1 && !this._isFinished) {
      this.finish();
    }
  }

  /**
   * Check if the animation has finished
   */
  isFinished(): boolean {
    return this._isFinished;
  }

  /**
   * Reset the animation to its initial state.
   * Restores the mobject to its pre-animation visual state so that
   * re-seeking (especially backward) produces correct results.
   */
  reset(): void {
    if (this._preAnimationState) {
      // Restore the mobject's visual properties from the snapshot
      const saved = this._preAnimationState;
      this.mobject.position.copy(saved.position);
      this.mobject.rotation.copy(saved.rotation);
      this.mobject.scaleVector.copy(saved.scaleVector);
      // Restore paint through the public setters so the renderer-facing style
      // record and the live scalar fields cannot diverge.  Directly assigning
      // strokeWidth/fillOpacity leaves `_style` at the animation's final paint;
      // a subsequent exact-value setter then short-circuits and cannot repair
      // that stale record.
      this.mobject.setFill(saved.fillColor ?? saved.color, saved.fillOpacity);
      this.mobject.setStroke(saved.color, saved.strokeWidth, saved.opacity);

      // Restore leaf geometry structurally. A VGroup's getLocalPoints()
      // aggregates its descendants, whose point counts may have changed
      // during partial-path animations; feeding that aggregate back through
      // VGroup.setPoints() before the leaves are restored violates its
      // partition invariant.
      if (this.mobject instanceof VMobject && saved instanceof VMobject) {
        this._restoreVMobjectFamilyPoints(this.mobject, saved);
      }

      this.mobject._markDirty();
    }
    this._startTime = null;
    this._isFinished = false;
    this._hasBegun = false;
  }

  private _restoreVMobjectFamilyPoints(current: VMobject, saved: VMobject): void {
    if (current.children.length === 0 && saved.children.length === 0) {
      current.setPoints3D(saved.getLocalPoints());
      return;
    }

    const childCount = Math.min(current.children.length, saved.children.length);
    for (let index = 0; index < childCount; index++) {
      const currentChild = current.children[index];
      const savedChild = saved.children[index];
      if (currentChild instanceof VMobject && savedChild instanceof VMobject) {
        this._restoreVMobjectFamilyPoints(currentChild, savedChild);
      }
    }
    current._markDirty();
  }

  /**
   * Get the start time of this animation (set by Timeline)
   */
  get startTime(): number | null {
    return this._startTime;
  }

  /**
   * Set the start time of this animation (used by Timeline)
   */
  set startTime(time: number | null) {
    this._startTime = time;
  }
}
