// @vitest-environment happy-dom

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Mobject } from '../../core/Mobject';
import { Group } from '../../core/Group';
import { VGroup } from '../../core/VGroup';
import { Circle } from '../../mobjects/geometry/Circle';
import { Line } from '../../mobjects/geometry/Line';
import { Uncreate, Write } from '../creation/Create';
import { ShowIncreasingSubsets, ShowSubmobjectsOneByOne } from '../creation/CreationExtensions';
import { Blink } from '../indication/Blink';
import { Broadcast, Remove } from '../utility';
import { FadeTransform, FadeTransformPieces } from './FadeTransforms';
import { ClockwiseTransform, CounterclockwiseTransform } from './MovementTransforms';
import { FadeToColor, TransformAnimations } from './SpecialTransforms';

function style(
  mobject: Mobject,
  fillColor: string,
  fillOpacity: number,
  strokeColor: string,
  strokeOpacity: number,
  strokeWidth: number,
): void {
  mobject.setFill(fillColor, fillOpacity);
  mobject.setStroke(strokeColor, strokeWidth, strokeOpacity);
}

function paint(mobject: Mobject): {
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
} {
  return {
    fillColor: mobject.fillColor ?? mobject.color,
    fillOpacity: mobject.fillOpacity,
    strokeColor: mobject.strokeColor ?? mobject.color,
    strokeOpacity: mobject.opacity,
    strokeWidth: mobject.strokeWidth,
  };
}

function expectColorClose(actual: string | undefined, expected: string): void {
  const actualColor = new THREE.Color(actual ?? '#000000');
  const expectedColor = new THREE.Color(expected);
  expect(actualColor.r).toBeCloseTo(expectedColor.r, 5);
  expect(actualColor.g).toBeCloseTo(expectedColor.g, 5);
  expect(actualColor.b).toBeCloseTo(expectedColor.b, 5);
}

describe('compatibility animation family paint parity', () => {
  it('cross-fades independent paint in FadeTransform and restores stale constructor styles', () => {
    const source = new Circle({ fillOpacity: 0.8, strokeWidth: 9 });
    style(source, '#ff2244', 0.8, '#22ff44', 0.2, 9);
    const target = new Circle({ fillOpacity: 0.4, strokeWidth: 3 });
    style(target, '#2244ff', 0.4, '#ffaa22', 0.6, 3);
    const original = paint(source);
    const animation = new FadeTransform(source, target);

    animation.begin();
    animation.interpolate(0.25);
    expect(source.fillOpacity).toBeCloseTo(0.4);
    expect(source.opacity).toBeCloseTo(0.1);

    animation.interpolate(0.75);
    expect(source.fillOpacity).toBeCloseTo(0.2);
    expect(source.opacity).toBeCloseTo(0.3);
    expectColorClose(source.fillColor, '#2244ff');
    expectColorClose(source.strokeColor, '#ffaa22');
    expect(source.strokeWidth).toBe(3);

    animation.finish();
    expect(paint(source)).toEqual(paint(target));
    animation.reset();
    expect(paint(source)).toEqual(original);
  });

  it('applies the same paint cross-fade independently to FadeTransformPieces families', () => {
    const sourcePart = new Circle({ fillOpacity: 1, strokeWidth: 8 });
    style(sourcePart, '#ff0000', 1, '#00ff00', 0, 8);
    const targetPart = new Circle({ fillOpacity: 0.6, strokeWidth: 2 });
    style(targetPart, '#0000ff', 0.6, '#ffff00', 0.4, 2);
    const source = new VGroup(sourcePart);
    const target = new VGroup(targetPart);
    const animation = new FadeTransformPieces(source, target);

    animation.begin();
    animation.interpolate(0.75);
    expect(sourcePart.fillOpacity).toBeCloseTo(0.3);
    expect(sourcePart.opacity).toBeCloseTo(0.2);
    expectColorClose(sourcePart.fillColor, '#0000ff');

    animation.finish();
    expect(paint(sourcePart)).toEqual(paint(targetPart));
    animation.reset();
    expect(sourcePart.fillOpacity).toBe(1);
    expect(sourcePart.opacity).toBe(0);
    expect(sourcePart.strokeWidth).toBe(8);
  });

  it.each([
    ['clockwise', ClockwiseTransform],
    ['counterclockwise', CounterclockwiseTransform],
  ] as const)(
    '%s movement transform interpolates full paint and resets it',
    (_name, AnimationType) => {
      const source = new Circle({ fillOpacity: 1, strokeWidth: 8 });
      style(source, '#ff0000', 1, '#00ff00', 0, 8);
      const target = new Circle({ fillOpacity: 0.2, strokeWidth: 2 });
      style(target, '#0000ff', 0.2, '#ffff00', 0.6, 2);
      const original = paint(source);
      const animation = new AnimationType(source, target);

      animation.begin();
      animation.interpolate(0.5);
      expect(source.fillOpacity).toBeCloseTo(0.6);
      expect(source.opacity).toBeCloseTo(0.3);
      expect(source.strokeWidth).toBeCloseTo(5);

      animation.finish();
      const finalPaint = paint(source);
      const targetPaint = paint(target);
      expectColorClose(finalPaint.fillColor, targetPaint.fillColor);
      expectColorClose(finalPaint.strokeColor, targetPaint.strokeColor);
      expect(finalPaint.fillOpacity).toBeCloseTo(targetPaint.fillOpacity);
      expect(finalPaint.strokeOpacity).toBeCloseTo(targetPaint.strokeOpacity);
      expect(finalPaint.strokeWidth).toBeCloseTo(targetPaint.strokeWidth);
      animation.reset();
      expect(paint(source)).toEqual(original);
    },
  );

  it('FadeToColor colors fill and stroke families independently without changing opacity', () => {
    const child = new Circle({ fillOpacity: 0.7, strokeWidth: 6 });
    style(child, '#ff0000', 0.7, '#00ff00', 0.3, 6);
    const group = new VGroup(child);
    const original = paint(child);
    const animation = new FadeToColor(group, { color: '#3355ff' });

    animation.begin();
    animation.interpolate(1);
    expectColorClose(child.fillColor, '#3355ff');
    expectColorClose(child.strokeColor, '#3355ff');
    expect(child.fillOpacity).toBe(0.7);
    expect(child.opacity).toBe(0.3);

    animation.reset();
    expect(paint(child)).toEqual(original);
  });

  it('TransformAnimations blends and restores both paint color channels', () => {
    const circle = new Circle({ fillOpacity: 0.8, strokeWidth: 7 });
    style(circle, '#ff0000', 0.8, '#00ff00', 0.25, 7);
    const original = paint(circle);
    const first = new FadeToColor(circle, { color: '#ffff00' });
    const second = new FadeToColor(circle, { color: '#0000ff' });
    const animation = new TransformAnimations(first, second);

    animation.begin();
    animation.interpolate(0.5);
    expect(circle.fillColor).not.toBe(original.fillColor);
    expect(circle.strokeColor).not.toBe(original.strokeColor);
    expect(circle.fillOpacity).toBeCloseTo(0.8);
    expect(circle.opacity).toBeCloseTo(0.25);

    animation.finish();
    expectColorClose(circle.fillColor, '#0000ff');
    expectColorClose(circle.strokeColor, '#0000ff');

    animation.reset();
    expect(paint(circle)).toEqual(original);
  });

  it('Remove hides and resets the entire independently styled family', () => {
    const fill = new Circle({ fillOpacity: 0.9, strokeWidth: 5 });
    style(fill, '#cc2244', 0.9, '#22cc44', 0, 5);
    const line = new Line({ strokeWidth: 7 });
    line.setStrokeOpacity(0.6);
    const group = new Group(fill, line);
    const animation = new Remove(group);

    animation.begin();
    expect(fill.fillOpacity).toBe(0);
    expect(fill.opacity).toBe(0);
    expect(line.opacity).toBe(0);

    animation.reset();
    expect(fill.fillOpacity).toBeCloseTo(0.9);
    expect(fill.opacity).toBe(0);
    expect(line.opacity).toBeCloseTo(0.6);
    expect(fill.strokeWidth).toBe(5);
    expect(line.strokeWidth).toBe(7);
  });

  it('Broadcast scales each copy’s original fill/stroke paint rather than only its stroke', () => {
    const source = new Circle({ fillOpacity: 0.8, strokeWidth: 5 });
    source.setStrokeOpacity(0.4);
    const animation = new Broadcast(source, {
      nMobs: 1,
      initialOpacity: 0.5,
      finalOpacity: 0.25,
    });

    animation.begin();
    const copies = (animation as unknown as { _copies: Circle[] })._copies;
    expect(copies).toHaveLength(1);
    expect(copies[0].fillOpacity).toBeCloseTo(0.4);
    expect(copies[0].opacity).toBeCloseTo(0.2);

    animation.interpolate(1);
    expect(copies[0].fillOpacity).toBeCloseTo(0.2);
    expect(copies[0].opacity).toBeCloseTo(0.1);

    animation.reset();
    expect((animation as unknown as { _copies: Circle[] })._copies).toHaveLength(0);
  });

  it('Blink modulates family paint as a factor and restores independent values', () => {
    const circle = new Circle({ fillOpacity: 0.8, strokeWidth: 6 });
    circle.setStrokeOpacity(0.4);
    const animation = new Blink(circle, {
      nBlinks: 1,
      minOpacity: 0.2,
      blinkDuration: 0.2,
    });

    animation.begin();
    animation.interpolate(0.4);
    expect(circle.fillOpacity).toBeCloseTo(0.16);
    expect(circle.opacity).toBeCloseTo(0.08);

    animation.finish();
    expect(circle.fillOpacity).toBeCloseTo(0.8);
    expect(circle.opacity).toBeCloseTo(0.4);

    animation.reset();
    expect(circle.fillOpacity).toBeCloseTo(0.8);
    expect(circle.opacity).toBeCloseTo(0.4);
  });

  it('subset revealers preserve fill-only and stroke-only child paint', () => {
    const first = new Circle({ fillOpacity: 0.8, strokeWidth: 5 });
    first.setStrokeOpacity(0);
    const second = new Line({ strokeWidth: 7 });
    second.setStrokeOpacity(0.6);
    const group = new VGroup(first, second);
    const increasing = new ShowIncreasingSubsets(group);

    increasing.begin();
    increasing.interpolate(0.25);
    expect(first.fillOpacity).toBeCloseTo(0.4);
    expect(first.opacity).toBe(0);
    expect(second.opacity).toBe(0);
    increasing.finish();
    expect(first.fillOpacity).toBeCloseTo(0.8);
    expect(second.opacity).toBeCloseTo(0.6);

    increasing.reset();
    const oneAtATime = new ShowSubmobjectsOneByOne(group);
    oneAtATime.begin();
    oneAtATime.interpolate(0.25);
    expect(first.fillOpacity).toBeCloseTo(0.8);
    expect(second.opacity).toBe(0);
    oneAtATime.interpolate(0.75);
    expect(first.fillOpacity).toBe(0);
    expect(second.opacity).toBeCloseTo(0.6);
    oneAtATime.reset();
    expect(first.fillOpacity).toBeCloseTo(0.8);
    expect(second.opacity).toBeCloseTo(0.6);
  });

  it('only changes full paint in legacy Uncreate/Write fallbacks, not contour paths', () => {
    const fallbackChild = new Circle({ fillOpacity: 0.8, strokeWidth: 5 });
    fallbackChild.setStrokeOpacity(0.2);
    const fallback = new Group(fallbackChild);
    const uncreate = new Uncreate(fallback);

    uncreate.begin();
    uncreate.interpolate(0.5);
    expect(fallbackChild.fillOpacity).toBeCloseTo(0.4);
    expect(fallbackChild.opacity).toBeCloseTo(0.1);
    uncreate.finish();
    expect(fallbackChild.fillOpacity).toBe(0);
    uncreate.reset();
    expect(fallbackChild.fillOpacity).toBeCloseTo(0.8);

    const contour = new Circle({ fillOpacity: 0.75 });
    contour.getThreeObject();
    const contourUncreate = new Uncreate(contour);
    contourUncreate.begin();
    contourUncreate.interpolate(0.5);
    expect(contour.fillOpacity).toBeCloseTo(0.75);

    const fallbackWrite = new Group();
    style(fallbackWrite, '#ff0000', 0.7, '#00ff00', 0.3, 9);
    const write = new Write(fallbackWrite, { remover: true });
    write.begin();
    expect(fallbackWrite.fillOpacity).toBe(0);
    write.interpolate(0.5);
    expect(fallbackWrite.fillOpacity).toBeCloseTo(0.35);
    expect(fallbackWrite.opacity).toBeCloseTo(0.15);
    write.finish();
    expect(fallbackWrite.fillOpacity).toBe(0);
    write.reset();
    expect(fallbackWrite.fillOpacity).toBeCloseTo(0.7);
    expect(fallbackWrite.opacity).toBeCloseTo(0.3);
    expect(fallbackWrite.strokeWidth).toBe(9);
  });
});
