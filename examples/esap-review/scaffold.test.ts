import { describe, expect, it } from 'vitest';
import { assertVisibleCopy, escapeLatexText, lintVisibleCopy } from './copy';
import { assertFormulaRenderBounds } from './formula';
import { boundsInside, boundsOverlap, findCollisions, stageBounds } from './layout';
import { assertFormulaSource } from './formula-source';
import { SeededRng } from './rng';
import {
  ESAP_FPS,
  SECTION_IDS,
  SECTIONS,
  TRACK_DURATION,
  bar,
  frameAlignedSectionCue,
  framesToSeconds,
  quantizeDuration,
  secondsToFrames,
  sectionTiming,
  SectionClock,
} from './timing';

describe('ESAP frame timing', () => {
  // MIGRATION: example for the property that every source section is converted
  // to the same independent frame span used by the reference assembly script.
  it('preserves the eight authoritative 60 fps section spans', () => {
    expect(SECTIONS.map((section) => section.id)).toEqual(SECTION_IDS);
    expect(SECTIONS.map((section) => section.frameCount)).toEqual([
      318, 1406, 701, 2810, 2107, 702, 2810, 1347,
    ]);
    expect(SECTIONS.reduce((total, section) => total + section.frameCount, 0)).toBe(12201);
    expect(SECTIONS[SECTIONS.length - 1].end).toBe(TRACK_DURATION);
    expect(bar(14)).toBe(40.414);
  });

  it('round-trips frame durations without introducing sub-frame drift', () => {
    expect(ESAP_FPS).toBe(60);
    expect(secondsToFrames(5.294)).toBe(318);
    expect(framesToSeconds(318)).toBe(5.3);
    expect(quantizeDuration(0.35)).toBe(0.35);
    expect(quantizeDuration(0)).toBe(0);
  });

  it('aligns the BUILD ONE derivative cascade to assembled reference frame 2074', () => {
    const section = sectionTiming('build-1');
    const cue = frameAlignedSectionCue(section, bar(12));
    const precedingFrames = SECTIONS.slice(0, SECTION_IDS.indexOf('build-1')).reduce(
      (total, candidate) => total + candidate.frameCount,
      0,
    );

    expect(secondsToFrames(cue - section.start)).toBe(350);
    expect(precedingFrames + secondsToFrames(cue - section.start)).toBe(2074);
  });

  it('rejects a scene module that overruns its authoritative frame span', async () => {
    const clock = new SectionClock('intro');
    const scene = {
      play: async () => undefined,
      wait: async () => undefined,
    };

    await expect(clock.hold(scene, clock.section.frameDuration + 1 / ESAP_FPS)).rejects.toThrow(
      /past its .* frame span/,
    );
  });

  it('fills a sub-frame residue exactly instead of rounding past the section boundary', async () => {
    const clock = new SectionClock('intro');
    const waits: number[] = [];
    const scene = {
      play: async () => undefined,
      wait: async (duration = 1) => {
        waits.push(duration);
      },
    };

    await clock.play(scene, { duration: clock.section.frameDuration - 0.004 } as never);
    await clock.finish(scene);

    expect(clock.elapsed).toBeCloseTo(clock.section.frameDuration, 10);
    expect(waits.at(-1)).toBeGreaterThan(0);
    expect(waits.at(-1)).toBeLessThan(1 / ESAP_FPS);
  });

  it('reserves one exact cleanup frame after an off-frame staggered group', async () => {
    const clock = new SectionClock('intro');
    const scene = {
      play: async () => undefined,
      wait: async () => undefined,
    };
    const cleanupFrame = 1 / ESAP_FPS;

    await clock.play(scene, {
      duration: clock.section.frameDuration - cleanupFrame - 0.00267,
    } as never);
    await clock.holdExact(scene, clock.remaining - cleanupFrame);
    await clock.play(scene, { duration: cleanupFrame } as never);

    expect(clock.remaining).toBe(0);
    expect(clock.elapsed).toBeCloseTo(clock.section.frameDuration, 10);
  });
});

describe('SeededRng', () => {
  // MIGRATION: example for the property that equal seeds yield equal finite
  // streams and named streams do not depend on ambient Math.random state.
  it('replays the same sequence for the same named seed', () => {
    const first = new SeededRng('starfield:drop-one');
    const second = new SeededRng('starfield:drop-one');
    const firstValues = Array.from({ length: 8 }, () => first.next());
    const secondValues = Array.from({ length: 8 }, () => second.next());

    expect(firstValues).toEqual(secondValues);
    expect(firstValues.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new SeededRng('starfield:drop-two').next()).not.toBe(firstValues[0]);
  });
});

describe('visible-copy and formula lint', () => {
  it('accepts LaTeX commands while rejecting visible slash division glyphs', () => {
    const fraction = String.raw`\frac{\partial \mathcal{L}}{\partial w}`;
    expect(() => assertVisibleCopy(fraction)).not.toThrow();
    expect(() => assertFormulaSource(fraction)).not.toThrow();
    expect(lintVisibleCopy(['a', 'b'].join('/'))).toHaveLength(1);
    expect(() => assertVisibleCopy('a ÷ b')).toThrow(/forbidden visible division glyph/);
  });

  it('escapes prose for a MathJax text command', () => {
    expect(escapeLatexText('loss & gain_1')).toBe(String.raw`loss \& gain\_1`);
  });

  it('never nests unsupported text commands inside sans-serif prose spans', async () => {
    const modules = import.meta.glob('./scenes/*.ts', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Readonly<Record<string, string>>;

    for (const [path, source] of Object.entries(modules)) {
      expect(source, path).not.toContain(String.raw`\textsf{\text{`);
      expect(source, path).not.toContain(String.raw`\text{\textsf{`);
    }
  });

  it('rejects empty MathJax geometry and keeps the adaptation prefix parse-safe', async () => {
    const adaptation = String.raw`p(x_{1:T}\mid c)=\prod_t p(x_t\mid c,x_{\lt t})`;
    expect(() => assertFormulaRenderBounds(0, 0, adaptation)).toThrow(/non-zero bounds/);
    expect(() => assertFormulaRenderBounds(4.886, 0.799, adaptation)).not.toThrow();

    const outroSource = (await import('./scenes/outro.ts?raw')).default;
    expect(outroSource).toContain(String.raw`x_{\lt t}`);
    expect(outroSource).not.toContain(String.raw`x_{<t}`);
  });
});

describe('layout collision guards', () => {
  const left = { name: 'left', left: -2, right: 0, bottom: -1, top: 1 };
  const touching = { name: 'touching', left: 0, right: 2, bottom: -1, top: 1 };
  const overlap = { name: 'overlap', left: -0.2, right: 1, bottom: -0.5, top: 0.5 };

  // MIGRATION: example for the property that pair detection is symmetric and
  // only reports boxes whose padded extents intersect on both axes.
  it('distinguishes edge contact, requested clearance, and overlap', () => {
    expect(boundsOverlap(left, touching)).toBe(false);
    expect(boundsOverlap(left, touching, 0.1)).toBe(true);
    expect(findCollisions([left, touching])).toEqual([]);
    expect(findCollisions([left, overlap]).map(({ first, second }) => [first, second])).toEqual([
      ['left', 'overlap'],
    ]);
  });

  it('defines a centered safe stage', () => {
    const safe = stageBounds(0.5);
    expect(boundsInside({ left: -1, right: 1, bottom: -1, top: 1 }, safe)).toBe(true);
    expect(boundsInside({ left: -8, right: 1, bottom: -1, top: 1 }, safe)).toBe(false);
  });
});
