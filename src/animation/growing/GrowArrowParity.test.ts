import { describe, expect, it } from 'vitest';
import { Arrow } from '../../mobjects/geometry/Arrow';
import { GrowArrow } from './index';

describe('GrowArrow Manim parity', () => {
  it('grows the shaft and tip together at alphas 0/.25/.5/.75/1', () => {
    const arrow = new Arrow({
      start: [1, -2, 0],
      end: [5, -2, 0],
      tipLength: 0.6,
      tipWidth: 0.25,
    });
    const shaft = arrow.children[0];
    const tip = arrow.children[1];
    const fullShaftWidth = shaft.getWidth();
    const fullTipWidth = tip.getWidth();
    const fullTipHeight = tip.getHeight();
    const grow = new GrowArrow(arrow);

    grow.begin();
    for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
      grow.interpolate(alpha);
      expect(shaft.getWidth()).toBeCloseTo(fullShaftWidth * alpha, 7);
      expect(tip.getWidth()).toBeCloseTo(fullTipWidth * alpha, 7);
      expect(tip.getHeight()).toBeCloseTo(fullTipHeight * alpha, 7);
      expect(arrow.getEnd()[0]).toBeCloseTo(1 + 4 * alpha, 7);
    }
  });

  it('does not show a full-sized tip before the arrow reaches its end', () => {
    const arrow = new Arrow({
      start: [0, 0, 0],
      end: [6, 0, 0],
      tipLength: 0.9,
      tipWidth: 0.4,
    });
    const tip = arrow.children[1];
    const fullTipWidth = tip.getWidth();
    const fullTipHeight = tip.getHeight();
    const grow = new GrowArrow(arrow);

    grow.begin();
    grow.interpolate(0.25);

    expect(tip.getWidth()).toBeCloseTo(fullTipWidth * 0.25, 7);
    expect(tip.getHeight()).toBeCloseTo(fullTipHeight * 0.25, 7);
    expect(arrow.getEnd()[0]).toBeCloseTo(1.5, 7);
    expect(arrow.getEnd()[0]).toBeLessThan(6);
  });

  it('preserves shaft/tip styles through growth and finish', () => {
    const arrow = new Arrow({ start: [0, 0, 0], end: [3, 1, 0] });
    const shaft = arrow.children[0];
    const tip = arrow.children[1];
    shaft.setStroke('#3b82f6', 8, 0.42);
    tip.setFill('#f97316', 0.57);
    const shaftStyle = shaft.style;
    const tipStyle = tip.style;
    const grow = new GrowArrow(arrow);

    grow.begin();
    grow.interpolate(0.6);
    expect(shaft.style).toEqual(shaftStyle);
    expect(tip.style).toEqual(tipStyle);

    grow.finish();
    expect(shaft.style).toEqual(shaftStyle);
    expect(tip.style).toEqual(tipStyle);
  });

  it('supports backward seeking and reset without residual collapse', () => {
    const arrow = new Arrow({ start: [-2, 1, 0], end: [4, 1, 0] });
    const fullWidth = arrow.getWidth();
    const fullStart = arrow.getStart();
    const fullEnd = arrow.getEnd();
    const grow = new GrowArrow(arrow);

    grow.begin();
    grow.interpolate(0.8);
    grow.interpolate(0.25);
    expect(arrow.getWidth()).toBeCloseTo(fullWidth * 0.25, 7);
    expect(arrow.getEnd()[0]).toBeCloseTo(-0.5, 7);

    grow.reset();
    expect(arrow.getWidth()).toBeCloseTo(fullWidth, 7);
    expect(arrow.getStart()).toEqual(fullStart);
    expect(arrow.getEnd()).toEqual(fullEnd);
  });
});
