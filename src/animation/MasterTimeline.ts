/**
 * MasterTimeline - Extended Timeline with segment + slide tracking for Player.
 *
 * Two granularities:
 * - **Segment**: one play() or wait() call. Pure timing unit.
 * - **Slide**: one or more contiguous segments that the user navigates as a
 *   single unit in slidesMode. Mirrors manim-slides' next_slide() concept.
 *
 * Slides are built by the recorder calling beginSlide(opts) as a boundary
 * marker; finalizeSlides() at end of recording builds the _slides array.
 * If no boundary is ever recorded each segment becomes its own slide, which
 * preserves the original per-play slidesMode behavior.
 */

import { Animation } from './Animation';
import { AnimationGroup } from './AnimationGroup';
import { Timeline, TIMELINE_TIME_EPSILON } from './Timeline';
import { Mobject } from '../core/Mobject';
import { logger } from '../utils/logger';

export interface Segment {
  /** Index in the segments array */
  index: number;
  /** Start time in seconds */
  startTime: number;
  /** End time in seconds */
  endTime: number;
  /** Animations in this segment (empty for wait segments) */
  animations: Animation[];
  /** Whether this is a wait/pause segment */
  isWait: boolean;
}

export interface Slide {
  /** Index in the slides array */
  readonly index: number;
  /** First segment in this slide */
  readonly startSegmentIndex: number;
  /** Last segment in this slide (inclusive) */
  readonly endSegmentIndex: number;
  /** = segments[startSegmentIndex].startTime */
  readonly startTime: number;
  /** = segments[endSegmentIndex].endTime */
  readonly endTime: number;
  /**
   * Replay this slide in slidesMode until the user navigates away
   * (→, ←, public seek out of the slide, or setSlidesMode(false)).
   * Wins over `autoNext` when both are set.
   */
  readonly loop: boolean;
  /**
   * Auto-advance to the next slide when this slide finishes (slidesMode only).
   * Ignored if `loop` is also true. Final autoNext slide pauses normally.
   */
  readonly autoNext: boolean;
}

export interface SlideOptions {
  /** Replay this slide in slidesMode until the user advances. */
  loop?: boolean;
  /** Auto-advance to the next slide when this slide finishes (slidesMode only). */
  autoNext?: boolean;
}

interface PaintOpacitySnapshot {
  readonly fillOpacity: number;
  readonly strokeOpacity: number;
}

export class MasterTimeline extends Timeline {
  private _segments: Segment[] = [];
  private _slides: Slide[] = [];
  /**
   * Slide boundaries recorded by beginSlide() during recording. Each entry
   * means "the segment at this index starts a new slide with these opts."
   * Consumed by finalizeSlides().
   */
  private _slideBoundaries: { atSegmentIndex: number; opts: SlideOptions }[] = [];
  /**
   * Maps mobjects to the segment index where they first appear.
   * Used by seek() to hide mobjects that haven't been introduced yet.
   */
  private _mobjectFirstSegment: Map<Mobject, number> = new Map();
  /**
   * Saves every introduced family member's independent fill/stroke opacity
   * at addSegment() time, before any seek() hides it.
   */
  private _savedMobjectOpacities: Map<Mobject, PaintOpacitySnapshot> = new Map();
  /** Backing Three.js visibility before timeline suppression first touched a member. */
  private _savedThreeVisibility: Map<Mobject, boolean> = new Map();
  /** Family members introduced by each segment, for O(crossed segments) reveals. */
  private _introducedMobjectsBySegment: Map<number, Mobject[]> = new Map();
  /** Future family members whose paint is currently suppressed. */
  private _hiddenFutureMobjects: Set<Mobject> = new Set();
  /** First segment whose introduction boundary has not been crossed. */
  private _nextRevealSegmentIndex = 0;
  /** False while recording/appending has left live mobjects at construction-time state. */
  private _seekStateEstablished = false;

  /**
   * Rebuild on backward seeks, but advance monotonically in place.
   *
   * A forward seek can safely finish the currently active animation and begin
   * intervening animations in schedule order. Resetting the entire recording
   * for every forward checkpoint is both unnecessary and prohibitively costly
   * for MathTex-heavy timelines. Backward seeks still unwind every snapshot in
   * reverse order before replaying, preserving exact arbitrary-seek behavior.
   */
  override seek(time: number): this {
    const previousTime = this.getCurrentTime();
    const targetTime = Math.max(0, Math.min(time, this.getDuration()));
    const isBackward = targetTime < previousTime;
    const needsRebuild = !this._seekStateEstablished || isBackward;

    if (needsRebuild) {
      // Unwind in reverse schedule order. Later animations snapshot the final
      // state of earlier ones, so resetting forward would restore those later
      // snapshots over the true initial state (and can violate VGroup topology
      // invariants after a partial-path animation).
      for (let segmentIndex = this._segments.length - 1; segmentIndex >= 0; segmentIndex--) {
        const animations = this._segments[segmentIndex].animations;
        for (let animationIndex = animations.length - 1; animationIndex >= 0; animationIndex--) {
          animations[animationIndex].reset();
        }
      }

      // Clear started tracking so _updateAnimationsAtTime re-begins them.
      this._startedAnimations.clear();

      // Restore all mobjects to their original paint opacity before replaying.
      // This ensures animation begin() captures the correct opacity,
      // even if a previous begin() captured a value corrupted by hiding.
      for (const mobject of this._savedMobjectOpacities.keys()) {
        this._restorePaintOpacity(mobject);
      }
      this._hiddenFutureMobjects.clear();
    } else {
      this._restoreIntroductionsThrough(targetTime);
    }

    // Delegate to parent which re-applies animations at target time
    super.seek(targetTime);
    this._seekStateEstablished = true;

    // A rebuild restores every snapshot, so establish the future-hidden state
    // once afterward. Monotonic seeks reveal only newly crossed segments.
    if (needsRebuild) {
      this._hideIntroductionsAfter(targetTime);
    }

    return this;
  }

  /**
   * Override update to restore opacity for mobjects whose introducing
   * segment starts during this tick. seek() hides future mobjects by
   * setting opacity=0; this restores them exactly when playback crosses
   * their segment boundary (not every frame).
   */
  override update(dt: number): void {
    if (!this.isPlaying()) return;
    if (!this._seekStateEstablished) {
      this.seek(this.getCurrentTime());
    }
    const targetTime = Math.min(this.getDuration(), this.getCurrentTime() + Math.max(0, dt));
    this._restoreIntroductionsThrough(targetTime);
    super.update(dt);
  }

  /**
   * Override reset to use seek(0) so future mobjects are hidden.
   */
  override reset(): this {
    this._seekStateEstablished = false;
    this.seek(0);
    this.pause();
    return this;
  }

  /**
   * Add a segment containing one or more parallel animations.
   */
  addSegment(animations: Animation[]): Segment {
    this._seekStateEstablished = false;
    const startTime = this.getDuration();
    this.addParallel(animations, startTime);

    const maxDuration = Math.max(...animations.map((a) => a.duration));
    const segmentIndex = this._segments.length;
    const segment: Segment = {
      index: segmentIndex,
      startTime,
      endTime: startTime + maxDuration,
      animations,
      isWait: false,
    };
    this._segments.push(segment);
    this._addSceneMembershipEvent(animations, startTime, segment.endTime);

    // Track every paint participant, including transform targets. Targets are
    // not added as independent roots by ordinary transforms, but cleanup-based
    // replacements can introduce them. Recording their earliest participation
    // prevents a later FadeOut from being mistaken for their first appearance.
    // Register every family member at its earliest segment so animating a child
    // again later cannot make it disappear between those segments.
    for (const mobject of this._collectIntroducedMobjects(animations)) {
      const family = typeof mobject.getFamily === 'function' ? mobject.getFamily() : [mobject];
      for (const member of family) {
        if (!this._mobjectFirstSegment.has(member)) {
          this._mobjectFirstSegment.set(member, segmentIndex);
          const introduced = this._introducedMobjectsBySegment.get(segmentIndex) ?? [];
          introduced.push(member);
          this._introducedMobjectsBySegment.set(segmentIndex, introduced);
          this._savedMobjectOpacities.set(member, {
            fillOpacity: member.fillOpacity,
            strokeOpacity: member.opacity,
          });
        }
      }
    }

    return segment;
  }

  private _restorePaintOpacity(mobject: Mobject): void {
    const snapshot = this._savedMobjectOpacities.get(mobject);
    if (!snapshot) return;
    const looseMobject = mobject as unknown as { fillOpacity: number; opacity: number };
    // Bypass VGroup's family-propagating overrides: every member is tracked
    // independently and keeps its own paint values.
    if (mobject instanceof Mobject) {
      Mobject.prototype.setFillOpacity.call(mobject, snapshot.fillOpacity);
      Mobject.prototype.setStrokeOpacity.call(mobject, snapshot.strokeOpacity);
    } else {
      looseMobject.fillOpacity = snapshot.fillOpacity;
      looseMobject.opacity = snapshot.strokeOpacity;
    }
    const savedThreeVisibility = this._savedThreeVisibility.get(mobject);
    if (savedThreeVisibility !== undefined) {
      mobject.getThreeObject().visible = savedThreeVisibility;
    }
    this._hiddenFutureMobjects.delete(mobject);
  }

  private _hidePaint(mobject: Mobject): void {
    if (!this._savedMobjectOpacities.has(mobject) || this._hiddenFutureMobjects.has(mobject)) {
      return;
    }
    const threeObject = mobject.getThreeObject();
    if (!this._savedThreeVisibility.has(mobject)) {
      this._savedThreeVisibility.set(mobject, threeObject.visible);
    }
    threeObject.visible = false;
    const looseMobject = mobject as unknown as { fillOpacity: number; opacity: number };
    if (mobject instanceof Mobject) {
      Mobject.prototype.setFillOpacity.call(mobject, 0);
      Mobject.prototype.setStrokeOpacity.call(mobject, 0);
    } else {
      looseMobject.fillOpacity = 0;
      looseMobject.opacity = 0;
    }
    this._hiddenFutureMobjects.add(mobject);
  }

  private _restoreIntroductionsThrough(targetTime: number): void {
    while (this._nextRevealSegmentIndex < this._segments.length) {
      const segmentIndex = this._nextRevealSegmentIndex;
      const segment = this._segments[segmentIndex];
      if (!segment || segment.startTime > targetTime + TIMELINE_TIME_EPSILON) break;

      for (const mobject of this._introducedMobjectsBySegment.get(segmentIndex) ?? []) {
        if (this._hiddenFutureMobjects.has(mobject) && !mobject.createdAtBeginning) {
          this._restorePaintOpacity(mobject);
        }
      }
      this._nextRevealSegmentIndex++;
    }
  }

  private _hideIntroductionsAfter(targetTime: number): void {
    this._nextRevealSegmentIndex = this._firstSegmentAfter(targetTime);
    for (
      let segmentIndex = this._nextRevealSegmentIndex;
      segmentIndex < this._segments.length;
      segmentIndex++
    ) {
      for (const mobject of this._introducedMobjectsBySegment.get(segmentIndex) ?? []) {
        if (!mobject.createdAtBeginning) this._hidePaint(mobject);
      }
    }
  }

  private _firstSegmentAfter(time: number): number {
    let low = 0;
    let high = this._segments.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this._segments[middle].startTime <= time + TIMELINE_TIME_EPSILON) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private _collectIntroducedMobjects(animations: readonly Animation[]): Mobject[] {
    const result: Mobject[] = [];
    const seen = new Set<Mobject>();
    const visit = (animation: Animation): void => {
      if (animation instanceof AnimationGroup) {
        for (const child of animation.animations) visit(child);
        return;
      }
      for (const mobject of animation.getAllMobjects()) {
        if (!seen.has(mobject)) {
          seen.add(mobject);
          result.push(mobject);
        }
      }
    };
    for (const animation of animations) {
      visit(animation);
    }
    return result;
  }

  /**
   * Add a wait (pause) segment with no animations.
   */
  addWaitSegment(duration: number): Segment {
    const startTime = this.getDuration();

    // We need to advance the timeline's internal duration.
    // Create a no-op "wait animation" that just holds time.
    const waitAnim = new WaitAnimation(duration);
    this.add(waitAnim, startTime);

    const segment: Segment = {
      index: this._segments.length,
      startTime,
      endTime: startTime + duration,
      animations: [],
      isWait: true,
    };
    this._segments.push(segment);
    return segment;
  }

  /**
   * Record a slide boundary: the next segment added will start a new slide
   * with the given options. Inspired by manim-slides' `next_slide(...)` — the
   * options configure the slide that *follows* this call.
   *
   * If no boundary is ever recorded, every segment becomes its own slide
   * (per-play behavior, used by existing slidesMode callers).
   *
   * Calling `beginSlide()` twice at the same segment index (i.e. with no
   * intervening play/wait) drops the earlier call's options, since an
   * empty slide cannot carry options into anything that will play. We warn
   * to surface the likely user error.
   */
  beginSlide(opts: SlideOptions = {}): void {
    const atSegmentIndex = this._segments.length;
    const last = this._slideBoundaries[this._slideBoundaries.length - 1];
    if (
      last &&
      last.atSegmentIndex === atSegmentIndex &&
      (last.opts.loop || last.opts.autoNext) &&
      typeof console !== 'undefined'
    ) {
      logger.warn(
        'MasterTimeline.beginSlide: consecutive nextSlide() calls with no play()/wait() between them — previous opts ' +
          JSON.stringify(last.opts) +
          ' will be dropped.',
      );
    }
    this._slideBoundaries.push({ atSegmentIndex, opts });
  }

  /**
   * Build the `_slides` array from recorded segments and slide boundaries.
   * Call once after the recording builder finishes; idempotent — calling
   * twice with the same `_segments` / `_slideBoundaries` produces the same
   * `_slides`.
   *
   * - No boundaries recorded: each segment is its own slide.
   * - Otherwise: segments before the first boundary form an implicit slide 0
   *   with default opts; each boundary opens a new slide with its opts that
   *   captures all subsequent segments up to the next boundary (or the end).
   *
   * Empty slides (consecutive boundaries with no plays between them) are
   * skipped — they have no animations and no duration to occupy.
   *
   * Throws if any slide carries `loop: true` but has zero total duration,
   * since the player would rewind every frame.
   */
  finalizeSlides(): void {
    this._slides = [];
    if (this._segments.length === 0) return;

    if (this._slideBoundaries.length === 0) {
      // Auto-boundary: each segment becomes its own slide with default opts.
      for (const seg of this._segments) {
        this._slides.push(this._buildSlide(seg.index, seg.index, {}));
      }
      return;
    }

    // Manual boundary mode. Synthesise a leading boundary at index 0 if the
    // first user boundary is later, so plays before it form slide 0 with
    // default opts.
    const boundaries = [...this._slideBoundaries];
    if (boundaries[0].atSegmentIndex > 0) {
      boundaries.unshift({ atSegmentIndex: 0, opts: {} });
    }
    // Synthesise a trailing boundary at segments.length so the last slide
    // has a well-defined end.
    boundaries.push({ atSegmentIndex: this._segments.length, opts: {} });

    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i].atSegmentIndex;
      const end = boundaries[i + 1].atSegmentIndex - 1;
      if (end < start) continue; // empty slide — skip
      this._slides.push(this._buildSlide(start, end, boundaries[i].opts));
    }
  }

  /**
   * Single construction site for Slide: enforces invariants, normalises opts
   * (`loop` wins over `autoNext`), and validates zero-duration loops.
   */
  private _buildSlide(start: number, end: number, opts: SlideOptions): Slide {
    const startSeg = this._segments[start];
    const endSeg = this._segments[end];
    if (!startSeg || !endSeg || end < start) {
      throw new Error(
        `MasterTimeline._buildSlide: invalid segment range [${start}..${end}] for ${this._segments.length} segments.`,
      );
    }
    const loop = opts.loop ?? false;
    if (loop && endSeg.endTime <= startSeg.startTime) {
      throw new Error(
        'MasterTimeline.finalizeSlides: cannot loop a zero-duration slide (would rewind every frame).',
      );
    }
    // Normalize: loop wins over autoNext so the runtime branch and the type
    // tell the same story.
    const autoNext = loop ? false : (opts.autoNext ?? false);
    return {
      index: this._slides.length,
      startSegmentIndex: start,
      endSegmentIndex: end,
      startTime: startSeg.startTime,
      endTime: endSeg.endTime,
      loop,
      autoNext,
    };
  }

  /**
   * Get all segments.
   */
  getSegments(): readonly Segment[] {
    return this._segments;
  }

  /**
   * Get all slides.
   */
  getSlides(): readonly Slide[] {
    return this._slides;
  }

  /**
   * Get the slide active at the given time. Returns `null` if `time` is
   * before the first slide's startTime or no slides exist.
   */
  getSlideAtTime(time: number): Slide | null {
    for (let i = this._slides.length - 1; i >= 0; i--) {
      if (time >= this._slides[i].startTime) {
        return this._slides[i];
      }
    }
    return null;
  }

  /**
   * Get the currently-active slide based on _currentTime.
   */
  getCurrentSlide(): Slide | null {
    return this.getSlideAtTime(this.getCurrentTime());
  }

  /** Number of slides built by finalizeSlides(). */
  get slideCount(): number {
    return this._slides.length;
  }

  /**
   * Get the segment at the given time.
   */
  getSegmentAtTime(time: number): Segment | null {
    for (let i = this._segments.length - 1; i >= 0; i--) {
      if (time >= this._segments[i].startTime) {
        return this._segments[i];
      }
    }
    return this._segments[0] ?? null;
  }

  /**
   * Get the currently-active segment based on _currentTime.
   */
  getCurrentSegment(): Segment | null {
    return this.getSegmentAtTime(this.getCurrentTime());
  }

  /**
   * Seek to the start of the next segment.
   * Returns the segment seeked to, or null if already at the end.
   */
  nextSegment(): Segment | null {
    const current = this.getCurrentSegment();
    if (!current) return null;

    const nextIdx = current.index + 1;
    if (nextIdx >= this._segments.length) return null;

    const next = this._segments[nextIdx];
    this.seek(next.startTime);
    return next;
  }

  /**
   * Seek to the start of the previous segment (or beginning of current).
   * If we're more than 0.5s into the current segment, seeks to its start.
   * Otherwise seeks to the previous segment's start.
   */
  prevSegment(): Segment | null {
    const current = this.getCurrentSegment();
    if (!current) return null;

    const elapsed = this.getCurrentTime() - current.startTime;
    if (elapsed > 0.5 && current.index >= 0) {
      // Go to start of current segment
      this.seek(current.startTime);
      return current;
    }

    const prevIdx = current.index - 1;
    if (prevIdx < 0) {
      this.seek(0);
      return current;
    }

    const prev = this._segments[prevIdx];
    this.seek(prev.startTime);
    return prev;
  }

  /**
   * Get the segment count.
   */
  get segmentCount(): number {
    return this._segments.length;
  }
}

/**
 * Factory function to create a MasterTimeline.
 * @returns A new MasterTimeline instance
 */
export function masterTimeline(): MasterTimeline {
  return new MasterTimeline();
}

/**
 * A no-op animation used to represent wait() durations on the timeline.
 * It needs a real Mobject reference but does nothing to it.
 */
class WaitAnimation extends Animation {
  constructor(duration: number) {
    // Create a minimal dummy mobject that satisfies the Animation contract
    super(DummyMobject.instance, { duration });
  }

  interpolate(_alpha: number): void {
    // No-op
  }

  begin(): void {
    this._hasBegun = true;
  }

  finish(): void {
    this._isFinished = true;
  }
}

/**
 * Minimal singleton mobject for WaitAnimation.
 * Never added to the scene — just satisfies the Animation constructor.
 */
import * as THREE from 'three';
class DummyMobject extends Mobject {
  override normalizeTransform(worldMatrix: THREE.Matrix4 = this._ownMatrix()): this {
    return this._flattenAsContainer(worldMatrix);
  }
  private static _instance: DummyMobject | null = null;

  static get instance(): DummyMobject {
    if (!DummyMobject._instance) {
      DummyMobject._instance = new DummyMobject();
    }
    return DummyMobject._instance;
  }

  override copy(): Mobject {
    return new DummyMobject();
  }

  protected _createThreeObject(): THREE.Object3D {
    return new THREE.Object3D();
  }
}
