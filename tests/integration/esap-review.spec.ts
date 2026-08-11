import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type {
  EsapReviewDiagnosticHook,
  EsapStageBoundsDiagnostics,
} from '../../examples/esap_review';

test.use({ baseURL: process.env.ESAP_BASE_URL ?? 'http://127.0.0.1:5173' });

interface Keyframe {
  readonly name: string;
  readonly time: number;
  readonly visual: 'content' | 'white-flash' | 'blackout';
}

const KEYFRAMES: readonly Keyframe[] = [
  { name: 'intro-write', time: 2.75, visual: 'content' },
  { name: 'verse-first-hard-cut', time: 5.294, visual: 'content' },
  { name: 'first-drop-flash', time: 40.464, visual: 'white-flash' },
  { name: 'qkv-head-slab-morph', time: 56.05, visual: 'content' },
  { name: 'attention-row-heat', time: 61.9, visual: 'content' },
  { name: 'attention-output-lane', time: 63.4, visual: 'content' },
  { name: 'elbo-kl', time: 115.35, visual: 'content' },
  { name: 'second-drop-flash', time: 134.122, visual: 'white-flash' },
  { name: 'generation-write', time: 134.45, visual: 'content' },
  { name: 'you-know-this-write', time: 199.62, visual: 'content' },
  { name: 'final-blackout', time: 202.2, visual: 'blackout' },
] as const;

interface DiagnosticSummary {
  readonly status: EsapReviewDiagnosticHook['status'];
  readonly ready: boolean;
  readonly error: string | null;
  readonly implementedCount: number;
  readonly moduleCount: number;
  readonly expectedFrameCount: number;
  readonly timelineFrameCount: number;
  readonly timelineDuration: number;
  readonly currentTime: number;
}

async function diagnosticSummary(page: Page): Promise<DiagnosticSummary> {
  return page.evaluate(() => {
    const diagnostic = window.__esapReview;
    return {
      status: diagnostic.status,
      ready: diagnostic.ready,
      error: diagnostic.error,
      implementedCount: diagnostic.implementedCount,
      moduleCount: diagnostic.moduleCount,
      expectedFrameCount: diagnostic.expectedFrameCount,
      timelineFrameCount: diagnostic.timelineFrameCount,
      timelineDuration: diagnostic.timelineDuration,
      currentTime: diagnostic.currentTime,
    };
  });
}

async function seekAndDiagnose(
  page: Page,
  testInfo: TestInfo,
  keyframe: Keyframe,
): Promise<EsapStageBoundsDiagnostics> {
  const result = await page.evaluate((time) => {
    const currentTime = window.__esapReview.seek(time);
    return {
      currentTime,
      bounds: window.__esapReview.stageBoundsDiagnostics,
    };
  }, keyframe.time);

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      }),
  );
  const centerPixel = await page.locator('#stage canvas').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new TypeError('ESAP stage drawable must be a canvas');
    }
    const sample = document.createElement('canvas');
    sample.width = 1;
    sample.height = 1;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create ESAP pixel-sampling context');
    context.drawImage(
      canvas,
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1,
      0,
      0,
      1,
      1,
    );
    return [...context.getImageData(0, 0, 1, 1).data] as [number, number, number, number];
  });
  const screenshot = await page.locator('#stage canvas').screenshot({
    path: testInfo.outputPath(`${keyframe.name}.png`),
  });

  expect(result.currentTime, `${keyframe.name} seek time`).toBeCloseTo(keyframe.time, 6);
  expect(screenshot.length, `${keyframe.name} screenshot bytes`).toBeGreaterThan(500);
  expect(result.bounds.errors, `${keyframe.name} bounds errors`).toEqual([]);
  expect(
    result.bounds.visibleTopLevelCount,
    `${keyframe.name} visible top-level mobjects`,
  ).toBeGreaterThan(0);
  if (keyframe.visual === 'content') {
    expect(
      result.bounds.applicableCount,
      `${keyframe.name} visible non-backdrop content`,
    ).toBeGreaterThan(0);
  } else {
    const [red, green, blue, alpha] = centerPixel;
    if (keyframe.visual === 'white-flash') {
      expect(Math.min(red, green, blue), `${keyframe.name} white impact flash`).toBeGreaterThan(
        245,
      );
      expect(alpha, `${keyframe.name} opaque impact flash`).toBe(255);
    } else {
      expect(Math.max(red, green, blue), `${keyframe.name} dark final frame`).toBeLessThan(20);
      expect(alpha, `${keyframe.name} opaque final frame`).toBe(255);
    }
  }

  const outside = result.bounds.items.filter((item) => item.applicable && !item.insideStage);
  expect(
    outside,
    `${keyframe.name} mobjects outside ${result.bounds.stage.width}×${result.bounds.stage.height} stage`,
  ).toEqual([]);
  expect(result.bounds.allApplicableInside, `${keyframe.name} stage containment`).toBe(true);

  expect(result.bounds.bottomSafeBand.pixelsAt1080p).toBe(96);
  expect(result.bounds.bottomSafeBand.worldHeight).toBeCloseTo((96 / 1080) * 8, 8);
  expect(result.bounds.bottomSafeBand.contentBottom).toBeCloseTo(-3.2888888889, 8);
  const belowBottomSafeBand = result.bounds.items.filter(
    (item) => item.applicable && !item.aboveBottomSafeBand,
  );
  expect(
    belowBottomSafeBand,
    `${keyframe.name} visible content below the ${result.bounds.bottomSafeBand.pixelsAt1080p}px bottom safe band`,
  ).toEqual([]);
  expect(result.bounds.allApplicableAboveBottomSafeBand, `${keyframe.name} bottom safe band`).toBe(
    true,
  );
  return result.bounds;
}

async function foregroundPixelCountAt(page: Page, time: number): Promise<number> {
  await page.evaluate((targetTime) => window.__esapReview.seek(targetTime), time);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      }),
  );

  return page.locator('#stage canvas').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new TypeError('ESAP stage drawable must be a canvas');
    }

    const sample = document.createElement('canvas');
    sample.width = 320;
    sample.height = 180;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create ESAP foreground-sampling context');
    context.drawImage(canvas, 0, 0, sample.width, sample.height);

    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    const cornerOffset = pixels.length - 4;
    const background = [
      pixels[cornerOffset],
      pixels[cornerOffset + 1],
      pixels[cornerOffset + 2],
    ] as const;
    let count = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const colorDistance =
        Math.abs(pixels[offset] - background[0]) +
        Math.abs(pixels[offset + 1] - background[1]) +
        Math.abs(pixels[offset + 2] - background[2]);
      if (colorDistance > 35) count += 1;
    }
    return count;
  });
}

test('ESAP records and seeks the complete frame-exact visual timeline', async ({
  page,
}, testInfo) => {
  // Cold MathJax vectorization plus the mandatory first reverse-order rebuild
  // is intentionally expensive. Keep every visual assertion; give the ten
  // deterministic checkpoints enough wall-clock budget to complete in CI and
  // on software-rendered local Chromium.
  test.setTimeout(1_500_000);
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await page.setViewportSize({ width: 1440, height: 1100 });
  const response = await page.goto('/examples/esap_review.html', {
    waitUntil: 'commit',
    timeout: 30_000,
  });
  expect(response).not.toBeNull();
  expect(response!.status()).toBeLessThan(400);

  await page.waitForFunction(
    () => window.__esapReview?.status === 'ready' || window.__esapReview?.status === 'error',
    undefined,
    { timeout: 420_000 },
  );

  const summary = await diagnosticSummary(page);
  expect(summary.error).toBeNull();
  expect(summary.status).toBe('ready');
  expect(summary.ready).toBe(true);
  expect(summary.moduleCount).toBe(8);
  expect(summary.implementedCount).toBe(8);
  expect(summary.expectedFrameCount).toBe(12_201);
  expect(summary.timelineFrameCount).toBe(12_201);
  expect(summary.timelineDuration).toBeCloseTo(203.35, 6);
  expect(summary.currentTime).toBe(0);

  for (const keyframe of KEYFRAMES) {
    await seekAndDiagnose(page, testInfo, keyframe);
  }

  // Frame 5234 is DROP ONE's final owned frame; frame 5235 is BREAKDOWN's
  // first. Both must contain visible content, with no black handoff frame.
  const breakdownStartFrame = 5_235;
  const outgoingBreakdownPixels = await foregroundPixelCountAt(
    page,
    (breakdownStartFrame - 1) / 60,
  );
  const incomingBreakdownPixels = await foregroundPixelCountAt(page, breakdownStartFrame / 60);
  expect(outgoingBreakdownPixels, 'DROP ONE final frame retained content').toBeGreaterThan(100);
  expect(incomingBreakdownPixels, 'BREAKDOWN first frame introduced content').toBeGreaterThan(25);

  // BREAKDOWN's frame-long membership animations are hard cuts: the outgoing
  // slide must remain fully visible on the cue frame instead of half-fading.
  for (const boundary of [98.952, 104.815, 110.666]) {
    const previousFramePixels = await foregroundPixelCountAt(page, boundary - 1 / 60);
    const cueFramePixels = await foregroundPixelCountAt(page, boundary);
    expect(cueFramePixels, `BREAKDOWN ${boundary}s cut retained foreground`).toBeGreaterThanOrEqual(
      previousFramePixels * 0.9,
    );
    expect(
      cueFramePixels,
      `BREAKDOWN ${boundary}s cut did not double foreground`,
    ).toBeLessThanOrEqual(previousFramePixels * 1.1);
  }

  const exportFrameDiagnostics = await page.evaluate(() => {
    const frameZeroTime = window.__esapReview.renderFrame(0);
    const frameOneTime = window.__esapReview.renderFrame(1);
    let nonSequentialError: string | null = null;
    try {
      window.__esapReview.renderFrame(3);
    } catch (error) {
      nonSequentialError = error instanceof Error ? error.message : String(error);
    }

    // Ordinary random-access seek remains available and resets the monotonic
    // export cursor so a fresh frame pass can start at zero.
    const seekTime = window.__esapReview.seek(2.75);
    const restartedFrameZeroTime = window.__esapReview.renderFrame(0);
    return {
      frameZeroTime,
      frameOneTime,
      nonSequentialError,
      seekTime,
      restartedFrameZeroTime,
    };
  });
  expect(exportFrameDiagnostics.frameZeroTime).toBe(0);
  expect(exportFrameDiagnostics.frameOneTime).toBeCloseTo(1 / 60, 8);
  expect(exportFrameDiagnostics.nonSequentialError).toContain('expected 2, received 3');
  expect(exportFrameDiagnostics.seekTime).toBeCloseTo(2.75, 8);
  expect(exportFrameDiagnostics.restartedFrameZeroTime).toBe(0);

  expect(browserErrors, 'page and console errors').toEqual([]);
});
