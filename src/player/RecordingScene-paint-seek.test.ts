import { describe, expect, it } from 'vitest';
import { MasterTimeline } from '../animation/MasterTimeline';
import { Write } from '../animation/creation/Create';
import { FadeIn } from '../animation/fading/FadeIn';
import { FadeOut } from '../animation/fading/FadeOut';
import { ReplacementTransform } from '../animation/transform/Transform';
import { Scene } from '../core/Scene';
import { VGroup } from '../core/VGroup';
import { VMobject } from '../core/VMobject';
import { Rectangle } from '../mobjects/geometry/Rectangle';
import { linear } from '../rate-functions';
import { RecordingScene } from './RecordingScene';

function glyphLikeLeaf(offset: number): VMobject {
  const leaf = new VMobject();
  leaf.setPoints3D([
    [offset, 0, 0],
    [offset + 0.1, 0, 0],
    [offset + 0.2, 0.2, 0],
    [offset + 0.3, 0.2, 0],
    [offset + 0.4, 0.2, 0],
    [offset + 0.5, 0, 0],
    [offset + 0.6, 0, 0],
  ]);
  leaf.setFill('#58c4dd', 1);
  leaf.setStroke('#58c4dd', 0.02, 1);
  return leaf;
}

function hasPaintedLeaf(root: VMobject): boolean {
  return root
    .getFamily()
    .some(
      (member) =>
        member instanceof VMobject &&
        member.children.length === 0 &&
        member.getLocalPoints().length > 0 &&
        (member.fillOpacity > 0 || member.opacity > 0),
    );
}

describe('RecordingScene sequential seek paint', () => {
  // MIGRATION: example for the property that a later formula-family topology
  // cannot change earlier active paint or detached replacement-source paint.
  it('keeps write, flash, and replacement visuals painted', async () => {
    const scene = Scene.createHeadless();
    const timeline = new MasterTimeline();
    const recording = new RecordingScene(scene, timeline);
    const title = new VGroup(
      ...Array.from({ length: 16 }, (_, index) => glyphLikeLeaf(index * 0.12)),
    );
    // Stand-in for the changed prose wrapper: unlike the title it has a nested
    // container and a different number of point-bearing leaves.
    const futureProse = new VGroup(
      new VGroup(...Array.from({ length: 7 }, (_, index) => glyphLikeLeaf(index * 0.14))),
      ...Array.from({ length: 9 }, (_, index) => glyphLikeLeaf(1.2 + index * 0.14)),
    );
    const flash = new Rectangle({
      width: 15.6,
      height: 9.6,
      color: '#ffffff',
      fillOpacity: 1,
      strokeWidth: 0,
    }).setFill('#ffffff', 1);
    flash.setZIndex(60);
    const projection = new Rectangle({
      width: 1.45,
      height: 1.2,
      color: '#58c4dd',
      fillOpacity: 0.2,
    }).setFill('#58c4dd', 0.2);
    const slabs = new VGroup(
      ...Array.from({ length: 4 }, (_, index) =>
        new Rectangle({
          width: 0.34,
          height: 1.2,
          color: '#58c4dd',
          fillOpacity: 0.28,
          center: [index * 0.43, 0, 0],
        }).setFill('#58c4dd', 0.28),
      ),
    );

    try {
      await recording.wait(2);
      await recording.play(new Write(title, { duration: 1, rateFunc: linear }));
      await recording.wait(0.5);
      await recording.play(new FadeIn(futureProse, { duration: 0.5 }));
      await recording.wait(1);
      await recording.play(new FadeIn(flash, { duration: 1 / 60, rateFunc: () => 1 }));
      await recording.wait(0.1 - 1 / 60);
      await recording.play(new FadeOut(flash, { duration: 1 / 60, rateFunc: () => 1 }));
      await recording.wait(1);
      await recording.play(
        new ReplacementTransform(projection, slabs, { duration: 0.55, rateFunc: linear }),
      );

      timeline.seek(0);
      timeline.seek(2.5);
      expect(scene.mobjects.has(title)).toBe(true);
      expect(hasPaintedLeaf(title)).toBe(true);

      timeline.seek(5.01);
      expect(scene.mobjects.has(flash)).toBe(true);
      expect(flash.fillOpacity).toBe(1);
      expect(flash.fillColor).toBe('#ffffff');

      timeline.seek(6.391667);
      expect(scene.mobjects.has(projection)).toBe(true);
      expect(scene.mobjects.has(slabs)).toBe(false);
      expect(hasPaintedLeaf(projection)).toBe(true);

      timeline.seek(timeline.getDuration());
      expect(scene.mobjects.has(projection)).toBe(false);
      expect(scene.mobjects.has(slabs)).toBe(true);

      // Exercise the rebuild path as well as the monotonic path above.
      timeline.seek(2.5);
      expect(scene.mobjects.has(title)).toBe(true);
      expect(hasPaintedLeaf(title)).toBe(true);
      timeline.seek(5.01);
      expect(scene.mobjects.has(flash)).toBe(true);
      expect(flash.fillOpacity).toBe(1);
      timeline.seek(6.391667);
      expect(scene.mobjects.has(projection)).toBe(true);
      expect(hasPaintedLeaf(projection)).toBe(true);
    } finally {
      scene.dispose();
    }
  });
});
