import { expect, test, type Page, type TestInfo } from '@playwright/test';

type FixtureStatus = 'loading' | 'ready' | 'error';
type GlyphPhase = 'hidden' | 'drawing' | 'outline' | 'filling' | 'complete';

interface GlyphState {
  pointCount: number;
  originalPointCount: number;
  fillOpacity: number;
  originalFillOpacity: number;
  strokeWidth: number;
  originalStrokeWidth: number;
  geometryRestored: boolean;
  styleRestored: boolean;
  styleMismatches: readonly string[];
  phase: GlyphPhase;
}

interface FixtureState {
  status: FixtureStatus;
  ready: boolean;
  alpha: number;
  pointBearingFamilyCount: number;
  glyphs: GlyphState[];
  geometryRestored: boolean;
  stylesRestored: boolean;
  errors: string[];
}

const ALPHAS = [0, 0.25, 0.5, 0.75, 1] as const;

async function loadFixture(
  page: Page,
  testInfo: TestInfo,
  alpha: (typeof ALPHAS)[number],
): Promise<FixtureState> {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await page.goto(`/examples/write_fidelity.html?alpha=${alpha}`);
  await page.waitForFunction(
    () => window.__writeFidelity?.status === 'ready' || window.__writeFidelity?.status === 'error',
    undefined,
    { timeout: 20_000 },
  );

  const state = await page.evaluate(() => window.__writeFidelity);
  await page.screenshot({
    path: testInfo.outputPath(`write-fidelity-alpha-${String(alpha).replace('.', '-')}.png`),
  });

  expect(runtimeErrors, `browser errors at alpha=${alpha}`).toEqual([]);
  expect(state.errors, `fixture errors at alpha=${alpha}`).toEqual([]);
  expect(state.status).toBe('ready');
  expect(state.ready).toBe(true);
  expect(state.alpha).toBe(alpha);
  expect(state.pointBearingFamilyCount).toBeGreaterThan(8);
  expect(state.glyphs).toHaveLength(state.pointBearingFamilyCount);
  return state;
}

test('Write exposes deterministic nonlinear MathTex reveal states', async ({ page }, testInfo) => {
  test.setTimeout(120_000);

  for (const alpha of ALPHAS) {
    const state = await loadFixture(page, testInfo, alpha);

    if (alpha > 0 && alpha < 1) {
      const phases = new Set(state.glyphs.map((glyph) => glyph.phase));
      expect(phases.size, `expected mixed glyph phases at alpha=${alpha}`).toBeGreaterThan(1);
      expect(
        state.glyphs.some(
          (glyph) =>
            glyph.pointCount !== glyph.originalPointCount ||
            glyph.fillOpacity !== glyph.originalFillOpacity,
        ),
      ).toBe(true);
      expect(state.glyphs.some((glyph) => glyph.geometryRestored)).toBe(true);
      expect(state.glyphs.some((glyph) => !glyph.geometryRestored)).toBe(true);
    }

    if (alpha === 1) {
      expect(state.geometryRestored).toBe(true);
      expect(state.glyphs.every((glyph) => glyph.geometryRestored)).toBe(true);
      expect(
        state.glyphs
          .map((glyph, index) => ({
            index,
            mismatches: glyph.styleMismatches,
            strokeWidth: glyph.strokeWidth,
            originalStrokeWidth: glyph.originalStrokeWidth,
          }))
          .filter(({ mismatches }) => mismatches.length > 0),
      ).toEqual([]);
      expect(state.stylesRestored).toBe(true);
      expect(state.glyphs.every((glyph) => glyph.styleRestored)).toBe(true);
      expect(state.glyphs.every((glyph) => glyph.pointCount === glyph.originalPointCount)).toBe(
        true,
      );
      expect(state.glyphs.every((glyph) => glyph.fillOpacity === glyph.originalFillOpacity)).toBe(
        true,
      );
    }
  }
});

declare global {
  interface Window {
    __writeFidelity: FixtureState;
  }
}
