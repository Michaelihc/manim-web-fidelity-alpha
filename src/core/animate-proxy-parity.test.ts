import { describe, expect, it } from 'vitest';
import { Circle } from '../mobjects/geometry/Circle';
import { Rectangle } from '../mobjects/geometry/Rectangle';
import { DOWN, LEFT } from './Mobject';
import { AnimateProxy } from './AnimateProxy';
import { VGroup } from './VGroup';

describe('AnimateProxy core parity methods', () => {
  it('animates setOpacity to independent fill/stroke endpoints', () => {
    const circle = new Circle({ color: '#ffffff' });
    circle.setFill('#00aa88', 0.8).setStroke('#ff6600', 6, 0.9);

    const animation = circle.animate.setOpacity(0.3);
    animation.begin();
    animation.finish();

    expect(circle.fillOpacity).toBeCloseTo(0.3);
    expect(circle.opacity).toBeCloseTo(0.3);
    expect(circle.fillColor).toBe('#00aa88');
    expect(circle.strokeColor).toBe('#ff6600');
  });

  it('animates setStroke without changing fill', () => {
    const circle = new Circle({ color: '#ffffff' }).setFill('#00aa88', 0.7);

    const animation = circle.animate.setStroke('#ff6600', 9, 0.4);
    animation.begin();
    animation.finish();

    expect(circle.strokeColor).toBe('#ff6600');
    expect(circle.strokeWidth).toBe(9);
    expect(circle.opacity).toBeCloseTo(0.4);
    expect(circle.fillColor).toBe('#00aa88');
    expect(circle.fillOpacity).toBeCloseTo(0.7);
  });

  it('animates zIndex state and fit helpers', () => {
    const rectangle = new Rectangle({ width: 2, height: 1 });

    const animation = rectangle.animate.setZIndex(12).scaleToFitWidth(6);
    animation.begin();
    animation.finish();

    expect(rectangle.zIndex).toBe(12);
    expect(rectangle.getBoundingBox().width).toBeCloseTo(6);
    expect(rectangle.getBoundingBox().height).toBeCloseTo(3);
  });

  it('records and applies aligned arrange on a VGroup', () => {
    const first = new Rectangle({ width: 1, height: 0.5 });
    const second = new Rectangle({ width: 2, height: 1 });
    const group = new VGroup(first, second);

    const animation = group.animate.arrange(DOWN, 0.3, { alignedEdge: LEFT });
    expect(animation).toBeInstanceOf(AnimateProxy);
    animation.begin();
    animation.finish();

    expect(first.getEdge(LEFT)[0]).toBeCloseTo(second.getEdge(LEFT)[0]);
    expect(first.getEdge(DOWN)[1] - second.getEdge([0, 1, 0])[1]).toBeCloseTo(0.3);
  });
});
