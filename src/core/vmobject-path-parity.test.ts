import { describe, expect, it } from 'vitest';
import { PointMobject } from '../mobjects/point';
import { MoveAlongPath } from '../animation/movement/MoveAlongPath';
import { linear } from '../rate-functions';
import { VMobject } from './VMobject';

function unequalStraightCurves(): VMobject {
  return new VMobject().setPoints3D([
    [0, 0, 0],
    [1 / 3, 0, 0],
    [2 / 3, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [3, 0, 0],
    [4, 0, 0],
  ]);
}

describe('VMobject path parity', () => {
  it('parameterizes pointFromProportion by approximate arc length', () => {
    const path = unequalStraightCurves();
    expect(path.pointFromProportion(0)).toEqual([0, 0, 0]);
    expect(path.pointFromProportion(0.25)[0]).toBeCloseTo(1, 5);
    expect(path.pointFromProportion(0.5)[0]).toBeCloseTo(2, 5);
    expect(path.pointFromProportion(1)[0]).toBeCloseTo(4, 5);
  });

  it('MoveAlongPath gives unequal cubics time in proportion to their lengths', () => {
    const movingPoint = new PointMobject({ position: [0, 0, 0] });
    const animation = new MoveAlongPath(movingPoint, {
      path: unequalStraightCurves(),
      rateFunc: linear,
    });
    animation.begin();
    animation.interpolate(0.25);
    expect(movingPoint.getCenter()[0]).toBeCloseTo(1, 3);
    animation.interpolate(0.75);
    expect(movingPoint.getCenter()[0]).toBeCloseTo(3, 3);
  });

  it('setPointsSmoothly creates matching derivatives at interior knots', () => {
    const path = new VMobject().setPointsSmoothly([
      [0, 0, 0],
      [1, 1, 0],
      [3, 0, 0],
    ]);
    const points = path.getLocalPoints();
    expect(points).toHaveLength(7);
    const incoming = [3 * (points[3][0] - points[2][0]), 3 * (points[3][1] - points[2][1])];
    const outgoing = [3 * (points[4][0] - points[3][0]), 3 * (points[4][1] - points[3][1])];
    expect(outgoing[0]).toBeCloseTo(incoming[0], 8);
    expect(outgoing[1]).toBeCloseTo(incoming[1], 8);
  });

  it('does not measure the gap between compound contours', () => {
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

    expect(path.pointFromProportion(0.5)[0]).toBeCloseTo(1, 5);
    expect(path.pointFromProportion(0.75)[0]).toBeCloseTo(10.5, 5);
  });
});
