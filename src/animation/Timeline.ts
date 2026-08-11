/**
 * Timeline - Sequencer for animations.
 * Supports GSAP-style positioning for flexible animation scheduling.
 */

import { Animation, type AnimationScene } from './Animation';
import { AnimationGroup } from './AnimationGroup';
import type { Mobject } from '../core/Mobject';
import { logger } from '../utils/logger';

/**
 * Floating-point tolerance for recorded timeline boundaries.
 *
 * Export frame times and segment times are often produced by different sums of
 * the same decimal durations. A one-nanosecond tolerance is many orders of
 * magnitude below a rendered frame, but keeps a frame that is only a few ULPs
 * before a boundary on the intended side of that boundary.
 */
export const TIMELINE_TIME_EPSILON = 1e-9;

/**
 * Position parameter for adding animations to the timeline.
 * - Number: absolute time in seconds
 * - '+=N': N seconds after the last animation ends
 * - '-=N': N seconds before the last animation ends
 * - '<': same start time as the previous animation
 * - '>': end of the previous animation (default)
 */
export type PositionParam = number | string;

interface ScheduledAnimation {
  animation: Animation;
  startTime: number;
  endTime: number;
}

interface TimelineScene extends AnimationScene {
  readonly mobjects: ReadonlySet<Mobject>;
  batch?(callback: () => void): void;
}

interface TimelineSceneAdapter {
  isForeground(mobject: Mobject): boolean;
  restoreForeground(mobject: Mobject, foreground: boolean): void;
  restoreInitialRootOrder(initialRoots: readonly Mobject[]): void;
}

interface SceneMembershipEvent {
  readonly startTime: number;
  readonly endTime: number;
  readonly scheduledAnimations: readonly ScheduledAnimation[];
  readonly cleanupAnimations: readonly Animation[];
  readonly sources: readonly Mobject[];
}

export class Timeline {
  /** All scheduled animations with their timing */
  private _animations: ScheduledAnimation[] = [];

  /**
   * Most recently inserted non-animation hold.
   *
   * Waits deliberately do not create a dummy Animation, but position
   * parameters added after a wait still need to resolve from that hold rather
   * than from the last real animation.
   */
  private _lastWait: { startTime: number; endTime: number } | null = null;

  /** Total duration of the timeline */
  private _duration: number = 0;

  /** Current playback time */
  private _currentTime: number = 0;

  /** Whether the timeline is playing */
  private _isPlaying: boolean = false;

  /** Track which animations have been started */
  protected _startedAnimations: Set<Animation> = new Set();

  /**
   * Scene-membership history is recorded separately from visual interpolation.
   * Animation.reset() can restore pixels and geometry, but a remover or
   * ReplacementTransform also changes which roots belong to the scene.
   */
  private _membershipScene: TimelineScene | null = null;
  private _membershipSceneAdapter: TimelineSceneAdapter | null = null;
  private _initialSceneMobjectOrder: Mobject[] = [];
  private _initialSceneMobjects: Set<Mobject> = new Set();
  private _initialForegroundMobjects: Set<Mobject> = new Set();
  private _membershipEvents: SceneMembershipEvent[] = [];
  private _trackedSceneMobjects: Set<Mobject> = new Set();
  private _cleanedMembershipEvents: Set<SceneMembershipEvent> = new Set();
  private _membershipStateEstablished: boolean = false;

  /**
   * Add an animation to the timeline.
   * @param animation The animation to add
   * @param position When to start the animation (default: '>' - after previous ends)
   */
  add(animation: Animation, position: PositionParam = '>'): this {
    const startTime = this._resolvePosition(position);
    const endTime = startTime + animation.duration;

    this._animations.push({
      animation,
      startTime,
      endTime,
    });

    this._duration = Math.max(this._duration, endTime);
    this._lastWait = null;

    return this;
  }

  /**
   * Add multiple animations to play in parallel (all start at the same time).
   * @param animations The animations to add
   * @param position When to start all animations (default: '>' - after previous ends)
   */
  addParallel(animations: Animation[], position: PositionParam = '>'): this {
    const startTime = this._resolvePosition(position);

    for (const animation of animations) {
      const endTime = startTime + animation.duration;

      this._animations.push({
        animation,
        startTime,
        endTime,
      });

      this._duration = Math.max(this._duration, endTime);
    }

    if (animations.length > 0) {
      this._lastWait = null;
    }

    return this;
  }

  /**
   * Add a hold with no animation.
   *
   * The hold advances timeline time while preserving the visual state reached
   * by preceding animations. It is intentionally not included in `length`,
   * which remains the number of scheduled animations.
   *
   * @param duration Hold duration in seconds
   * @param position When to start the hold (default: after the previous item)
   */
  addWait(duration: number, position: PositionParam = '>'): this {
    const normalizedDuration = Number.isNaN(duration) ? 0 : Math.max(0, duration);
    const startTime = this._resolvePosition(position);
    const endTime = startTime + normalizedDuration;

    this._duration = Math.max(this._duration, endTime);
    this._lastWait = { startTime, endTime };

    return this;
  }

  /**
   * Bind the scene whose root membership this timeline controls.
   *
   * @internal Used by Scene and RecordingScene. Rebinding to the same scene
   * preserves the original baseline captured before timeline construction.
   */
  _attachScene(scene: TimelineScene, adapter?: TimelineSceneAdapter): this {
    if (this._membershipScene === scene) {
      if (adapter) {
        const firstAdapter = this._membershipSceneAdapter === null;
        this._membershipSceneAdapter = adapter;
        if (firstAdapter) {
          this._initialForegroundMobjects = new Set(
            this._initialSceneMobjectOrder.filter((mobject) => adapter.isForeground(mobject)),
          );
        }
      }
      return this;
    }

    this._membershipScene = scene;
    this._membershipSceneAdapter = adapter ?? null;
    this._membershipStateEstablished = false;
    this._captureInitialSceneMembership();
    return this;
  }

  /**
   * Record one play() call as a scene-membership interval.
   *
   * Sources become scene roots at startTime. At endTime, cleanup hooks are
   * replayed in the same flattened order as Scene.play(), which covers both
   * generic removers and source/target swaps without duplicating transform
   * type knowledge in the timeline.
   *
   * @internal Used by Scene and MasterTimeline.
   */
  _addSceneMembershipEvent(
    animations: readonly Animation[],
    startTime: number,
    endTime: number,
  ): this {
    this._membershipStateEstablished = false;
    const flattened = this._flattenAnimations(animations);
    const sources: Mobject[] = [];
    const seenSources = new Set<Mobject>();

    for (const animation of flattened) {
      for (const mobject of animation.getAllMobjects()) {
        this._trackedSceneMobjects.add(mobject);
      }
      if (!(animation instanceof AnimationGroup) && !seenSources.has(animation.mobject)) {
        seenSources.add(animation.mobject);
        sources.push(animation.mobject);
      }
    }

    this._membershipEvents.push({
      startTime,
      endTime,
      scheduledAnimations: this._findScheduledAnimations(animations),
      cleanupAnimations: flattened,
      sources,
    });
    return this;
  }

  /**
   * Resolve a position parameter to an absolute time.
   */
  private _resolvePosition(position: PositionParam): number {
    if (typeof position === 'number') {
      return Math.max(0, position);
    }

    const lastAnim = this._animations[this._animations.length - 1];
    const lastEnd = this._lastWait?.endTime ?? lastAnim?.endTime ?? 0;
    const lastStart = this._lastWait?.startTime ?? lastAnim?.startTime ?? 0;

    if (position === '>') {
      return lastEnd;
    }

    if (position === '<') {
      return lastStart;
    }

    const addMatch = position.match(/^\+=(\d*\.?\d+)$/);
    if (addMatch) {
      const offset = parseFloat(addMatch[1]);
      return lastEnd + offset;
    }

    const subMatch = position.match(/^-=(\d*\.?\d+)$/);
    if (subMatch) {
      const offset = parseFloat(subMatch[1]);
      return Math.max(0, lastEnd - offset);
    }

    logger.warn(`Invalid position parameter: "${position}", using ">" instead`);
    return lastEnd;
  }

  /**
   * Seek to a specific time in the timeline.
   * @param time The time to seek to (in seconds)
   */
  seek(time: number): this {
    const prevTime = this._currentTime;
    const targetTime = Math.max(0, Math.min(time, this._duration));
    this._currentTime = targetTime;

    const movingBackward = targetTime < prevTime;
    const needsMembershipRebuild = !this._membershipStateEstablished || movingBackward;

    const advance = (): void => {
      if (movingBackward) {
        // Reset the animation active at the target plus all future animations,
        // in reverse schedule order. Sequential animations commonly target the
        // same mobject, and each animation's pre-state is the final state of the
        // one before it. Reversing preserves that state stack.
        for (let i = this._animations.length - 1; i >= 0; i--) {
          const scheduled = this._animations[i];
          if (scheduled.endTime > this._currentTime) {
            scheduled.animation.reset();
            this._startedAnimations.delete(scheduled.animation);
          }
        }
      }

      // A monotonic forward seek can advance the existing membership state in
      // place. Rebuilding every recorded root here makes frame-by-frame export
      // quadratic in timeline length and also renders the scene twice per frame.
      if (needsMembershipRebuild) {
        this._resetSceneMembership();
        this._cleanedMembershipEvents.clear();
      }
      this._updateAnimationsAtTime(this._currentTime);
      this._membershipStateEstablished = true;
    };

    // Only the initial/backward reconstruction can mutate many roots. Regular
    // forward export frames deliberately avoid Scene.batch(), whose outer
    // commit renders once before Scene.seek() renders the requested frame.
    if (needsMembershipRebuild && this._membershipScene?.batch) {
      this._membershipScene.batch(advance);
    } else {
      advance();
    }

    return this;
  }
  /**
   * Update the timeline by a time delta.
   * @param dt Time delta in seconds
   */
  update(dt: number): void {
    if (!this._isPlaying) return;

    this._currentTime += dt;

    if (this._currentTime > this._duration) {
      this._currentTime = this._duration;
      this._isPlaying = false;
    }

    this._updateAnimationsAtTime(this._currentTime);
  }

  /**
   * Update all animations that should be active at the given time.
   */
  private _updateAnimationsAtTime(time: number): void {
    const registeredAnimations = new Set<ScheduledAnimation>();

    // Replaying cleanup between play() segments is important for visual state
    // as well as membership. FadeOut restores its source after removal, for
    // example, and the following animation must run after that restoration.
    for (const event of this._membershipEvents) {
      for (const scheduled of event.scheduledAnimations) {
        registeredAnimations.add(scheduled);
      }

      if (time < event.startTime - TIMELINE_TIME_EPSILON) continue;
      if (
        time >= event.endTime - TIMELINE_TIME_EPSILON &&
        this._cleanedMembershipEvents.has(event)
      ) {
        continue;
      }

      const scene = this._membershipScene;
      if (scene) {
        this._addManyPreservingCreationFlags(scene, event.sources);
      }

      for (const scheduled of event.scheduledAnimations) {
        this._updateScheduledAnimation(scheduled, time);
      }

      if (
        time >= event.endTime - TIMELINE_TIME_EPSILON &&
        !this._cleanedMembershipEvents.has(event)
      ) {
        this._applyMembershipCleanup(event);
        this._cleanedMembershipEvents.add(event);
      }
    }

    // Standalone Timeline users do not register scene-membership events.
    // Preserve their original scheduling behavior.
    for (const scheduled of this._animations) {
      if (!registeredAnimations.has(scheduled)) {
        this._updateScheduledAnimation(scheduled, time);
      }
    }
  }

  private _updateScheduledAnimation(scheduled: ScheduledAnimation, time: number): void {
    const { animation, startTime, endTime } = scheduled;

    if (time < startTime - TIMELINE_TIME_EPSILON) return;

    if (!this._startedAnimations.has(animation)) {
      animation.startTime = startTime;
      this._startedAnimations.add(animation);
    }

    if (time <= endTime + TIMELINE_TIME_EPSILON || !animation.isFinished()) {
      // Snap microscopic boundary drift to the recorded boundary. This makes
      // the first sampled frame exactly alpha=0 and the last exactly alpha=1.
      const sampleTime =
        time < startTime
          ? startTime
          : time < endTime && time >= endTime - TIMELINE_TIME_EPSILON
            ? endTime
            : time;
      animation.update(0, sampleTime);
    }
  }

  /**
   * Start playing the timeline.
   */
  play(): this {
    this._isPlaying = true;
    return this;
  }

  /**
   * Pause the timeline.
   */
  pause(): this {
    this._isPlaying = false;
    return this;
  }

  /**
   * Reset the timeline to the beginning.
   */
  reset(): this {
    this._currentTime = 0;
    this._isPlaying = false;
    this._startedAnimations.clear();

    for (let i = this._animations.length - 1; i >= 0; i--) {
      this._animations[i].animation.reset();
    }

    this._resetSceneMembership();
    this._cleanedMembershipEvents.clear();
    this._updateAnimationsAtTime(0);
    this._membershipStateEstablished = true;
    return this;
  }

  /**
   * Check if the timeline has finished playing.
   */
  isFinished(): boolean {
    return this._currentTime >= this._duration;
  }

  /**
   * Check if the timeline is currently playing.
   */
  isPlaying(): boolean {
    return this._isPlaying;
  }

  /**
   * Get the total duration of the timeline.
   */
  getDuration(): number {
    return this._duration;
  }

  /**
   * Get the current playback time.
   */
  getCurrentTime(): number {
    return this._currentTime;
  }

  /**
   * Get the number of animations in the timeline.
   */
  get length(): number {
    return this._animations.length;
  }

  /**
   * Clear all animations from the timeline.
   */
  clear(): this {
    this._animations = [];
    this._lastWait = null;
    this._duration = 0;
    this._currentTime = 0;
    this._isPlaying = false;
    this._startedAnimations.clear();
    this._membershipEvents = [];
    this._trackedSceneMobjects.clear();
    this._cleanedMembershipEvents.clear();
    this._membershipStateEstablished = false;
    if (this._membershipScene) {
      this._captureInitialSceneMembership();
    }
    return this;
  }

  private _captureInitialSceneMembership(): void {
    const scene = this._membershipScene;
    if (!scene) return;

    this._initialSceneMobjectOrder = [...scene.mobjects];
    this._initialSceneMobjects = new Set(this._initialSceneMobjectOrder);
    this._initialForegroundMobjects = new Set(
      this._initialSceneMobjectOrder.filter(
        (mobject) => this._membershipSceneAdapter?.isForeground(mobject) ?? false,
      ),
    );
  }

  private _flattenAnimations(animations: readonly Animation[]): Animation[] {
    const result: Animation[] = [];
    for (const animation of animations) {
      result.push(animation);
      if (animation instanceof AnimationGroup) {
        result.push(...this._flattenAnimations(animation.animations));
      }
    }
    return result;
  }

  private _findScheduledAnimations(animations: readonly Animation[]): ScheduledAnimation[] {
    const result: ScheduledAnimation[] = [];
    const used = new Set<ScheduledAnimation>();

    for (const animation of animations) {
      for (let index = this._animations.length - 1; index >= 0; index--) {
        const scheduled = this._animations[index];
        if (scheduled.animation === animation && !used.has(scheduled)) {
          used.add(scheduled);
          result.push(scheduled);
          break;
        }
      }
    }

    return result;
  }

  /**
   * Restore only timeline-owned roots to the baseline captured when the scene
   * was attached, leaving unrelated scene additions untouched.
   */
  private _resetSceneMembership(): void {
    const scene = this._membershipScene;
    if (!scene) return;

    const restore: Mobject[] = [];
    const remove: Mobject[] = [];
    for (const mobject of this._trackedSceneMobjects) {
      if (this._initialSceneMobjects.has(mobject)) {
        restore.push(mobject);
      } else {
        remove.push(mobject);
      }
    }

    // Scene.add/remove refresh painter ordering once per call. Reconstructing
    // a recording one root at a time turns a large timeline into quadratic
    // work even while rendering is batched, so mutate each membership class
    // in one operation.
    if (remove.length > 0) scene.remove(...remove);
    this._addManyPreservingCreationFlags(scene, restore);
    for (const mobject of restore) {
      this._membershipSceneAdapter?.restoreForeground(
        mobject,
        this._initialForegroundMobjects.has(mobject),
      );
    }
    this._membershipSceneAdapter?.restoreInitialRootOrder(this._initialSceneMobjectOrder);
  }

  private _applyMembershipCleanup(event: SceneMembershipEvent): void {
    const scene = this._membershipScene;
    if (!scene) return;

    // Cleanup receives a forwarding facade so any custom target it introduces
    // joins the tracked set and can be removed on a later rewind.
    const membershipScene: AnimationScene = {
      add: (...mobjects) => {
        for (const mobject of mobjects) {
          this._trackedSceneMobjects.add(mobject);
          this._addPreservingCreationFlags(scene, mobject);
        }
      },
      remove: (...mobjects) => {
        for (const mobject of mobjects) {
          this._trackedSceneMobjects.add(mobject);
        }
        scene.remove(...mobjects);
      },
    };

    for (const animation of event.cleanupAnimations) {
      animation.cleanUpFromScene(membershipScene);
    }
  }

  private _addManyPreservingCreationFlags(
    scene: TimelineScene,
    mobjects: readonly Mobject[],
  ): void {
    const missing = mobjects.filter((mobject) => !scene.mobjects.has(mobject));
    if (missing.length === 0) return;

    const families = missing.map((mobject) => {
      const family = mobject.getFamily();
      return {
        family,
        flags: family.map((member) => member.createdAtBeginning),
      };
    });
    scene.add(...missing);
    for (const { family, flags } of families) {
      for (let index = 0; index < family.length; index++) {
        family[index].createdAtBeginning = flags[index];
      }
    }
  }

  private _addPreservingCreationFlags(scene: TimelineScene, mobject: Mobject): void {
    this._addManyPreservingCreationFlags(scene, [mobject]);
  }
}
