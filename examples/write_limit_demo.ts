import { Write } from '../src/animation/creation/Create.ts';
import { Scene } from '../src/core/Scene.ts';
import { MathTex } from '../src/mobjects/text/MathTex.ts';
import { linear } from '../src/rate-functions/index.ts';

declare global {
  interface Window {
    __writeLimitReady?: boolean;
  }
}

async function boot(): Promise<void> {
  const stage = document.getElementById('stage');
  if (!stage) throw new Error('Missing stage');

  const alphaValue = Number(new URLSearchParams(window.location.search).get('alpha') ?? '0');
  const alpha = Math.max(0, Math.min(1, Number.isFinite(alphaValue) ? alphaValue : 0));
  const scene = new Scene(stage, {
    width: 960,
    height: 540,
    frameWidth: 16,
    frameHeight: 9,
    backgroundColor: '#070a10',
    autoRender: false,
  });
  const formula = new MathTex({
    latex:
      '\\frac{\\partial L}{\\partial w}=\\frac{\\partial L}{\\partial z}\\frac{\\partial z}{\\partial y}\\frac{\\partial y}{\\partial w}',
    color: '#edf2f7',
    height: 1.65,
  });
  const label = new MathTex({
    latex: '\\text{WRITE EACH GLYPH}',
    color: '#55d6c2',
    height: 0.72,
  });
  await Promise.all([formula.waitForRender(), label.waitForRender()]);
  formula.moveTo([0, 0.65, 0]);
  label.moveTo([0, -1.4, 0]);
  scene.add(formula, label);

  const formulaWrite = new Write(formula, { lagRatio: 0.075, rateFunc: linear });
  const labelWrite = new Write(label, { lagRatio: 0.11, rateFunc: linear });
  formulaWrite.begin();
  labelWrite.begin();
  formulaWrite.interpolate(alpha);
  labelWrite.interpolate(alpha);
  scene.render();
  window.__writeLimitReady = true;
  document.body.dataset.ready = 'true';
}

void boot();
