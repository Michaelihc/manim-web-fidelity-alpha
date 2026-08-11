import { describe, expect, it } from 'vitest';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { VMobject } from './VMobject';

const COMPOUND_POINTS = [
  [0, 0, 0],
  [1 / 3, 0, 0],
  [2 / 3, 0, 0],
  [1, 0, 0],
  [10, 0, 0],
  [10 + 2 / 3, 0, 0],
  [10 + 4 / 3, 0, 0],
  [12, 0, 0],
];

function makeCompoundPath(): VMobject {
  const path = new VMobject();
  path.setPoints3D(COMPOUND_POINTS);
  path.setBaseSubpathLengths([4, 4]);
  return path;
}

function renderedStrokeLines(path: VMobject): Line2[] {
  const lines: Line2[] = [];
  path.getThreeObject().traverse((child) => {
    if (child instanceof Line2) lines.push(child);
  });
  return lines;
}

function expectPointsClose(actual: number[][], expected: number[][]): void {
  expect(actual).toHaveLength(expected.length);
  for (let pointIndex = 0; pointIndex < expected.length; pointIndex++) {
    expect(actual[pointIndex]).toHaveLength(expected[pointIndex].length);
    for (
      let coordinateIndex = 0;
      coordinateIndex < expected[pointIndex].length;
      coordinateIndex++
    ) {
      expect(actual[pointIndex][coordinateIndex]).toBeCloseTo(
        expected[pointIndex][coordinateIndex],
        12,
      );
    }
  }
}

describe('VMobject.pointwiseBecomePartial', () => {
  it('slices compound contours without introducing a bridge', () => {
    const source = makeCompoundPath();
    const partial = new VMobject().pointwiseBecomePartial(source, 0, 0.75);

    expectPointsClose(partial.getLocalPoints(), [
      [0, 0, 0],
      [1 / 3, 0, 0],
      [2 / 3, 0, 0],
      [1, 0, 0],
      [10, 0, 0],
      [10 + 1 / 3, 0, 0],
      [10 + 2 / 3, 0, 0],
      [11, 0, 0],
    ]);
    expect(partial.getEffectiveSubpathLengths()).toEqual([4, 4]);
    expect(partial.getEffectiveSubpathLengths()?.every((length) => (length - 1) % 3 === 0)).toBe(
      true,
    );

    const lines = renderedStrokeLines(partial);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const starts = line.geometry.getAttribute('instanceStart');
      const ends = line.geometry.getAttribute('instanceEnd');
      const renderedXCoordinates: number[] = [];
      for (let index = 0; index < starts.count; index++) {
        renderedXCoordinates.push(starts.getX(index), ends.getX(index));
      }
      expect(
        renderedXCoordinates.every(
          (xCoordinate) => xCoordinate <= 1 + 1e-12 || xCoordinate >= 10 - 1e-12,
        ),
      ).toBe(true);
    }

    expect(source.getLocalPoints()).toEqual(COMPOUND_POINTS);
    expect(source.getEffectiveSubpathLengths()).toEqual([4, 4]);
  });

  it('copies the full interval and its topology exactly', () => {
    const source = makeCompoundPath();
    const partial = new VMobject().pointwiseBecomePartial(source, 0, 1);

    expect(partial.getLocalPoints()).toEqual(COMPOUND_POINTS);
    expect(partial.getEffectiveSubpathLengths()).toEqual([4, 4]);
  });

  it('represents zero progress as a degenerate cubic at the first anchor', () => {
    const source = makeCompoundPath();
    const partial = new VMobject().pointwiseBecomePartial(source, 0, 0);

    expect(partial.getLocalPoints()).toEqual([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    expect(partial.getEffectiveSubpathLengths()).toEqual([4]);
  });

  it('uses exact de Casteljau handles for a curved partial cubic', () => {
    const source = new VMobject().setPoints3D([
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ]);
    const partial = new VMobject().pointwiseBecomePartial(source, 0, 0.5);

    expect(partial.getLocalPoints()).toEqual([
      [0, 0, 0],
      [0, 0.5, 0],
      [0.25, 0.75, 0],
      [0.5, 0.75, 0],
    ]);
    expect(partial.getEffectiveSubpathLengths()).toEqual([4]);
  });

  it('preserves intrinsic and transform-time topology when copied', () => {
    const source = makeCompoundPath();
    source.setTransformSubpathLengths([4, 4]);

    const copy = source.copy();

    expect(copy.getSubpathLengths()).toEqual([4, 4]);
    expect(copy.getEffectiveSubpathLengths()).toEqual([4, 4]);

    const returnedLengths = copy.getSubpathLengths();
    if (!returnedLengths) throw new Error('Expected copied base topology.');
    returnedLengths[0] = 7;

    expect(copy.getSubpathLengths()).toEqual([4, 4]);
    expect(source.getSubpathLengths()).toEqual([4, 4]);
  });
});
