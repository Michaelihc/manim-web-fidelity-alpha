// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import type { Mobject } from '../../core/Mobject';
import { VMobject } from '../../core/VMobject';
import { VGroup } from '../../core/VGroup';
import { MathTex } from '../../mobjects/text/MathTex';
import { TransformMatchingTex } from './TransformMatching';

interface LeafSnapshot {
  points: number[][];
  position: number[];
  color: string;
  fillColor: string | undefined;
  opacity: number;
  fillOpacity: number;
  strokeWidth: number;
  subpathLengths: number[] | undefined;
}

function collectLeafSnapshots(root: VMobject): LeafSnapshot[] {
  const snapshots: LeafSnapshot[] = [];
  const visit = (mobject: Mobject): void => {
    if (mobject instanceof VMobject && !(mobject instanceof VGroup)) {
      snapshots.push({
        points: mobject.getLocalPoints(),
        position: [mobject.position.x, mobject.position.y, mobject.position.z],
        color: mobject.color,
        fillColor: mobject.fillColor,
        opacity: mobject.opacity,
        fillOpacity: mobject.fillOpacity,
        strokeWidth: mobject.strokeWidth,
        subpathLengths: mobject.getEffectiveSubpathLengths(),
      });
    }
    for (const child of mobject.children) visit(child);
  };
  visit(root);
  return snapshots;
}

function expectCentersClose(actual: number[], expected: number[]): void {
  expect(actual[0]).toBeCloseTo(expected[0], 8);
  expect(actual[1]).toBeCloseTo(expected[1], 8);
  expect(actual[2]).toBeCloseTo(expected[2], 8);
}

function makeFakeScene(initial: Mobject[]): {
  mobjects: Set<Mobject>;
  scene: { add(...mobjects: Mobject[]): void; remove(...mobjects: Mobject[]): void };
} {
  const mobjects = new Set(initial);
  return {
    mobjects,
    scene: {
      add: (...added) => added.forEach((mobject) => mobjects.add(mobject)),
      remove: (...removed) => removed.forEach((mobject) => mobjects.delete(mobject)),
    },
  };
}

describe('TransformMatchingTex semantic MathTex parity', () => {
  it('matches exact multipart LaTeX keys in stable duplicate order', async () => {
    const source = new MathTex({ latex: ['x', 'y', 'x', 'x'] });
    const target = new MathTex({ latex: ['x', 'x', 'y'] });
    await Promise.all([source.waitForRender(), target.waitForRender()]);

    const targetCenters = [
      target.getPart(0).getCenter(),
      target.getPart(1).getCenter(),
      target.getPart(2).getCenter(),
    ];
    const animation = new TransformMatchingTex(source, target);

    expect(animation.keyFunc(source.getPart(0))).toBe('x');
    expect(animation.keyFunc(source.getPart(1))).toBe('y');
    expect(animation.keyFunc(source.getPart(2))).toBe('x');

    animation.begin();
    animation.interpolate(0.5);

    // The third duplicate has no target counterpart and fades independently.
    expect(source.getPart(3).opacity).toBe(0);
    expect(source.getPart(0).opacity).toBeGreaterThan(0);
    expect(source.getPart(2).opacity).toBeGreaterThan(0);

    animation.interpolate(1);
    animation.finish();

    expectCentersClose(source.getPart(0).getCenter(), targetCenters[0]);
    expectCentersClose(source.getPart(2).getCenter(), targetCenters[1]);
    expectCentersClose(source.getPart(1).getCenter(), targetCenters[2]);
  }, 60_000);

  it('renders unmatched chain-rule target parts for a top-level source and cleans up to the exact target', async () => {
    const source = new MathTex({ latex: '\\frac{\\partial L}{\\partial w}' });
    const target = new MathTex({
      latex: ['\\frac{\\partial L}{\\partial z}', '\\frac{\\partial z}{\\partial w}'],
    });
    await Promise.all([source.waitForRender(), target.waitForRender()]);

    expect(source.parent).toBeNull();
    const sourceChildCount = source.children.length;
    const targetBefore = collectLeafSnapshots(target);
    const animation = new TransformMatchingTex(source, target);

    animation.begin();

    const temporaryTargetParts = source.children.slice(sourceChildCount);
    expect(temporaryTargetParts).toHaveLength(2);
    expect(temporaryTargetParts.every((part) => part.opacity === 0)).toBe(true);
    expect(temporaryTargetParts.every((part) => !part.isEmpty())).toBe(true);

    animation.interpolate(1);
    expect(temporaryTargetParts.every((part) => part.opacity > 0)).toBe(true);
    animation.finish();

    const { mobjects, scene } = makeFakeScene([source]);
    animation.cleanUpFromScene(scene);

    expect(mobjects).toEqual(new Set([target]));
    expect(mobjects.has(source)).toBe(false);
    expect(target.opacity).toBeGreaterThan(0);
    expect(target.parent).toBeNull();
    expect(collectLeafSnapshots(target)).toEqual(targetBefore);
    expect(source.children).toHaveLength(sourceChildCount);
    expect(temporaryTargetParts.every((part) => part.parent === null)).toBe(true);
  }, 60_000);
});
