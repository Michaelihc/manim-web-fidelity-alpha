import {
  Arrow,
  Axes,
  Circle,
  Create,
  Dot,
  Ellipse,
  FadeIn,
  FadeOut,
  GrowArrow,
  Indicate,
  LaggedStart,
  Line,
  MoveAlongPath,
  Polygon,
  Rectangle,
  RoundedRectangle,
  ShowPassingFlash,
  Transform,
  Underline,
  VGroup,
  VMobject,
  Write,
  addVec,
  easeInOutSine,
  type Animation,
  type MathTex,
  type Mobject,
  type Vector3Tuple,
} from '../../../src/index.ts';
import { assertNoCollisions, namedMobjectBounds } from '../layout';
import { SeededRng } from '../rng';
import { BEAT_DURATION, barBeats } from '../timing';
import { clearFrameSafe, createBackdrop, createStarfield } from './helpers';
import { defineEsapScene, type EsapSceneContext } from './types';

const FRAME = 1 / 60;
const UP_LEFT: Vector3Tuple = [-1, 1, 0];
const PAPER_PURPLE = '#7C3AED';

/**
 * The Python reference hard-cuts slide furniture on a frame boundary.
 *
 * Keeping the cut as a one-frame animation preserves replayable timeline
 * membership, while the step rate prevents a partially faded subset of a
 * heterogeneous VGroup from leaking into the boundary frame.
 */
function hardCutRate(alpha: number): number {
  return alpha < 1 ? 0 : 1;
}

/** Make the incoming section own its first output frame immediately. */
function instantCutRate(): number {
  return 1;
}

function laggedChildDuration(count: number, totalDuration: number, lagRatio: number): number {
  return totalDuration / (1 + Math.max(0, count - 1) * lagRatio);
}

function normal(rng: SeededRng): number {
  const first = Math.max(Number.EPSILON, rng.next());
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * rng.next());
}

function smoothPath(points: readonly Vector3Tuple[], color: string): VMobject {
  const path = new VMobject();
  path.setPointsSmoothly(points.map((point) => [...point]));
  path.setFill(undefined, 0);
  path.setStroke(color, 3.2, 1);
  return path;
}

class BreakdownStage {
  private readonly _context: EsapSceneContext;
  private readonly _starfield: VGroup;
  private _starfieldIntroduced = false;
  private _paper: Rectangle | null = null;
  private _paperIntroduced = false;
  private _active: Mobject[] = [];

  constructor(context: EsapSceneContext) {
    this._context = context;
    this._starfield = createStarfield(
      { rng: new SeededRng(41), palette: context.palette },
      { count: 55 },
    );
    this._starfield.setZIndex(-10);
  }

  useLightPalette(): void {
    this._context.formula.setMode('light');
    if (this._paper === null) {
      this._paper = createBackdrop(this._context.formula.palette);
      this._paper.setZIndex(-9);
    }
  }

  async beginBar(
    barNumber: number,
    chipCopy: string,
    chipColor: string,
    roots: readonly Mobject[],
    firstBeatAnimations: readonly Animation[],
  ): Promise<readonly number[]> {
    const beats = barBeats(barNumber);
    const chip = await this._context.formula.label(chipCopy, {
      uppercase: true,
      color: chipColor,
      fontSize: 28,
      maxWidth: 6.5,
    });
    chip.toCorner(UP_LEFT, 0.45, [14.22, 8]);

    const isInitialBar = !this._starfieldIntroduced;
    const transitions: Animation[] = this._active.map(
      (mobject) => new FadeOut(mobject, { duration: FRAME, rateFunc: hardCutRate }),
    );
    if (!this._starfieldIntroduced) {
      transitions.push(new FadeIn(this._starfield, { duration: FRAME, rateFunc: instantCutRate }));
      this._starfieldIntroduced = true;
    }
    if (this._paper !== null && !this._paperIntroduced) {
      transitions.push(new FadeIn(this._paper, { duration: FRAME, rateFunc: hardCutRate }));
      this._paperIntroduced = true;
    }
    transitions.push(
      new FadeIn(chip, {
        duration: FRAME,
        rateFunc: isInitialBar ? instantCutRate : hardCutRate,
      }),
    );

    await this._context.clock.hit(
      this._context.scene,
      beats[0],
      ...transitions,
      ...firstBeatAnimations,
    );
    this._active = [chip, ...roots];
    return beats;
  }

  async finish(): Promise<void> {
    const { scene, clock } = this._context;
    await clock.holdExact(scene, Math.max(0, clock.remaining - FRAME));
    await clearFrameSafe(
      this._context,
      [this._starfield, ...(this._paper ? [this._paper] : []), ...this._active],
      FRAME,
    );
  }
}

async function optimizerRace(stage: BreakdownStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = formula.palette;
  const center: Vector3Tuple = [-2.7, -0.3, 0];
  const rings = new VGroup(
    ...Array.from({ length: 4 }, (_unused, index) => {
      const ring = new Ellipse({
        width: 2.2 + index * 1.5,
        height: 1.15 + index * 0.85,
        color: palette.dim,
        strokeWidth: 1.4,
        center,
      });
      ring.setStroke(palette.dim, 1.4, 0.8 - index * 0.12);
      return ring;
    }),
  );
  const target = new Dot({
    point: center,
    color: palette.valid,
    radius: 0.08,
  });

  const start = addVec(center, [2.9, 1.55, 0]);
  const endpoint = addVec(center, [0.06, 0.05, 0]);
  const sgd = smoothPath(
    [
      start,
      addVec(start, [-0.7, -0.9, 0]),
      addVec(start, [-1.9, 0.15, 0]),
      addVec(start, [-2.2, -1.5, 0]),
      addVec(center, [0.7, 0.5, 0]),
      endpoint,
    ],
    palette.loss,
  );
  const momentum = smoothPath(
    [
      start,
      addVec(start, [-1.6, -0.4, 0]),
      addVec(center, [-1, -0.75, 0]),
      addVec(center, [-0.5, 0.4, 0]),
      endpoint,
    ],
    palette.parameter,
  );
  const adam = smoothPath(
    [start, addVec(start, [-1.2, -0.7, 0]), addVec(center, [0.6, -0.3, 0]), endpoint],
    palette.input,
  );

  const labels = await Promise.all([
    formula.caption('SGD — jitters', {
      color: palette.loss,
      fontSize: 25,
      position: [3.4, 1.95, 0],
    }),
    formula.caption('momentum — commits', {
      color: palette.parameter,
      fontSize: 25,
      position: [3.4, 1.45, 0],
    }),
    formula.caption('Adam — adapts per-axis', {
      color: palette.input,
      fontSize: 25,
      position: [3.4, 0.95, 0],
    }),
  ]);
  labels[1].alignTo(labels[0], [-1, 0, 0]);
  labels[2].alignTo(labels[0], [-1, 0, 0]);

  const [momentumEquation, momentsEquation, updateEquation] = await Promise.all([
    formula.math(String.raw`v_t=\beta v_{t-1}+g_t`, {
      color: palette.parameter,
      fontSize: 30,
      position: [3.1, -0.25, 0],
      maxWidth: 5.8,
    }),
    formula.math(
      String.raw`\hat m_t=\tfrac{m_t}{1-\beta_1^t},\ \ \hat v_t=\tfrac{v_t}{1-\beta_2^t}`,
      {
        color: palette.input,
        fontSize: 28,
        position: [3.1, -1.25, 0],
        maxWidth: 6.2,
      },
    ),
    formula.math(
      String.raw`\theta_t=\theta_{t-1}-\eta\,\frac{\hat m_t}{\sqrt{\hat v_t}+\epsilon}`,
      {
        color: palette.ink,
        fontSize: 30,
        position: [3.1, -2.35, 0],
        maxWidth: 6.2,
      },
    ),
  ]);

  const roots: Mobject[] = [
    rings,
    target,
    sgd,
    momentum,
    adam,
    ...labels,
    momentumEquation,
    momentsEquation,
    updateEquation,
  ];
  const beats30 = await stage.beginBar(30, 'optimizer race', palette.output, roots, [
    new Create(rings, { duration: 0.7 }),
    new FadeIn(target, { duration: 0.7 }),
  ]);
  await clock.hit(
    scene,
    beats30[1],
    new Create(sgd, { duration: 0.9 }),
    new FadeIn(labels[0], { duration: 0.9 }),
  );
  await clock.hit(
    scene,
    beats30[2],
    new Create(momentum, { duration: 0.9 }),
    new FadeIn(labels[1], { duration: 0.9 }),
  );
  await clock.hit(
    scene,
    beats30[3],
    new Create(adam, { duration: 0.9 }),
    new FadeIn(labels[2], { duration: 0.9 }),
  );

  const beats31 = barBeats(31);
  await clock.hit(scene, beats31[0], new Write(momentumEquation, { duration: 0.6 }));
  await clock.hit(scene, beats31[1], new Write(momentsEquation, { duration: 0.6 }));
  await clock.hit(scene, beats31[2], new Write(updateEquation, { duration: 0.7 }));
  await clock.hit(
    scene,
    beats31[3],
    new Indicate(updateEquation, {
      duration: 0.6,
      color: palette.parameter,
      scaleFactor: 1.05,
    }),
  );
}

interface SchedulePanel {
  readonly group: VGroup;
  readonly axes: Axes;
  readonly curve: VMobject;
  readonly label: MathTex;
}

async function schedulePanel(
  context: EsapSceneContext,
  fn: (time: number) => number,
  copy: string,
  color: string,
  center: Vector3Tuple,
  useSmoothing = true,
): Promise<SchedulePanel> {
  const axes = new Axes({
    xRange: [0, 12.2, 2],
    yRange: [0, 1.22, 0.2],
    xLength: 3.1,
    yLength: 1.7,
    color: context.formula.palette.dim,
    axisConfig: {
      strokeWidth: 1.2,
      includeTicks: false,
    },
  });
  axes.moveTo(center);
  const curve = axes.plot((time) => Math.min(fn(time), 1), {
    xRange: [0.01, 9.5],
    color,
    strokeWidth: 3,
    useSmoothing,
  });
  const label = await context.formula.caption(copy, {
    color,
    fontSize: 25,
    fitStage: false,
  });
  label.nextTo(axes, [0, -1, 0], 0.12);
  return {
    group: new VGroup(axes, curve, label),
    axes,
    curve,
    label,
  };
}

async function learningRateSchedules(
  stage: BreakdownStage,
  context: EsapSceneContext,
): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = formula.palette;
  const [step, polynomial, cosine, restarts] = await Promise.all([
    schedulePanel(
      context,
      (time) => 0.95 * Math.pow(0.55, Math.floor(time / 2.6)),
      'step decay',
      palette.input,
      [-3.6, 1.35, 0],
      false,
    ),
    schedulePanel(
      context,
      (time) => 0.95 * Math.pow(1 - time / 10, 2),
      'polynomial',
      palette.output,
      [3, 1.35, 0],
    ),
    schedulePanel(
      context,
      (time) => 0.08 + 0.435 * (1 + Math.cos((Math.PI * time) / 10)),
      'cosine',
      palette.parameter,
      [-3.6, -1.35, 0],
    ),
    schedulePanel(
      context,
      (time) =>
        0.08 +
        0.435 *
          (1 + Math.cos((Math.PI * (time % 3.4)) / 3.4)) *
          Math.pow(0.92, Math.floor(time / 3.4)),
      'warm restarts',
      palette.loss,
      [3, -1.35, 0],
      false,
    ),
  ]);

  const cosineFormula = await formula.math(
    String.raw`\eta_t=\eta_{\min}+\frac{1}{2}(\eta_0-\eta_{\min})\left[1+\cos\frac{\pi t}{T_{\max}}\right]`,
    {
      color: palette.ink,
      fontSize: 30,
      position: [0, -3, 0],
      maxWidth: 10.8,
      stageMargin: 0.5,
    },
  );
  const adamW = await formula.math(
    [
      String.raw`\text{AdamW: }\quad \theta_t=\theta_{t-1}-\eta\frac{\hat m_t}{\sqrt{\hat v_t}+\epsilon}`,
      String.raw`\;-\;\eta\lambda\theta_{t-1}`,
    ],
    {
      color: palette.ink,
      fontSize: 30,
      position: [0, -3, 0],
      maxWidth: 11.2,
      stageMargin: 0.5,
    },
  );
  adamW.getPart(1).setColor(palette.latent);

  const panels = [step, polynomial, cosine, restarts];
  const roots: Mobject[] = [...panels.map((panel) => panel.group), cosineFormula, adamW];
  const beats32 = await stage.beginBar(32, 'learning-rate schedules', palette.output, roots, [
    new FadeIn(step.axes, { duration: 0.7 }),
    new Create(step.curve, { duration: 0.7 }),
    new FadeIn(step.label, { duration: 0.7 }),
  ]);
  for (let index = 1; index < panels.length; index += 1) {
    const panel = panels[index];
    await clock.hit(
      scene,
      beats32[index],
      new FadeIn(panel.axes, { duration: 0.7 }),
      new Create(panel.curve, { duration: 0.7 }),
      new FadeIn(panel.label, { duration: 0.7 }),
    );
  }

  const beats33 = barBeats(33);
  await clock.hit(
    scene,
    beats33[0],
    new FadeIn(cosineFormula, { duration: 0.6, shift: [0, 0.15, 0] }),
  );
  await clock.hit(
    scene,
    beats33[2],
    new FadeOut(cosineFormula, { duration: 0.35, shift: [0, -0.2, 0] }),
  );
  await clock.hit(scene, beats33[3], new FadeIn(adamW, { duration: 0.5, shift: [0, 0.15, 0] }));
}

async function autoencoder(stage: BreakdownStage, context: EsapSceneContext): Promise<void> {
  stage.useLightPalette();
  const { scene, clock, formula } = context;
  const palette = formula.palette;

  const encoder = new Polygon({
    vertices: [
      [-4.6, 1.5, 0],
      [-4.6, -1.5, 0],
      [-1.7, -0.55, 0],
      [-1.7, 0.55, 0],
    ],
    color: palette.input,
    strokeWidth: 2.5,
    fillOpacity: 0.12,
  });
  encoder.setFill(palette.input, 0.12);
  const decoder = new Polygon({
    vertices: [
      [1.7, 0.55, 0],
      [1.7, -0.55, 0],
      [4.6, -1.5, 0],
      [4.6, 1.5, 0],
    ],
    color: palette.output,
    strokeWidth: 2.5,
    fillOpacity: 0.12,
  });
  decoder.setFill(palette.output, 0.12);
  const latentBox = new RoundedRectangle({
    width: 1.15,
    height: 0.8,
    cornerRadius: 0.12,
    color: PAPER_PURPLE,
  });
  const [latentLabel, encoderLabel, decoderLabel, loss, caption] = await Promise.all([
    formula.math('z', {
      color: PAPER_PURPLE,
      fontSize: 46,
      position: latentBox.getCenter(),
    }),
    formula.math(String.raw`z=f_\phi(x)`, {
      color: palette.input,
      fontSize: 33,
      position: [-3.15, 1.95, 0],
    }),
    formula.math(String.raw`\hat x=g_\theta(z)`, {
      color: palette.output,
      fontSize: 33,
      position: [3.15, 1.95, 0],
    }),
    formula.math(String.raw`L_{\mathrm{recon}}=\lVert x-\hat x\rVert_2^2`, {
      color: palette.loss,
      fontSize: 36,
      position: [0, -2.05, 0],
      maxWidth: 7.5,
    }),
    formula.math(String.raw`\text{no guarantee an arbitrary }z\text{ decodes to anything real}`, {
      color: palette.dim,
      fontSize: 28,
      position: [0, -3, 0],
      maxWidth: 10.6,
      stageMargin: 0.55,
    }),
  ]);

  const lattice: Vector3Tuple[] = Array.from({ length: 5 }, (_row, row) =>
    Array.from(
      { length: 5 },
      (_column, column) => [column * 0.28 - 0.56, row * 0.28 - 0.56, 0] as Vector3Tuple,
    ),
  ).flat();
  const inputCenter: Vector3Tuple = [-5.35, 0, 0];
  const outputCenter: Vector3Tuple = [5.35, 0, 0];
  const dots = lattice.map(
    (offset) =>
      new Dot({
        point: addVec(inputCenter, offset),
        radius: 0.055,
        color: palette.loss,
        fillOpacity: 0.9,
      }),
  );
  const pointCloud = new VGroup(...dots);
  const jitterRng = new SeededRng(21);
  const jitter = lattice.map(
    () => [normal(jitterRng) * 0.045, normal(jitterRng) * 0.045, 0] as Vector3Tuple,
  );

  const roots: Mobject[] = [
    encoder,
    decoder,
    latentBox,
    latentLabel,
    encoderLabel,
    decoderLabel,
    pointCloud,
    loss,
    caption,
  ];
  const beats34 = await stage.beginBar(34, 'autoencoder', palette.input, roots, [
    new Create(encoder, { duration: 0.7 }),
    new Write(encoderLabel, { duration: 0.7 }),
  ]);
  await clock.hit(
    scene,
    beats34[1],
    new Create(latentBox, { duration: 0.7 }),
    new Write(latentLabel, { duration: 0.7 }),
    new Create(decoder, { duration: 0.7 }),
    new Write(decoderLabel, { duration: 0.7 }),
  );
  const dotLag = 0.02;
  const dotFadeDuration = laggedChildDuration(dots.length, 0.5, dotLag);
  await clock.hit(
    scene,
    beats34[2],
    new LaggedStart(
      dots.map(
        (dot) =>
          new FadeIn(dot, {
            duration: dotFadeDuration,
            scale: 0.4,
          }),
      ),
      { lagRatio: dotLag },
    ),
  );

  const beats35 = barBeats(35);
  await clock.hit(
    scene,
    beats35[0],
    ...dots.map((dot, index) =>
      dot.animate
        .withDuration(0.85)
        .withRateFunc(easeInOutSine)
        .moveTo(
          addVec(latentBox.getCenter(), [0.06 * lattice[index][0], 0.06 * lattice[index][1], 0]),
        ),
    ),
  );
  await clock.hit(
    scene,
    beats35[1],
    ...dots.map((dot, index) =>
      dot.animate
        .withDuration(0.85)
        .withRateFunc(easeInOutSine)
        .moveTo(addVec(addVec(outputCenter, lattice[index]), jitter[index]))
        .setColor('#C4707A'),
    ),
  );
  await clock.hit(scene, beats35[2], new Write(loss, { duration: 0.6 }));
  await clock.hit(scene, beats35[3], new FadeIn(caption, { duration: 0.5, scale: 1.4 }));
}

async function variationalAutoencoder(
  stage: BreakdownStage,
  context: EsapSceneContext,
): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = formula.palette;

  const meanBox = new Rectangle({
    width: 2.5,
    height: 0.5,
    color: palette.input,
    strokeWidth: 2,
    fillOpacity: 0.2,
    center: [-3.7, 1.5, 0],
  });
  meanBox.setFill(palette.input, 0.2);
  const varianceBox = new Rectangle({
    width: 2.5,
    height: 0.5,
    color: palette.output,
    strokeWidth: 2,
    fillOpacity: 0.2,
    center: [-3.7, 0.55, 0],
  });
  varianceBox.setFill(palette.output, 0.2);
  const [meanLabel, varianceLabel, countCaption] = await Promise.all([
    formula.math(String.raw`\mu(x)`, {
      color: palette.input,
      fontSize: 32,
      position: meanBox.getCenter(),
    }),
    formula.math(String.raw`\log\sigma^2(x)`, {
      color: palette.output,
      fontSize: 32,
      position: varianceBox.getCenter(),
    }),
    formula.math(
      String.raw`\text{encoder emits }2d\text{ scalars — }d\text{ means}+d\text{ log-variances}`,
      {
        color: palette.dim,
        fontSize: 25,
        maxWidth: 6.6,
        fitStage: false,
      },
    ),
  ]);
  const meanGroup = new VGroup(meanBox, meanLabel);
  const varianceGroup = new VGroup(varianceBox, varianceLabel);
  countCaption.nextTo(varianceGroup, [0, -1, 0], 0.4);
  countCaption.alignTo(meanGroup, [-1, 0, 0]);

  const epsilonRng = new SeededRng(5);
  const epsilonDots = Array.from(
    { length: 26 },
    () =>
      new Dot({
        point: [2.6 + normal(epsilonRng) * 0.45, 1.3 + normal(epsilonRng) * 0.45, 0],
        radius: 0.045,
        color: PAPER_PURPLE,
        fillOpacity: 0.7,
      }),
  );
  const epsilonCloud = new VGroup(...epsilonDots);
  const epsilonLabel = await formula.math(String.raw`\epsilon\sim\mathcal N(0,I)`, {
    color: PAPER_PURPLE,
    fontSize: 33,
    fitStage: false,
  });
  epsilonLabel.nextTo(epsilonCloud, [0, 1, 0], 0.2);

  const zEquation = await formula.math(
    ['z', '=', String.raw`\mu`, '+', String.raw`\sigma`, String.raw`\odot`, String.raw`\epsilon`],
    {
      color: palette.ink,
      fontSize: 46,
      position: [0, -1.35, 0],
      maxWidth: 8.5,
    },
  );
  zEquation.getPart(2).setColor(palette.input);
  zEquation.getPart(4).setColor(palette.output);
  zEquation.getPart(6).setColor(PAPER_PURPLE);
  const gradientCaption = await formula.math(
    String.raw`\text{gradients flow through }\mu,\sigma\text{ — randomness isolated in }\epsilon`,
    {
      color: palette.loss,
      fontSize: 29,
      position: [0, -2.55, 0],
      maxWidth: 10.8,
      stageMargin: 0.55,
    },
  );

  const roots: Mobject[] = [
    meanGroup,
    varianceGroup,
    countCaption,
    epsilonCloud,
    epsilonLabel,
    zEquation,
    gradientCaption,
  ];
  const beats36 = await stage.beginBar(36, 'variational autoencoder', PAPER_PURPLE, roots, [
    new FadeIn(meanGroup, { duration: 0.6, shift: [0.2, 0, 0] }),
  ]);
  await clock.hit(
    scene,
    beats36[1],
    new FadeIn(varianceGroup, { duration: 0.6, shift: [0.2, 0, 0] }),
    new FadeIn(countCaption, { duration: 0.6 }),
  );
  const epsilonLag = 0.04;
  const epsilonFadeDuration = laggedChildDuration(epsilonDots.length, 0.8, epsilonLag);
  await clock.hit(
    scene,
    beats36[2],
    new LaggedStart(
      epsilonDots.map(
        (dot) =>
          new FadeIn(dot, {
            duration: epsilonFadeDuration,
            scale: 0.4,
          }),
      ),
      { lagRatio: epsilonLag },
    ),
    new Write(epsilonLabel, { duration: 0.8 }),
  );
  await clock.hit(scene, beats36[3], new Write(zEquation, { duration: 0.7 }));

  const beats37 = barBeats(37);
  await clock.hit(
    scene,
    beats37[0],
    new FadeIn(gradientCaption, { duration: 0.5, shift: [0, 0.15, 0] }),
  );
  const underline = new Underline(zEquation, {
    color: palette.loss,
    strokeWidth: 3,
  });
  await clock.hit(
    scene,
    beats37[2],
    new ShowPassingFlash(underline, {
      duration: 1.2,
      color: palette.loss,
      strokeWidth: 3,
      timeWidth: 0.7,
    }),
  );
}

async function evidenceLowerBound(stage: BreakdownStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = formula.palette;

  const [inequality, gap] = await Promise.all([
    formula.math(
      [
        String.raw`\log p_\theta(x)\;\ge\;`,
        String.raw`\underbrace{\mathbb E_{q_\phi(z\mid x)}[\log p_\theta(x\mid z)]}_{\text{reconstruction}}`,
        String.raw`-\;`,
        String.raw`\underbrace{D_{\mathrm{KL}}(q_\phi(z\mid x)\,\Vert\,p(z))}_{\text{stay near prior}}`,
      ],
      {
        color: palette.ink,
        fontSize: 35,
        position: [0, 1.35, 0],
        maxWidth: 12.3,
        stageMargin: 0.5,
      },
    ),
    formula.math(
      String.raw`\text{gap}=D_{\mathrm{KL}}(q_\phi\,\Vert\,p_\theta(z\mid x))\quad\text{— zero iff }q\text{ matches the true posterior}`,
      {
        color: palette.dim,
        fontSize: 25,
        maxWidth: 11.5,
        fitStage: false,
      },
    ),
  ]);
  const inequalityParts = [
    inequality.getPart(0),
    inequality.getPart(1),
    inequality.getPart(2),
    inequality.getPart(3),
  ] as const;
  inequalityParts[1].setColor(palette.input);
  inequalityParts[3].setColor(palette.loss);
  gap.nextTo(inequality, [0, -1, 0], 0.45);

  assertNoCollisions(
    [namedMobjectBounds('ELBO inequality', inequality), namedMobjectBounds('posterior gap', gap)],
    0.06,
  );

  const bubble = new Ellipse({
    width: 1.4,
    height: 0.9,
    color: palette.input,
    strokeWidth: 2.5,
    fillOpacity: 0.15,
    center: [-4.6, -1.75, 0],
  });
  bubble.setFill(palette.input, 0.15);
  const prior = new Circle({
    radius: 0.85,
    color: PAPER_PURPLE,
    strokeWidth: 2.2,
    center: [-0.9, -1.75, 0],
  });
  const [bubbleLabel, priorLabel, closedKl] = await Promise.all([
    formula.math(String.raw`q_\phi(z\mid x)`, {
      color: palette.input,
      fontSize: 28,
      fitStage: false,
    }),
    formula.math(String.raw`p(z)`, {
      color: PAPER_PURPLE,
      fontSize: 28,
      fitStage: false,
    }),
    formula.math(
      String.raw`D_{\mathrm{KL}}=-\frac{1}{2}\sum_j\left(1+\log\sigma_j^2-\mu_j^2-\sigma_j^2\right)`,
      {
        color: palette.ink,
        fontSize: 29,
        position: [3.4, -1.75, 0],
        maxWidth: 5.4,
        maxHeight: 1.05,
        stageMargin: 0.58,
      },
    ),
  ]);
  bubbleLabel.nextTo(bubble, [0, -1, 0], 0.18);
  priorLabel.nextTo(prior, [0, -1, 0], 0.18);
  const pull = new Arrow({
    start: bubble.getRight(),
    end: prior.getLeft(),
    color: palette.loss,
    buff: 0.15,
    strokeWidth: 3,
  });
  assertNoCollisions(
    [
      namedMobjectBounds('approximate posterior label', bubbleLabel),
      namedMobjectBounds('prior label', priorLabel),
      namedMobjectBounds('closed KL', closedKl),
    ],
    0.1,
  );

  const roots: Mobject[] = [
    ...inequalityParts,
    gap,
    bubble,
    bubbleLabel,
    prior,
    priorLabel,
    pull,
    closedKl,
  ];
  const beats38 = await stage.beginBar(38, 'evidence lower bound', PAPER_PURPLE, roots, [
    new Write(inequalityParts[0], { duration: 0.6 }),
  ]);
  await clock.hit(scene, beats38[1], new Write(inequalityParts[1], { duration: 0.7 }));
  await clock.hit(
    scene,
    beats38[2],
    new Write(inequalityParts[2], { duration: 0.7 }),
    new Write(inequalityParts[3], { duration: 0.7 }),
  );
  await clock.hit(scene, beats38[3], new FadeIn(gap, { duration: 0.5 }));

  const beats39 = barBeats(39);
  await clock.hit(
    scene,
    beats39[0],
    new Create(bubble, { duration: 0.6 }),
    new FadeIn(bubbleLabel, { duration: 0.6 }),
    new Create(prior, { duration: 0.6 }),
    new FadeIn(priorLabel, { duration: 0.6 }),
  );
  await clock.hit(
    scene,
    beats39[1],
    new GrowArrow(pull, { duration: 0.8 }),
    bubble.animate.withDuration(0.8).shift([1.1, 0, 0]),
  );
  await clock.hit(scene, beats39[2], new Write(closedKl, { duration: 0.7 }));
}

async function interpolationAndQuantization(
  stage: BreakdownStage,
  context: EsapSceneContext,
): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = formula.palette;

  const latentA = new Dot({
    point: [-4.4, 1.1, 0],
    color: palette.input,
    radius: 0.09,
  });
  const latentB = new Dot({
    point: [-0.4, 1.6, 0],
    color: palette.output,
    radius: 0.09,
  });
  const [labelA, labelB, interpolation] = await Promise.all([
    formula.math(String.raw`z_a`, {
      color: palette.input,
      fontSize: 31,
      position: [-4.4, 0.65, 0],
    }),
    formula.math(String.raw`z_b`, {
      color: palette.output,
      fontSize: 31,
      position: [-0.4, 1.15, 0],
    }),
    formula.math(String.raw`z(\lambda)=(1-\lambda)z_a+\lambda z_b`, {
      color: palette.ink,
      fontSize: 34,
      position: [-2.4, 2.35, 0],
      maxWidth: 6.3,
    }),
  ]);
  const segment = new Line({
    start: latentA.getCenter(),
    end: latentB.getCenter(),
    color: palette.dim,
    strokeWidth: 2,
  });
  const slider = new Dot({
    point: latentA.getCenter(),
    color: palette.loss,
    radius: 0.1,
  });

  const decodedShape = new Circle({
    radius: 0.62,
    color: palette.input,
    strokeWidth: 3,
    center: [3.4, 1.25, 0],
  });
  const decodedTarget = new RoundedRectangle({
    width: 1.3,
    height: 1.3,
    cornerRadius: 0.18,
    color: palette.output,
    strokeWidth: 3,
    center: decodedShape.getCenter(),
  });
  const decodeCaption = await formula.caption('decode along the path', {
    color: palette.dim,
    fontSize: 27,
    position: [3.4, 0.25, 0],
  });

  const latticeDots: Dot[] = [];
  for (let column = 0; column < 5; column += 1) {
    for (let row = 0; row < 3; row += 1) {
      latticeDots.push(
        new Dot({
          point: [-4.6 + column * 0.8, -2.75 + row * 0.75, 0],
          radius: 0.05,
          color: palette.dim,
        }),
      );
    }
  }
  const lattice = new VGroup(...latticeDots);
  const encoded = new Dot({
    point: [-3.15, -1.8, 0],
    color: palette.loss,
    radius: 0.09,
  });
  const nearest = new Dot({
    point: [-3, -2, 0],
    color: PAPER_PURPLE,
    radius: 0.09,
  });
  const snap = new Arrow({
    start: encoded.getCenter(),
    end: nearest.getCenter(),
    color: PAPER_PURPLE,
    buff: 0.05,
    strokeWidth: 3,
  });
  const [nearestEquation, commitmentLoss] = await Promise.all([
    formula.math(String.raw`k^*=\arg\min_j\lVert z_e-e_j\rVert^2`, {
      color: palette.ink,
      fontSize: 31,
      position: [3.15, -1.45, 0],
      maxWidth: 5.8,
    }),
    formula.math(
      String.raw`L=L_{\mathrm{recon}}+\lVert\operatorname{sg}[z_e]-e_{k^*}\rVert^2+\beta\lVert z_e-\operatorname{sg}[e_{k^*}]\rVert^2`,
      {
        color: palette.dim,
        fontSize: 25,
        position: [3.15, -2.75, 0],
        maxWidth: 6.4,
        maxHeight: 0.9,
        stageMargin: 0.58,
      },
    ),
  ]);
  assertNoCollisions(
    [
      namedMobjectBounds('nearest-code equation', nearestEquation),
      namedMobjectBounds('commitment loss', commitmentLoss),
    ],
    0.18,
  );

  const roots: Mobject[] = [
    latentA,
    latentB,
    labelA,
    labelB,
    segment,
    slider,
    interpolation,
    decodedShape,
    decodeCaption,
    lattice,
    encoded,
    nearest,
    snap,
    nearestEquation,
    commitmentLoss,
  ];
  const beats40 = await stage.beginBar(
    40,
    'latent interpolation · vector quantization',
    palette.input,
    roots,
    [
      new FadeIn(latentA, { duration: 0.7 }),
      new FadeIn(latentB, { duration: 0.7 }),
      new FadeIn(labelA, { duration: 0.7 }),
      new FadeIn(labelB, { duration: 0.7 }),
      new Create(segment, { duration: 0.7 }),
      new Write(interpolation, { duration: 0.7 }),
    ],
  );
  await clock.waitUntil(scene, beats40[1]);
  scene.add(slider, decodedShape);
  await clock.play(scene, new FadeIn(decodeCaption, { duration: 0.3 }));
  await clock.play(
    scene,
    new MoveAlongPath(slider, {
      path: segment,
      duration: 2 * BEAT_DURATION,
      rateFunc: easeInOutSine,
    }),
    new Transform(decodedShape, decodedTarget, {
      duration: 2 * BEAT_DURATION,
      rateFunc: easeInOutSine,
    }),
  );

  const beats41 = barBeats(41);
  await clock.hit(
    scene,
    beats41[0],
    new FadeIn(lattice, { duration: 0.55 }),
    new FadeIn(encoded, { duration: 0.55 }),
  );
  await clock.hit(
    scene,
    beats41[1],
    new GrowArrow(snap, { duration: 0.6 }),
    new FadeIn(nearest, { duration: 0.6 }),
    new Write(nearestEquation, { duration: 0.6 }),
  );
  await clock.hit(scene, beats41[2], new Write(commitmentLoss, { duration: 0.6 }));
  await clock.hit(
    scene,
    beats41[3],
    new Indicate(commitmentLoss, {
      duration: 0.6,
      color: PAPER_PURPLE,
      scaleFactor: 1.04,
    }),
  );
}

export const breakdownScene = defineEsapScene({
  id: 'breakdown',
  title: 'Probability and uncertainty',
  status: 'implemented',
  async build(context) {
    const stage = new BreakdownStage(context);
    await optimizerRace(stage, context);
    await learningRateSchedules(stage, context);
    await autoencoder(stage, context);
    await variationalAutoencoder(stage, context);
    await evidenceLowerBound(stage, context);
    await interpolationAndQuantization(stage, context);
    await stage.finish();
  },
});
