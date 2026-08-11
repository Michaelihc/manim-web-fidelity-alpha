import {
  Animation,
  Arrow,
  Axes,
  Circle,
  Create,
  CurvedArrow,
  Dot,
  FadeIn,
  FadeOut,
  GrowArrow,
  Line,
  Mobject,
  Rectangle,
  RoundedRectangle,
  Square,
  Transform,
  VGroup,
  Write,
  easeInOutSine,
  easeOutQuad,
  type MathTex,
  type Vector3Tuple,
} from '../../../src/index.ts';
import { type NamedBounds, assertNoCollisions, namedMobjectBounds } from '../layout';
import { type EsapPalette, type PaletteMode } from '../palette';
import { SeededRng } from '../rng';
import {
  BEAT_DURATION,
  DROPS,
  bar,
  barBeats,
  beatsIn,
  frameAlignedSectionCue,
  quantizeDuration,
} from '../timing';
import { clearFrameSafe, createBackdrop, createStarfield, titleChip } from './helpers';
import { defineEsapScene, type EsapSceneContext } from './types';

const FRAME = 1 / 60;
const STAGE_SIZE: [number, number] = [14.22, 8];
const CHIP_CORNER: Vector3Tuple = [-1, 1, 0];
const BOTTOM_CAPTION_Y = -3;

// NumPy default_rng(19), matching the authored Manim scene exactly. The ESAP
// SeededRng intentionally uses a different generator, which changed both the
// cloud and the six points selected for the Pareto frontier.
const REFERENCE_PARETO_POINTS: readonly (readonly [number, number])[] = [
  [0.4331181884125792, 0.8577302496460312],
  [0.310050789834557, 0.1304408274629224],
  [0.3408565049830141, 0.6832756166125447],
  [0.7360110886852739, 0.5325078623068581],
  [0.3417989509720093, 0.8497337726868857],
  [0.8595834296765122, 0.4466776195931752],
  [0.4241417860289934, 0.5951259896954423],
  [0.6794349749420948, 0.6008989911157641],
  [0.4436881385615545, 0.4511943934539824],
  [0.6226358952903402, 0.851005582648553],
  [0.1202837305059383, 0.1553006899972296],
  [0.719696210952811, 0.4661457769063624],
  [0.7328087199953525, 0.5330901471480212],
  [0.4679640923778831, 0.8815068078193279],
  [0.3894371513882151, 0.6234922233843766],
  [0.5365197134084265, 0.1732490420318838],
  [0.2207851399635381, 0.7664391699199884],
  [0.5190690023685032, 0.6502717549625848],
  [0.4613065557995452, 0.7938296509276372],
  [0.7956935157647064, 0.4416367630330392],
  [0.1884938004491497, 0.7779586143904824],
  [0.4991861454334863, 0.5475904594866592],
  [0.5069484442323295, 0.1109696784247654],
  [0.5107657190880664, 0.1605539099464875],
  [0.1327109090650303, 0.7750598636015299],
  [0.1996308822186824, 0.6860712520574499],
];

interface BarScene {
  readonly chip: MathTex;
  readonly roots: readonly Mobject[];
  readonly firstAnimations: readonly Animation[];
}

class DropTwoStage {
  private readonly _context: EsapSceneContext;
  private readonly _starfield: VGroup;
  private _paper: Rectangle | null = null;
  private _active: Mobject[] = [];

  constructor(context: EsapSceneContext) {
    this._context = context;
    this._starfield = createStarfield(
      { rng: new SeededRng(61), palette: context.palette },
      { count: 65 },
    );
    this._starfield.setZIndex(-10);
  }

  usePalette(mode: PaletteMode): EsapPalette {
    this._context.formula.setMode(mode);
    return this._context.formula.palette;
  }

  setActive(...mobjects: Mobject[]): void {
    this._active = [...mobjects];
  }

  addActive(...mobjects: Mobject[]): void {
    this._active.push(...mobjects);
  }

  async secondDropFlash(title: MathTex, paperPalette: EsapPalette): Promise<void> {
    const { scene, clock } = this._context;
    const flash = filledRectangle(15.6, 9.6, '#FFFFFF', 1, [0, 0, 0], 0);
    flash.setZIndex(60);

    await clock.hit(
      scene,
      DROPS['drop 2'],
      new FadeIn(this._starfield, { duration: FRAME, rateFunc: () => 1 }),
      new FadeIn(flash, { duration: FRAME, rateFunc: () => 1 }),
    );
    // The cut-in frame is already the first visible white frame, while the
    // cut-out segment lands on paper. Keep five additional white frames so the
    // encoded slam spans the reference's exact six frames.
    await clock.hold(scene, 0.1 - FRAME);

    const paper = createBackdrop(paperPalette);
    paper.setZIndex(-9);
    this._paper = paper;
    await clock.play(
      scene,
      new FadeOut(flash, { duration: FRAME, rateFunc: () => 1 }),
      new FadeIn(paper, { duration: FRAME, rateFunc: () => 1 }),
      // Write now slices each MathTex contour and staggers glyph families.
      new Write(title, { duration: 0.6, lagRatio: 0.08 }),
    );
    this.setActive(title);
  }

  async beginBar(
    barNumber: number,
    mode: PaletteMode,
    sceneDefinition: BarScene,
  ): Promise<readonly number[]> {
    const { scene, clock, formula } = this._context;
    formula.setMode(mode);
    const palette = formula.palette;
    const beats = barBeats(barNumber);
    const transitions: Animation[] = this._active.map(
      (mobject) => new FadeOut(mobject, { duration: FRAME, rateFunc: () => 1 }),
    );

    if (mode === 'light' && this._paper === null) {
      this._paper = createBackdrop(palette);
      this._paper.setZIndex(-9);
      transitions.push(new FadeIn(this._paper, { duration: FRAME, rateFunc: () => 1 }));
    } else if (mode === 'dark' && this._paper !== null) {
      transitions.push(new FadeOut(this._paper, { duration: FRAME, rateFunc: () => 1 }));
      this._paper = null;
    }

    sceneDefinition.chip.toCorner(CHIP_CORNER, 0.45, STAGE_SIZE);
    transitions.push(
      new FadeIn(sceneDefinition.chip, { duration: FRAME, rateFunc: () => 1 }),
      ...sceneDefinition.firstAnimations,
    );
    await clock.hit(scene, frameAlignedSectionCue(this._context.timing, beats[0]), ...transitions);
    this._active = [sceneDefinition.chip, ...sceneDefinition.roots];
    return beats;
  }

  async finish(): Promise<void> {
    const { scene, clock } = this._context;
    await clock.holdExact(scene, Math.max(0, clock.remaining - FRAME));
    const finalRoots = [this._starfield, ...this._active, ...(this._paper ? [this._paper] : [])];
    await clearFrameSafe(this._context, finalRoots, FRAME);
  }
}

function filledRectangle(
  width: number,
  height: number,
  color: string,
  opacity: number,
  center: Vector3Tuple,
  strokeWidth = 1.5,
): Rectangle {
  const rectangle = new Rectangle({
    width,
    height,
    color,
    fillOpacity: opacity,
    strokeWidth,
    center,
  });
  rectangle.setFill(color, opacity);
  return rectangle;
}

function filledSquare(
  sideLength: number,
  color: string,
  opacity: number,
  center: Vector3Tuple,
  strokeWidth = 1.8,
): Square {
  const square = new Square({
    sideLength,
    color,
    fillOpacity: opacity,
    strokeWidth,
    center,
  });
  square.setFill(color, opacity);
  return square;
}

function interpolatePoint(start: Vector3Tuple, end: Vector3Tuple, alpha: number): Vector3Tuple {
  return [
    start[0] + (end[0] - start[0]) * alpha,
    start[1] + (end[1] - start[1]) * alpha,
    start[2] + (end[2] - start[2]) * alpha,
  ];
}

function interpolateHex(start: string, end: string, alpha: number): string {
  const startValue = Number.parseInt(start.slice(1), 16);
  const endValue = Number.parseInt(end.slice(1), 16);
  const channels = [16, 8, 0].map((shift) =>
    Math.round(
      ((startValue >> shift) & 0xff) +
        (((endValue >> shift) & 0xff) - ((startValue >> shift) & 0xff)) * alpha,
    ),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function assertTextRows(name: string, rows: readonly Mobject[], minimumGap = 0.08): void {
  const bounds: NamedBounds[] = rows.map((row, index) =>
    namedMobjectBounds(`${name} ${index + 1}`, row),
  );
  assertNoCollisions(bounds, minimumGap);
}

async function reverseSampling(stage: DropTwoStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = stage.usePalette('light');
  const title = await formula.title('GENERATION', {
    color: palette.ink,
    fontSize: 118,
    maxWidth: 10.8,
  });

  await stage.secondDropFlash(title, palette);

  const titleTarget = title.copy();
  titleTarget.scale(0.36);
  titleTarget.toCorner(CHIP_CORNER, 0.45, STAGE_SIZE);
  const bar46Beats = barBeats(46);
  await clock.hit(scene, bar46Beats[1], new Transform(title, titleTarget, { duration: 0.45 }));

  const pointCount = 90;
  const rng = new SeededRng(29);
  const noisyPoints: Vector3Tuple[] = Array.from({ length: pointCount }, () => [
    rng.range(-5.75, -1.45),
    rng.range(-1.8, 1.35),
    0,
  ]);
  const cleanPoints: Vector3Tuple[] = Array.from({ length: pointCount }, (_unused, index) => {
    const spiralTime = 0.35 + ((2.6 * Math.PI * 2) / 3 + 1.85) * (index / (pointCount - 1));
    return [
      0.16 * spiralTime * Math.cos(1.9 * spiralTime) - 3.55,
      0.16 * spiralTime * Math.sin(1.9 * spiralTime) - 0.2,
      0,
    ];
  });
  const cloud = new VGroup(
    ...noisyPoints.map((point) => {
      const dot = new Dot({
        point,
        radius: 0.05,
        color: palette.latent,
        fillOpacity: 0.65,
        strokeWidth: 0,
      });
      dot.setFill(palette.latent, 0.65);
      return dot;
    }),
  );

  const reverseEquation = await formula.math(
    String.raw`p_\theta(x_{t-1}\mid x_t)=\mathcal N\!\left(\mu_\theta(x_t,t),\,\Sigma_\theta(x_t,t)\right)`,
    {
      color: palette.ink,
      fontSize: 31,
      position: [3.25, 1.7, 0],
      maxWidth: 5.65,
    },
  );
  const order = await formula.math(String.raw`t:\;T,\,T-1,\,\ldots,\,1,\,0`, {
    color: palette.parameter,
    fontSize: 35,
    position: [3.25, 0.65, 0],
    maxWidth: 5.2,
  });
  const tickLabel = await formula.math('t=', {
    color: palette.parameter,
    fontSize: 35,
    position: [2.85, -0.55, 0],
  });
  const denoiseBeats = beatsIn(clock.now + 0.55, bar(48));
  const tick = await formula.math('7', {
    color: palette.parameter,
    fontSize: 45,
    position: [3.55, -0.55, 0],
  });
  const finalCaption = await formula.math(
    String.raw`\text{final step: no added noise}\ \to\ \text{clean }x_0`,
    {
      color: palette.output,
      fontSize: 28,
      position: [3.25, -2.15, 0],
      maxWidth: 5.55,
    },
  );
  assertTextRows('reverse sampling right column', [
    reverseEquation,
    order,
    tickLabel,
    finalCaption,
  ]);

  await clock.play(
    scene,
    new FadeIn(cloud, { duration: 0.55 }),
    new Write(reverseEquation, { duration: 0.55, lagRatio: 0.04 }),
    new Write(order, { duration: 0.55, lagRatio: 0.08 }),
    new FadeIn(tickLabel, { duration: 0.55 }),
    new FadeIn(tick, { duration: 0.55 }),
  );
  stage.addActive(cloud, reverseEquation, order, tickLabel, tick, finalCaption);

  const tickTargets = await Promise.all(
    denoiseBeats.map((_beat, index) =>
      formula.math(String(denoiseBeats.length - 1 - index), {
        color: palette.parameter,
        fontSize: 45,
        position: tick.getCenter(),
      }),
    ),
  );

  for (let stepIndex = 0; stepIndex < denoiseBeats.length; stepIndex += 1) {
    const fraction = (stepIndex + 1) / denoiseBeats.length;
    const easedFraction = Math.pow(fraction, 1.15);
    const color = interpolateHex(palette.latent, palette.input, fraction);
    const targetCloud = new VGroup(
      ...noisyPoints.map((point, index) => {
        const dot = new Dot({
          point: interpolatePoint(point, cleanPoints[index], easedFraction),
          radius: 0.05,
          color,
          fillOpacity: 0.6 + 0.4 * fraction,
          strokeWidth: 0,
        });
        dot.setFill(color, 0.6 + 0.4 * fraction);
        return dot;
      }),
    );
    const animations: Animation[] = [
      new Transform(cloud, targetCloud, { duration: 0.4 }),
      new Transform(tick, tickTargets[stepIndex], { duration: 0.4 }),
    ];
    if (stepIndex === denoiseBeats.length - 1) {
      animations.push(new FadeIn(finalCaption, { duration: 0.4, scale: 1.35 }));
    }
    await clock.hit(scene, denoiseBeats[stepIndex], ...animations);
  }
}

async function diffusionTargets(stage: DropTwoStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = stage.usePalette('light');
  const chip = await titleChip({ formula, palette }, 'training · what does the network predict?');
  const rowSources = [
    String.raw`\mathbf{1.}\quad x_0\sim\mathcal D`,
    String.raw`\mathbf{2.}\quad t\sim\mathcal U[0,T]`,
    String.raw`\mathbf{3.}\quad \epsilon\sim\mathcal N(0,I)`,
    String.raw`\mathbf{4.}\quad x_t=\sqrt{\bar\alpha_t}\,x_0+\sqrt{1-\bar\alpha_t}\,\epsilon`,
  ] as const;
  const rowColors = [palette.input, palette.parameter, palette.latent, palette.ink] as const;
  const rowY = [1.55, 0.72, -0.11, -0.94] as const;
  const rows = await Promise.all(
    rowSources.map((source, index) =>
      formula.math(source, {
        color: rowColors[index],
        fontSize: 30,
        position: [-3.5, rowY[index], 0],
        maxWidth: 5.7,
      }),
    ),
  );
  rows.forEach((row) => row.alignTo(rows[0], [-1, 0, 0]));
  const loss = await formula.math(
    String.raw`\mathbf{5.}\quad \min_\theta\ \left\|\epsilon-\epsilon_\theta(x_t,t)\right\|_2^2`,
    {
      color: palette.loss,
      fontSize: 32,
      position: [-3.5, -1.88, 0],
      maxWidth: 5.8,
    },
  );
  loss.alignTo(rows[0], [-1, 0, 0]);
  const loop = new CurvedArrow({
    startPoint: [loss.getLeft()[0] - 0.25, loss.getCenter()[1], 0],
    endPoint: [rows[0].getLeft()[0] - 0.25, rows[0].getCenter()[1], 0],
    angle: -1.15,
    color: palette.dim,
    strokeWidth: 2,
    tipLength: 0.16,
  });
  const timeCondition = await formula.caption('the network MUST be conditioned on t', {
    color: palette.parameter,
    fontSize: 25,
    position: [-3.25, BOTTOM_CAPTION_Y, 0],
    maxWidth: 5.9,
  });

  const selectorHead = await formula.label('prediction target?', {
    color: palette.ink,
    fontSize: 28,
    position: [3.75, 2.15, 0],
  });
  const optionSources = [
    String.raw`\epsilon`,
    String.raw`x_0`,
    String.raw`\nabla_x\log p_t`,
    'v',
  ] as const;
  const optionFrames: RoundedRectangle[] = [];
  const optionLabels: MathTex[] = [];
  for (let index = 0; index < optionSources.length; index += 1) {
    const center: Vector3Tuple = [3.75, 1.35 - index * 0.92, 0];
    const frame = new RoundedRectangle({
      width: 2.45,
      height: 0.68,
      cornerRadius: 0.1,
      color: palette.dim,
      fillOpacity: 0,
      strokeWidth: 1.8,
      center,
    });
    const label = await formula.math(optionSources[index], {
      color: palette.ink,
      fontSize: 30,
      position: center,
    });
    optionFrames.push(frame);
    optionLabels.push(label);
  }
  const warning = await formula.caption('identify the parameterization first', {
    color: palette.loss,
    fontSize: 24,
    position: [3.75, -2.55, 0],
    maxWidth: 4.8,
  });
  assertTextRows('diffusion recipe', [...rows, loss], 0.06);
  assertTextRows('prediction selector', [selectorHead, ...optionLabels, warning], 0.04);

  const roots: Mobject[] = [
    ...rows,
    loss,
    loop,
    timeCondition,
    selectorHead,
    ...optionFrames,
    ...optionLabels,
    warning,
  ];
  const beats = await stage.beginBar(48, 'light', {
    chip,
    roots,
    firstAnimations: [new Write(rows[0], { duration: 0.45, lagRatio: 0.08 })],
  });
  await clock.hit(
    scene,
    beats[1],
    new Write(rows[1], { duration: 0.45, lagRatio: 0.08 }),
    new Write(rows[2], { duration: 0.45, lagRatio: 0.08 }),
  );
  await clock.hit(scene, beats[2], new Write(rows[3], { duration: 0.5, lagRatio: 0.05 }));
  await clock.hit(
    scene,
    beats[3],
    new Write(loss, { duration: 0.55, lagRatio: 0.04 }),
    new Create(loop, { duration: 0.55 }),
    new FadeIn(timeCondition, { duration: 0.55, scale: 1.35 }),
  );

  const bar49Beats = barBeats(49);
  await clock.hit(
    scene,
    bar49Beats[0],
    new FadeIn(selectorHead, { duration: 0.5 }),
    ...optionFrames.map((frame) => new FadeIn(frame, { duration: 0.5, shift: [-0.25, 0, 0] })),
    ...optionLabels.map((label) => new FadeIn(label, { duration: 0.5, shift: [-0.25, 0, 0] })),
    new FadeIn(warning, { duration: 0.5, scale: 1.35 }),
  );
  for (let beatIndex = 1; beatIndex < bar49Beats.length; beatIndex += 1) {
    const selected = (beatIndex - 1) % optionFrames.length;
    const animations = optionFrames.map((frame, index) =>
      frame.animate
        .withDuration(0.35)
        .setStroke(
          index === selected ? palette.parameter : palette.dim,
          index === selected ? 3 : 1.8,
        )
        .setFill(
          index === selected ? palette.parameter : palette.background,
          index === selected ? 0.18 : 0,
        ),
    );
    await clock.hit(scene, bar49Beats[beatIndex], ...animations);
  }
}

async function maskedReveal(stage: DropTwoStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = stage.usePalette('dark');
  const chip = await titleChip({ formula, palette }, 'masked diffusion — iterative reveal');
  const tokenCount = 12;
  const letters = 'G A T C C A T G C G A T'.split(' ');
  const tokenFrames: Square[] = [];
  const tokenLabels: MathTex[] = [];
  const revealedLabels: MathTex[] = [];

  for (let index = 0; index < tokenCount; index += 1) {
    const center: Vector3Tuple = [-4.3 + index * 0.78, 1.5, 0];
    tokenFrames.push(filledSquare(0.68, palette.latent, 0.4, center));
    tokenLabels.push(
      await formula.math('M', {
        color: palette.latent,
        fontSize: 30,
        position: center,
      }),
    );
    revealedLabels.push(
      await formula.math(letters[index], {
        color: palette.valid,
        fontSize: 30,
        position: center,
      }),
    );
  }

  const weight = await formula.math(String.raw`w(t)=\frac{-\alpha'(t)}{1-\alpha(t)}`, {
    color: palette.parameter,
    fontSize: 34,
    position: [4.3, -1, 0],
    maxWidth: 3.7,
  });
  const lossCaption = await formula.caption(
    'cross-entropy ONLY on masked positions — visible ones are context',
    {
      color: palette.dim,
      fontSize: 25,
      position: [-0.9, -0.4, 0],
      maxWidth: 8.7,
    },
  );
  const orderCaption = await formula.caption('reveal order is FLEXIBLE — not left-to-right', {
    color: palette.parameter,
    fontSize: 25,
    position: [-0.9, -1.4, 0],
    maxWidth: 8.2,
  });
  assertTextRows('masked diffusion captions', [lossCaption, orderCaption], 0.18);

  const roots: Mobject[] = [...tokenFrames, ...tokenLabels, weight, lossCaption, orderCaption];
  await stage.beginBar(50, 'dark', {
    chip,
    roots,
    firstAnimations: [
      ...tokenFrames.map((frame) => new FadeIn(frame, { duration: 0.55, shift: [0, 0.2, 0] })),
      ...tokenLabels.map((label) => new FadeIn(label, { duration: 0.55, shift: [0, 0.2, 0] })),
      new Write(weight, { duration: 0.55, lagRatio: 0.08 }),
    ],
  });
  await clock.play(scene, new FadeIn(lossCaption, { duration: 0.35, scale: 1.35 }));

  const revealOrder = [5, 9, 1, 11, 3, 7, 0, 8, 2, 10, 4, 6] as const;
  const revealBeats = beatsIn(clock.now, bar(52));
  let revealIndex = 0;
  for (let beatIndex = 0; beatIndex < revealBeats.length; beatIndex += 1) {
    const animations: Animation[] = [];
    for (let pairIndex = 0; pairIndex < 2 && revealIndex < tokenCount; pairIndex += 1) {
      const tokenIndex = revealOrder[revealIndex];
      animations.push(
        tokenFrames[tokenIndex].animate
          .withDuration(0.4)
          .setFill(palette.valid, 0.25)
          .setStroke(palette.valid, 2),
        new Transform(tokenLabels[tokenIndex], revealedLabels[tokenIndex], {
          duration: 0.4,
        }),
      );
      revealIndex += 1;
    }
    if (beatIndex === 2) {
      animations.push(new FadeIn(orderCaption, { duration: 0.4, scale: 1.35 }));
    }
    if (animations.length > 0) await clock.hit(scene, revealBeats[beatIndex], ...animations);
  }
}

async function planningAndGuidance(stage: DropTwoStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = stage.usePalette('dark');
  const chip = await titleChip({ formula, palette }, 'reveal planning · guidance');
  const confidences = [0.9, 0.3, 0.75, 0.5, 0.95, 0.2, 0.6, 0.82] as const;
  const confidenceBars = confidences.map((confidence, index) =>
    filledRectangle(0.55, 1.6 * confidence, palette.output, 0.5, [
      -4.6 + index * 0.75,
      0.1 + 0.8 * confidence,
      0,
    ]),
  );
  const baseline = new Line({
    start: [-5.1, 0.08, 0],
    end: [-0.7, 0.08, 0],
    color: palette.dim,
    strokeWidth: 1.6,
  });
  const plannerCaption = await formula.caption('planner: reveal the CONFIDENT positions first', {
    color: palette.output,
    fontSize: 24,
    position: [-2.9, -0.75, 0],
    maxWidth: 5.7,
  });

  const initialDistribution = [0.15, 0.4, 0.25, 0.2] as const;
  const tiltedDistribution = [0.05, 0.65, 0.2, 0.1] as const;
  const distributionBars = initialDistribution.map((probability, index) =>
    filledRectangle(0.6, 2.2 * probability, palette.latent, 0.5, [
      2.6 + index * 0.8,
      0.1 + 1.1 * probability,
      0,
    ]),
  );
  const tiltedBars = tiltedDistribution.map((probability, index) =>
    filledRectangle(0.6, 2.2 * probability, palette.latent, 0.5, [
      2.6 + index * 0.8,
      0.1 + 1.1 * probability,
      0,
    ]),
  );
  const guidance = await formula.math(
    String.raw`p_{\mathrm{guided}}(x)\propto p_\theta(x)\,e^{\gamma s(x)}`,
    {
      color: palette.ink,
      fontSize: 31,
      position: [3.8, 2.3, 0],
      maxWidth: 5.1,
    },
  );
  const classifierFree = await formula.math(
    String.raw`\ell_{\mathrm{guided}}=\ell_{\mathrm{uncond}}+\gamma\!\left(\ell_{\mathrm{cond}}-\ell_{\mathrm{uncond}}\right)`,
    {
      color: palette.ink,
      fontSize: 30,
      position: [0, -2.15, 0],
      maxWidth: 8.8,
    },
  );
  const convention = await formula.caption('two CFG conventions exist — state which one first', {
    color: palette.loss,
    fontSize: 24,
    position: [0, BOTTOM_CAPTION_Y, 0],
    maxWidth: 8.2,
  });
  assertTextRows('guidance lower rows', [classifierFree, convention], 0.16);

  const roots: Mobject[] = [
    baseline,
    ...confidenceBars,
    plannerCaption,
    ...distributionBars,
    guidance,
    classifierFree,
    convention,
  ];
  const bar52 = await stage.beginBar(52, 'dark', {
    chip,
    roots,
    firstAnimations: [
      new Create(baseline, { duration: 0.5 }),
      ...confidenceBars.map((barObject) => new FadeIn(barObject, { duration: 0.5 })),
      new FadeIn(plannerCaption, { duration: 0.5, scale: 1.35 }),
    ],
  });
  const ranked = confidences
    .map((confidence, index) => ({ confidence, index }))
    .sort((left, right) => right.confidence - left.confidence);
  for (let beatIndex = 1; beatIndex < bar52.length; beatIndex += 1) {
    const selected = confidenceBars[ranked[beatIndex - 1].index];
    await clock.hit(
      scene,
      bar52[beatIndex],
      selected.animate.withDuration(0.35).setFill(palette.valid, 0.8).setStroke(palette.valid, 2.5),
    );
  }

  const bar53 = barBeats(53);
  await clock.hit(
    scene,
    bar53[0],
    new Write(guidance, { duration: 0.5, lagRatio: 0.05 }),
    ...distributionBars.map((barObject) => new FadeIn(barObject, { duration: 0.5 })),
  );
  await clock.hit(
    scene,
    bar53[1],
    ...distributionBars.map(
      (barObject, index) => new Transform(barObject, tiltedBars[index], { duration: 0.6 }),
    ),
  );
  await clock.hit(scene, bar53[2], new Write(classifierFree, { duration: 0.55, lagRatio: 0.04 }));
  await clock.hit(scene, bar53[3], new FadeIn(convention, { duration: 0.45, scale: 1.35 }));
}

async function flowMatching(stage: DropTwoStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = stage.usePalette('light');
  const chip = await titleChip({ formula, palette }, 'flow matching — straight paths');
  const sourceLabel = await formula.math(String.raw`t=0:\ \text{simple source}`, {
    color: palette.input,
    fontSize: 27,
    position: [-3.55, 2.45, 0],
  });
  const dataLabel = await formula.math(String.raw`t=1:\ \text{data}`, {
    color: palette.valid,
    fontSize: 27,
    position: [3.75, 2.45, 0],
  });
  const pathEquation = await formula.math(String.raw`x_t=(1-t)x_0+t x_1\qquad u_t=x_1-x_0`, {
    color: palette.ink,
    fontSize: 32,
    position: [0.65, 1.62, 0],
    maxWidth: 8.7,
  });

  const rng = new SeededRng(7);
  const sourcePoints: Vector3Tuple[] = Array.from({ length: 10 }, () => [
    rng.range(-5.4, -3.2),
    rng.range(-1.25, 0.85),
    0,
  ]);
  const destinationPoints: Vector3Tuple[] = Array.from({ length: 10 }, () => [
    rng.range(3.1, 5.35),
    rng.range(-1.3, 0.95),
    0,
  ]);
  const sourceDots = new VGroup(
    ...sourcePoints.map((point) => new Dot({ point, radius: 0.06, color: palette.input })),
  );
  const destinationDots = new VGroup(
    ...destinationPoints.map((point) => new Dot({ point, radius: 0.06, color: palette.valid })),
  );
  const pathLines = new VGroup(
    ...sourcePoints.map((point, index) => {
      const line = new Line({
        start: point,
        end: destinationPoints[index],
        color: palette.dim,
        strokeWidth: 1.3,
      });
      line.setStroke(palette.dim, 1.3, 0.7);
      return line;
    }),
  );
  const movers = new VGroup(
    ...sourcePoints.map((point) => new Dot({ point, radius: 0.065, color: palette.parameter })),
  );
  const midpointMovers = new VGroup(
    ...sourcePoints.map(
      (point, index) =>
        new Dot({
          point: interpolatePoint(point, destinationPoints[index], 0.55),
          radius: 0.065,
          color: palette.parameter,
        }),
    ),
  );
  const finalMovers = new VGroup(
    ...destinationPoints.map(
      (point) => new Dot({ point, radius: 0.065, color: palette.parameter }),
    ),
  );
  const loss = await formula.math(
    String.raw`L_{\mathrm{FM}}=\mathbb E\!\left[\left\|v_\theta(t,x_t)-(x_1-x_0)\right\|^2\right]`,
    {
      color: palette.ink,
      fontSize: 30,
      position: [0, -2.2, 0],
      maxWidth: 8.2,
    },
  );
  const recipe = await formula.math(
    String.raw`\text{sample }x_0\ \cdot\ \text{sample }x_1\ \cdot\ t\sim\mathcal U[0,1]\ \cdot\ \text{form }x_t\ \cdot\ \text{regress}`,
    {
      color: palette.dim,
      fontSize: 24,
      position: [0, BOTTOM_CAPTION_Y, 0],
      maxWidth: 11.8,
    },
  );
  assertTextRows('flow matching lower rows', [loss, recipe], 0.15);

  const roots: Mobject[] = [
    sourceLabel,
    dataLabel,
    sourceDots,
    destinationDots,
    pathLines,
    movers,
    pathEquation,
    loss,
    recipe,
  ];
  const bar54 = await stage.beginBar(54, 'light', {
    chip,
    roots,
    firstAnimations: [
      new FadeIn(sourceLabel, { duration: 0.5 }),
      new FadeIn(dataLabel, { duration: 0.5 }),
      new FadeIn(sourceDots, { duration: 0.5 }),
      new FadeIn(destinationDots, { duration: 0.5 }),
    ],
  });
  await clock.hit(
    scene,
    bar54[1],
    new Create(pathLines, { duration: 0.6 }),
    new Write(pathEquation, { duration: 0.6, lagRatio: 0.04 }),
  );
  await clock.waitUntil(scene, bar54[2]);
  await clock.play(
    scene,
    new Transform(movers, midpointMovers, {
      duration: quantizeDuration(2 * BEAT_DURATION),
      rateFunc: easeInOutSine,
    }),
  );

  const bar55 = barBeats(55);
  await clock.hit(scene, bar55[0], new Write(loss, { duration: 0.55, lagRatio: 0.04 }));
  await clock.hit(scene, bar55[1], new FadeIn(recipe, { duration: 0.45, scale: 1.35 }));
  await clock.hit(scene, bar55[3], new Transform(movers, finalMovers, { duration: 0.6 }));
}

async function eulerAndContinuity(stage: DropTwoStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = stage.usePalette('light');
  const chip = await titleChip({ formula, palette }, 'euler integration · continuity');
  const euler = await formula.math(String.raw`x_{t+\Delta t}=x_t+\Delta t\,v_\theta(t,x_t)`, {
    color: palette.ink,
    fontSize: 34,
    position: [1.15, 2.63, 0],
    maxWidth: 7.4,
  });

  const rng = new SeededRng(13);
  let particlePoints: Vector3Tuple[] = Array.from({ length: 22 }, () => [
    rng.range(-5.7, -1.25),
    rng.range(-1.65, 1.05),
    0,
  ]);
  const particles = new VGroup(
    ...particlePoints.map((point) => new Dot({ point, radius: 0.055, color: palette.input })),
  );
  const particleTargets: VGroup[] = [];
  for (let step = 0; step < 3; step += 1) {
    particlePoints = particlePoints.map((point) => {
      const localX = point[0] + 3.35;
      const localY = point[1] + 0.45;
      return [point[0] - 0.25 * localY, point[1] + 0.25 * localX, 0];
    });
    particleTargets.push(
      new VGroup(
        ...particlePoints.map((point) => new Dot({ point, radius: 0.055, color: palette.input })),
      ),
    );
  }

  const diffusionContrast = await formula.math(
    String.raw`\text{diffusion: predict noise or score}\ \to\ \text{stochastic reverse}`,
    {
      color: palette.latent,
      fontSize: 25,
      position: [3.75, 1.58, 0],
      maxWidth: 5.55,
    },
  );
  const flowContrast = await formula.math(
    String.raw`\text{flow: predict velocity}\ \to\ \text{deterministic ODE}`,
    {
      color: palette.input,
      fontSize: 25,
      position: [3.75, 0.88, 0],
      maxWidth: 5.55,
    },
  );
  const omega = new Circle({
    radius: 0.82,
    color: palette.parameter,
    strokeWidth: 2,
    center: [3.65, -0.62, 0],
  });
  const omegaLabel = await formula.math(String.raw`\Omega`, {
    color: palette.parameter,
    fontSize: 35,
    position: omega.getCenter(),
  });
  const fluxArrows = Array.from({ length: 8 }, (_unused, index) => {
    const angle = (index / 8) * Math.PI * 2;
    const start = omega.pointAtAngle(angle);
    const end: Vector3Tuple = [
      start[0] + 0.48 * Math.cos(angle),
      start[1] + 0.48 * Math.sin(angle),
      0,
    ];
    return new Arrow({
      start,
      end,
      color: palette.parameter,
      buff: 0,
      strokeWidth: 2,
      maxTipLengthToLengthRatio: 0.3,
    });
  });
  const continuity = await formula.math(String.raw`\partial_t\rho_t+\nabla\!\cdot(\rho_t v_t)=0`, {
    color: palette.ink,
    fontSize: 32,
    position: [3.65, -2.38, 0],
    maxWidth: 5.3,
  });
  assertTextRows('diffusion flow contrast', [diffusionContrast, flowContrast], 0.12);

  const roots: Mobject[] = [
    euler,
    particles,
    diffusionContrast,
    flowContrast,
    omega,
    omegaLabel,
    ...fluxArrows,
    continuity,
  ];
  const bar56 = await stage.beginBar(56, 'light', {
    chip,
    roots,
    firstAnimations: [
      new Write(euler, { duration: 0.55, lagRatio: 0.05 }),
      new FadeIn(particles, { duration: 0.55 }),
    ],
  });
  for (let beatIndex = 1; beatIndex < bar56.length; beatIndex += 1) {
    await clock.hit(
      scene,
      bar56[beatIndex],
      new Transform(particles, particleTargets[beatIndex - 1], {
        duration: 0.45,
        rateFunc: easeOutQuad,
      }),
    );
  }

  const bar57 = barBeats(57);
  await clock.hit(scene, bar57[0], new FadeIn(diffusionContrast, { duration: 0.45 }));
  await clock.hit(scene, bar57[1], new FadeIn(flowContrast, { duration: 0.45 }));
  await clock.hit(
    scene,
    bar57[2],
    new Create(omega, { duration: 0.55 }),
    new Write(omegaLabel, { duration: 0.55 }),
    ...fluxArrows.map((arrow) => new GrowArrow(arrow, { duration: 0.55 })),
  );
  await clock.hit(scene, bar57[3], new Write(continuity, { duration: 0.55, lagRatio: 0.05 }));
}

async function categoricalJumpFlow(stage: DropTwoStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = stage.usePalette('dark');
  const chip = await titleChip({ formula, palette }, 'categorical jump flow');
  const railY = [1.55, 0.62, -0.31, -1.24] as const;
  const rails = railY.map(
    (y) =>
      new Line({
        start: [-5.15, y, 0],
        end: [-0.25, y, 0],
        color: palette.dim,
        strokeWidth: 1.6,
      }),
  );
  const railLabels = await Promise.all(
    railY.map((y, index) =>
      formula.math(String.raw`c_{${index + 1}}`, {
        color: palette.dim,
        fontSize: 28,
        position: [-5.65, y, 0],
      }),
    ),
  );
  const state = new Dot({
    point: [-4.75, railY[1], 0],
    color: palette.parameter,
    radius: 0.11,
  });
  const stateCaption = await formula.caption('state stays CATEGORICAL — rates are continuous', {
    color: palette.parameter,
    fontSize: 24,
    position: [-3.15, -2.55, 0],
    maxWidth: 5.6,
  });
  const rate = await formula.math(String.raw`R_t^i(x)=\sum_{y\ne x}u_t^i(y,x)`, {
    color: palette.ink,
    fontSize: 29,
    position: [3.55, 1.28, 0],
    maxWidth: 5.1,
  });
  const stay = await formula.math(String.raw`\Pr(\text{stay})=e^{-hR}`, {
    color: palette.output,
    fontSize: 29,
    position: [3.55, 0.22, 0],
    maxWidth: 5.1,
  });
  const jump = await formula.math(
    String.raw`\Pr(\text{jump }y)=\frac{u_y}{R}\left(1-e^{-hR}\right)`,
    {
      color: palette.loss,
      fontSize: 29,
      position: [3.55, -0.86, 0],
      maxWidth: 5.1,
    },
  );
  const simplex = await formula.caption(
    'simplex flow: soft vector · jump flow: hard category + rates',
    {
      color: palette.latent,
      fontSize: 23,
      position: [2.35, BOTTOM_CAPTION_Y, 0],
      maxWidth: 8,
    },
  );
  assertTextRows('jump flow equations', [rate, stay, jump], 0.14);

  const roots: Mobject[] = [
    ...rails,
    ...railLabels,
    state,
    stateCaption,
    rate,
    stay,
    jump,
    simplex,
  ];
  const bar58 = await stage.beginBar(58, 'dark', {
    chip,
    roots,
    firstAnimations: [
      ...rails.map((rail) => new Create(rail, { duration: 0.5 })),
      ...railLabels.map((label) => new FadeIn(label, { duration: 0.5 })),
      new FadeIn(state, { duration: 0.5 }),
      new FadeIn(stateCaption, { duration: 0.5, scale: 1.35 }),
    ],
  });

  const jumps: readonly Vector3Tuple[] = [
    [-4.05, railY[2], 0],
    [-3.3, railY[2], 0],
    [-3.15, railY[0], 0],
    [-2.25, railY[3], 0],
    [-1.5, railY[3], 0],
    [-1.25, railY[1], 0],
  ];
  const targets = jumps.map(
    (point) =>
      new Dot({
        point,
        color: palette.parameter,
        radius: 0.11,
      }),
  );
  const bar59 = barBeats(59);
  const jumpBeats = [...bar58.slice(1), ...bar59.slice(0, 3)];
  for (let index = 0; index < jumpBeats.length; index += 1) {
    const animations: Animation[] = [new Transform(state, targets[index], { duration: 0.4 })];
    if (index === 1) animations.push(new Write(rate, { duration: 0.4, lagRatio: 0.06 }));
    if (index === 2) animations.push(new Write(stay, { duration: 0.4, lagRatio: 0.06 }));
    if (index === 3) animations.push(new Write(jump, { duration: 0.4, lagRatio: 0.04 }));
    if (index === 4) {
      animations.push(new FadeIn(simplex, { duration: 0.4, scale: 1.35 }));
    }
    await clock.hit(scene, jumpBeats[index], ...animations);
  }
}

async function paretoAndEvaluation(stage: DropTwoStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = stage.usePalette('dark');
  const chip = await titleChip({ formula, palette }, 'pareto frontier · evaluation');
  const axes = new Axes({
    xRange: [0, 1, 0.2],
    yRange: [0, 1, 0.2],
    xLength: 4.6,
    yLength: 3.3,
    color: palette.dim,
    axisConfig: { includeTicks: false, strokeWidth: 1.5 },
    tips: true,
  });
  axes.moveTo([-2.9, -0.45, 0]);
  const xLabel = await formula.math(String.raw`f_1`, {
    color: palette.dim,
    fontSize: 28,
    position: [0, 0, 0],
    fitStage: false,
  });
  xLabel.nextTo(axes, [0, -1, 0], 0.15);
  const yLabel = await formula.math(String.raw`f_2`, {
    color: palette.dim,
    fontSize: 28,
    position: [0, 0, 0],
    fitStage: false,
  });
  yLabel.nextTo(axes, [-1, 0, 0], 0.15);

  const rawPoints = REFERENCE_PARETO_POINTS;
  const frontier = rawPoints
    .map((_point, index) => index)
    .filter((index) => {
      const point = rawPoints[index];
      return !rawPoints.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other[0] >= point[0] &&
          other[1] >= point[1] &&
          (other[0] > point[0] || other[1] > point[1]),
      );
    });
  const dots = rawPoints.map((point) => {
    const dot = new Dot({
      point: axes.coordsToPoint(point[0], point[1]),
      radius: 0.06,
      color: palette.dim,
      fillOpacity: 0.85,
      strokeWidth: 0,
    });
    dot.setFill(palette.dim, 0.85);
    return dot;
  });
  const dominance = await formula.caption('a dominates b: no worse everywhere, better somewhere', {
    color: palette.ink,
    fontSize: 24,
    position: [3.3, 2.05, 0],
    maxWidth: 5.7,
  });
  const entropy = await formula.math(String.raw`H=-\sum_a p(a)\log_2 p(a)`, {
    color: palette.parameter,
    fontSize: 28,
    position: [3.45, 0.92, 0],
    maxWidth: 5.2,
  });
  const jaccard = await formula.math(
    String.raw`J(A,B)=\frac{\lvert A\cap B\rvert}{\lvert A\cup B\rvert}`,
    {
      color: palette.output,
      fontSize: 28,
      position: [3.45, -0.12, 0],
      maxWidth: 5.2,
    },
  );
  const uniqueness = await formula.math(
    String.raw`\mathrm{uniqueness}=\frac{\#\,\mathrm{distinct}}{\#\,\mathrm{outputs}}`,
    {
      color: palette.input,
      fontSize: 28,
      position: [3.45, -1.24, 0],
      maxWidth: 5.2,
    },
  );
  const independent = await formula.caption(
    'score with an INDEPENDENT evaluator — no self-grading',
    {
      color: palette.loss,
      fontSize: 24,
      position: [1.65, BOTTOM_CAPTION_Y, 0],
      maxWidth: 9.2,
    },
  );
  assertTextRows('evaluation metric column', [dominance, entropy, jaccard, uniqueness]);

  const roots: Mobject[] = [
    axes,
    xLabel,
    yLabel,
    ...dots,
    dominance,
    entropy,
    jaccard,
    uniqueness,
    independent,
  ];
  const bar60 = await stage.beginBar(60, 'dark', {
    chip,
    roots,
    firstAnimations: [
      new Create(axes, { duration: 0.55 }),
      new FadeIn(xLabel, { duration: 0.55 }),
      new FadeIn(yLabel, { duration: 0.55 }),
      ...dots.map((dot) => new FadeIn(dot, { duration: 0.55 })),
    ],
  });
  await clock.hit(
    scene,
    bar60[1],
    new FadeIn(dominance, { duration: 0.5, scale: 1.35 }),
    ...dots
      .map((dot, index) => ({ dot, index }))
      .filter(({ index }) => !frontier.includes(index))
      .map(({ dot }) => dot.animate.withDuration(0.5).setOpacity(0.25)),
  );

  const bar61 = barBeats(61);
  const evaluationBeats = [...bar60.slice(2), ...bar61];
  const remainingFrontier = [...frontier];
  for (let beatIndex = 0; beatIndex < evaluationBeats.length; beatIndex += 1) {
    const animations: Animation[] = [];
    const frontierIndex = remainingFrontier.shift();
    if (frontierIndex !== undefined) {
      animations.push(
        dots[frontierIndex].animate
          .withDuration(0.4)
          .setColor(palette.parameter)
          .setOpacity(1)
          .scale(1.5),
      );
    }
    if (beatIndex === 2) {
      animations.push(new Write(entropy, { duration: 0.4, lagRatio: 0.06 }));
    }
    if (beatIndex === 3) {
      animations.push(new Write(jaccard, { duration: 0.4, lagRatio: 0.06 }));
    }
    if (beatIndex === 4) {
      animations.push(
        new Write(uniqueness, { duration: 0.4, lagRatio: 0.04 }),
        new FadeIn(independent, { duration: 0.4, scale: 1.35 }),
      );
    }
    if (animations.length > 0) {
      await clock.hit(scene, evaluationBeats[beatIndex], ...animations);
    }
  }
}

export const dropTwoScene = defineEsapScene({
  id: 'drop-2',
  title: 'Modern architectures',
  status: 'implemented',
  async build(context) {
    const stage = new DropTwoStage(context);
    await reverseSampling(stage, context);
    await diffusionTargets(stage, context);
    await maskedReveal(stage, context);
    await planningAndGuidance(stage, context);
    await flowMatching(stage, context);
    await eulerAndContinuity(stage, context);
    await categoricalJumpFlow(stage, context);
    await paretoAndEvaluation(stage, context);
    await stage.finish();
  },
});
