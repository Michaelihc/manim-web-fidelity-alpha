import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MasterTimeline } from '../animation/MasterTimeline';
import { FadeIn } from '../animation/fading/FadeIn';
import { FadeOut } from '../animation/fading/FadeOut';
import { Transform } from '../animation/transform/Transform';
import { Mobject } from '../core/Mobject';
import { Scene } from '../core/Scene';
import { VGroup } from '../core/VGroup';
import { Rectangle } from '../mobjects/geometry/Rectangle';
import { linear } from '../rate-functions';
import { RecordingScene } from './RecordingScene';

class BasicMobject extends Mobject {
  override copy(): BasicMobject {
    const clone = new BasicMobject();
    this._copyBaseAttributesInto(clone);
    return clone;
  }

  override normalizeTransform(worldMatrix: THREE.Matrix4 = this._ownMatrix()): this {
    return this._flattenAsContainer(worldMatrix);
  }

  protected override _createThreeObject(): THREE.Object3D {
    return new THREE.Object3D();
  }
}

class BeginProbeTransform extends Transform {
  beginCount = 0;

  override begin(): void {
    this.beginCount++;
    super.begin();
  }
}

describe('RecordingScene animation lifecycle', () => {
  it('captures a nested family FadeOut from the completed FadeIn state', async () => {
    const scene = Scene.createHeadless();
    const timeline = new MasterTimeline();
    const recording = new RecordingScene(scene, timeline);
    const first = new Rectangle({
      width: 2,
      height: 1,
      color: '#58c4dd',
      fillOpacity: 0.8,
    })
      .setFill('#58c4dd', 0.8)
      .setStroke('#58c4dd', 0.04, 0.6);
    const second = new Rectangle({
      width: 1,
      height: 1,
      color: '#ff6b6b',
      fillOpacity: 0.35,
    })
      .setFill('#ff6b6b', 0.35)
      .setStroke('#ff6b6b', 0.03, 0.2);
    const nested = new VGroup(new VGroup(first), second);

    try {
      await recording.wait(0.25);
      await recording.play(new FadeIn(nested, { duration: 1, rateFunc: linear }));
      await recording.wait(0.25);
      await recording.play(new FadeOut(nested, { duration: 1, rateFunc: linear }));

      timeline.seek(0);
      timeline.seek(2);

      // The FadeOut runs from 1.5s to 2.5s, so this is its midpoint.
      expect(first.fillOpacity).toBeCloseTo(0.4);
      expect(first.opacity).toBeCloseTo(0.3);
      expect(second.fillOpacity).toBeCloseTo(0.175);
      expect(second.opacity).toBeCloseTo(0.1);
      expect(scene.mobjects.has(nested)).toBe(true);

      // Rebuilding from a later frame must preserve the same family snapshots.
      timeline.seek(0.5);
      timeline.seek(2);
      expect(first.fillOpacity).toBeCloseTo(0.4);
      expect(second.fillOpacity).toBeCloseTo(0.175);
    } finally {
      scene.dispose();
    }
  });

  it('defers Transform begin and target parenting until its scheduled segment', async () => {
    const scene = Scene.createHeadless();
    const source = new BasicMobject().setStroke('#ffffff', 1, 1);
    const target = new BasicMobject().setStroke('#58c4dd', 1, 0.8);
    scene.add(source);
    const timeline = new MasterTimeline();
    const recording = new RecordingScene(scene, timeline);
    const animation = new BeginProbeTransform(source, target, {
      duration: 1,
      rateFunc: linear,
    });

    try {
      await recording.wait(1);
      await recording.play(animation);

      expect(animation.beginCount).toBe(0);
      expect(target.opacity).toBeCloseTo(0.8);
      expect(target.getThreeObject().parent).toBeNull();

      timeline.seek(0.5);
      expect(animation.beginCount).toBe(0);
      // MasterTimeline paint-gates future participants without beginning them.
      expect(target.opacity).toBe(0);
      expect(target.getThreeObject().visible).toBe(false);
      expect(target.getThreeObject().parent).toBeNull();

      timeline.seek(1.5);
      expect(animation.beginCount).toBe(1);
      expect(target.opacity).toBeCloseTo(0.4);
      expect(target.getThreeObject().visible).toBe(true);
      expect(target.getThreeObject().parent).not.toBeNull();
    } finally {
      scene.dispose();
    }
  });
});
