// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { VGroup } from '../../core/VGroup';
import { MathTex } from './MathTex';

function familyPointCount(math: MathTex): number {
  return math
    .getFamily()
    .filter((member) => member !== math && 'getLocalPoints' in member)
    .reduce(
      (sum, member) =>
        sum +
        (
          member as unknown as {
            getLocalPoints(): number[][];
          }
        ).getLocalPoints().length,
      0,
    );
}

describe('MathTex copy parity', () => {
  it('keeps a rendered copy single-populated after its constructor render settles', async () => {
    const original = new MathTex({ latex: String.raw`\text{MACHINE LEARNING}` });
    await original.waitForRender();
    const originalChildren = original.children.length;
    const originalPoints = familyPointCount(original);
    expect(originalChildren).toBeGreaterThan(0);
    expect(originalPoints).toBeGreaterThan(0);

    const renderer = await import('./MathJaxRenderer');
    const renderSpy = vi.spyOn(renderer, 'renderLatexToSVG');
    renderSpy.mockClear();

    const copy = original.copy();
    expect(copy.children).toHaveLength(originalChildren);
    expect(familyPointCount(copy)).toBe(originalPoints);
    expect(renderSpy).not.toHaveBeenCalled();

    // A rendered copy is ready immediately from its frozen vector family; it
    // must neither invoke MathJax nor append another glyph family later.
    await copy.waitForRender();
    expect(renderSpy).not.toHaveBeenCalled();
    expect(copy.children).toHaveLength(originalChildren);
    expect(familyPointCount(copy)).toBe(originalPoints);
    renderSpy.mockRestore();
  });

  it('rebuilds multipart part references from frozen copied children', async () => {
    const original = new MathTex({ latex: ['Q', '+', 'K'] });
    await original.waitForRender();

    const copy = original.copy();
    await copy.waitForRender();

    expect(copy.getPartCount()).toBe(original.getPartCount());
    for (let index = 0; index < copy.getPartCount(); index++) {
      expect(copy.getPart(index)).toBe(copy.children[index]);
      expect(copy.getPart(index)).not.toBe(original.getPart(index));
      expect(
        (
          copy.getPart(index) as VGroup & {
            getLatex(): string;
          }
        ).getLatex(),
      ).toBe(
        (
          original.getPart(index) as VGroup & {
            getLatex(): string;
          }
        ).getLatex(),
      );
    }
  });
});
