import { Write } from '../src/animation/creation/Create.ts';
import { type Mobject, type MobjectStyle } from '../src/core/Mobject.ts';
import { Scene } from '../src/core/Scene.ts';
import { VMobject } from '../src/core/VMobject.ts';
import { MathTex } from '../src/mobjects/text/MathTex.ts';
import { linear } from '../src/rate-functions/index.ts';

type FixtureStatus = 'loading' | 'ready' | 'error';
type FixtureLine = 'chain-rule' | 'statement';
type GlyphPhase = 'hidden' | 'drawing' | 'outline' | 'filling' | 'complete';

interface GlyphBaseline {
  mobject: VMobject;
  line: FixtureLine;
  points: number[][];
  color: string;
  fillOpacity: number;
  strokeOpacity: number;
  strokeWidth: number;
  style: MobjectStyle;
}

export interface WriteFidelityGlyphState {
  line: FixtureLine;
  index: number;
  pointCount: number;
  originalPointCount: number;
  fillOpacity: number;
  originalFillOpacity: number;
  strokeOpacity: number;
  originalStrokeOpacity: number;
  strokeWidth: number;
  originalStrokeWidth: number;
  geometryRestored: boolean;
  styleRestored: boolean;
  styleMismatches: readonly string[];
  phase: GlyphPhase;
}

export interface WriteFidelityState {
  status: FixtureStatus;
  ready: boolean;
  alpha: number;
  pointBearingFamilyCount: number;
  glyphs: WriteFidelityGlyphState[];
  geometryRestored: boolean;
  stylesRestored: boolean;
  errors: string[];
}

declare global {
  interface Window {
    __writeFidelity: WriteFidelityState;
  }
}

const errors: string[] = [];
const requestedAlpha = parseAlpha(new URLSearchParams(window.location.search).get('alpha'));

window.__writeFidelity = {
  status: 'loading',
  ready: false,
  alpha: requestedAlpha,
  pointBearingFamilyCount: 0,
  glyphs: [],
  geometryRestored: false,
  stylesRestored: false,
  errors,
};

window.addEventListener('error', (event) => {
  recordError(event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  recordError(event.reason);
});

function parseAlpha(value: string | null): number {
  if (value === null || value.trim() === '') return 1;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(0, Math.min(1, parsed));
}

function recordError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  errors.push(message);
  window.__writeFidelity.errors = [...errors];
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required page element "${id}"`);
  return element as T;
}

function pointBearingLeaves(root: Mobject): VMobject[] {
  return root
    .getFamily()
    .filter(
      (member): member is VMobject =>
        member instanceof VMobject &&
        member.children.length === 0 &&
        member.getLocalPoints().length >= 4,
    );
}

function captureBaselines(root: Mobject, line: FixtureLine): GlyphBaseline[] {
  return pointBearingLeaves(root).map((mobject) => ({
    mobject,
    line,
    points: mobject.getLocalPoints(),
    color: mobject.color,
    fillOpacity: mobject.fillOpacity,
    strokeOpacity: mobject.opacity,
    strokeWidth: mobject.strokeWidth,
    style: mobject.style,
  }));
}

function equalPoints(current: number[][], original: number[][]): boolean {
  if (current.length !== original.length) return false;
  for (let pointIndex = 0; pointIndex < current.length; pointIndex++) {
    if (current[pointIndex].length !== original[pointIndex].length) return false;
    for (let axis = 0; axis < current[pointIndex].length; axis++) {
      if (current[pointIndex][axis] !== original[pointIndex][axis]) return false;
    }
  }
  return true;
}

function equalStyle(current: MobjectStyle, original: MobjectStyle): boolean {
  return (
    current.fillColor === original.fillColor &&
    current.fillOpacity === original.fillOpacity &&
    current.strokeColor === original.strokeColor &&
    current.strokeOpacity === original.strokeOpacity &&
    current.strokeWidth === original.strokeWidth
  );
}

function classifyGlyph(
  baseline: GlyphBaseline,
  geometryRestored: boolean,
  styleRestored: boolean,
): GlyphPhase {
  const { mobject } = baseline;
  if (geometryRestored && styleRestored) return 'complete';
  if (geometryRestored && mobject.fillOpacity > 0) return 'filling';
  if (geometryRestored) return 'outline';

  const points = mobject.getLocalPoints();
  const collapsed =
    points.length <= 4 &&
    points.every(
      (point) =>
        point[0] === points[0]?.[0] && point[1] === points[0]?.[1] && point[2] === points[0]?.[2],
    );
  return collapsed ? 'hidden' : 'drawing';
}

function inspectGlyphs(baselines: GlyphBaseline[]): WriteFidelityGlyphState[] {
  return baselines.map((baseline, index) => {
    const { mobject } = baseline;
    const geometryRestored = equalPoints(mobject.getLocalPoints(), baseline.points);
    const styleMismatches: string[] = [];
    if (mobject.color !== baseline.color) styleMismatches.push('color');
    if (mobject.fillOpacity !== baseline.fillOpacity) styleMismatches.push('fillOpacity');
    if (mobject.opacity !== baseline.strokeOpacity) styleMismatches.push('strokeOpacity');
    if (mobject.strokeWidth !== baseline.strokeWidth) styleMismatches.push('strokeWidth');
    if (!equalStyle(mobject.style, baseline.style)) styleMismatches.push('style');
    const styleRestored = styleMismatches.length === 0;

    return {
      line: baseline.line,
      index,
      pointCount: mobject.getLocalPoints().length,
      originalPointCount: baseline.points.length,
      fillOpacity: mobject.fillOpacity,
      originalFillOpacity: baseline.fillOpacity,
      strokeOpacity: mobject.opacity,
      originalStrokeOpacity: baseline.strokeOpacity,
      strokeWidth: mobject.strokeWidth,
      originalStrokeWidth: baseline.strokeWidth,
      geometryRestored,
      styleRestored,
      styleMismatches,
      phase: classifyGlyph(baseline, geometryRestored, styleRestored),
    };
  });
}

async function boot(): Promise<void> {
  const stage = requiredElement<HTMLElement>('stage');
  const scene = new Scene(stage, {
    width: 1280,
    height: 720,
    frameWidth: 16,
    frameHeight: 9,
    backgroundColor: '#070a10',
    autoRender: false,
  });

  const chainRule = new MathTex({
    latex:
      '\\frac{\\partial L}{\\partial w} = ' +
      '\\frac{\\partial L}{\\partial z}\\,' +
      '\\frac{\\partial z}{\\partial y}\\,' +
      '\\frac{\\partial y}{\\partial w}',
    color: '#edf2f7',
    height: 1.45,
  });
  const statement = new MathTex({
    latex: '\\text{YOU KNOW THIS.}',
    color: '#55d6c2',
    height: 1.05,
  });

  await Promise.all([chainRule.waitForRender(), statement.waitForRender()]);

  chainRule.moveTo([0, 1.25, 0]);
  statement.moveTo([0, -1.35, 0]);
  scene.add(chainRule, statement);

  const baselines = [
    ...captureBaselines(chainRule, 'chain-rule'),
    ...captureBaselines(statement, 'statement'),
  ];
  if (baselines.length < 8) {
    throw new Error(`Expected vector glyph paths, received only ${baselines.length}`);
  }

  const chainRuleWrite = new Write(chainRule, { lagRatio: 0.075, rateFunc: linear });
  const statementWrite = new Write(statement, { lagRatio: 0.12, rateFunc: linear });
  chainRuleWrite.begin();
  statementWrite.begin();
  chainRuleWrite.interpolate(requestedAlpha);
  statementWrite.interpolate(requestedAlpha);
  scene.render();

  const glyphs = inspectGlyphs(baselines);
  window.__writeFidelity = {
    status: 'ready',
    ready: true,
    alpha: requestedAlpha,
    pointBearingFamilyCount: glyphs.length,
    glyphs,
    geometryRestored: glyphs.every((glyph) => glyph.geometryRestored),
    stylesRestored: glyphs.every((glyph) => glyph.styleRestored),
    errors: [...errors],
  };
  document.body.dataset.fixtureReady = 'true';
  document.body.dataset.alpha = String(requestedAlpha);
}

void boot().catch((error: unknown) => {
  recordError(error);
  window.__writeFidelity = {
    ...window.__writeFidelity,
    status: 'error',
    ready: false,
    errors: [...errors],
  };
  document.body.dataset.fixtureReady = 'error';
});
