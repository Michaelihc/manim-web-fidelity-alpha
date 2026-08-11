import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Mobject } from '../../core/Mobject';
import { Scene } from '../../core/Scene';
import { VGroup } from '../../core/VGroup';
import { VMobject } from '../../core/VMobject';
import { Circle } from '../../mobjects/geometry/Circle';
import { Rectangle } from '../../mobjects/geometry/Rectangle';
import { PMobject } from '../../mobjects/point/PMobject';
import { Timeline } from '../Timeline';
import { ReplacementTransform, Transform } from './Transform';

function expectBoundsClose(actual: Mobject, expected: Mobject): void {
  const a = actual.getBounds();
  const e = expected.getBounds();
  expect(a.min.x).toBeCloseTo(e.min.x, 5);
  expect(a.min.y).toBeCloseTo(e.min.y, 5);
  expect(a.max.x).toBeCloseTo(e.max.x, 5);
  expect(a.max.y).toBeCloseTo(e.max.y, 5);
}

class PlainMobject extends Mobject {
  protected override _createThreeObject(): THREE.Object3D {
    return new THREE.Group();
  }

  override copy(): PlainMobject {
    const copy = new PlainMobject();
    this._copyBaseAttributesInto(copy);
    return copy;
  }
}

describe('Transform parity lifecycle', () => {
  it('advertises both source and lazy target for render-readiness discovery', () => {
    const source = new Circle();
    const target = new Circle();
    const animation = new Transform(source, target);

    expect(animation.getAllMobjects()).toEqual([source, target]);
  });

  it('normalizes detached family copies and reset restores exact live hierarchy', () => {
    const sourceLeaf = new Circle({ radius: 0.6, color: '#ff3300' });
    sourceLeaf.fillOpacity = 0.35;
    const nested = new VGroup(sourceLeaf);
    const source = new VGroup(nested);
    source.shift([-1.25, 0.4, 0]);
    source.scale(1.4);
    source.rotation.z = 0.2;
    source.zIndex = 3;

    const targetA = new Circle({ radius: 1.1, color: '#3366ff' });
    targetA.shift([1.2, 0.6, 0]);
    const targetB = new Circle({ radius: 0.35, color: '#55dd88' });
    targetB.shift([2.6, -0.5, 0]);
    const target = new VGroup(targetA, targetB);
    target.rotation.z = -0.15;
    target.zIndex = 9;

    const originalChildren = [...source.children];
    const originalPoints = sourceLeaf.getLocalPoints().map((point) => [...point]);
    const originalPosition = source.position.clone();
    const originalRotation = source.rotation.clone();
    const originalScale = source.scaleVector.clone();
    const originalRadius = sourceLeaf.getRadius();

    const animation = new Transform(source, target);
    animation.begin();
    animation.interpolate(1);
    animation.finish();

    expect(source.children.length).toBe(2);
    expectBoundsClose(source, target);
    expect(source.zIndex).toBe(target.zIndex);

    animation.reset();

    expect(source.children).toEqual(originalChildren);
    expect(source.children[0]).toBe(nested);
    expect(nested.children[0]).toBe(sourceLeaf);
    expect(source.position.toArray()).toEqual(originalPosition.toArray());
    expect(source.rotation.toArray()).toEqual(originalRotation.toArray());
    expect(source.scaleVector.toArray()).toEqual(originalScale.toArray());
    expect(sourceLeaf.getLocalPoints()).toEqual(originalPoints);
    expect(sourceLeaf.getRadius()).toBeCloseTo(originalRadius, 8);
    expect(source.zIndex).toBe(3);
  });

  it('restores nested VGroup point partitions after unequal leaf alignment', () => {
    const sourceLeaf = new VMobject().setPoints([
      [0, 0, 0],
      [0.3, 0, 0],
      [0.7, 1, 0],
      [1, 1, 0],
    ]);
    const nestedSource = new VGroup(sourceLeaf);
    const source = new VGroup(nestedSource);
    const targetLeaf = new VMobject().setPoints([
      [0, 0, 0],
      [0.2, 0, 0],
      [0.4, 0.5, 0],
      [0.6, 0.5, 0],
      [0.6, 0.5, 0],
      [0.8, 0.5, 0],
      [1, 1, 0],
      [1.2, 1, 0],
    ]);
    const target = new VGroup(new VGroup(targetLeaf));
    const originalPoints = sourceLeaf.getLocalPoints().map((point) => [...point]);
    const animation = new Transform(source, target);

    animation.begin();
    expect(sourceLeaf.getLocalPoints()).toHaveLength(8);

    expect(() => animation.reset()).not.toThrow();
    expect(source.children).toEqual([nestedSource]);
    expect(nestedSource.children).toEqual([sourceLeaf]);
    expect(sourceLeaf.getLocalPoints()).toEqual(originalPoints);
    expect(source.getLocalPoints()).toEqual(originalPoints);
  });

  it('can seek backward and replay an unequal-family transform without accumulating leaves', () => {
    const sourceLeaf = new Circle({ radius: 0.5 });
    const source = new VGroup(sourceLeaf);
    source.shift([-2, 0, 0]);
    const target = new VGroup(
      new Circle({ radius: 0.8, position: [1, 0, 0] }),
      new Circle({ radius: 0.25, position: [2.5, 0.5, 0] }),
    );
    const originalLeafBounds = sourceLeaf.getBounds();
    const animation = new Transform(source, target, { duration: 1 });
    const timeline = new Timeline().add(animation, 0);

    timeline.seek(1);
    expect(source.children.length).toBe(2);
    expectBoundsClose(source, target);

    timeline.seek(0);
    expect(source.children.length).toBe(2);
    const resetLeafBounds = sourceLeaf.getBounds();
    expect(resetLeafBounds.min.x).toBeCloseTo(originalLeafBounds.min.x, 5);
    expect(resetLeafBounds.max.x).toBeCloseTo(originalLeafBounds.max.x, 5);
    expect((source.children[1] as VMobject).opacity).toBe(0);

    timeline.seek(1);
    expect(source.children.length).toBe(2);
    expectBoundsClose(source, target);

    animation.reset();
    expect(source.children).toEqual([sourceLeaf]);
  });

  it('aligns a stretched VGroup through generic point snapshots', () => {
    const source = new VGroup(new Circle({ radius: 0.5 }));
    const target = new VGroup(new Circle({ radius: 0.5 }));
    target.scaleVector.set(2.5, 0.75, 1);
    target.shift([1.5, -0.25, 0]);
    const animation = new Transform(source, target);

    expect(() => animation.begin()).not.toThrow();
    animation.finish();

    expectBoundsClose(source, target);
  });

  it('morphs one rectangle into a four-leaf VGroup (ESAP Q projection slabs)', () => {
    const source = new Rectangle({
      width: 1.45,
      height: 1.2,
      center: [2.55, 1.75, 0],
      fillOpacity: 0.2,
    });
    const target = new VGroup(
      ...Array.from(
        { length: 4 },
        (_, index) =>
          new Rectangle({
            width: 0.34,
            height: 1.2,
            center: [4.65 + index * 0.43, 1.75, 0],
            fillOpacity: 0.28,
          }),
      ),
    );
    const originalPoints = source.getLocalPoints().map((point) => [...point]);
    const animation = new ReplacementTransform(source, target);

    expect(() => animation.begin()).not.toThrow();
    animation.interpolate(1);
    animation.finish();

    expect(source.children).toHaveLength(3);
    expectBoundsClose(source, target);

    animation.reset();
    expect(source.children).toHaveLength(0);
    expect(source.getLocalPoints()).toEqual(originalPoints);
  });

  it('restores exact compound topology after a partial point morph', () => {
    const source = new VMobject().setPoints([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 0],
    ]);
    source.setBaseSubpathLengths([5]);
    const target = new VMobject().setPoints([
      [0, 0, 0],
      [2, 0, 0],
      [2, 2, 0],
      [0, 2, 0],
      [0, 0, 0],
      [0.7, 0.7, 0],
      [1.3, 0.7, 0],
      [1.3, 1.3, 0],
      [0.7, 1.3, 0],
      [0.7, 0.7, 0],
    ]);
    target.setBaseSubpathLengths([5, 5]);
    const originalPoints = source.getLocalPoints().map((point) => [...point]);

    const animation = new Transform(source, target);
    animation.begin();
    animation.interpolate(0.63);
    animation.reset();

    expect(source.getLocalPoints()).toEqual(originalPoints);
    expect(source.getEffectiveSubpathLengths()).toEqual([5]);
  });

  it('keeps fill and stroke channels independent through the exact endpoint', () => {
    const source = new Circle({ color: '#ff0000' });
    source.setFill('#224466', 0.3);
    source.setStroke('#ff0000', 2, 0.8);
    const target = new Circle({ color: '#00ff00' });
    target.setFill('#224466', 0.75);
    target.setStroke('#00ff00', 6, 0.45);
    target.zIndex = 12;
    const animation = new Transform(source, target);

    animation.begin();
    animation.interpolate(0.5);
    expect(source.fillColor).toBe('#224466');
    animation.finish();

    expect(source.strokeColor).toBe('#00ff00');
    expect(source.fillColor).toBe('#224466');
    expect(source.opacity).toBeCloseTo(0.45, 8);
    expect(source.fillOpacity).toBeCloseTo(0.75, 8);
    expect(source.strokeWidth).toBe(6);
    expect(source.zIndex).toBe(12);
  });

  it('restores an unpadded PMobject after reset', () => {
    const source = new PMobject({ points: [{ position: [-1, 0, 0], opacity: 0.4 }] });
    const target = new PMobject({
      points: [{ position: [1, 0, 0] }, { position: [2, 0, 0] }, { position: [3, 0, 0] }],
    });
    const animation = new Transform(source, target);

    animation.begin();
    expect(source.getLocalPoints()).toHaveLength(3);
    animation.interpolate(0.5);
    animation.reset();

    const restored = source.getLocalPoints();
    expect(restored).toHaveLength(1);
    expect(restored[0].position).toEqual([-1, 0, 0]);
    expect(restored[0].opacity).toBeCloseTo(0.4, 8);
  });

  it('detaches a temporary fade target and restores both identities on reset', () => {
    const source = new PlainMobject();
    const target = new PlainMobject();
    source.opacity = 0.7;
    target.opacity = 0.45;
    const renderParent = new THREE.Group();
    renderParent.add(source.getThreeObject());
    const animation = new Transform(source, target);

    animation.begin();
    expect(target.getThreeObject().parent).toBe(renderParent);
    animation.interpolate(0.6);
    animation.reset();

    expect(source.opacity).toBeCloseTo(0.7, 8);
    expect(target.opacity).toBeCloseTo(0.45, 8);
    expect(target.getThreeObject().parent).toBeNull();
  });

  it('ReplacementTransform preserves source semantic stacking through scene reranks', () => {
    const scene = Scene.createHeadless({ autoRender: false });
    const below = new Circle().setZIndex(0, false);
    const source = new Circle().setZIndex(5, false);
    const above = new Circle().setZIndex(10, false);
    const target = new Circle().setZIndex(-20, false);

    const expectRenderRank = (mobject: Mobject, rank: number): void => {
      const renderables: THREE.Object3D[] = [];
      mobject.getThreeObject().traverse((object) => {
        if ((object as THREE.Mesh).material) renderables.push(object);
      });
      expect(renderables.length).toBeGreaterThan(0);
      for (const object of renderables) expect(object.renderOrder).toBe(rank);
    };

    try {
      scene.add(below, source, above);
      scene.render();
      expectRenderRank(source, 1);

      const animation = new ReplacementTransform(source, target);
      animation.begin();
      animation.interpolate(1);
      animation.finish();
      expect(source.zIndex).toBe(-20);
      animation.cleanUpFromScene(scene);
      scene.render();

      expect(scene.mobjects.has(source)).toBe(false);
      expect(scene.mobjects.has(target)).toBe(true);
      expect(target.zIndex).toBe(5);
      expectRenderRank(target, 1);

      below.setZIndex(7, false);
      scene.render();
      expectRenderRank(target, 0);
      expectRenderRank(below, 1);
      expectRenderRank(above, 2);
    } finally {
      scene.dispose();
    }
  });
});
