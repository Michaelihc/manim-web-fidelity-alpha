import { describe, expect, it } from 'vitest';
import { VMobject } from '../../core/VMobject';
import { VGroup } from '../../core/VGroup';
import { FadeIn } from './FadeIn';
import { FadeOut } from './FadeOut';

const ALPHAS = [0, 0.25, 0.5, 0.75, 1] as const;

function dimShape(fillOpacity: number = 0.36, strokeOpacity: number = 0.24): VMobject {
  const shape = new VMobject();
  shape.setPoints([
    [-1, -1, 0],
    [1, -1, 0],
    [1, 1, 0],
    [-1, 1, 0],
  ]);
  shape.setStyle({
    fillOpacity,
    strokeColor: '#7bc8f6',
    strokeOpacity,
    strokeWidth: 7,
  });
  shape.fillColor = '#c25bff';
  return shape;
}

function expectCenter(mobject: VMobject, expected: [number, number, number]): void {
  const center = mobject.getCenter();
  expect(center[0]).toBeCloseTo(expected[0], 8);
  expect(center[1]).toBeCloseTo(expected[1], 8);
  expect(center[2]).toBeCloseTo(expected[2], 8);
}

describe('FadeIn Manim parity', () => {
  it('interpolates dim fill/stroke, relative scale, and independent shift at key alphas', () => {
    const shape = dimShape();
    shape.position.set(3, -2, 0);
    shape.scaleVector.set(1.4, 0.8, 1);
    const targetCenter = shape.getCenter();
    const animation = new FadeIn(shape, {
      scale: 0.5,
      shift: [2, -1, 0],
    });

    animation.begin();

    for (const alpha of ALPHAS) {
      animation.interpolate(alpha);
      const expectedScale = 0.5 + 0.5 * alpha;

      expect(shape.fillOpacity).toBeCloseTo(0.36 * alpha, 8);
      expect(shape.opacity).toBeCloseTo(0.24 * alpha, 8);
      expect(shape.scaleVector.x).toBeCloseTo(1.4 * expectedScale, 8);
      expect(shape.scaleVector.y).toBeCloseTo(0.8 * expectedScale, 8);
      expectCenter(shape, [
        targetCenter[0] - 2 * (1 - alpha),
        targetCenter[1] + 1 * (1 - alpha),
        targetCenter[2],
      ]);
      expect(shape.fillColor).toBe('#c25bff');
      expect(shape.strokeColor).toBe('#7bc8f6');
      expect(shape.strokeWidth).toBe(7);
    }
  });

  it('preserves each member of a nested family and restores it on reset', () => {
    const first = dimShape(0.32, 0.18);
    const second = dimShape(0.68, 0.42);
    second.shift([3, 0, 0]);
    second.fillColor = '#ffae42';
    second.strokeColor = '#31e6a1';

    const nested = new VGroup(second);
    const group = new VGroup(first, nested);
    group.position.set(-1, 2, 0);

    const originalPosition = group.position.clone();
    const originalScale = group.scaleVector.clone();
    const targetCenter = group.getCenter();
    const originalFamily = group.getFamily().map((member) => ({
      member,
      color: member.color,
      style: member.style,
      fillOpacity: member.fillOpacity,
      strokeOpacity: member.opacity,
      strokeWidth: member.strokeWidth,
    }));

    const animation = new FadeIn(group, {
      scale: 0.6,
      shift: [-1.5, 0.5, 0],
    });
    animation.begin();

    for (const alpha of ALPHAS) {
      animation.interpolate(alpha);
      const expectedScale = 0.6 + 0.4 * alpha;

      expect(first.fillOpacity).toBeCloseTo(0.32 * alpha, 8);
      expect(first.opacity).toBeCloseTo(0.18 * alpha, 8);
      expect(second.fillOpacity).toBeCloseTo(0.68 * alpha, 8);
      expect(second.opacity).toBeCloseTo(0.42 * alpha, 8);
      expect(group.scaleVector.x).toBeCloseTo(originalScale.x * expectedScale, 8);
      expect(group.scaleVector.y).toBeCloseTo(originalScale.y * expectedScale, 8);
      expectCenter(group, [
        targetCenter[0] + 1.5 * (1 - alpha),
        targetCenter[1] - 0.5 * (1 - alpha),
        targetCenter[2],
      ]);
    }

    // A backward jump must derive from the original state, not compound the
    // transform/style left by the later alpha.
    animation.interpolate(0.75);
    animation.interpolate(0.25);

    expect(first.fillOpacity).toBeCloseTo(0.32 * 0.25, 8);
    expect(first.opacity).toBeCloseTo(0.18 * 0.25, 8);
    expect(second.fillOpacity).toBeCloseTo(0.68 * 0.25, 8);
    expect(second.opacity).toBeCloseTo(0.42 * 0.25, 8);

    animation.reset();

    expect(group.position.toArray()).toEqual(originalPosition.toArray());
    expect(group.scaleVector.toArray()).toEqual(originalScale.toArray());
    for (const snapshot of originalFamily) {
      expect(snapshot.member.color).toBe(snapshot.color);
      expect(snapshot.member.style).toEqual(snapshot.style);
      expect(snapshot.member.fillOpacity).toBe(snapshot.fillOpacity);
      expect(snapshot.member.opacity).toBe(snapshot.strokeOpacity);
      expect(snapshot.member.strokeWidth).toBe(snapshot.strokeWidth);
    }
  });
});

describe('FadeOut Manim parity', () => {
  it('interpolates dim fill/stroke, relative scale, and independent shift at key alphas', () => {
    const shape = dimShape(0.4, 0.3);
    shape.position.set(-2, 1.5, 0);
    shape.scaleVector.set(0.75, 1.25, 1);
    const targetCenter = shape.getCenter();
    const animation = new FadeOut(shape, {
      scale: 1.5,
      shift: [-2, 1, 0],
    });

    animation.begin();

    for (const alpha of ALPHAS) {
      animation.interpolate(alpha);
      const expectedScale = 1 + 0.5 * alpha;
      const visibility = 1 - alpha;

      expect(shape.fillOpacity).toBeCloseTo(0.4 * visibility, 8);
      expect(shape.opacity).toBeCloseTo(0.3 * visibility, 8);
      expect(shape.scaleVector.x).toBeCloseTo(0.75 * expectedScale, 8);
      expect(shape.scaleVector.y).toBeCloseTo(1.25 * expectedScale, 8);
      expectCenter(shape, [targetCenter[0] - 2 * alpha, targetCenter[1] + alpha, targetCenter[2]]);
      expect(shape.fillColor).toBe('#c25bff');
      expect(shape.strokeColor).toBe('#7bc8f6');
      expect(shape.strokeWidth).toBe(7);
    }
  });

  it('restores a nested family after reset and after scene cleanup', () => {
    const first = dimShape(0.2, 0.15);
    const second = dimShape(0.7, 0.55);
    second.shift([2.5, 0, 0]);
    second.fillColor = '#ffe066';
    second.strokeColor = '#ff5c77';
    const group = new VGroup(first, new VGroup(second));

    const snapshots = group.getFamily().map((member) => ({
      member,
      style: member.style,
      color: member.color,
    }));
    const originalPosition = group.position.clone();
    const originalScale = group.scaleVector.clone();
    const targetCenter = group.getCenter();

    const animation = new FadeOut(group, {
      scale: 0.4,
      shift: [1, -1, 0],
    });
    animation.begin();

    for (const alpha of ALPHAS) {
      animation.interpolate(alpha);
      const visibility = 1 - alpha;
      const expectedScale = 1 - 0.6 * alpha;

      expect(first.fillOpacity).toBeCloseTo(0.2 * visibility, 8);
      expect(first.opacity).toBeCloseTo(0.15 * visibility, 8);
      expect(second.fillOpacity).toBeCloseTo(0.7 * visibility, 8);
      expect(second.opacity).toBeCloseTo(0.55 * visibility, 8);
      expect(group.scaleVector.x).toBeCloseTo(originalScale.x * expectedScale, 8);
      expect(group.scaleVector.y).toBeCloseTo(originalScale.y * expectedScale, 8);
      expectCenter(group, [targetCenter[0] + alpha, targetCenter[1] - alpha, targetCenter[2]]);
    }

    animation.interpolate(0.75);
    animation.interpolate(0.25);

    expect(first.fillOpacity).toBeCloseTo(0.2 * 0.75, 8);
    expect(first.opacity).toBeCloseTo(0.15 * 0.75, 8);
    expect(second.fillOpacity).toBeCloseTo(0.7 * 0.75, 8);
    expect(second.opacity).toBeCloseTo(0.55 * 0.75, 8);

    animation.reset();
    expect(group.position.toArray()).toEqual(originalPosition.toArray());
    expect(group.scaleVector.toArray()).toEqual(originalScale.toArray());
    for (const snapshot of snapshots) {
      expect(snapshot.member.style).toEqual(snapshot.style);
      expect(snapshot.member.color).toBe(snapshot.color);
    }

    animation.begin();
    animation.finish();
    const removed: VMobject[] = [];
    animation.cleanUpFromScene({
      add: () => undefined,
      remove: (...mobjects) => removed.push(...(mobjects as VMobject[])),
    });

    expect(removed).toEqual([group]);
    expect(group.position.toArray()).toEqual(originalPosition.toArray());
    expect(group.scaleVector.toArray()).toEqual(originalScale.toArray());
    for (const snapshot of snapshots) {
      expect(snapshot.member.style).toEqual(snapshot.style);
      expect(snapshot.member.color).toBe(snapshot.color);
    }
  });
});
