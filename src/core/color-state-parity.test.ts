// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { Arrow } from '../mobjects/geometry/Arrow';
import { MathTex } from '../mobjects/text/MathTex';
import { VMobject } from './VMobject';
import { deserializeMobject, serializeMobject } from './StateManager';

const ORIGINAL_COLOR = '#23a6d5';
const ORIGINAL_FILL = '#9b5de5';
const MUTATED_COLOR = '#ff006e';

function expectArrowPaintRestored(arrow: Arrow): void {
  expect(arrow.color).toBe(ORIGINAL_COLOR);
  expect(arrow.strokeColor).toBe(ORIGINAL_COLOR);
  expect(arrow.fillColor).toBe(ORIGINAL_FILL);
  expect(arrow.style.strokeColor).toBe(ORIGINAL_COLOR);
  expect(arrow.style.fillColor).toBe(ORIGINAL_FILL);
}

describe('constructor color state parity', () => {
  it('canonicalizes Arrow paint in both serializable and Mobject.saveState snapshots', () => {
    const arrow = new Arrow({
      start: [-1, 0, 0],
      end: [1, 0, 0],
      color: ORIGINAL_COLOR,
    });
    arrow.setFill(ORIGINAL_FILL, 0.35);

    const serialized = serializeMobject(arrow);
    expect(serialized.color).toBe(ORIGINAL_COLOR);
    expect(serialized.style.strokeColor).toBe(ORIGINAL_COLOR);
    expect(serialized.style.fillColor).toBe(ORIGINAL_FILL);

    arrow.saveState();
    arrow.setColor(MUTATED_COLOR);
    expect(arrow.restoreState()).toBe(true);
    expectArrowPaintRestored(arrow);

    arrow.setColor(MUTATED_COLOR);
    deserializeMobject(arrow, serialized);
    expectArrowPaintRestored(arrow);
  });

  it('round-trips a rendered custom-colored MathTex without reverting its root to white', async () => {
    const math = new MathTex({
      latex: 'x^2',
      color: ORIGINAL_COLOR,
    });

    try {
      await math.waitForRender();
      const serialized = serializeMobject(math);

      expect(serialized.color).toBe(ORIGINAL_COLOR);
      expect(serialized.style.strokeColor).toBe(ORIGINAL_COLOR);
      expect(serialized.style.fillColor).toBe(ORIGINAL_COLOR);

      math.setColor(MUTATED_COLOR);
      deserializeMobject(math, serialized);

      expect(math.color).toBe(ORIGINAL_COLOR);
      expect(math.style.strokeColor).toBe(ORIGINAL_COLOR);
      expect(math.style.fillColor).toBe(ORIGINAL_COLOR);

      const glyphs = math
        .getFamily()
        .filter(
          (member): member is VMobject =>
            member instanceof VMobject &&
            member.children.length === 0 &&
            member.getLocalPoints().length > 0,
        );
      expect(glyphs.length).toBeGreaterThan(0);
      expect(glyphs.every((glyph) => glyph.color === ORIGINAL_COLOR)).toBe(true);
    } finally {
      math.dispose();
    }
  });
});
