import { describe, expect, it, vi } from 'vitest';
import { Animation, type AnimationScene } from '../animation/Animation';
import { AnimationGroup } from '../animation/AnimationGroup';
import { FadeOut } from '../animation/fading/FadeOut';
import { ReplacementTransform } from '../animation/transform/Transform';
import { VideoExporter } from '../export/VideoExporter';
import { Circle } from '../mobjects/geometry/Circle';
import { linear } from '../rate-functions';
import { Scene } from './Scene';

class MoveX extends Animation {
  constructor(
    mobject: Circle,
    private readonly from: number,
    private readonly to: number,
    duration: number,
  ) {
    super(mobject, { duration, rateFunc: linear });
  }

  override interpolate(alpha: number): void {
    this.mobject.position.x = this.from + (this.to - this.from) * alpha;
  }
}

class LazyTargetAnimation extends Animation {
  readonly target: Circle & { ready: boolean; waitForRender: () => Promise<void> };
  targetReadyAtBegin = false;

  constructor(
    source: Circle,
    target: Circle & { ready: boolean; waitForRender: () => Promise<void> },
  ) {
    super(source, { duration: 0.01, rateFunc: linear });
    this.target = target;
  }

  override getAllMobjects() {
    return [this.mobject, this.target];
  }

  override begin(): void {
    this.targetReadyAtBegin = this.target.ready;
    super.begin();
  }

  override interpolate(_alpha: number): void {}
}

describe('Scene cumulative play timeline', () => {
  it('awaits lazy transform targets without adding them as scene roots', async () => {
    const scene = Scene.createHeadless();
    const source = new Circle();
    const target = Object.assign(new Circle(), {
      ready: false,
      async waitForRender() {
        await Promise.resolve();
        this.ready = true;
      },
    });
    const animation = new LazyTargetAnimation(source, target);

    await scene.play(animation);

    expect(animation.targetReadyAtBegin).toBe(true);
    expect(scene.mobjects.has(source)).toBe(true);
    expect(scene.mobjects.has(target)).toBe(false);
    scene.dispose();
  });

  it('retains two sequential plays as one seekable history', async () => {
    const scene = Scene.createHeadless();
    const circle = new Circle();
    const first = new MoveX(circle, 0, 1, 0.02);
    const second = new MoveX(circle, 1, 3, 0.03);

    await scene.play(first);
    const timeline = scene.timeline;

    expect(timeline).not.toBeNull();
    expect(timeline?.length).toBe(1);
    expect(timeline?.getDuration()).toBeCloseTo(0.02, 6);

    await scene.play(second);

    expect(scene.timeline).toBe(timeline);
    expect(scene.timeline?.length).toBe(2);
    expect(scene.getTimelineDuration()).toBeCloseTo(0.05, 6);
    expect(scene.currentTime).toBeCloseTo(0.05, 6);

    scene.seek(0.01);
    expect(circle.position.x).toBeCloseTo(0.5, 4);

    scene.seek(0.035);
    expect(circle.position.x).toBeCloseTo(2, 4);

    scene.dispose();
  });

  it('retains play-wait-play timing for seeks and default video export', async () => {
    const scene = Scene.createHeadless();
    const circle = new Circle();

    await scene.play(new MoveX(circle, 0, 1, 0.01));
    await scene.wait(0.02);
    await scene.play(new MoveX(circle, 1, 3, 0.01));

    expect(scene.getTimelineDuration()).toBeCloseTo(0.04, 6);
    expect(scene.currentTime).toBeCloseTo(0.04, 6);

    // The wait holds the completed first animation until the second starts.
    scene.seek(0.02);
    expect(circle.position.x).toBeCloseTo(1, 4);
    scene.seek(0.035);
    expect(circle.position.x).toBeCloseTo(2, 4);

    const exporter = new VideoExporter(scene, {
      fps: 100,
      includeAudio: false,
    });
    const output = new Blob(['video-data'], { type: 'video/webm' });
    vi.spyOn(exporter, 'startRecording').mockResolvedValue();
    vi.spyOn(exporter, 'stopRecording').mockResolvedValue(output);
    const seekSpy = vi.spyOn(scene, 'seek');
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    try {
      await expect(exporter.exportTimeline()).resolves.toBe(output);
      // Four frames proves the exporter's default duration includes the
      // 20 ms hold (without it, this sequence would export only two).
      expect(seekSpy).toHaveBeenCalledTimes(4);
      expect(seekSpy).toHaveBeenNthCalledWith(1, 0);
      expect(seekSpy).toHaveBeenNthCalledWith(2, 0.01);
      expect(seekSpy).toHaveBeenNthCalledWith(3, 0.02);
      expect(seekSpy).toHaveBeenNthCalledWith(4, 0.03);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      scene.dispose();
    }
  });

  it('restores remover membership when seeking repeatedly across cleanup', async () => {
    const scene = Scene.createHeadless();
    const circle = new Circle();
    scene.add(circle);

    await scene.play(new FadeOut(circle, { duration: 0.01 }));
    expect(scene.mobjects.has(circle)).toBe(false);

    scene.seek(0.005);
    expect(scene.mobjects.has(circle)).toBe(true);

    scene.seek(0.01);
    expect(scene.mobjects.has(circle)).toBe(false);
    // A subsequent forward/equal checkpoint must not re-add a source whose
    // cleanup already ran during the monotonic export pass.
    scene.seek(0.01);
    expect(scene.mobjects.has(circle)).toBe(false);

    scene.seek(0);
    expect(scene.mobjects.has(circle)).toBe(true);
    scene.seek(0.0075);
    expect(scene.mobjects.has(circle)).toBe(true);
    scene.seek(0.01);
    expect(scene.mobjects.has(circle)).toBe(false);
    scene.dispose();
  });

  it('applies a zero-duration membership cut at a microscopically early frame time', async () => {
    const scene = Scene.createHeadless();
    const circle = new Circle();
    scene.add(circle);

    await scene.wait(0.01);
    await scene.play(new FadeOut(circle, { duration: 0, rateFunc: linear }));

    scene.seek(0);
    expect(scene.mobjects.has(circle)).toBe(true);

    scene.seek(0.01 - 1e-12);
    expect(scene.mobjects.has(circle)).toBe(false);
    scene.dispose();
  });

  it('swaps replacement source and target membership across repeated seeks', async () => {
    const scene = Scene.createHeadless();
    const source = new Circle();
    const target = new Circle().shift([2, 0, 0]);
    scene.add(source);

    await scene.play(new ReplacementTransform(source, target, { duration: 0.01 }));
    expect(scene.mobjects.has(source)).toBe(false);
    expect(scene.mobjects.has(target)).toBe(true);

    scene.seek(0.005);
    expect(scene.mobjects.has(source)).toBe(true);
    expect(scene.mobjects.has(target)).toBe(false);

    scene.seek(0.01);
    expect(scene.mobjects.has(source)).toBe(false);
    expect(scene.mobjects.has(target)).toBe(true);

    scene.seek(0);
    expect(scene.mobjects.has(source)).toBe(true);
    expect(scene.mobjects.has(target)).toBe(false);
    scene.seek(0.0075);
    expect(scene.mobjects.has(source)).toBe(true);
    expect(scene.mobjects.has(target)).toBe(false);
    scene.seek(0.01);
    expect(scene.mobjects.has(source)).toBe(false);
    expect(scene.mobjects.has(target)).toBe(true);
    scene.dispose();
  });

  it('runs nested leaf cleanup exactly once and does not replay it while appending', async () => {
    class CleanupCounter extends Animation {
      cleanupCalls = 0;

      override interpolate(_alpha: number): void {}

      override cleanUpFromScene(_scene: AnimationScene): void {
        this.cleanupCalls += 1;
      }
    }

    const scene = Scene.createHeadless();
    const leaf = new CleanupCounter(new Circle(), { duration: 0.01, rateFunc: linear });
    const nested = new AnimationGroup([new AnimationGroup([leaf])]);

    await scene.play(nested);
    expect(leaf.cleanupCalls).toBe(1);

    await scene.play(new MoveX(new Circle(), 0, 1, 0.01));
    expect(leaf.cleanupCalls).toBe(1);
    scene.dispose();
  });

  it('restores a cleanup-only companion root when rewinding', async () => {
    class RemoveCompanion extends Animation {
      constructor(
        mobject: Circle,
        private readonly companion: Circle,
      ) {
        super(mobject, { duration: 0.01, rateFunc: linear });
      }

      override interpolate(_alpha: number): void {}

      override cleanUpFromScene(scene: AnimationScene): void {
        scene.remove(this.companion);
      }
    }

    const scene = Scene.createHeadless();
    const source = new Circle();
    const companion = new Circle().shift([2, 0, 0]);
    scene.add(source, companion);

    await scene.play(new RemoveCompanion(source, companion));
    expect(scene.mobjects.has(companion)).toBe(false);

    scene.seek(0.005);
    expect(scene.mobjects.has(companion)).toBe(true);
    scene.seek(0.01);
    expect(scene.mobjects.has(companion)).toBe(false);
    scene.seek(0);
    expect(scene.mobjects.has(companion)).toBe(true);
    scene.dispose();
  });

  it('reset matches seek zero for alpha-zero visuals and remover membership', async () => {
    class AlphaZeroRemover extends Animation {
      constructor(mobject: Circle) {
        super(mobject, { duration: 0.01, rateFunc: linear });
        this.remover = true;
      }

      override interpolate(alpha: number): void {
        this.mobject.position.x = 1 + alpha * 3;
      }
    }

    const scene = Scene.createHeadless();
    const circle = new Circle();
    scene.add(circle);

    await scene.play(new AlphaZeroRemover(circle));
    expect(scene.mobjects.has(circle)).toBe(false);

    scene.seek(0);
    const seekZeroX = circle.position.x;
    expect(seekZeroX).toBeCloseTo(1);
    expect(scene.mobjects.has(circle)).toBe(true);

    scene.seek(0.01);
    scene.stop();
    expect(circle.position.x).toBeCloseTo(seekZeroX);
    expect(scene.mobjects.has(circle)).toBe(true);
    scene.dispose();
  });
});
