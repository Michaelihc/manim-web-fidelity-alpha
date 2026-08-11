import { describe, expect, it } from 'vitest';
import { Line } from '../mobjects/geometry/Line';
import { Rectangle } from '../mobjects/geometry/Rectangle';
import { DOWN, LEFT, RIGHT, UP } from './Mobject';
import { VGroup } from './VGroup';

describe('core layout parity', () => {
  it('scaleToFitWidth uses current world bounds rather than stale subclass dimensions', () => {
    const rectangle = new Rectangle({ width: 2, height: 1 });
    rectangle.scale(2);

    // Rectangle.getWidth() is construction metadata; the generic fit helper
    // must instead use transformed world bounds (currently width 4).
    expect(rectangle.getWidth()).toBe(2);
    expect(rectangle.getBoundingBox().width).toBeCloseTo(4);

    rectangle.scaleToFitWidth(8);
    expect(rectangle.getBoundingBox().width).toBeCloseTo(8);
    expect(rectangle.getBoundingBox().height).toBeCloseTo(4);
  });

  it('supports proportional width/height fitting', () => {
    const byWidth = new Rectangle({ width: 2, height: 1 }).scaleToFitWidth(6);
    expect(byWidth.getBoundingBox().width).toBeCloseTo(6);
    expect(byWidth.getBoundingBox().height).toBeCloseTo(3);

    const byHeight = new Rectangle({ width: 2, height: 1 }).scaleToFitHeight(4);
    expect(byHeight.getBoundingBox().width).toBeCloseTo(8);
    expect(byHeight.getBoundingBox().height).toBeCloseTo(4);
  });

  it('supports independent width/height stretching', () => {
    const byWidth = new Rectangle({ width: 2, height: 1 }).stretchToFitWidth(6);
    expect(byWidth.getBoundingBox().width).toBeCloseTo(6);
    expect(byWidth.getBoundingBox().height).toBeCloseTo(1);

    const byHeight = new Rectangle({ width: 2, height: 1 }).stretchToFitHeight(5);
    expect(byHeight.getBoundingBox().width).toBeCloseTo(2);
    expect(byHeight.getBoundingBox().height).toBeCloseTo(5);
  });

  it('fits against world bounds under a scaled parent', () => {
    const rectangle = new Rectangle({ width: 2, height: 1 });
    const group = new VGroup(rectangle);
    group.scale(2);

    expect(rectangle.getBoundingBox().width).toBeCloseTo(4);
    rectangle.scaleToFitWidth(6);
    expect(rectangle.getBoundingBox().width).toBeCloseTo(6);
  });

  it('leaves a zero-length dimension unchanged', () => {
    const verticalLine = new Line({ start: [0, -1, 0], end: [0, 1, 0] });
    const before = verticalLine.getBoundingBox();

    expect(verticalLine.scaleToFitWidth(3)).toBe(verticalLine);
    expect(verticalLine.getBoundingBox()).toEqual(before);
  });

  it('arranges a column with an aligned edge via options', () => {
    const first = new Rectangle({ width: 1, height: 0.5 });
    const second = new Rectangle({ width: 2, height: 1 });
    const third = new Rectangle({ width: 0.5, height: 1.5 });
    const group = new VGroup(first, second, third);

    group.arrange(DOWN, 0.4, { alignedEdge: LEFT });

    const lefts = [first, second, third].map((mob) => mob.getEdge(LEFT)[0]);
    expect(lefts[1]).toBeCloseTo(lefts[0]);
    expect(lefts[2]).toBeCloseTo(lefts[0]);
    expect(first.getEdge(DOWN)[1] - second.getEdge(UP)[1]).toBeCloseTo(0.4);
    expect(second.getEdge(DOWN)[1] - third.getEdge(UP)[1]).toBeCloseTo(0.4);
  });

  it('preserves legacy arrange calls and supports positional alignedEdge', () => {
    const first = new Rectangle({ width: 1, height: 1 });
    const second = new Rectangle({ width: 2, height: 1 });
    const group = new VGroup(first, second);
    const originalCenter = group.getCenter();

    group.arrange(DOWN, 0.25, true, RIGHT);

    expect(first.getEdge(RIGHT)[0]).toBeCloseTo(second.getEdge(RIGHT)[0]);
    expect(group.getCenter()[0]).toBeCloseTo(originalCenter[0]);
    expect(group.getCenter()[1]).toBeCloseTo(originalCenter[1]);
  });

  it('toEdge preserves an orthogonal center that differs from position', () => {
    const rectangle = new Rectangle({ width: 2, height: 1 });
    rectangle.shift([2, 1, 0]);
    rectangle.normalizeTransform();
    expect(rectangle.position.y).toBeCloseTo(0);
    expect(rectangle.getCenter()[1]).toBeCloseTo(1);

    rectangle.toEdge(RIGHT, 0.5, [14, 8]);

    expect(rectangle.getCenter()[1]).toBeCloseTo(1);
    expect(rectangle.getEdge(RIGHT)[0]).toBeCloseTo(6.5);
  });
});
