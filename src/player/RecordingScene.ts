/**
 * RecordingScene - the scene proxy passed to `Player.sequence(builder)`.
 *
 * Captures `play()` / `wait()` / `nextSlide()` calls into the player's
 * MasterTimeline without actually running animations. Visible to user code
 * only via the builder callback; not exported from the public surface.
 */

import { Scene } from '../core/Scene';
import { Animation } from '../animation/Animation';
import { AnimationGroup } from '../animation/AnimationGroup';
import { MasterTimeline, SlideOptions } from '../animation/MasterTimeline';

export class RecordingScene {
  private _realScene: Scene;
  private _masterTimeline: MasterTimeline;

  constructor(scene: Scene, masterTimeline: MasterTimeline) {
    this._realScene = scene;
    this._masterTimeline = masterTimeline;
    this._realScene.setTimeline(this._masterTimeline);
  }

  /** Proxy for scene.play() — records animations into the master timeline. */
  async play(...animations: Animation[]): Promise<void> {
    if (animations.length === 0) return;

    // Collect all nested animations for scene.add().
    const allAnimations = this._collectAll(animations);

    // Await and sync every participating source/target before the timeline
    // eventually calls begin() and freezes transform geometry. Transform
    // targets are readiness inputs only: the scene-add loop below still adds
    // live animation sources, not targets.
    const readinessMobjects = new Set(
      animations.flatMap((animation) =>
        typeof animation.getAllMobjects === 'function'
          ? [...animation.getAllMobjects()]
          : [animation.mobject],
      ),
    );
    const renderPromises: Promise<void>[] = [];
    const collectRenders = (mobject: Animation['mobject']): void => {
      const asyncMobject = mobject as Animation['mobject'] & {
        waitForRender?: () => Promise<void>;
      };
      if (typeof asyncMobject.waitForRender === 'function') {
        renderPromises.push(asyncMobject.waitForRender().catch(() => {}));
      }
      for (const child of mobject.children) collectRenders(child);
    };
    for (const mobject of readinessMobjects) collectRenders(mobject);
    if (renderPromises.length > 0) {
      await Promise.all(renderPromises);
    }

    for (const mobject of readinessMobjects) {
      if (mobject._dirty) {
        mobject._syncToThree();
        mobject._dirty = false;
      }
    }

    // Record the untouched construction state. Animation.begin() deliberately
    // belongs to timeline playback, not recording: it may put the live source
    // at alpha zero or parent a hidden transform target. Beginning a later
    // animation while recording would then snapshot those temporary values
    // (for example, FadeOut after FadeIn would capture zero opacity and vanish
    // instantly). Player.sequence() is batched and seeks to zero after the
    // builder completes, so deferring begin() cannot expose a pre-animation
    // frame.
    this._masterTimeline.addSegment(animations);

    // Add to real scene (so they're visible when we seek)
    for (const anim of allAnimations) {
      if (anim instanceof AnimationGroup) continue;
      if (!this._realScene.mobjects.has(anim.mobject)) {
        const family =
          typeof anim.mobject.getFamily === 'function' ? anim.mobject.getFamily() : [anim.mobject];
        const priorCreationFlags = new Map(
          family.map((member) => [member, member.createdAtBeginning] as const),
        );
        this._realScene.add(anim.mobject);
        // Scene.add marks the full family as pre-existing. Restore each
        // member's prior flag independently so an explicitly pre-added child
        // remains visible while newly introduced siblings stay timeline-gated.
        for (const member of family) {
          if (!priorCreationFlags.get(member)) {
            member.createdAtBeginning = false;
          }
        }
      }
    }
  }

  /**
   * Start a new slide. Inspired by manim-slides' `Scene.next_slide(...)`:
   * options apply to the slide that *follows* this call (every play()/wait()
   * up to the next `nextSlide()` belongs to that slide).
   *
   * Supported options: `{ loop, autoNext }`. manim-slides' `name`,
   * `playback_rate`, and `notes` are not implemented.
   *
   * If `nextSlide()` is never called inside a `sequence()`, each play()/wait()
   * becomes its own slide. The moment the first `nextSlide()` appears, all
   * plays in the sequence — including any before that first call — are grouped
   * by boundary; plays before the first boundary form an implicit slide 0 with
   * default options.
   */
  async nextSlide(opts: SlideOptions = {}): Promise<void> {
    this._masterTimeline.beginSlide(opts);
  }

  /** Proxy for scene.wait() — records a wait segment. */
  async wait(duration: number = 1): Promise<void> {
    this._masterTimeline.addWaitSegment(duration);
  }

  /** Pass-through: add mobjects directly to the scene. */
  add(...args: Parameters<Scene['add']>): ReturnType<Scene['add']> {
    return this._realScene.add(...args);
  }

  /** Pass-through: remove mobjects from the scene. */
  remove(...args: Parameters<Scene['remove']>): ReturnType<Scene['remove']> {
    return this._realScene.remove(...args);
  }

  /** Pass-through: access the camera. */
  get camera() {
    return this._realScene.camera;
  }

  /** Pass-through: batch updates. */
  batch<T>(callback: () => T): T {
    return this._realScene.batch(callback);
  }

  private _collectAll(animations: Animation[]): Animation[] {
    const result: Animation[] = [];
    for (const anim of animations) {
      result.push(anim);
      if (anim instanceof AnimationGroup) {
        result.push(...this._collectAll(anim.animations));
      }
    }
    return result;
  }
}
