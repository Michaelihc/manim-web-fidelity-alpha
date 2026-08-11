import { describe, expect, it } from 'vitest';
import { VGroup } from '../../core/VGroup';
import { VMobject } from '../../core/VMobject';
import { linear } from '../../rate-functions';
import { VectorPathReveal } from './VectorPathReveal';

function makeLeaf(
  length: number,
  fillOpacity: number,
  strokeOpacity: number,
  strokeWidth: number,
): VMobject {
  const leaf = new VMobject();
  leaf.setPoints3D([
    [0, 0, 0],
    [length / 3, 0, 0],
    [(2 * length) / 3, 0, 0],
    [length, 0, 0],
  ]);
  leaf.setFillOpacity(fillOpacity);
  leaf.setStrokeOpacity(strokeOpacity);
  leaf.setStrokeWidth(strokeWidth);
  return leaf;
}

function endpointX(leaf: VMobject): number {
  const points = leaf.getLocalPoints();
  return points[points.length - 1][0];
}

describe('VectorPathReveal', () => {
  it('stagger-draws leaf geometry before restoring each original fill', () => {
    const first = makeLeaf(2, 0.8, 0.35, 0.6);
    const second = makeLeaf(5, 0.65, 0.75, 1.25);
    const root = new VGroup(first, second);
    const reveal = new VectorPathReveal(root, {
      lagRatio: 0.5,
      outlineStrokeWidth: 2,
      rateFunc: linear,
    });

    expect(reveal.begin()).toBe(true);
    expect(reveal.partCount).toBe(2);
    expect(first.fillOpacity).toBe(0);
    expect(second.fillOpacity).toBe(0);
    expect(first.opacity).toBe(1);
    expect(first.strokeWidth).toBe(2);
    expect(new Set(first.getLocalPoints().map((point) => point[0])).size).toBe(1);

    reveal.interpolate(0.2);
    expect(endpointX(first)).toBeCloseTo(1.2, 5);
    expect(endpointX(second)).toBeCloseTo(0, 5);
    expect(first.fillOpacity).toBe(0);
    expect(second.fillOpacity).toBe(0);

    // The first glyph is already filling while the second is still drawing:
    // this is the non-linear mixed state missing from a texture wipe.
    reveal.interpolate(0.6);
    expect(endpointX(first)).toBeCloseTo(2, 5);
    expect(first.fillOpacity).toBeCloseTo(0.8 * 0.8, 5);
    expect(first.strokeWidth).toBeCloseTo(2 + (0.6 - 2) * 0.8, 5);
    expect(endpointX(second)).toBeCloseTo(4, 5);
    expect(second.fillOpacity).toBe(0);

    reveal.restore();
    expect(endpointX(first)).toBeCloseTo(2, 5);
    expect(first.fillOpacity).toBeCloseTo(0.8, 5);
    expect(first.opacity).toBeCloseTo(0.35, 5);
    expect(first.strokeWidth).toBeCloseTo(0.6, 5);
    expect(endpointX(second)).toBeCloseTo(5, 5);
    expect(second.fillOpacity).toBeCloseTo(0.65, 5);
    expect(second.opacity).toBeCloseTo(0.75, 5);
    expect(second.strokeWidth).toBeCloseTo(1.25, 5);
  });

  it('applies easing after the family lag shift', () => {
    const first = makeLeaf(2, 1, 1, 0.1);
    const second = makeLeaf(2, 1, 1, 0.1);
    const reveal = new VectorPathReveal(new VGroup(first, second), {
      lagRatio: 0.5,
      rateFunc: (alpha) => alpha * alpha,
    });

    reveal.begin();
    reveal.interpolate(0.5);

    // first: (0.5 * 1.5)^2 = 0.5625, just into fill phase.
    // second: (0.5 * 1.5 - 0.5)^2 = 0.0625, early outline.
    expect(first.fillOpacity).toBeCloseTo(0.125, 5);
    expect(endpointX(first)).toBeCloseTo(2, 5);
    expect(second.fillOpacity).toBe(0);
    expect(endpointX(second)).toBeCloseTo(0.25, 5);
    reveal.restore();
  });

  it('restores exact captured paint at the completed endpoint', () => {
    const leaf = makeLeaf(2, 1, 1, 0.00001);
    const originalStyle = leaf.style;
    const reveal = new VectorPathReveal(leaf, {
      outlineStrokeWidth: 2,
      rateFunc: linear,
    });

    reveal.begin();
    reveal.interpolate(1);

    expect(leaf.strokeWidth).toBe(0.00001);
    expect(leaf.style).toEqual(originalStyle);
  });

  it('can leave remover animations hidden with exact full geometry', () => {
    const leaf = makeLeaf(3, 0.9, 0.4, 0.8);
    const reveal = new VectorPathReveal(leaf, { rateFunc: linear });

    reveal.begin();
    reveal.interpolate(0.4);
    reveal.hide();

    expect(endpointX(leaf)).toBeCloseTo(3, 5);
    expect(leaf.fillOpacity).toBe(0);
    expect(leaf.opacity).toBe(0);
  });
});
