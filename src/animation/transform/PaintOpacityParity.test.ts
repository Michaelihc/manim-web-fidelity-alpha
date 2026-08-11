// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import type { Mobject } from '../../core/Mobject';
import { Group } from '../../core/Group';
import { Scene } from '../../core/Scene';
import { VGroup } from '../../core/VGroup';
import { VMobject } from '../../core/VMobject';
import { Circle } from '../../mobjects/geometry/Circle';
import { Line } from '../../mobjects/geometry/Line';
import { MathTex } from '../../mobjects/text/MathTex';
import { Transform } from './Transform';
import { TransformMatchingShapes, TransformMatchingTex } from './TransformMatching';
import {
  TransformMatchingAbstractBase,
  type TransformMatchingBaseOptions,
} from './TransformMatchingBase';

function semanticPart(latex: string, ...children: VMobject[]): VGroup {
  const part = new VGroup(...children);
  (part as unknown as { getLatex(): string }).getLatex = () => latex;
  return part;
}

function ownPaint(mobject: Mobject): [number, number, number] {
  return [mobject.fillOpacity, mobject.opacity, mobject.strokeWidth];
}

class TestMatchingBase extends TransformMatchingAbstractBase {
  constructor(source: VMobject, target: VMobject, options: TransformMatchingBaseOptions = {}) {
    super(source, target, options);
  }

  protected _getSubmobjects(vmobject: VMobject): VMobject[] {
    return vmobject.children.filter((child) => child instanceof VMobject) as VMobject[];
  }

  protected _getKey(vmobject: VMobject): string {
    return vmobject.id;
  }
}

describe('filled VMobject transform paint-opacity parity', () => {
  it('cross-fades fallback Transform families and restores live Circle/Line constructor paint', () => {
    const source = new Circle({
      fillOpacity: 0.8,
      strokeWidth: 9,
      color: '#ff3355',
    });
    source.setStrokeOpacity(0.3);

    const targetLine = new Line({
      strokeWidth: 7,
      color: '#55ddff',
    });
    targetLine.setStrokeOpacity(0.6);
    const target = new Group(targetLine);
    const animation = new Transform(source, target);

    animation.begin();
    expect(ownPaint(source)).toEqual([0.8, 0.3, 9]);
    expect(ownPaint(targetLine)).toEqual([0, 0, 7]);

    animation.interpolate(0.5);
    expect(source.fillOpacity).toBeCloseTo(0.4);
    expect(source.opacity).toBeCloseTo(0.15);
    expect(targetLine.fillOpacity).toBe(0);
    expect(targetLine.opacity).toBeCloseTo(0.3);

    animation.finish();
    expect(source.fillOpacity).toBe(0);
    expect(source.opacity).toBe(0);
    expect(ownPaint(targetLine)).toEqual([0, 0.6, 7]);

    animation.reset();
    expect(ownPaint(source)).toEqual([0.8, 0.3, 9]);
    expect(source.fillColor).toBe('#ff3355');
    expect(source.strokeColor).toBe('#ff3355');
    expect(ownPaint(targetLine)).toEqual([0, 0.6, 7]);
    expect(targetLine.strokeColor).toBe('#55ddff');
  });

  it('fades unmatched TransformMatchingShapes fill and stroke channels independently', () => {
    const sourcePart = new Circle({ fillOpacity: 1, strokeWidth: 6 });
    sourcePart.setStrokeOpacity(0);
    const source = new VGroup(sourcePart);
    const sourceParent = new VGroup(source);

    const targetPart = new Circle({ fillOpacity: 0.7, strokeWidth: 3 });
    targetPart.setStrokeOpacity(0.2);
    const target = new VGroup(targetPart);
    const animation = new TransformMatchingShapes(source, target, {
      keyFunc: (part) => (part === sourcePart ? 'source' : 'target'),
      fadeRatio: 0.5,
    });

    animation.begin();
    const fadeInCopy = sourceParent.children.find((child) => child !== source) as VMobject;
    expect(fadeInCopy).toBeInstanceOf(VMobject);
    expect(ownPaint(fadeInCopy)).toEqual([0, 0, 3]);

    animation.interpolate(0.25);
    expect(ownPaint(sourcePart)).toEqual([0.5, 0, 6]);
    expect(ownPaint(fadeInCopy)).toEqual([0, 0, 3]);

    animation.interpolate(0.75);
    expect(ownPaint(sourcePart)).toEqual([0, 0, 6]);
    expect(fadeInCopy.fillOpacity).toBeCloseTo(0.35);
    expect(fadeInCopy.opacity).toBeCloseTo(0.1);

    animation.finish();
    expect(ownPaint(fadeInCopy)).toEqual([0.7, 0.2, 3]);

    animation.reset();
    expect(ownPaint(sourcePart)).toEqual([1, 0, 6]);
    expect(sourceParent.children).toEqual([source]);
  });

  it('keeps zero-ratio TransformMatchingShapes paint finite and applies the cut immediately', () => {
    const sourcePart = new Circle({ fillOpacity: 1 });
    sourcePart.setStrokeOpacity(0);
    const source = new VGroup(sourcePart);
    const parent = new VGroup(source);
    const targetPart = new Circle({ fillOpacity: 0.75 });
    targetPart.setStrokeOpacity(0);
    const target = new VGroup(targetPart);
    const animation = new TransformMatchingShapes(source, target, {
      keyFunc: (part) => (part === sourcePart ? 'source' : 'target'),
      fadeRatio: 0,
    });

    animation.begin();
    const fadeInCopy = parent.children.find((child) => child !== source) as VMobject;
    animation.interpolate(0);

    for (const value of [
      sourcePart.fillOpacity,
      sourcePart.opacity,
      fadeInCopy.fillOpacity,
      fadeInCopy.opacity,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(sourcePart.fillOpacity).toBe(0);
    expect(fadeInCopy.fillOpacity).toBeCloseTo(0.75);

    animation.reset();
  });

  it('renders top-level target-only shapes and cleans up to the exact target tree', () => {
    const sourcePart = new Circle({ fillOpacity: 1 });
    const source = new VGroup(sourcePart);
    const sourceChildCount = source.children.length;
    const targetPart = new Circle({ fillOpacity: 0.65 });
    targetPart.setStrokeOpacity(0);
    const target = new VGroup(targetPart);
    const animation = new TransformMatchingShapes(source, target, {
      keyFunc: (part) => (part === sourcePart ? 'source' : 'target'),
    });

    animation.begin();
    const temporaryCopies = source.children.slice(sourceChildCount);
    expect(temporaryCopies).toHaveLength(1);
    expect(temporaryCopies[0].parent).toBe(source);

    animation.interpolate(1);
    expect((temporaryCopies[0] as VMobject).fillOpacity).toBeCloseTo(0.65);
    animation.finish();

    const roots = new Set<Mobject>([source]);
    animation.cleanUpFromScene({
      add: (...mobjects) => mobjects.forEach((mobject) => roots.add(mobject)),
      remove: (...mobjects) => mobjects.forEach((mobject) => roots.delete(mobject)),
    });

    expect(roots).toEqual(new Set([target]));
    expect(source.children).toHaveLength(sourceChildCount);
    expect(temporaryCopies[0].parent).toBeNull();
    expect(target.children).toEqual([targetPart]);
    expect(targetPart.fillOpacity).toBeCloseTo(0.65);
  });

  it('interpolates matched TransformMatchingShapes fill/stroke paint and resets it', () => {
    const sourcePart = new Circle({ fillOpacity: 1, strokeWidth: 8 });
    sourcePart.setStrokeOpacity(0);
    const targetPart = new Circle({ fillOpacity: 0.2, strokeWidth: 2 });
    targetPart.setStrokeOpacity(0.6);
    const animation = new TransformMatchingShapes(new VGroup(sourcePart), new VGroup(targetPart), {
      keyFunc: () => 'same',
    });

    animation.begin();
    animation.interpolate(0.5);
    expect(sourcePart.fillOpacity).toBeCloseTo(0.6);
    expect(sourcePart.opacity).toBeCloseTo(0.3);

    animation.finish();
    expect(sourcePart.fillOpacity).toBeCloseTo(0.2);
    expect(sourcePart.opacity).toBeCloseTo(0.6);

    animation.reset();
    expect(ownPaint(sourcePart)).toEqual([1, 0, 8]);
  });

  it('keeps fill-only semantic families visible through mismatch cross-fades and reset', () => {
    const sourceLeaf = new Circle({ fillOpacity: 1, strokeWidth: 5 });
    sourceLeaf.setStrokeOpacity(0);
    const targetLeaf = new Circle({ fillOpacity: 0.6, strokeWidth: 4 });
    targetLeaf.setStrokeOpacity(0);
    const source = semanticPart('x', sourceLeaf);
    const target = semanticPart('y', targetLeaf);
    const animation = new TransformMatchingTex(source, target, {
      transformMismatches: true,
    });

    animation.begin();
    animation.interpolate(0.25);
    expect(sourceLeaf.fillOpacity).toBeGreaterThan(0);
    expect(sourceLeaf.fillOpacity).toBeLessThan(1);
    expect(sourceLeaf.opacity).toBe(0);

    animation.interpolate(0.5);
    expect(sourceLeaf.fillOpacity).toBe(0);
    expect(sourceLeaf.opacity).toBe(0);

    animation.interpolate(0.75);
    expect(sourceLeaf.fillOpacity).toBeGreaterThan(0);
    expect(sourceLeaf.opacity).toBe(0);

    animation.finish();
    expect(sourceLeaf.fillOpacity).toBeCloseTo(0.6);
    expect(sourceLeaf.opacity).toBe(0);

    animation.reset();
    expect(ownPaint(sourceLeaf)).toEqual([1, 0, 5]);
  });

  it('applies the same family paint semantics in TransformMatchingAbstractBase', () => {
    const sourcePart = new Circle({ fillOpacity: 0.9, strokeWidth: 5 });
    sourcePart.setStrokeOpacity(0);
    const source = new VGroup(sourcePart);
    const sourceParent = new VGroup(source);
    const targetPart = new Line({ strokeWidth: 7 });
    targetPart.setStrokeOpacity(0.8);
    const target = new VGroup(targetPart);
    const animation = new TestMatchingBase(source, target, {
      keyFunc: (part) => (part === sourcePart ? 'source' : 'target'),
      fadeRatio: 0.5,
    });

    animation.begin();
    const fadeInCopy = sourceParent.children.find((child) => child !== source) as VMobject;
    animation.interpolate(0.75);
    expect(sourcePart.fillOpacity).toBe(0);
    expect(fadeInCopy.opacity).toBeCloseTo(0.4);

    animation.finish();
    expect(ownPaint(fadeInCopy)).toEqual([0, 0.8, 7]);

    animation.reset();
    expect(ownPaint(sourcePart)).toEqual([0.9, 0, 5]);
    expect(sourceParent.children).toEqual([source]);
  });

  it('advertises lazy targets for every matching-transform implementation', () => {
    const shapesSource = new Circle();
    const shapesTarget = new Circle();
    const shapes = new TransformMatchingShapes(shapesSource, shapesTarget);

    const texSource = semanticPart('x', new Circle());
    const texTarget = semanticPart('x', new Circle());
    const tex = new TransformMatchingTex(texSource, texTarget);

    const baseSource = new VGroup(new Circle());
    const baseTarget = new VGroup(new Circle());
    const base = new TestMatchingBase(baseSource, baseTarget);

    expect(shapes.getAllMobjects()).toEqual([shapesSource, shapesTarget]);
    expect(tex.getAllMobjects()).toEqual([texSource, texTarget]);
    expect(base.getAllMobjects()).toEqual([baseSource, baseTarget]);
  });

  it('awaits a lazy matching target and cleans up to its exact scene identity', async () => {
    const scene = Scene.createHeadless();
    const source = new Circle();
    const target = Object.assign(new Circle(), {
      ready: false,
      async waitForRender() {
        await Promise.resolve();
        this.ready = true;
      },
    });
    const animation = new TransformMatchingShapes(source, target, { duration: 0.001 });

    await scene.play(animation);

    expect(target.ready).toBe(true);
    expect(scene.mobjects.has(source)).toBe(false);
    expect(scene.mobjects.has(target)).toBe(true);
    scene.dispose();
  });

  it('fades real fill-only MathTex glyphs instead of only their invisible strokes', async () => {
    const source = new MathTex({ latex: 'x' });
    const target = new MathTex({ latex: 'y' });
    await Promise.all([source.waitForRender(), target.waitForRender()]);
    source.setFillOpacity(1);
    source.setStrokeOpacity(0);
    target.setFillOpacity(1);
    target.setStrokeOpacity(0);

    const glyphs = source
      .getFamily()
      .filter(
        (mobject): mobject is VMobject =>
          mobject instanceof VMobject &&
          mobject.getLocalPoints().length > 0 &&
          mobject.fillOpacity > 0,
      );
    expect(glyphs.length).toBeGreaterThan(0);
    expect(glyphs.every((glyph) => glyph.opacity === 0)).toBe(true);
    const originalFills = glyphs.map((glyph) => glyph.fillOpacity);

    const animation = new TransformMatchingTex(source, target, { fadeRatio: 0.5 });
    animation.begin();
    animation.interpolate(0.25);
    expect(glyphs.every((glyph, index) => glyph.fillOpacity < originalFills[index])).toBe(true);
    expect(glyphs.some((glyph) => glyph.fillOpacity > 0)).toBe(true);

    animation.interpolate(0.5);
    expect(glyphs.every((glyph) => glyph.fillOpacity === 0)).toBe(true);

    animation.reset();
    expect(glyphs.map((glyph) => glyph.fillOpacity)).toEqual(originalFills);
    expect(glyphs.every((glyph) => glyph.opacity === 0)).toBe(true);
  }, 60_000);
});
