import { describe, expect, it } from 'vitest';
import { Circle } from '../mobjects/geometry/Circle';
import { VGroup } from './VGroup';

describe('core style parity', () => {
  it('keeps fill and stroke channels independent on a leaf', () => {
    const circle = new Circle({ color: '#112233', fillOpacity: 0.2 });

    circle.setFill('#44aa66', 0.4);
    expect(circle.fillColor).toBe('#44aa66');
    expect(circle.fillOpacity).toBeCloseTo(0.4);
    expect(circle.strokeColor).toBe('#112233');
    expect(circle.color).toBe('#112233');

    circle.setStroke('#ee3355', 7, 0.65);
    expect(circle.strokeColor).toBe('#ee3355');
    expect(circle.color).toBe('#ee3355');
    expect(circle.strokeWidth).toBe(7);
    expect(circle.opacity).toBeCloseTo(0.65);
    expect(circle.fillColor).toBe('#44aa66');
    expect(circle.fillOpacity).toBeCloseTo(0.4);
  });

  it('setStyle updates stroke color without overwriting fill color', () => {
    const circle = new Circle({ color: '#ffffff', fillOpacity: 1 });
    circle.setFill('#00aa88');

    circle.setStyle({ strokeColor: '#ff6600', strokeOpacity: 0.5, strokeWidth: 9 });

    expect(circle.strokeColor).toBe('#ff6600');
    expect(circle.color).toBe('#ff6600');
    expect(circle.fillColor).toBe('#00aa88');
    expect(circle.fillOpacity).toBe(1);
    expect(circle.opacity).toBeCloseTo(0.5);
    expect(circle.strokeWidth).toBe(9);
  });

  it('setColor still intentionally resets both color channels', () => {
    const circle = new Circle({ color: '#334455' });
    circle.setFill('#abcdef');

    // The legacy stroke-facing color already matches, so this also verifies
    // setColor does not incorrectly early-return while fill differs.
    circle.setColor('#334455');

    expect(circle.strokeColor).toBe('#334455');
    expect(circle.fillColor).toBe('#334455');
  });

  it('setOpacity changes both opacity channels without changing colors', () => {
    const circle = new Circle({ color: '#ffffff' });
    circle.setFill('#00aa88', 0.8).setStroke('#ff6600', 6, 0.9);

    expect(circle.setOpacity(0.35)).toBe(circle);

    expect(circle.fillOpacity).toBeCloseTo(0.35);
    expect(circle.opacity).toBeCloseTo(0.35);
    expect(circle.style.fillOpacity).toBeCloseTo(0.35);
    expect(circle.style.strokeOpacity).toBeCloseTo(0.35);
    expect(circle.fillColor).toBe('#00aa88');
    expect(circle.strokeColor).toBe('#ff6600');
  });

  it('VGroup propagates non-clobbering fill, stroke, and opacity through nested groups', () => {
    const first = new Circle({ color: '#101010' });
    const nestedLeaf = new Circle({ color: '#202020' });
    const nested = new VGroup(nestedLeaf);
    const group = new VGroup(first, nested);

    group.setFill('#44aa66', 0.7);
    for (const leaf of [first, nestedLeaf]) {
      expect(leaf.fillColor).toBe('#44aa66');
      expect(leaf.fillOpacity).toBeCloseTo(0.7);
    }
    expect(first.strokeColor).toBe('#101010');
    expect(nestedLeaf.strokeColor).toBe('#202020');

    group.setStroke('#ee3355', 8, 0.6);
    for (const leaf of [first, nestedLeaf]) {
      expect(leaf.strokeColor).toBe('#ee3355');
      expect(leaf.strokeWidth).toBe(8);
      expect(leaf.opacity).toBeCloseTo(0.6);
      expect(leaf.fillColor).toBe('#44aa66');
    }

    group.setOpacity(0.25);
    for (const member of [group, nested, first, nestedLeaf]) {
      expect(member.fillOpacity).toBeCloseTo(0.25);
      expect(member.opacity).toBeCloseTo(0.25);
    }
  });

  it('stores, copies, and restores zIndex across a family', () => {
    const first = new Circle();
    const second = new Circle();
    const group = new VGroup(first, second).setZIndex(20);

    expect(group.zIndex).toBe(20);
    expect(first.zIndex).toBe(20);
    expect(second.zIndex).toBe(20);
    expect(group.copy().zIndex).toBe(20);

    group.saveState();
    group.setZIndex(-4);
    expect(group.restoreState()).toBe(true);
    expect(group.zIndex).toBe(20);
    expect(first.zIndex).toBe(20);
    expect(second.zIndex).toBe(20);

    group.setZIndex(7, false);
    expect(group.zIndex).toBe(7);
    expect(first.zIndex).toBe(20);
  });
});
