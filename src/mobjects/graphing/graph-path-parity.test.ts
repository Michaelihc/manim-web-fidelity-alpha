import { describe, expect, it } from 'vitest';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { Axes } from './Axes';
import { FunctionGraph } from './FunctionGraph';
import { NumberLine } from './NumberLine';

describe('graph path parity', () => {
  it('round-trips coordinates after deferred axes transforms', () => {
    const axes = new Axes({
      xRange: [-4, 4, 1],
      yRange: [-2, 2, 1],
      xLength: 8,
      yLength: 4,
      tips: false,
    });
    axes.scale(1.4);
    axes.rotate(0.35);
    axes.shift([2, -1, 0]);

    const point = axes.coordsToPoint(1.25, -0.75);
    const [x, y] = axes.pointToCoords(point);
    expect(x).toBeCloseTo(1.25, 8);
    expect(y).toBeCloseTo(-0.75, 8);
  });

  it('round-trips NumberLine values after rotation, scale, and shift', () => {
    const numberLine = new NumberLine({ xRange: [-2, 6, 1], length: 8 });
    numberLine.scale(0.75);
    numberLine.rotate(-0.6);
    numberLine.shift([3, 2, 0]);

    const point = numberLine.numberToPoint(4.25);
    expect(numberLine.pointToNumber(point)).toBeCloseTo(4.25, 8);
  });

  it('keeps declared discontinuity contours disconnected in the renderer', () => {
    const graph = new FunctionGraph({
      func: (x) => 1 / x,
      xRange: [-2, 2],
      discontinuities: [0],
      numSamples: 80,
      useSmoothing: false,
    });

    expect(graph.getEffectiveSubpathLengths()).toHaveLength(2);
    const lines: Line2[] = [];
    graph.getThreeObject().traverse((child) => {
      if (child instanceof Line2) lines.push(child);
    });
    expect(lines).toHaveLength(2);
  });

  it('honors strokeOpacity for invisible guide paths', () => {
    const guide = new FunctionGraph({
      func: (x) => x * x,
      xRange: [-1, 1],
      strokeOpacity: 0,
    });
    expect(guide.opacity).toBe(0);
    expect(guide.style.strokeOpacity).toBe(0);
  });

  it('preserves the exact ReLU kink when smoothing is disabled', () => {
    const relu = new FunctionGraph({
      func: (x) => Math.max(0, x),
      xRange: [-2, 2],
      numSamples: 4,
      useSmoothing: false,
    });
    const points = relu.getLocalPoints();
    const anchors = points.filter((_, index) => index % 3 === 0);
    expect(anchors.filter((point) => point[0] < 0).every((point) => point[1] === 0)).toBe(true);
  });
});
