import { describe, expect, it } from 'vitest';
import { VMobject } from '../../core/VMobject';
import { ShowPassingFlash } from './ShowPassingFlash';
import { ShowPassingFlashWithThinningStrokeWidth } from './ShowPassingFlashWithThinningStrokeWidth';
import { Arrow } from '../../mobjects/geometry/Arrow';
import { Line } from '../../mobjects/geometry/Line';

function straightPath(): VMobject {
  return new VMobject().setPoints3D([
    [0, 0, 0],
    [1 / 3, 0, 0],
    [2 / 3, 0, 0],
    [1, 0, 0],
  ]);
}

describe('ShowPassingFlash Bézier geometry', () => {
  it('moves an exact partial-path window instead of selecting point indices', () => {
    const path = straightPath();
    const animation = new ShowPassingFlash(path, { timeWidth: 0.2 });

    animation.begin();
    animation.interpolate(0.5);

    const points = path.getLocalPoints();
    expect(points).toHaveLength(4);
    expect(points[0][0]).toBeCloseTo(0.4, 8);
    expect(points[3][0]).toBeCloseTo(0.6, 8);
    expect(animation.remover).toBe(true);
  });

  it('preserves disconnected compound contours inside the moving window', () => {
    const path = new VMobject().setPoints3D([
      [0, 0, 0],
      [1 / 3, 0, 0],
      [2 / 3, 0, 0],
      [1, 0, 0],
      [10, 0, 0],
      [10 + 1 / 3, 0, 0],
      [10 + 2 / 3, 0, 0],
      [11, 0, 0],
    ]);
    path.setBaseSubpathLengths([4, 4]);
    const animation = new ShowPassingFlash(path, { timeWidth: 0.6 });

    animation.begin();
    animation.interpolate(0.5);

    expect(path.getEffectiveSubpathLengths()).toEqual([4, 4]);
    expect(path.getLocalPoints()).toHaveLength(8);
    expect(path.getLocalPoints()[3][0]).toBeLessThan(2);
    expect(path.getLocalPoints()[4][0]).toBeGreaterThan(9);
  });

  it('restores exact geometry and style on reset', () => {
    const path = straightPath().setStroke('#58c4dd', 7, 0.65).setFill('#fc6255', 0.4);
    const originalPoints = path.getLocalPoints();
    const originalStyle = path.style;
    const animation = new ShowPassingFlash(path, {
      color: '#ffffff',
      strokeWidth: 11,
    });

    animation.begin();
    animation.interpolate(0.4);
    const captured = (
      animation as unknown as {
        _parts: Array<{ fillOpacity: number; strokeWidth: number }>;
      }
    )._parts;
    expect(captured).toHaveLength(1);
    expect(captured[0].fillOpacity).toBeCloseTo(0.4);
    expect(captured[0].strokeWidth).toBe(7);
    animation.reset();

    expect(path.getLocalPoints()).toEqual(originalPoints);
    expect(path.style).toEqual(originalStyle);
  });

  it('preserves live constructor stroke width when style metadata is stale', () => {
    const path = new Line({ strokeWidth: 8, color: '#58c4dd' });
    path.setStrokeOpacity(0.55);
    const animation = new ShowPassingFlash(path);

    animation.begin();
    animation.interpolate(0.5);
    expect(path.strokeWidth).toBe(8);
    expect(path.opacity).toBeCloseTo(0.55);

    animation.reset();
    expect(path.strokeWidth).toBe(8);
    expect(path.opacity).toBeCloseTo(0.55);
    expect(path.strokeColor).toBe('#58c4dd');
  });

  it('partializes Arrow leaves and restores the compound world geometry', () => {
    const arrow = new Arrow({
      start: [-2, -0.5, 0],
      end: [2, 0.75, 0],
      color: '#58c4dd',
      strokeWidth: 7,
    });
    const originalStart = arrow.getStart();
    const originalEnd = arrow.getEnd();
    const originalChildPointCounts = arrow.children.map(
      (child) => (child as VMobject).getLocalPoints().length,
    );
    const animation = new ShowPassingFlash(arrow, { timeWidth: 0.35 });

    expect(() => animation.begin()).not.toThrow();
    const captured = (
      animation as unknown as {
        _parts: Array<{ mobject: VMobject }>;
      }
    )._parts;
    expect(captured.map(({ mobject }) => mobject)).toEqual(arrow.children);
    expect(() => animation.interpolate(0.5)).not.toThrow();
    expect(() => animation.reset()).not.toThrow();

    expect(arrow.getStart()).toEqual(originalStart);
    expect(arrow.getEnd()).toEqual(originalEnd);
    expect(arrow.children.map((child) => (child as VMobject).getLocalPoints().length)).toEqual(
      originalChildPointCounts,
    );
  });

  it('creates a true thin-to-thick segmented tail without changing the public root', () => {
    const path = straightPath().setStroke('#58c4dd', 8, 1);
    const animation = new ShowPassingFlashWithThinningStrokeWidth(path, {
      minStrokeWidthRatio: 0.25,
      taperSegments: 4,
      timeWidth: 0.4,
    });

    animation.begin();
    animation.interpolate(0.5);

    expect(path.children).toHaveLength(4);
    expect(path.children.map((child) => child.strokeWidth)).toEqual([3.5, 5, 6.5, 8]);
    animation.reset();
    expect(path.children).toHaveLength(0);
    expect(path.getLocalPoints()[0][0]).toBe(0);
    expect(path.getLocalPoints()[3][0]).toBe(1);
  });
});
