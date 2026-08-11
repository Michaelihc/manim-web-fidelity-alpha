/**
 * Succession - plays animations one after another (sequential).
 */

import { Animation } from './Animation';
import { AnimationGroup, AnimationGroupOptions } from './AnimationGroup';

export type SuccessionOptions = Omit<AnimationGroupOptions, 'lagRatio'>;

/**
 * Create a Succession animation group.
 * Animations play one after another with no overlap (lagRatio = 1).
 *
 * @param animations Array of animations to play in sequence
 * @param options Animation options (rateFunc)
 */
export function succession(animations: Animation[], options?: SuccessionOptions): Succession {
  return new Succession(animations, options);
}

/**
 * Succession class for cases where class instantiation is preferred.
 */
export class Succession extends AnimationGroup {
  private _activeIndex: number = -1;
  private _childStartTimes: number[] = [];
  private _childEndTimes: number[] = [];
  private _lastGroupTime: number | null = null;

  constructor(animations: Animation[], options: SuccessionOptions = {}) {
    super(animations, {
      ...options,
      lagRatio: 1,
    });
  }

  /**
   * Begin only the first child. AnimationGroup intentionally begins every
   * child to support overlapping schedules, but Succession must defer each
   * child's state snapshot until the preceding child has finished.
   */
  override begin(): void {
    Animation.prototype.begin.call(this);
    this._computeTimings();
    this._activeIndex = -1;
    this._lastGroupTime = null;

    if (this.animations.length > 0) {
      this._activate(0);
    }
  }

  /**
   * Advance the active child according to the group's absolute time. Backward
   * interpolation rebuilds the child lifecycle from pristine state so direct
   * seeks and timeline resets produce the same result as forward playback.
   */
  override interpolate(alpha: number): void {
    const groupTime = Math.max(0, Math.min(this.duration, alpha * this.duration));

    if (this._lastGroupTime !== null && groupTime < this._lastGroupTime) {
      this._rebuildAt(groupTime);
    } else {
      if (this._activeIndex < 0 && this.animations.length > 0) {
        this._activate(0);
      }
      this._advanceThrough(groupTime);
    }

    const active = this.animations[this._activeIndex];
    if (active) {
      const startTime = this._childStartTimes[this._activeIndex];
      const duration = active.duration;
      const localAlpha =
        duration > 0 ? Math.max(0, Math.min(1, (groupTime - startTime) / duration)) : 1;
      active.interpolateRawAlpha(localAlpha);
    }

    this._lastGroupTime = groupTime;
  }

  /**
   * Finish the current child and all remaining children in lifecycle order.
   */
  override finish(): void {
    if (!this._hasBegun) {
      this.begin();
    }

    while (this._activeIndex >= 0 && this._activeIndex < this.animations.length) {
      this._finishActiveAndAdvance();
    }

    this._lastGroupTime = this.duration;
    Animation.prototype.finish.call(this);
  }

  /**
   * Reset children in reverse order because later animations may have
   * snapshotted the final state of earlier animations on the same mobject.
   */
  override reset(): void {
    for (let i = this.animations.length - 1; i >= 0; i--) {
      this.animations[i].reset();
    }
    Animation.prototype.reset.call(this);
    this._activeIndex = -1;
    this._lastGroupTime = null;
  }

  private _computeTimings(): void {
    this._childStartTimes = [];
    this._childEndTimes = [];

    let currentTime = 0;
    for (const animation of this.animations) {
      this._childStartTimes.push(currentTime);
      currentTime += animation.duration;
      this._childEndTimes.push(currentTime);
    }
  }

  private _activate(index: number): void {
    this._activeIndex = index;
    const animation = this.animations[index];
    if (animation) {
      animation.begin();
    }
  }

  private _finishActiveAndAdvance(): void {
    const active = this.animations[this._activeIndex];
    if (active && !active.isFinished()) {
      // A seek or slow frame may jump directly across the boundary. Apply
      // the child's endpoint before finish(); the base finish() only marks
      // completion and many animations do not override it to set alpha=1.
      active.interpolateRawAlpha(1);
      active.finish();
    }
    this._activate(this._activeIndex + 1);
  }

  private _advanceThrough(groupTime: number): void {
    while (
      this._activeIndex >= 0 &&
      this._activeIndex < this.animations.length &&
      groupTime >= this._childEndTimes[this._activeIndex]
    ) {
      this._finishActiveAndAdvance();
    }
  }

  private _rebuildAt(groupTime: number): void {
    for (let i = this.animations.length - 1; i >= 0; i--) {
      this.animations[i].reset();
    }
    this._isFinished = false;
    this._activeIndex = -1;

    if (this.animations.length > 0) {
      this._activate(0);
      this._advanceThrough(groupTime);
    }
  }
}
