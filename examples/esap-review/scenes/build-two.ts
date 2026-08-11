import {
  Animation,
  Create,
  Dot,
  FadeIn,
  LaggedStart,
  Mobject,
  Rectangle,
  Remove,
  Square,
  Transform,
  VGroup,
  Write,
  type Vector3Tuple,
} from '../../../src/index.ts';
import { SeededRng } from '../rng';
import { CUTOUTS, barBeats } from '../timing';
import { createStarfield, titleChip } from './helpers';
import { defineEsapScene, type EsapSceneContext } from './types';

const FRAME = 1 / 60;
const STAGE_DIMENSIONS: [number, number] = [14.22, 8];

function laggedChildDuration(total: number, count: number, lagRatio: number): number {
  return count <= 1 ? total : total / (1 + (count - 1) * lagRatio);
}

function gaussian(rng: SeededRng): number {
  const first = Math.max(Number.EPSILON, rng.next());
  const second = rng.next();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function interpolateHex(start: string, end: string, alpha: number): string {
  const cleanStart = start.replace('#', '');
  const cleanEnd = end.replace('#', '');
  const channels = [0, 2, 4].map((offset) => {
    const from = Number.parseInt(cleanStart.slice(offset, offset + 2), 16);
    const to = Number.parseInt(cleanEnd.slice(offset, offset + 2), 16);
    return Math.round(from + (to - from) * alpha)
      .toString(16)
      .padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

interface CloudStyle {
  readonly color: string;
  readonly opacity: number;
}

/**
 * One absolute cloud step. Explicit endpoints keep every seek deterministic,
 * even though several beat-level transitions target the same 90 dots.
 */
class PointCloudTween extends Animation {
  private readonly _dots: readonly Dot[];
  private readonly _clean: readonly Vector3Tuple[];
  private readonly _from: readonly Vector3Tuple[];
  private readonly _to: readonly Vector3Tuple[];
  private readonly _cleanStyle: CloudStyle;
  private readonly _fromStyle: CloudStyle;
  private readonly _toStyle: CloudStyle;

  constructor(
    dots: readonly Dot[],
    clean: readonly Vector3Tuple[],
    from: readonly Vector3Tuple[],
    to: readonly Vector3Tuple[],
    cleanStyle: CloudStyle,
    fromStyle: CloudStyle,
    toStyle: CloudStyle,
    duration: number,
  ) {
    if (dots.length === 0) throw new Error('PointCloudTween requires at least one dot');
    super(dots[0], { duration });
    this._dots = dots;
    this._clean = clean;
    this._from = from;
    this._to = to;
    this._cleanStyle = cleanStyle;
    this._fromStyle = fromStyle;
    this._toStyle = toStyle;
  }

  override begin(): void {
    super.begin();
    this.interpolate(0);
  }

  interpolate(alpha: number): void {
    const color = interpolateHex(this._fromStyle.color, this._toStyle.color, alpha);
    const opacity =
      this._fromStyle.opacity + (this._toStyle.opacity - this._fromStyle.opacity) * alpha;
    this._dots.forEach((dot, index) => {
      const from = this._from[index];
      const to = this._to[index];
      dot.moveTo([
        from[0] + (to[0] - from[0]) * alpha,
        from[1] + (to[1] - from[1]) * alpha,
        from[2] + (to[2] - from[2]) * alpha,
      ]);
      dot.setFill(color, opacity);
      dot.setStroke(color, 0, opacity);
    });
  }

  override finish(): void {
    this.interpolate(1);
    super.finish();
  }

  override reset(): void {
    super.reset();
    this._dots.forEach((dot, index) => {
      dot.moveTo(this._clean[index]);
      dot.setFill(this._cleanStyle.color, this._cleanStyle.opacity);
      dot.setStroke(this._cleanStyle.color, 0, this._cleanStyle.opacity);
    });
  }
}

function jitteredCloud(
  from: readonly Vector3Tuple[],
  rng: SeededRng,
  standardDeviation: number,
): Vector3Tuple[] {
  return from.map((point) => [
    point[0] + gaussian(rng) * standardDeviation,
    point[1] + gaussian(rng) * standardDeviation,
    point[2],
  ]);
}

function gaugeTarget(
  frame: Rectangle,
  width: number,
  color: string,
  anchor: 'left' | 'center' = 'left',
): Rectangle {
  const target = new Rectangle({
    width,
    height: 0.42,
    color,
    fillOpacity: 0.5,
    strokeWidth: 0,
    center: frame.getCenter(),
  });
  target.setFill(color, 0.5);
  if (anchor === 'left') {
    target.alignTo(frame, [-1, 0, 0]);
  }
  return target;
}

interface Token {
  readonly root: VGroup;
  readonly maskedTarget: VGroup;
}

async function tokenAt(
  context: EsapSceneContext,
  copy: string,
  center: Vector3Tuple,
): Promise<Token> {
  const { formula, palette } = context;
  const square = new Square({
    sideLength: 0.62,
    color: palette.output,
    fillOpacity: 0.18,
    strokeWidth: 1.8,
    center,
  });
  square.setFill(palette.output, 0.18);
  const label = await formula.math(copy, {
    color: palette.output,
    fontSize: 30,
    position: center,
    fitStage: false,
  });

  const maskedSquare = new Square({
    sideLength: 0.62,
    color: palette.latent,
    fillOpacity: 0.5,
    strokeWidth: 2,
    center,
  });
  maskedSquare.setFill(palette.latent, 0.5);
  const maskedLabel = await formula.math('M', {
    color: palette.latent,
    fontSize: 30,
    position: center,
    fitStage: false,
  });
  return {
    root: new VGroup(square, label),
    maskedTarget: new VGroup(maskedSquare, maskedLabel),
  };
}

export const buildTwoScene = defineEsapScene({
  id: 'build-2',
  title: 'Representation learning',
  status: 'implemented',
  async build(context) {
    const { scene, clock, formula, palette } = context;
    const starfield = createStarfield({ rng: new SeededRng(53), palette }, { count: 55 });
    const chip = await titleChip(context, 'forward noising', {
      color: palette.latent,
    });
    chip.toCorner([-1, 1, 0], 0.45, STAGE_DIMENSIONS);

    const pointCount = 90;
    const cleanPoints: Vector3Tuple[] = Array.from({ length: pointCount }, (_unused, index) => {
      const t = 0.35 + ((2.6 * Math.PI * 2) / 3 + 2.2 - 0.35) * (index / (pointCount - 1));
      return [0.16 * t * Math.cos(1.9 * t) - 2.6, 0.16 * t * Math.sin(1.9 * t) + 0.3, 0];
    });
    const dots = cleanPoints.map((point) => {
      const dot = new Dot({
        point,
        radius: 0.045,
        color: palette.input,
        fillOpacity: 0.9,
      });
      dot.setFill(palette.input, 0.9);
      return dot;
    });
    const cloudLabel = await formula.math(String.raw`x_0`, {
      color: palette.input,
      fontSize: 35,
      position: [-2.6, 2.05, 0],
      fitStage: false,
    });

    const gaugeFrame = new Rectangle({
      width: 3.2,
      height: 0.42,
      color: palette.dim,
      strokeWidth: 1.6,
      center: [3.6, 2.3, 0],
    });
    const alphaGauge = gaugeTarget(gaugeFrame, 3.2, palette.valid);
    const alphaLabel = await formula.math(String.raw`\bar\alpha_t=\textstyle\prod_s\alpha_s`, {
      color: palette.valid,
      fontSize: 30,
      position: [3.6, 2.86, 0],
      maxWidth: 4.9,
    });
    const transitionLaw = await formula.math(
      String.raw`q(x_t\mid x_{t-1})=\mathcal N\!\left(\sqrt{\alpha_t}\,x_{t-1},\,(1-\alpha_t)I\right)`,
      {
        color: palette.ink,
        fontSize: 31,
        position: [3.4, 1.1, 0],
        maxWidth: 6.25,
      },
    );

    const bar42 = barBeats(42);
    const dotFadeDuration = laggedChildDuration(0.6, dots.length, 0.008);
    await clock.hit(
      scene,
      bar42[0],
      new FadeIn(starfield, { duration: FRAME, rateFunc: () => 1 }),
      new FadeIn(chip, { duration: FRAME, rateFunc: () => 1 }),
      new LaggedStart(
        dots.map(
          (dot) =>
            new FadeIn(dot, {
              duration: dotFadeDuration,
              scale: 0.3,
            }),
        ),
        { lagRatio: 0.008 },
      ),
      new FadeIn(cloudLabel, { duration: 0.6 }),
      new Create(gaugeFrame, { duration: 0.6 }),
      new FadeIn(alphaGauge, { duration: 0.6 }),
      new Write(alphaLabel, { duration: 0.6 }),
    );
    await clock.hit(scene, bar42[1], new Write(transitionLaw, { duration: 0.5 }));

    const inputStyle = { color: palette.input, opacity: 0.9 } as const;
    const noisingRng = new SeededRng(3);
    const firstNoising = jitteredCloud(cleanPoints, noisingRng, 0.16);
    const secondNoising = jitteredCloud(firstNoising, noisingRng, 0.26);
    await clock.hit(
      scene,
      bar42[2],
      new PointCloudTween(
        dots,
        cleanPoints,
        cleanPoints,
        firstNoising,
        inputStyle,
        inputStyle,
        inputStyle,
        0.4,
      ),
      new Transform(alphaGauge, gaugeTarget(gaugeFrame, 3.2 * 0.78, palette.valid), {
        duration: 0.4,
      }),
    );
    await clock.hit(
      scene,
      bar42[3],
      new PointCloudTween(
        dots,
        cleanPoints,
        firstNoising,
        secondNoising,
        inputStyle,
        inputStyle,
        inputStyle,
        0.4,
      ),
      new Transform(alphaGauge, gaugeTarget(gaugeFrame, 3.2 * 0.6, palette.valid), {
        duration: 0.4,
      }),
    );

    const marginal = await formula.math(
      String.raw`x_t=\sqrt{\bar\alpha_t}\,x_0+\sqrt{1-\bar\alpha_t}\,\epsilon`,
      {
        color: palette.parameter,
        fontSize: 35,
        position: [3.4, -0.08, 0],
        maxWidth: 6.2,
      },
    );
    const jumpCaption = await formula.caption('jump to ANY t in one shot — no chain needed', {
      color: palette.parameter,
      fontSize: 24,
      position: [3.4, -0.75, 0],
      maxWidth: 6.2,
    });
    const tokenCopies = ['A', 'C', 'G', 'T', 'C', 'A', 'G'] as const;
    const tokens = await Promise.all(
      tokenCopies.map((copy, index) => tokenAt(context, copy, [-5 + index * 0.78, -2.35, 0])),
    );
    const maskLaw = await formula.math(
      String.raw`q(x_t^\ell\mid x_0^\ell)=\alpha(t)\,\delta_{x_0^\ell}+[1-\alpha(t)]\,\delta_M`,
      {
        color: palette.ink,
        fontSize: 29,
        position: [3.4, -1.8, 0],
        maxWidth: 6.25,
      },
    );
    const absorbingCaption = await formula.caption('absorbing: once masked, stays masked', {
      color: palette.latent,
      fontSize: 24,
      position: [3.4, -2.52, 0],
      maxWidth: 5.9,
    });

    const bar43 = barBeats(43);
    await clock.hit(
      scene,
      bar43[0],
      new Write(marginal, { duration: 0.55 }),
      new FadeIn(jumpCaption, { duration: 0.55 }),
    );
    await clock.hit(
      scene,
      bar43[1],
      ...tokens.map(
        ({ root }) =>
          new FadeIn(root, {
            duration: 0.55,
            shift: [0, 0.2, 0],
          }),
      ),
      new Write(maskLaw, { duration: 0.55 }),
    );

    const corruptionRng = new SeededRng(11);
    // Match the reference stream: it draws (then intentionally does not use)
    // one extra cloud-sized normal sample before the beat-level corruption.
    for (let index = 0; index < pointCount * 2; index += 1) gaussian(corruptionRng);
    const corruptionStates: Vector3Tuple[][] = [secondNoising];
    for (let index = 0; index < 6; index += 1) {
      corruptionStates.push(
        jitteredCloud(corruptionStates[corruptionStates.length - 1], corruptionRng, 0.13),
      );
    }
    const maskOrder = [1, 4, 0, 6, 2, 5] as const;
    const corruptionBeats = [...bar43.slice(2), ...barBeats(44)];
    const translucentStyle = { color: palette.input, opacity: 0.75 } as const;
    for (let index = 0; index < corruptionBeats.length; index += 1) {
      const animations: Animation[] = [
        new PointCloudTween(
          dots,
          cleanPoints,
          corruptionStates[index],
          corruptionStates[index + 1],
          inputStyle,
          index === 0 ? inputStyle : translucentStyle,
          translucentStyle,
          0.4,
        ),
        new Transform(tokens[maskOrder[index]].root, tokens[maskOrder[index]].maskedTarget, {
          duration: 0.4,
        }),
      ];
      if (index === 2) {
        animations.push(new FadeIn(absorbingCaption, { duration: 0.4 }));
      }
      await clock.hit(scene, corruptionBeats[index], ...animations);
    }

    const finalNoiseRng = new SeededRng(29);
    const noisePoints: Vector3Tuple[] = Array.from({ length: pointCount }, () => [
      finalNoiseRng.range(-4.6, -0.6),
      finalNoiseRng.range(-1.4, 2),
      0,
    ]);
    const noiseStyle = { color: palette.latent, opacity: 0.55 } as const;
    await clock.hit(
      scene,
      CUTOUTS[1],
      new PointCloudTween(
        dots,
        cleanPoints,
        corruptionStates[corruptionStates.length - 1],
        noisePoints,
        inputStyle,
        translucentStyle,
        noiseStyle,
        0.5,
      ),
      new Transform(tokens[3].root, tokens[3].maskedTarget, { duration: 0.5 }),
      new Transform(alphaGauge, gaugeTarget(gaugeFrame, 0.02, palette.valid, 'center'), {
        duration: 0.5,
      }),
    );

    const reverseCaption = await formula.label('now run it backwards.', {
      color: palette.ink,
      fontSize: 39,
      position: [-2.6, 2.9, 0],
      maxWidth: 6.4,
    });
    await clock.hold(scene, 0.7);
    await clock.play(
      scene,
      new FadeIn(reverseCaption, {
        duration: 0.8,
        shift: [0, 0.15, 0],
      }),
    );

    const roots: Mobject[] = [
      starfield,
      chip,
      ...dots,
      cloudLabel,
      gaugeFrame,
      alphaGauge,
      alphaLabel,
      transitionLaw,
      marginal,
      jumpCaption,
      ...tokens.map(({ root }) => root),
      maskLaw,
      absorbingCaption,
      reverseCaption,
    ];
    // Leave the final noise tableau frozen to the last frame. The following
    // drop module owns the two-frame white slam, just as in the Python source.
    await clock.holdExact(scene, clock.remaining);
    await clock.play(scene, ...roots.map((mobject) => new Remove(mobject)));
  },
});
