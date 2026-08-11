import {
  Add,
  Animation,
  AnimationGroup,
  Axes,
  Circle,
  Create,
  Dot,
  Ellipse,
  FadeIn,
  GrowFromCenter,
  Line,
  MoveAlongPath,
  Rectangle,
  Remove,
  RoundedRectangle,
  Succession,
  Transform,
  VGroup,
  VMobject,
  Write,
  easeOutBack,
  smooth,
  type Mobject,
  type Vector3Tuple,
} from '../../../src/index.ts';
import { escapeLatexText } from '../copy';
import type { EsapPalette } from '../palette';
import { BEATS, bar, barBeats, quantizeDuration } from '../timing';
import { createStarfield } from './helpers';
import { defineEsapScene, type EsapSceneContext } from './types';

const RECAP_DURATION = 1.1;
const MICRO_CENTER: Vector3Tuple = [3.65, -0.6, 0];

type PaletteRole = keyof EsapPalette;

interface RecapDefinition {
  readonly title: string;
  readonly color: PaletteRole;
  readonly formulas: readonly string[];
}

interface RecapSlide {
  readonly roots: readonly Mobject[];
  readonly title: Mobject;
  readonly rule: Mobject;
  readonly formulaRows: readonly Mobject[];
  readonly micro: MicroPlan;
}

interface MicroPlan {
  readonly roots: readonly Mobject[];
  readonly entrance: readonly Animation[];
  readonly motion: readonly Animation[];
}

interface GeneratorDefinition {
  readonly model: string;
  readonly state: string;
  readonly sampling: string;
  readonly color: PaletteRole;
}

const RECAPS: readonly RecapDefinition[] = [
  {
    title: 'NN CORE',
    color: 'input',
    formulas: [
      String.raw`z=w^\top x+b,\qquad h=\phi(z)`,
      String.raw`L_{\mathrm{BCE}}=-\left[y\log p+(1-y)\log(1-p)\right]`,
      String.raw`\frac{\partial L}{\partial z}=p-y,\qquad \theta\leftarrow\theta-\eta\nabla_\theta L`,
    ],
  },
  {
    title: 'OPTIMIZATION',
    color: 'output',
    formulas: [
      String.raw`m_t=\beta_1m_{t-1}+(1-\beta_1)g_t,\qquad v_t=\beta_2v_{t-1}+(1-\beta_2)g_t^2`,
      String.raw`\theta_t=\theta_{t-1}-\eta\,\frac{\hat m_t}{\sqrt{\hat v_t}+\epsilon}`,
      String.raw`\eta_t=\eta_{\min}+\frac{1}{2}(\eta_0-\eta_{\min})\left[1+\cos\left(\frac{\pi t}{T_{\max}}\right)\right]`,
    ],
  },
  {
    title: 'ATTENTION',
    color: 'loss',
    formulas: [
      String.raw`A=\operatorname{softmax}_{\mathrm{row}}\!\left(\frac{QK^\top}{\sqrt{d_k}}\right),\qquad Z=AV`,
      String.raw`QK^\top:\ B\times H\times L\times L,\qquad d_k=\frac{d}{H}`,
      String.raw`\operatorname{FFN}(x)=W_2\,\phi(W_1x+b_1)+b_2`,
    ],
  },
  {
    title: 'ADAPTATION · DECODING',
    color: 'parameter',
    formulas: [
      String.raw`W'=W+\frac{\alpha}{r}BA:\qquad r(d_{\mathrm{in}}+d_{\mathrm{out}})\ \text{parameters}`,
      String.raw`p(x_{1:T}\mid c)=\prod_t p(x_t\mid c,x_{\lt t})`,
      String.raw`\operatorname{cache}\!\left(K_{1:t-1},V_{1:t-1}\right)\qquad \text{same distribution}`,
    ],
  },
  {
    title: 'VAE',
    color: 'latent',
    formulas: [
      String.raw`z=\mu+\sigma\odot\epsilon,\qquad \epsilon\sim\mathcal N(0,I)`,
      String.raw`\mathcal L=\mathbb E_q[\log p_\theta(x\mid z)]-D_{\mathrm{KL}}\!\left(q_\phi(z\mid x)\,\middle\|\,p(z)\right)`,
      String.raw`D_{\mathrm{KL}}=-\frac{1}{2}\sum_j\left(1+\log\sigma_j^2-\mu_j^2-\sigma_j^2\right)`,
    ],
  },
  {
    title: 'DIFFUSION',
    color: 'input',
    formulas: [
      String.raw`x_t=\sqrt{\bar\alpha_t}\,x_0+\sqrt{1-\bar\alpha_t}\,\epsilon`,
      String.raw`L=\mathbb E\!\left[\left\|\epsilon-\epsilon_\theta(x_t,t)\right\|^2\right]`,
      String.raw`q(x_t^\ell\mid x_0^\ell)=\alpha(t)\,\delta_{x_0^\ell}+[1-\alpha(t)]\,\delta_M`,
    ],
  },
  {
    title: 'FLOW',
    color: 'output',
    formulas: [
      String.raw`x_t=(1-t)x_0+tx_1,\qquad u_t=x_1-x_0`,
      String.raw`x_{t+\Delta t}=x_t+\Delta t\,v_\theta(t,x_t)`,
      String.raw`\Pr(\mathrm{stay})=e^{-hR},\qquad \Pr(\mathrm{jump}\ y)=\frac{u_y}{R}\left(1-e^{-hR}\right)`,
    ],
  },
  {
    title: 'GUIDANCE · EVALUATION',
    color: 'valid',
    formulas: [
      String.raw`p_{\mathrm{guided}}\propto p_\theta(x)e^{\gamma s(x)},\qquad \ell=\ell_u+\gamma(\ell_c-\ell_u)`,
      String.raw`H=-\sum_a p(a)\log_2p(a),\qquad J=\frac{\lvert A\cap B\rvert}{\lvert A\cup B\rvert}`,
    ],
  },
] as const;

const GENERATORS: readonly GeneratorDefinition[] = [
  {
    model: 'autoregressive',
    state: 'prefix of tokens',
    sampling: 'append one token',
    color: 'input',
  },
  {
    model: 'VAE',
    state: 'continuous latent',
    sampling: 'one decode',
    color: 'latent',
  },
  {
    model: 'continuous diffusion',
    state: 'noisy vector',
    sampling: 'reverse T steps',
    color: 'loss',
  },
  {
    model: 'masked diffusion',
    state: 'tokens + [M]',
    sampling: 'iterative reveal',
    color: 'valid',
  },
  {
    model: 'flow matching',
    state: 'continuous vector',
    sampling: 'integrate ODE',
    color: 'output',
  },
  {
    model: 'jump flow',
    state: 'category + rates',
    sampling: 'stochastic jumps',
    color: 'parameter',
  },
  {
    model: 'flow map',
    state: 'finite transport',
    sampling: 'one or a few map calls',
    color: 'ink',
  },
] as const;

function framedCue(context: EsapSceneContext, cue: number): number {
  return context.timing.start + quantizeDuration(cue - context.timing.start);
}

function point(x: number, y: number, center: Vector3Tuple = MICRO_CENTER): Vector3Tuple {
  return [center[0] + x, center[1] + y, center[2]];
}

function staggeredRate(index: number, count: number, lagRatio: number): (alpha: number) => number {
  const childSpan = 1 / (1 + lagRatio * Math.max(0, count - 1));
  const childStart = index * childSpan * lagRatio;
  return (alpha: number) => smooth(Math.max(0, Math.min(1, (alpha - childStart) / childSpan)));
}

function neuralNetworkMicro(palette: EsapPalette): MicroPlan {
  const axes = new Axes({
    xRange: [-3, 3, 1],
    yRange: [-0.2, 1.3, 0.5],
    xLength: 3.9,
    yLength: 2.3,
    color: palette.dim,
    axisConfig: {
      strokeWidth: 1.2,
      includeTicks: false,
    },
    tips: true,
    tipLength: 0.18,
  }).moveTo(MICRO_CENTER);
  const sigmoid = axes.plot((x) => 1 / (1 + Math.exp(-2.2 * x)), {
    xRange: [-3, 3],
    color: palette.input,
    strokeWidth: 3,
    numSamples: 48,
  });
  const motionPath = sigmoid.copy();
  const iterate = new Dot({
    point: motionPath.pointFromProportion(0),
    radius: 0.07,
    color: palette.parameter,
  });
  return {
    roots: [axes, sigmoid, iterate],
    entrance: [
      new FadeIn(axes, {
        duration: RECAP_DURATION,
        scale: 0.4,
        rateFunc: easeOutBack,
      }),
    ],
    motion: [
      new Create(sigmoid, { duration: RECAP_DURATION }),
      new MoveAlongPath(iterate, { path: motionPath, duration: RECAP_DURATION }),
    ],
  };
}

function optimizationMicro(palette: EsapPalette): MicroPlan {
  const rings = [0, 1, 2].map(
    (index) =>
      new Ellipse({
        width: 1.2 + index * 1.05,
        height: 0.65 + index * 0.58,
        center: MICRO_CENTER,
        color: palette.dim,
        strokeWidth: 1.2,
      }),
  );
  const path = new VMobject()
    .setPointsSmoothly([point(2.1, 1.15), point(-1, 0.5), point(0.6, -0.4), point(0.04, 0.03)])
    .setStroke(palette.output, 3, 1)
    .setFill(palette.output, 0);
  const optimum = new Dot({
    point: point(0.04, 0.02),
    radius: 0.065,
    color: palette.valid,
  });
  const motionPath = path.copy();
  const iterate = new Dot({
    point: motionPath.pointFromProportion(0),
    radius: 0.065,
    color: palette.parameter,
  });
  const landscape = new VGroup(...rings, optimum);
  return {
    roots: [landscape, path, iterate],
    entrance: [
      new FadeIn(landscape, {
        duration: RECAP_DURATION,
        scale: 0.4,
        rateFunc: easeOutBack,
      }),
    ],
    motion: [
      new Create(path, { duration: RECAP_DURATION }),
      new MoveAlongPath(iterate, { path: motionPath, duration: RECAP_DURATION }),
    ],
  };
}

function attentionMicro(palette: EsapPalette): MicroPlan {
  const weights = [0.2, 0.62, 0.18, 0.12, 0.25, 0.63, 0.72, 0.18, 0.1];
  const cells = weights.map((_, index) => {
    const row = Math.floor(index / 3);
    const column = index % 3;
    return new Rectangle({
      width: 0.68,
      height: 0.68,
      center: point((column - 1) * 0.76, (1 - row) * 0.76),
      color: palette.dim,
      fillOpacity: 0.05,
      strokeWidth: 1,
    }).setFill(palette.loss, 0.05);
  });
  const rowDuration = RECAP_DURATION / 3;
  const rowAnimations = [0, 1, 2].map(
    (row) =>
      new AnimationGroup(
        cells
          .slice(row * 3, row * 3 + 3)
          .map((cell, column) =>
            cell.animate
              .withDuration(rowDuration)
              .setFill(palette.loss, 0.08 + weights[row * 3 + column] * 0.8),
          ),
      ),
  );
  return {
    roots: cells,
    entrance: cells.map(
      (cell) =>
        new FadeIn(cell, {
          duration: RECAP_DURATION,
          scale: 0.4,
          rateFunc: easeOutBack,
        }),
    ),
    motion: [new Succession(rowAnimations)],
  };
}

async function adaptationMicro(context: EsapSceneContext): Promise<MicroPlan> {
  const { palette, formula } = context;
  const base = new Rectangle({
    width: 1.9,
    height: 1.9,
    center: point(-0.85, 0),
    color: palette.input,
    fillOpacity: 0.08,
    strokeWidth: 2,
  }).setFill(palette.input, 0.08);
  const label = await formula.math('W', {
    color: palette.input,
    fontSize: 38,
    maxWidth: 0.5,
    maxHeight: 0.5,
    position: point(-0.85, 0),
    fitStage: false,
  });
  const leftFactor = new Rectangle({
    width: 0.42,
    height: 1.9,
    center: point(0.58, 0),
    color: palette.parameter,
    fillOpacity: 0.34,
    strokeWidth: 1.5,
  }).setFill(palette.parameter, 0.34);
  const rightFactor = new Rectangle({
    width: 1.7,
    height: 0.42,
    center: point(1.72, 0),
    color: palette.parameter,
    fillOpacity: 0.34,
    strokeWidth: 1.5,
  }).setFill(palette.parameter, 0.34);
  const baseVisual = new VGroup(base, label);
  const factors = [leftFactor, rightFactor] as const;
  return {
    roots: [baseVisual, leftFactor, rightFactor],
    entrance: [
      new FadeIn(baseVisual, {
        duration: RECAP_DURATION,
        scale: 0.4,
        rateFunc: easeOutBack,
      }),
    ],
    // Keep the factors top-level so RecordingScene records their real
    // introduction segment; delayed easing retains the oracle's stagger.
    motion: factors.map(
      (factor, index) =>
        new FadeIn(factor, {
          duration: RECAP_DURATION,
          shift: [-0.15, 0, 0],
          rateFunc: staggeredRate(index, factors.length, 0.2),
        }),
    ),
  };
}

async function vaeMicro(context: EsapSceneContext): Promise<MicroPlan> {
  const { palette, formula } = context;
  const prior = new Circle({
    radius: 1.25,
    center: MICRO_CENTER,
    color: palette.latent,
    strokeWidth: 2,
  });
  const label = await formula.math(String.raw`z\sim p(z)`, {
    color: palette.latent,
    fontSize: 30,
    maxWidth: 1.4,
    maxHeight: 0.38,
    position: point(0, -1.52),
    fitStage: false,
  });
  const samples = [
    [-0.72, 0.54],
    [-0.43, -0.68],
    [-0.12, 0.17],
    [0.17, -0.35],
    [0.38, 0.64],
    [0.67, 0.12],
    [0.83, -0.52],
    [-0.86, -0.2],
    [0.12, 0.88],
    [0.49, -0.82],
  ] as const;
  const dots = samples.map(
    ([x, y]) =>
      new Dot({
        point: point(x, y),
        radius: 0.052,
        color: palette.output,
        fillOpacity: 0.9,
      }),
  );
  const priorVisual = new VGroup(prior, label);
  const dotLag = 0.08;
  return {
    roots: [priorVisual, ...dots],
    entrance: [
      new FadeIn(priorVisual, {
        duration: RECAP_DURATION,
        scale: 0.4,
        rateFunc: easeOutBack,
      }),
    ],
    // As above, top-level fades keep seek-time visibility exact while the
    // delayed rates reproduce the source LaggedStart.
    motion: dots.map(
      (dot, index) =>
        new FadeIn(dot, {
          duration: RECAP_DURATION,
          scale: 0.3,
          rateFunc: staggeredRate(index, dots.length, dotLag),
        }),
    ),
  };
}

function diffusionMicro(context: EsapSceneContext): MicroPlan {
  const { palette } = context;
  const rng = context.rng.fork('outro-diffusion');
  const dots = Array.from(
    { length: 40 },
    () =>
      new Dot({
        point: point(rng.range(-1.75, 1.75), rng.range(-1.5, 1.5)),
        radius: 0.04,
        color: palette.latent,
        fillOpacity: 0.7,
      }),
  );
  const motions = dots.map((dot, index) => {
    const angle = (index * Math.PI * 2) / dots.length;
    return dot.animate
      .withDuration(RECAP_DURATION)
      .moveTo(point(1.15 * Math.cos(angle), 1.15 * Math.sin(angle)))
      .setColor(palette.input);
  });
  return {
    roots: dots,
    entrance: dots.map(
      (dot) =>
        new FadeIn(dot, {
          duration: RECAP_DURATION,
          scale: 0.4,
          rateFunc: easeOutBack,
        }),
    ),
    motion: [new AnimationGroup(motions)],
  };
}

function flowMicro(context: EsapSceneContext): MicroPlan {
  const { palette } = context;
  const rng = context.rng.fork('outro-flow');
  const sources = Array.from({ length: 6 }, () => point(-2, rng.range(-1.35, 1.35)));
  const destinations = Array.from({ length: 6 }, () => point(2, rng.range(-1.35, 1.35)));
  const lines = sources.map((source, index) =>
    new Line({
      start: source,
      end: destinations[index],
      color: palette.dim,
      strokeWidth: 1.1,
    }).setStroke(palette.dim, 1.1, 0.6),
  );
  const streamlines = new VGroup(...lines);
  const movers = sources.map(
    (source) =>
      new Dot({
        point: source,
        radius: 0.05,
        color: palette.parameter,
      }),
  );
  return {
    roots: [streamlines, ...movers],
    entrance: [
      new FadeIn(streamlines, {
        duration: RECAP_DURATION,
        scale: 0.4,
        rateFunc: easeOutBack,
      }),
    ],
    motion: [
      new AnimationGroup(
        movers.map((mover, index) =>
          mover.animate.withDuration(RECAP_DURATION).moveTo(destinations[index]),
        ),
      ),
    ],
  };
}

function guidanceMicro(palette: EsapPalette): MicroPlan {
  const before = [0.2, 0.35, 0.28, 0.17];
  const after = [0.06, 0.62, 0.22, 0.1];
  const bars = before.map((height, index) => {
    const x = (index - 1.5) * 0.82;
    return new Rectangle({
      width: 0.56,
      height: 2.5 * height,
      center: point(x, -1 + 1.25 * height),
      color: palette.latent,
      fillOpacity: 0.5,
      strokeWidth: 1.2,
    }).setFill(palette.latent, 0.5);
  });
  const motions = bars.map((bar, index) => {
    const height = 2.5 * after[index];
    const x = (index - 1.5) * 0.82;
    return bar.animate
      .withDuration(RECAP_DURATION)
      .stretchToFitHeight(height)
      .moveTo(point(x, -1 + height / 2))
      .setFill(palette.valid, 0.55)
      .setStroke(palette.valid, 1.2, 1);
  });
  return {
    roots: bars,
    entrance: bars.map(
      (bar) =>
        new FadeIn(bar, {
          duration: RECAP_DURATION,
          scale: 0.4,
          rateFunc: easeOutBack,
        }),
    ),
    motion: [new AnimationGroup(motions)],
  };
}

async function createMicro(index: number, context: EsapSceneContext): Promise<MicroPlan> {
  switch (index) {
    case 0:
      return neuralNetworkMicro(context.palette);
    case 1:
      return optimizationMicro(context.palette);
    case 2:
      return attentionMicro(context.palette);
    case 3:
      return adaptationMicro(context);
    case 4:
      return vaeMicro(context);
    case 5:
      return diffusionMicro(context);
    case 6:
      return flowMicro(context);
    case 7:
      return guidanceMicro(context.palette);
    default:
      throw new RangeError(`Unknown recap micro ${index}`);
  }
}

async function createRecapSlide(
  context: EsapSceneContext,
  definition: RecapDefinition,
  index: number,
): Promise<RecapSlide> {
  const color = context.palette[definition.color];
  const title = await context.formula.label(definition.title, {
    color,
    fontSize: 42,
    maxWidth: 10,
    maxHeight: 0.62,
    position: [0, 3.15, 0],
    fitStage: false,
  });
  const rule = new Line({
    start: [-3.25, 2.58, 0],
    end: [3.25, 2.58, 0],
    color,
    strokeWidth: 2.5,
  });
  const rowY = [1.22, 0, -1.22] as const;
  const rows = await Promise.all(
    definition.formulas.map((source, rowIndex) =>
      context.formula.math(source, {
        color: context.palette.ink,
        fontSize: 38,
        maxWidth: 6.95,
        maxHeight: 0.74,
        position: [-3.12, rowY[rowIndex], 0],
        fitStage: false,
      }),
    ),
  );
  const micro = await createMicro(index, context);

  return {
    roots: [title, rule, ...rows, ...micro.roots],
    title,
    rule,
    formulaRows: rows,
    micro,
  };
}

async function showRecap(
  context: EsapSceneContext,
  slide: RecapSlide,
  index: number,
  outgoing: readonly Mobject[],
  starfield?: VGroup,
): Promise<void> {
  const side = index % 2 === 0 ? -1.4 : 1.4;
  const rowLag = 0.16;
  await context.clock.play(
    context.scene,
    ...outgoing.map((mobject) => new Remove(mobject)),
    ...(starfield ? [new Add(starfield)] : []),
    new FadeIn(slide.title, {
      duration: RECAP_DURATION,
      shift: [0, -0.55, 0],
      scale: 1.12,
      rateFunc: easeOutBack,
    }),
    new GrowFromCenter(slide.rule, { duration: RECAP_DURATION }),
    ...slide.formulaRows.map(
      (row, rowIndex) =>
        new FadeIn(row, {
          duration: RECAP_DURATION,
          shift: [side, -0.12, 0],
          scale: 1.05,
          rateFunc: staggeredRate(rowIndex, slide.formulaRows.length, rowLag),
        }),
    ),
    ...slide.micro.entrance,
    ...slide.micro.motion,
  );
}

async function buildGeneratorTable(
  context: EsapSceneContext,
  outgoing: readonly Mobject[],
): Promise<readonly Mobject[]> {
  const chip = await context.formula.label('KNOW THE GENERATOR BY ITS SIGNATURE', {
    color: context.palette.ink,
    fontSize: 32,
    maxWidth: 8.8,
    maxHeight: 0.42,
    position: [0, 3.08, 0],
    fitStage: false,
  });

  const xColumns = [-4.1, 0.4, 4.3] as const;
  const headerY = 1.95;
  const headers = await Promise.all(
    ['MODEL', 'STATE', 'SAMPLING'].map((copy, index) =>
      context.formula.label(copy, {
        color: context.palette.dim,
        fontSize: 20,
        maxHeight: 0.3,
        position: [xColumns[index], headerY, 0],
        fitStage: false,
      }),
    ),
  );
  const headerGroup = new VGroup(...headers);
  const headerRule = new Line({
    start: [-6.2, headerY - 0.36, 0],
    end: [6.2, headerY - 0.36, 0],
    color: context.palette.dim,
    strokeWidth: 1.4,
  });

  const rowGroups = await Promise.all(
    GENERATORS.map(async (definition, index) => {
      const rowY = headerY - 0.82 - index * 0.66;
      const color = context.palette[definition.color];
      const model = await context.formula.label(definition.model, {
        color,
        fontSize: 21,
        maxWidth: 2.55,
        maxHeight: 0.32,
        position: [xColumns[0], rowY, 0],
        fitStage: false,
      });
      const state = escapeLatexText(definition.state);
      const sampling = escapeLatexText(definition.sampling);
      const [stateCell, samplingCell] = await Promise.all([
        context.formula.math(String.raw`\textsf{${state}}`, {
          color: context.palette.ink,
          fontSize: 22,
          maxWidth: 3.4,
          maxHeight: 0.34,
          position: [xColumns[1], rowY, 0],
          fitStage: false,
        }),
        context.formula.math(String.raw`\textsf{${sampling}}`, {
          color: context.palette.dim,
          fontSize: 22,
          maxWidth: 3.45,
          maxHeight: 0.34,
          position: [xColumns[2], rowY, 0],
          fitStage: false,
        }),
      ]);
      return new VGroup(model, stateCell, samplingCell);
    }),
  );

  const tableParts: readonly Mobject[] = [headerGroup, headerRule, ...rowGroups];
  const tableLeft = Math.min(...tableParts.map((mobject) => mobject.getLeft()[0]));
  const tableRight = Math.max(...tableParts.map((mobject) => mobject.getRight()[0]));
  const tableBottom = Math.min(...tableParts.map((mobject) => mobject.getBottom()[1]));
  const tableTop = Math.max(...tableParts.map((mobject) => mobject.getTop()[1]));
  const frame = new RoundedRectangle({
    width: tableRight - tableLeft + 0.7,
    height: tableTop - tableBottom + 0.7,
    center: [(tableLeft + tableRight) / 2, (tableBottom + tableTop) / 2, 0],
    cornerRadius: 0.12,
    color: context.palette.parameter,
    fillOpacity: 0,
    strokeWidth: 2,
  });

  const tableBeats = [...barBeats(66), ...barBeats(67)];
  await context.clock.hit(
    context.scene,
    framedCue(context, bar(66)),
    ...outgoing.map((mobject) => new Remove(mobject)),
    new Add(chip),
    new FadeIn(headerGroup, { duration: 0.4 }),
    new Create(headerRule, { duration: 0.4 }),
  );
  for (let row = 0; row < rowGroups.length; row += 1) {
    await context.clock.hit(
      context.scene,
      framedCue(context, tableBeats[row]),
      new FadeIn(rowGroups[row], {
        duration: 0.4,
        shift: [0.25, 0, 0],
      }),
    );
  }
  await context.clock.hit(
    context.scene,
    framedCue(context, tableBeats[7]),
    new Create(frame, { duration: 0.5 }),
  );

  return [chip, headerGroup, headerRule, ...rowGroups, frame];
}

function tableCenter(mobjects: readonly Mobject[]): Vector3Tuple {
  const left = Math.min(...mobjects.map((mobject) => mobject.getLeft()[0]));
  const right = Math.max(...mobjects.map((mobject) => mobject.getRight()[0]));
  const bottom = Math.min(...mobjects.map((mobject) => mobject.getBottom()[1]));
  const top = Math.max(...mobjects.map((mobject) => mobject.getTop()[1]));
  return [(left + right) / 2, (bottom + top) / 2, 0];
}

function dimmedTableTarget(mobject: Mobject, center: Vector3Tuple): Mobject {
  const target = mobject.copy();
  const sourceCenter = mobject.getCenter();
  target.scale(0.5);
  target.moveTo([
    (sourceCenter[0] - center[0]) * 0.5,
    (sourceCenter[1] - center[1]) * 0.5,
    (sourceCenter[2] - center[2]) * 0.5,
  ]);
  for (const member of target.getFamily()) member.setOpacity(0.15);
  return target;
}

export const outroScene = defineEsapScene({
  id: 'outro',
  title: 'Review map',
  status: 'implemented',
  async build(context) {
    const { scene, clock, formula, palette } = context;
    const starfield = createStarfield(context, { count: 60 });
    starfield.setZIndex(-10);

    const recapBeats = [62, 63, 64, 65].flatMap((barNumber) => [...barBeats(barNumber)]);
    let currentSlide: RecapSlide | undefined;

    for (let index = 0; index < RECAPS.length; index += 1) {
      const cue = framedCue(context, recapBeats[index * 2]);
      const outgoing = currentSlide?.roots ?? [];
      await clock.waitUntil(scene, cue);
      const nextSlide = await createRecapSlide(context, RECAPS[index], index);
      await showRecap(context, nextSlide, index, outgoing, index === 0 ? starfield : undefined);
      currentSlide = nextSlide;
    }

    const tableRoots = await buildGeneratorTable(context, currentSlide?.roots ?? []);

    const finalCue = framedCue(context, bar(68));
    await clock.waitUntil(scene, finalCue);
    const originalTableCenter = tableCenter(tableRoots);
    await clock.play(
      scene,
      ...tableRoots.map(
        (mobject) =>
          new Transform(mobject, dimmedTableTarget(mobject, originalTableCenter), {
            duration: 0.7,
          }),
      ),
    );

    const message = await formula.title('YOU KNOW THIS.', {
      color: palette.ink,
      fontSize: 60,
      maxWidth: 6.5,
      maxHeight: 1.4,
      position: [0, 0, 0],
      fitStage: false,
    });
    const subtitle = await formula.caption('good luck.', {
      color: palette.parameter,
      fontSize: 42,
      maxWidth: 4.2,
      maxHeight: 0.55,
      position: [0, -0.82, 0],
      fitStage: false,
    });

    // The largest, longest contour reveal in the outro is deliberately reserved
    // for the final recognition beat.
    await clock.play(
      scene,
      new Write(message, {
        duration: 0.9,
        lagRatio: 0.28,
        strokeRatio: 0.86,
        rateFunc: smooth,
      }),
    );
    await clock.play(
      scene,
      new FadeIn(subtitle, {
        duration: 0.5,
        shift: [0, 0.15, 0],
      }),
    );

    await clock.waitUntil(scene, framedCue(context, BEATS[BEATS.length - 1]));
    const shade = new Rectangle({
      width: 15.6,
      height: 9.6,
      center: [0, 0, 0],
      color: '#000000',
      fillOpacity: 1,
      strokeWidth: 0,
    });
    shade.setZIndex(80);
    await clock.play(scene, new FadeIn(shade, { duration: 1.6 }));
    await clock.finish(scene);
  },
});
