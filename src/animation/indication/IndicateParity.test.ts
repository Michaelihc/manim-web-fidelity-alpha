// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VMobject } from '../../core/VMobject';
import { VGroup } from '../../core/VGroup';
import { MathTex } from '../../mobjects/text/MathTex';
import { YELLOW } from '../../constants';
import { Indicate } from './Indicate';

function makeLine(start = 0, end = 2): VMobject {
  const line = new VMobject();
  line.setPoints([
    [start, 0, 0],
    [start + (end - start) / 3, 0, 0],
    [start + (2 * (end - start)) / 3, 0, 0],
    [end, 0, 0],
  ]);
  return line;
}

function expectColor(actual: string | undefined, expected: string): void {
  const result = new THREE.Color(actual ?? '#000000');
  const target = new THREE.Color(expected);
  expect(result.r).toBeCloseTo(target.r, 6);
  expect(result.g).toBeCloseTo(target.g, 6);
  expect(result.b).toBeCloseTo(target.b, 6);
}

describe('Indicate Manim parity', () => {
  it('follows there-and-back at raw alphas 0/.25/.5/.75/1', () => {
    const line = makeLine();
    line.setColor('#ffffff');
    const indicate = new Indicate(line);

    const cases = [
      { time: 0, scale: 1, progress: 0 },
      { time: 0.25, scale: 1.1, progress: 0.5 },
      { time: 0.5, scale: 1.2, progress: 1 },
      { time: 0.75, scale: 1.1, progress: 0.5 },
      { time: 1, scale: 1, progress: 0 },
    ];

    for (const { time, scale, progress } of cases) {
      indicate.update(0, time);
      expect(line.scaleVector.x).toBeCloseTo(scale, 8);
      const expected = new THREE.Color('#ffffff').lerp(new THREE.Color(YELLOW), progress);
      expectColor(line.color, '#' + expected.getHexString());
    }
  });

  it('scales about the geometric center rather than the local origin', () => {
    const line = makeLine(2, 6);
    line.position.set(3, -2, 0);
    const originalCenter = line.getCenter();
    const originalPosition = line.position.clone();
    const indicate = new Indicate(line, { scaleFactor: 1.5 });

    indicate.begin();
    indicate.interpolate(1);

    expect(line.getCenter()[0]).toBeCloseTo(originalCenter[0], 8);
    expect(line.getCenter()[1]).toBeCloseTo(originalCenter[1], 8);
    expect(line.position.equals(originalPosition)).toBe(false);

    indicate.finish();
    expect(line.position.equals(originalPosition)).toBe(true);
    expect(line.getCenter()[0]).toBeCloseTo(originalCenter[0], 8);
  });

  it('preserves each VGroup member’s fill/stroke channels and dim opacity', () => {
    const first = makeLine(0, 1).setFill('#17324d', 0.23).setStroke('#b5482b', 7, 0.31);
    const second = makeLine(2, 4).setFill('#286342', 0.47).setStroke('#315cc7', 3, 0.58);
    const group = new VGroup(first, new VGroup(second));
    const originals = [first, second].map((mobject) => ({
      color: mobject.color,
      fillColor: mobject.fillColor,
      strokeColor: mobject.strokeColor,
      fillOpacity: mobject.fillOpacity,
      strokeOpacity: mobject.opacity,
      strokeWidth: mobject.strokeWidth,
    }));
    const indicate = new Indicate(group, { color: '#f4d35e' });

    indicate.begin();
    indicate.interpolate(1);

    for (const [index, mobject] of [first, second].entries()) {
      expectColor(mobject.color, '#f4d35e');
      expectColor(mobject.fillColor, '#f4d35e');
      expectColor(mobject.strokeColor, '#f4d35e');
      expect(mobject.fillOpacity).toBe(originals[index].fillOpacity);
      expect(mobject.opacity).toBe(originals[index].strokeOpacity);
      expect(mobject.strokeWidth).toBe(originals[index].strokeWidth);
    }

    indicate.finish();
    for (const [index, mobject] of [first, second].entries()) {
      expect(mobject.color).toBe(originals[index].color);
      expect(mobject.fillColor).toBe(originals[index].fillColor);
      expect(mobject.strokeColor).toBe(originals[index].strokeColor);
      expect(mobject.fillOpacity).toBe(originals[index].fillOpacity);
      expect(mobject.opacity).toBe(originals[index].strokeOpacity);
      expect(mobject.strokeWidth).toBe(originals[index].strokeWidth);
    }
  });

  it('restores a dim, multipart MathTex family exactly', async () => {
    const tex = new MathTex({ latex: ['x', '+', 'y'], fontSize: 1 });
    await tex.waitForRender();
    tex.setFillOpacity(0.34);
    tex.setStrokeOpacity(0.18);
    tex.getPart(0).setColor('#e05a47');
    tex.getPart(1).setColor('#89b54a');
    tex.getPart(2).setColor('#4b78cf');

    const leaves = tex.getFamily().filter((mobject) => mobject.children.length === 0);
    const originals = leaves.map((mobject) => ({
      color: mobject.color,
      fillColor: mobject.fillColor,
      strokeColor: mobject.strokeColor,
      fillOpacity: mobject.fillOpacity,
      strokeOpacity: mobject.opacity,
      strokeWidth: mobject.strokeWidth,
    }));
    const indicate = new Indicate(tex);

    indicate.begin();
    indicate.interpolate(1);
    for (const [index, leaf] of leaves.entries()) {
      expectColor(leaf.fillColor, YELLOW);
      expectColor(leaf.strokeColor, YELLOW);
      expect(leaf.fillOpacity).toBe(originals[index].fillOpacity);
      expect(leaf.opacity).toBe(originals[index].strokeOpacity);
      expect(leaf.strokeWidth).toBe(originals[index].strokeWidth);
    }

    indicate.finish();
    for (const [index, leaf] of leaves.entries()) {
      expect(leaf.color).toBe(originals[index].color);
      expect(leaf.fillColor).toBe(originals[index].fillColor);
      expect(leaf.strokeColor).toBe(originals[index].strokeColor);
      expect(leaf.fillOpacity).toBe(originals[index].fillOpacity);
      expect(leaf.opacity).toBe(originals[index].strokeOpacity);
      expect(leaf.strokeWidth).toBe(originals[index].strokeWidth);
    }
  });

  it('is absolute under backward seeks and reset restores the exact start', () => {
    const line = makeLine(1, 5).setFill('#123456', 0.27).setStroke('#abcdef', 5, 0.41);
    line.position.set(4, 3, 0);
    line.scaleVector.set(1.5, 0.75, 1);
    const originalPosition = line.position.clone();
    const originalScale = line.scaleVector.clone();
    const originalStyle = line.style;
    const originalColor = line.color;
    const indicate = new Indicate(line, { color: '#ff8800', scaleFactor: 1.4 });

    indicate.begin();
    indicate.interpolate(0.8);
    indicate.interpolate(0.25);
    expect(line.scaleVector.x).toBeCloseTo(originalScale.x * 1.1, 8);

    indicate.reset();
    expect(line.position.equals(originalPosition)).toBe(true);
    expect(line.scaleVector.equals(originalScale)).toBe(true);
    expect(line.color).toBe(originalColor);
    expect(line.style).toEqual(originalStyle);
  });

  it('preserves a custom rate function endpoint until reset', () => {
    const line = makeLine(1, 5).setColor('#ffffff');
    line.position.set(2, -1, 0);
    const originalPosition = line.position.clone();
    const originalScale = line.scaleVector.clone();
    const indicate = new Indicate(line, {
      color: '#ff8800',
      scaleFactor: 1.4,
      duration: 1,
      rateFunc: () => 1,
    });

    // Animation.update() calls finish() on the terminal frame. That finish
    // must not snap a monotonic indication back to its pre-animation state.
    indicate.update(0, 0);
    indicate.update(0, 1);
    expect(line.scaleVector.x).toBeCloseTo(originalScale.x * 1.4, 8);
    expectColor(line.color, '#ff8800');
    expect(line.position.equals(originalPosition)).toBe(false);

    indicate.reset();
    expect(line.position.equals(originalPosition)).toBe(true);
    expect(line.scaleVector.equals(originalScale)).toBe(true);
    expectColor(line.color, '#ffffff');
  });
});
