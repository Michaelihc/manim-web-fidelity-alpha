import { describe, expect, it } from 'vitest';
import { VGroup } from '../../core/VGroup';
import { VMobject } from '../../core/VMobject';
import { Mobject } from '../../core/Mobject';
import { Circle } from '../../mobjects/geometry/Circle';
import { linear } from '../../rate-functions';
import { Animation } from '../Animation';
import { MasterTimeline } from '../MasterTimeline';
import { Timeline } from '../Timeline';
import { Create, DrawBorderThenFill, Unwrite, Write } from './Create';

function leaf(length: number, fillOpacity = 0.8, strokeOpacity = 0.7): VMobject {
  return new VMobject()
    .setPoints3D([
      [0, 0, 0],
      [length / 3, 0, 0],
      [(2 * length) / 3, 0, 0],
      [length, 0, 0],
    ])
    .setFillOpacity(fillOpacity)
    .setStrokeOpacity(strokeOpacity)
    .setStrokeWidth(0.5);
}

function endpointX(mobject: VMobject): number {
  const points = mobject.getLocalPoints();
  return points[points.length - 1][0];
}

function glyphLikeLeaf(offset: number): VMobject {
  const points: number[][] = [];
  for (let segment = 0; segment < 4; segment++) {
    const x = offset + segment;
    if (segment === 0) points.push([x, 0, 0]);
    points.push([x + 1 / 3, 0.2, 0], [x + 2 / 3, -0.2, 0], [x + 1, 0, 0]);
  }
  return new VMobject().setPoints3D(points).setFillOpacity(0.8).setStrokeOpacity(0.7);
}

class FamilyFadeForReset extends Animation {
  private _paint: Array<{ mobject: Mobject; fill: number; stroke: number }> = [];

  override begin(): void {
    super.begin();
    this._paint = this.mobject.getFamily().map((mobject) => ({
      mobject,
      fill: mobject.fillOpacity,
      stroke: mobject.opacity,
    }));
  }

  interpolate(alpha: number): void {
    for (const state of this._paint) {
      Mobject.prototype.setFillOpacity.call(state.mobject, state.fill * (1 - alpha));
      Mobject.prototype.setStrokeOpacity.call(state.mobject, state.stroke * (1 - alpha));
    }
  }

  override reset(): void {
    super.reset();
    for (const state of this._paint) {
      Mobject.prototype.setFillOpacity.call(state.mobject, state.fill);
      Mobject.prototype.setStrokeOpacity.call(state.mobject, state.stroke);
    }
  }
}

describe('creation animation vector parity', () => {
  it('Create slices geometry without adding a fill phase', () => {
    const path = leaf(4, 0.6, 0.4);
    const animation = new Create(path, { lagRatio: 0, rateFunc: linear });

    expect(animation.duration).toBe(1);
    animation.begin();
    expect(endpointX(path)).toBe(0);
    expect(path.fillOpacity).toBeCloseTo(0.6, 5);
    expect(path.opacity).toBeCloseTo(0.4, 5);

    animation.interpolate(0.25);
    expect(endpointX(path)).toBeCloseTo(1, 5);
    expect(path.fillOpacity).toBeCloseTo(0.6, 5);

    animation.finish();
    expect(endpointX(path)).toBeCloseTo(4, 5);
    expect(path.fillOpacity).toBeCloseTo(0.6, 5);
    expect(path.opacity).toBeCloseTo(0.4, 5);
  });

  it('Write defaults to linear and produces mixed outline/fill glyph states', () => {
    const first = leaf(2);
    const second = leaf(5);
    const animation = new Write(new VGroup(first, second), {
      lagRatio: 0.5,
      rateFunc: linear,
    });

    expect(animation.rateFunc).toBe(linear);
    animation.begin();
    animation.interpolate(0.6);

    expect(endpointX(first)).toBeCloseTo(2, 5);
    expect(first.fillOpacity).toBeGreaterThan(0);
    expect(endpointX(second)).toBeCloseTo(4, 5);
    expect(second.fillOpacity).toBe(0);

    animation.finish();
    expect(endpointX(first)).toBeCloseTo(2, 5);
    expect(endpointX(second)).toBeCloseTo(5, 5);
    expect(first.fillOpacity).toBeCloseTo(0.8, 5);
    expect(second.fillOpacity).toBeCloseTo(0.8, 5);
  });

  it('uses Manim long-family timing when vector leaves are already rendered', () => {
    const formulaLikeFamily = new VGroup(
      ...Array.from({ length: 16 }, (_, index) => leaf(1 + index * 0.01)),
    );
    expect(new Write(formulaLikeFamily).duration).toBe(2);
    expect(new Write(formulaLikeFamily, { duration: 0.75 }).duration).toBe(0.75);
  });

  it('DrawBorderThenFill reset restores exact pre-animation geometry and style', () => {
    const path = leaf(3, 0.45, 0.25);
    path.setColor('#58c4dd');
    path.fillColor = '#fc6255';
    const originalPoints = path.getLocalPoints();
    const animation = new DrawBorderThenFill(path, {
      lagRatio: 0,
      rateFunc: linear,
      strokeWidth: 2,
    });

    animation.begin();
    animation.interpolate(0.3);
    expect(path.getLocalPoints()).not.toEqual(originalPoints);
    expect(path.fillOpacity).toBe(0);
    expect(path.strokeWidth).toBe(2);

    animation.reset();
    expect(path.getLocalPoints()).toEqual(originalPoints);
    expect(path.fillOpacity).toBeCloseTo(0.45, 5);
    expect(path.opacity).toBeCloseTo(0.25, 5);
    expect(path.strokeWidth).toBeCloseTo(0.5, 5);
    expect(path.color).toBe('#58c4dd');
    expect(path.fillColor).toBe('#fc6255');
  });

  it('restores live constructor paint fields even when style metadata began stale', () => {
    const circle = new Circle({
      radius: 1,
      color: '#58c4dd',
      fillOpacity: 0.7,
      strokeWidth: 7,
    });
    const animation = new DrawBorderThenFill(circle, {
      lagRatio: 0,
      rateFunc: linear,
      strokeWidth: 2,
    });

    animation.begin();
    animation.interpolate(0.25);
    animation.reset();

    expect(circle.fillOpacity).toBeCloseTo(0.7, 8);
    expect(circle.strokeWidth).toBeCloseTo(7, 8);
    expect(circle.fillColor).toBe('#58c4dd');
    expect(circle.strokeColor).toBe('#58c4dd');
  });

  it('Unwrite is a remover and reset recovers hidden family members', () => {
    const first = leaf(2, 0.7, 0.6);
    const second = leaf(4, 0.5, 0.4);
    const animation = new Unwrite(new VGroup(first, second), {
      lagRatio: 0.5,
      rateFunc: linear,
    });

    expect(animation.remover).toBe(true);
    animation.begin();
    animation.finish();
    expect(first.opacity).toBe(0);
    expect(second.opacity).toBe(0);

    animation.reset();
    expect(endpointX(first)).toBeCloseTo(2, 5);
    expect(endpointX(second)).toBeCloseTo(4, 5);
    expect(first.fillOpacity).toBeCloseTo(0.7, 5);
    expect(second.fillOpacity).toBeCloseTo(0.5, 5);
    expect(first.opacity).toBeCloseTo(0.6, 5);
    expect(second.opacity).toBeCloseTo(0.4, 5);
  });

  it('restores formula-like VGroup leaf topology before the root snapshot on reset', () => {
    const leaves = Array.from({ length: 15 }, (_, index) => glyphLikeLeaf(index * 0.1));
    const formulaLike = new VGroup(...leaves);
    const originalPoints = leaves.map((member) => member.getLocalPoints());
    const animation = new Write(formulaLike, { lagRatio: 0.05, rateFunc: linear });

    animation.begin();
    expect(leaves.reduce((sum, member) => sum + member.getLocalPoints().length, 0)).toBe(60);
    expect(() => animation.reset()).not.toThrow();
    expect(leaves.map((member) => member.getLocalPoints())).toEqual(originalPoints);

    animation.begin();
    animation.interpolate(0.4);
    expect(() => animation.reset()).not.toThrow();
    expect(leaves.map((member) => member.getLocalPoints())).toEqual(originalPoints);
  });

  it('supports repeated backward seeks through a partial formula-like Write', () => {
    const leaves = Array.from({ length: 15 }, (_, index) => glyphLikeLeaf(index * 0.1));
    const formulaLike = new VGroup(...leaves);
    const animation = new Write(formulaLike, { duration: 1, lagRatio: 0.05, rateFunc: linear });
    const timeline = new Timeline().add(animation, 0);

    timeline.seek(0.5);
    expect(() => timeline.seek(0)).not.toThrow();
    expect(() => timeline.seek(0.5)).not.toThrow();
    expect(() => timeline.seek(0)).not.toThrow();

    animation.reset();
    expect(leaves.every((member) => member.getLocalPoints().length === 13)).toBe(true);
  });

  it('resets sequential Write then family fade in reverse state-stack order', () => {
    const leaves = Array.from({ length: 15 }, (_, index) => glyphLikeLeaf(index * 0.1));
    const formulaLike = new VGroup(...leaves);
    const writeAnimation = new Write(formulaLike, {
      duration: 1,
      lagRatio: 0.05,
      rateFunc: linear,
    });
    const fadeAnimation = new FamilyFadeForReset(formulaLike, { duration: 1 });
    const timeline = new MasterTimeline();
    timeline.addSegment([writeAnimation]);
    timeline.addSegment([fadeAnimation]);

    // Recording begins the next segment while the preceding Write family is
    // still in its aligned four-point-per-glyph start state.
    writeAnimation.begin();
    expect(leaves.every((member) => member.getLocalPoints().length === 4)).toBe(true);
    fadeAnimation.begin();
    writeAnimation.finish();
    fadeAnimation.finish();

    expect(() => timeline.seek(0)).not.toThrow();
    expect(leaves.every((member) => member.getLocalPoints().length === 4)).toBe(true);
    expect(() => timeline.seek(2)).not.toThrow();
    expect(() => timeline.seek(0)).not.toThrow();
    expect(leaves.every((member) => member.getLocalPoints().length === 4)).toBe(true);
  });
});
