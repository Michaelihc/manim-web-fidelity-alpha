import {
  Animation,
  ArcBetweenPoints,
  Arrow,
  Axes,
  Circle,
  Create,
  CurvedArrow,
  Dot,
  FadeIn,
  FadeOut,
  GrowArrow,
  Indicate,
  LaggedStart,
  Line,
  Mobject,
  Rectangle,
  ReplacementTransform,
  Rotate,
  RoundedRectangle,
  Square,
  Transform,
  VGroup,
  Write,
  type Vector3Tuple,
} from '../../../src/index.ts';
import { paletteFor, type EsapPalette, type PaletteMode } from '../palette';
import { SeededRng } from '../rng';
import { barBeats, frameAlignedSectionCue } from '../timing';
import { createBackdrop, createStarfield, titleChip } from './helpers';
import { defineEsapScene, type EsapSceneContext } from './types';

const FRAME = 1 / 60;

/** Keep the outgoing section visible through its final owned output frame. */
function endStepRate(alpha: number): number {
  return alpha < 1 ? 0 : 1;
}
const STAGE_SIZE: [number, number] = [14.22, 8];

function filledRectangle(
  width: number,
  height: number,
  color: string,
  opacity: number,
  center: Vector3Tuple,
  strokeWidth = 2,
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
  strokeWidth = 1,
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

function roundedBlock(
  width: number,
  height: number,
  color: string,
  opacity: number,
  center: Vector3Tuple,
): RoundedRectangle {
  const block = new RoundedRectangle({
    width,
    height,
    cornerRadius: 0.12,
    color,
    fillOpacity: opacity,
    strokeWidth: 2,
    center,
  });
  block.setFill(color, opacity);
  return block;
}

async function matrixBlock(
  context: EsapSceneContext,
  width: number,
  height: number,
  color: string,
  label: string,
  center: Vector3Tuple,
): Promise<VGroup> {
  const rectangle = filledRectangle(width, height, color, 0.2, center, 2.2);
  const text = await context.formula.math(label, {
    color,
    fontSize: 48,
    position: center,
    fitStage: false,
  });
  return new VGroup(rectangle, text);
}

function midpoint(start: Vector3Tuple, end: Vector3Tuple): Vector3Tuple {
  return [(start[0] + end[0]) * 0.5, (start[1] + end[1]) * 0.5, (start[2] + end[2]) * 0.5];
}

function interpolateHex(start: string, end: string, alpha: number): string {
  const amount = Math.max(0, Math.min(1, alpha));
  const cleanStart = start.replace('#', '');
  const cleanEnd = end.replace('#', '');
  const channels = [0, 2, 4].map((offset) => {
    const from = Number.parseInt(cleanStart.slice(offset, offset + 2), 16);
    const to = Number.parseInt(cleanEnd.slice(offset, offset + 2), 16);
    return Math.round(from + (to - from) * amount)
      .toString(16)
      .padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

class PoseAnimation extends Animation {
  private readonly _targetPosition: Vector3Tuple;
  private readonly _targetScale: Vector3Tuple;
  private _startPosition: Vector3Tuple = [0, 0, 0];
  private _startScale: Vector3Tuple = [1, 1, 1];

  constructor(mobject: Mobject, target: Mobject, duration: number) {
    super(mobject, { duration });
    this._targetPosition = [target.position.x, target.position.y, target.position.z];
    this._targetScale = [target.scaleVector.x, target.scaleVector.y, target.scaleVector.z];
  }

  override begin(): void {
    super.begin();
    this._startPosition = [
      this.mobject.position.x,
      this.mobject.position.y,
      this.mobject.position.z,
    ];
    this._startScale = [
      this.mobject.scaleVector.x,
      this.mobject.scaleVector.y,
      this.mobject.scaleVector.z,
    ];
  }

  override interpolate(alpha: number): void {
    const amount = Math.max(0, Math.min(1, alpha));
    this.mobject.position.set(
      this._startPosition[0] + (this._targetPosition[0] - this._startPosition[0]) * amount,
      this._startPosition[1] + (this._targetPosition[1] - this._startPosition[1]) * amount,
      this._startPosition[2] + (this._targetPosition[2] - this._startPosition[2]) * amount,
    );
    this.mobject.scaleVector.set(
      this._startScale[0] + (this._targetScale[0] - this._startScale[0]) * amount,
      this._startScale[1] + (this._targetScale[1] - this._startScale[1]) * amount,
      this._startScale[2] + (this._targetScale[2] - this._startScale[2]) * amount,
    );
    this.mobject._markDirty();
  }

  override finish(): void {
    this.interpolate(1);
    super.finish();
  }
}

interface PaintStyleTarget {
  readonly fillColor: string;
  readonly fillOpacity: number;
  readonly strokeColor: string;
  readonly strokeOpacity: number;
  readonly strokeWidth: number;
  readonly duration: number;
}

class PaintStyleAnimation extends Animation {
  private readonly _target: PaintStyleTarget;
  private _startFillColor = '#FFFFFF';
  private _startStrokeColor = '#FFFFFF';
  private _startFillOpacity = 0;
  private _startStrokeOpacity = 1;
  private _startStrokeWidth = 1;

  constructor(mobject: Mobject, target: PaintStyleTarget) {
    super(mobject, { duration: target.duration });
    this._target = target;
  }

  override begin(): void {
    super.begin();
    this._startFillColor = this.mobject.fillColor ?? this.mobject.color;
    this._startStrokeColor = this.mobject.strokeColor ?? this.mobject.color;
    this._startFillOpacity = this.mobject.fillOpacity;
    this._startStrokeOpacity = this.mobject.opacity;
    this._startStrokeWidth = this.mobject.strokeWidth;
  }

  override interpolate(alpha: number): void {
    const amount = Math.max(0, Math.min(1, alpha));
    this.mobject.setFill(
      interpolateHex(this._startFillColor, this._target.fillColor, amount),
      this._startFillOpacity + (this._target.fillOpacity - this._startFillOpacity) * amount,
    );
    this.mobject.setStroke(
      interpolateHex(this._startStrokeColor, this._target.strokeColor, amount),
      this._startStrokeWidth + (this._target.strokeWidth - this._startStrokeWidth) * amount,
      this._startStrokeOpacity + (this._target.strokeOpacity - this._startStrokeOpacity) * amount,
    );
  }

  override finish(): void {
    this.interpolate(1);
    super.finish();
  }
}

class DropOneStage {
  private readonly _context: EsapSceneContext;
  private _active: Mobject[] = [];
  private _mode: PaletteMode = 'dark';
  private _starfield: VGroup | null = null;

  constructor(context: EsapSceneContext) {
    this._context = context;
  }

  useMode(mode: PaletteMode): EsapPalette {
    this._mode = mode;
    this._context.formula.setMode(mode);
    return paletteFor(mode);
  }

  track(...mobjects: Mobject[]): void {
    for (const mobject of mobjects) {
      if (!this._active.includes(mobject)) this._active.push(mobject);
    }
  }

  async beginPair(
    barNumber: number,
    chipCopy: string,
    palette: EsapPalette,
    firstRoots: readonly Mobject[],
    firstBeatAnimations: readonly Animation[],
  ): Promise<readonly number[]> {
    const { scene, clock, formula } = this._context;
    const beats = barBeats(barNumber);
    const backdrop = createBackdrop(palette);
    // The reference keeps one starfield for the whole section. Light scenes
    // place their paper above it; dark scenes place only a backing color below it.
    backdrop.setZIndex(this._mode === 'light' ? -9 : -11);
    const chip = await titleChip(
      {
        formula,
        palette,
      },
      chipCopy,
      {
        maxWidth: 5.6,
      },
    );
    chip.toCorner([-1, 1, 0], 0.45, STAGE_SIZE);

    const outgoing = this._active.map(
      (mobject) => new FadeOut(mobject, { duration: FRAME, rateFunc: () => 1 }),
    );
    await clock.hit(
      scene,
      frameAlignedSectionCue(this._context.timing, beats[0]),
      ...outgoing,
      new FadeIn(backdrop, { duration: FRAME, rateFunc: () => 1 }),
      new FadeIn(chip, { duration: FRAME, rateFunc: () => 1 }),
      ...firstBeatAnimations,
    );
    this._active = [backdrop, chip, ...firstRoots];
    return beats;
  }

  async beginDrop(title: Mobject, palette: EsapPalette): Promise<void> {
    const { scene, clock } = this._context;
    const flash = filledRectangle(15.6, 9.6, '#FFFFFF', 1, [0, 0, 0], 0);
    flash.setZIndex(60);
    const backdrop = createBackdrop(palette);
    backdrop.setZIndex(-9);
    this._starfield = createStarfield(
      {
        rng: new SeededRng(31),
        palette: paletteFor('dark'),
      },
      {
        count: 65,
      },
    );
    this._starfield.setZIndex(-10);

    await clock.play(scene, new FadeIn(flash, { duration: FRAME, rateFunc: () => 1 }));
    // The cut-in frame is already the first visible white frame, while the
    // cut-out segment lands on paper. Keep five additional white frames so the
    // encoded slam spans the reference's exact six frames.
    await clock.hold(scene, 0.1 - FRAME);
    await clock.play(
      scene,
      new FadeOut(flash, { duration: FRAME, rateFunc: () => 1 }),
      new FadeIn(backdrop, { duration: FRAME, rateFunc: () => 1 }),
      new FadeIn(this._starfield, { duration: FRAME, rateFunc: () => 1 }),
      new Write(title, { duration: 0.7 }),
    );
    this._active = [backdrop, title];
  }

  async finish(): Promise<void> {
    const { scene, clock } = this._context;
    await clock.holdExact(scene, Math.max(0, clock.remaining - FRAME));
    const outgoing = this._starfield ? [...this._active, this._starfield] : this._active;
    await clock.play(
      scene,
      ...outgoing.map(
        (mobject) => new FadeOut(mobject, { duration: FRAME, rateFunc: endStepRate }),
      ),
    );
  }
}

async function titleAndEmbeddings(stage: DropOneStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = stage.useMode('light');
  const title = await formula.title('TRANSFORMERS', {
    color: palette.ink,
    fontSize: 112,
    maxWidth: 10.8,
    position: [0, 0.25, 0],
    fitStage: false,
  });
  await stage.beginDrop(title, palette);

  const beats14 = barBeats(14);
  const titleTarget = title.copy();
  titleTarget.scale(0.36);
  titleTarget.toCorner([-1, 1, 0], 0.45, STAGE_SIZE);
  await clock.hit(scene, beats14[2], new PoseAnimation(title, titleTarget, 0.5));

  const idValues = [7, 12, 3, 41] as const;
  const idChips = new VGroup();
  for (let index = 0; index < idValues.length; index += 1) {
    const center: Vector3Tuple = [-5.65, 1.55 - index * 1.02, 0];
    const chip = roundedBlock(0.9, 0.62, palette.input, 0.06, center);
    const label = await formula.math(String(idValues[index]), {
      color: palette.input,
      fontSize: 36,
      position: center,
      fitStage: false,
    });
    idChips.add(new VGroup(chip, label));
  }

  const embeddingRows = new VGroup();
  const embeddingRowList: Rectangle[] = [];
  for (let index = 0; index < 9; index += 1) {
    const row = filledRectangle(2.5, 0.31, palette.dim, 0.12, [-1.35, 1.55 - index * 0.4, 0], 1);
    embeddingRows.add(row);
    embeddingRowList.push(row);
  }
  const embeddingLabel = await formula.math(String.raw`E\in\mathbb{R}^{|V|\times d}`, {
    color: palette.ink,
    fontSize: 39,
    position: [-1.35, 2.22, 0],
    fitStage: false,
  });

  const outputRows: Rectangle[] = [];
  for (let index = 0; index < idValues.length; index += 1) {
    outputRows.push(
      filledRectangle(2.5, 0.42, palette.parameter, 0.3, [3.65, 1.35 - index * 0.78, 0], 1.8),
    );
  }
  const outputLabel = await formula.math(String.raw`X=E[\mathrm{ids}]\in\mathbb{R}^{L\times d}`, {
    color: palette.parameter,
    fontSize: 38,
    position: [3.65, 2.2, 0],
    fitStage: false,
  });
  const caption = await formula.caption('IDs are indices — not magnitudes', {
    color: palette.dim,
    fontSize: 30,
    maxWidth: 7,
    position: [0, -3, 0],
    fitStage: false,
  });

  await clock.hit(
    scene,
    beats14[3],
    new FadeIn(idChips, { duration: 0.5, shift: [0.2, 0, 0] }),
    new FadeIn(embeddingRows, { duration: 0.5 }),
    new Write(embeddingLabel, { duration: 0.5 }),
  );
  stage.track(idChips, embeddingRows, embeddingLabel);

  const sourceRows = [1, 5, 2, 7] as const;
  const beats15 = barBeats(15);
  for (let index = 0; index < beats15.length; index += 1) {
    const highlight = embeddingRowList[sourceRows[index]].copy();
    highlight.setFill(palette.parameter, 0.5);
    highlight.setStroke(palette.parameter, 2, 1);
    const animations: Animation[] = [
      new ReplacementTransform(highlight, outputRows[index], { duration: 0.5 }),
    ];
    if (index === 0) animations.push(new Write(outputLabel, { duration: 0.5 }));
    if (index === 3) {
      animations.push(
        new FadeIn(caption, {
          duration: 0.4,
          shift: [0, 0.18, 0],
          scale: 0.95,
        }),
      );
    }
    await clock.hit(scene, beats15[index], ...animations);
    stage.track(outputRows[index]);
    if (index === 0) stage.track(outputLabel);
    if (index === 3) stage.track(caption);
  }
}

async function positionalInformation(
  stage: DropOneStage,
  context: EsapSceneContext,
): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = stage.useMode('light');
  const axes = new Axes({
    xRange: [0, 12, 1],
    yRange: [-1.4, 1.4, 1],
    xLength: 8.6,
    yLength: 3,
    color: palette.dim,
    axisConfig: {
      strokeWidth: 1.4,
      includeTicks: false,
    },
    tips: true,
  });
  axes.moveTo([0, 1, 0]);
  const frequencies = [
    { value: 1, color: palette.input },
    { value: 0.5, color: palette.output },
    { value: 0.25, color: palette.parameter },
    { value: 0.125, color: palette.loss },
  ] as const;
  const waves = frequencies.map(({ value, color }) =>
    axes.plot((x) => Math.sin(value * x), {
      xRange: [0, 12],
      color,
      strokeWidth: 3,
    }),
  );
  const positionFormula = await formula.math(
    String.raw`p_{i,2m}=\sin\!\left(\frac{i}{10000^{\frac{2m}{d}}}\right)\qquad p_{i,2m+1}=\cos\!\left(\frac{i}{10000^{\frac{2m}{d}}}\right)`,
    {
      color: palette.ink,
      fontSize: 38,
      maxWidth: 10.6,
      position: [0.55, -0.85, 0],
      fitStage: false,
    },
  );

  const ropeCircle = new Circle({
    radius: 0.72,
    color: palette.dim,
    strokeWidth: 1.4,
    center: [-3.8, -2.35, 0],
  });
  const ropeCenter = ropeCircle.getCenter();
  const ropeArrow = new Arrow({
    start: ropeCenter,
    end: [ropeCenter[0] + 0.72, ropeCenter[1], 0],
    color: palette.input,
    strokeWidth: 3.2,
    buff: 0,
  });
  const ropeLabel = await formula.math(String.raw`\widetilde q_i=R(i)\,q_i`, {
    color: palette.input,
    fontSize: 43,
    position: [-1.55, -2.05, 0],
    fitStage: false,
  });
  const ropeCaption = await formula.math(
    String.raw`\textsf{RoPE rotates }q,k\textsf{ by position; attention sees }j-i`,
    {
      color: palette.dim,
      fontSize: 28,
      maxWidth: 6.8,
      position: [-0.4, -2.9, 0],
      fitStage: false,
    },
  );

  const beats16 = barBeats(16);
  await stage.beginPair(
    16,
    'positional information',
    palette,
    [axes, waves[0]],
    [new Create(axes, { duration: 0.55 }), new Create(waves[0], { duration: 0.55 })],
  );
  for (let index = 1; index < waves.length; index += 1) {
    const animations: Animation[] = [new Create(waves[index], { duration: 0.55 })];
    if (index === waves.length - 1) {
      animations.push(new Write(positionFormula, { duration: 0.55 }));
    }
    await clock.hit(scene, beats16[index], ...animations);
    stage.track(waves[index]);
    if (index === waves.length - 1) stage.track(positionFormula);
  }

  const beats17 = barBeats(17);
  await clock.hit(
    scene,
    beats17[0],
    new Create(ropeCircle, { duration: 0.5 }),
    new GrowArrow(ropeArrow, { duration: 0.5 }),
    new Write(ropeLabel, { duration: 0.5 }),
  );
  stage.track(ropeCircle, ropeArrow, ropeLabel);
  await clock.hit(
    scene,
    beats17[1],
    new Rotate(ropeArrow, {
      angle: Math.PI / 3,
      aboutPoint: ropeCenter,
      duration: 0.5,
    }),
  );
  await clock.hit(
    scene,
    beats17[2],
    new Rotate(ropeArrow, {
      angle: Math.PI / 3,
      aboutPoint: ropeCenter,
      duration: 0.5,
    }),
    new FadeIn(ropeCaption, {
      duration: 0.4,
      shift: [0, 0.16, 0],
      scale: 0.96,
    }),
  );
  stage.track(ropeCaption);
  await clock.hit(
    scene,
    beats17[3],
    new Rotate(ropeArrow, {
      angle: Math.PI / 2,
      aboutPoint: ropeCenter,
      duration: 0.5,
    }),
  );
}

async function qkvProjections(stage: DropOneStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = stage.useMode('dark');
  const input = await matrixBlock(context, 1.65, 2.25, palette.ink, 'X', [-5.15, 0.45, 0]);
  const specifications = [
    { name: 'Q', color: palette.input, center: [2.55, 1.75, 0] as Vector3Tuple },
    { name: 'K', color: palette.loss, center: [2.55, 0.15, 0] as Vector3Tuple },
    { name: 'V', color: palette.parameter, center: [2.55, -1.45, 0] as Vector3Tuple },
  ] as const;
  const outputs: VGroup[] = [];
  const arrows: Arrow[] = [];
  const weightLabels: Mobject[] = [];
  for (const specification of specifications) {
    const output = await matrixBlock(
      context,
      1.45,
      1.2,
      specification.color,
      specification.name,
      specification.center,
    );
    const arrow = new Arrow({
      start: input.getRight(),
      end: output.getLeft(),
      color: specification.color,
      strokeWidth: 2.2,
      buff: 0.14,
    });
    const arrowMidpoint = midpoint(arrow.getStart(), arrow.getEnd());
    const weight = await formula.math(String.raw`W^{${specification.name}}`, {
      color: specification.color,
      fontSize: 36,
      position: [arrowMidpoint[0], arrowMidpoint[1] + 0.34, 0],
      fitStage: false,
    });
    outputs.push(output);
    arrows.push(arrow);
    weightLabels.push(weight);
  }
  const shape = await formula.math(
    String.raw`Q,K,V:\ B\times H\times L\times d_k\qquad d_k=\frac{d}{H}`,
    {
      color: palette.ink,
      fontSize: 38,
      maxWidth: 9.6,
      position: [0.2, -2.55, 0],
      fitStage: false,
    },
  );
  const slabs = new VGroup();
  for (let index = 0; index < 4; index += 1) {
    slabs.add(filledRectangle(0.34, 1.2, palette.input, 0.28, [4.65 + index * 0.43, 1.75, 0], 1.5));
  }
  const slabCaption = await formula.math(
    String.raw`d\textsf{ is sliced into }H\textsf{ heads; total width stays fixed}`,
    {
      color: palette.input,
      fontSize: 28,
      maxWidth: 9,
      position: [0.2, -3, 0],
      fitStage: false,
    },
  );

  const beats18 = barBeats(18);
  await stage.beginPair(
    18,
    'queries · keys · values',
    palette,
    [input],
    [new FadeIn(input, { duration: 0.5, scale: 0.8 })],
  );
  for (let index = 0; index < specifications.length; index += 1) {
    await clock.hit(
      scene,
      beats18[index + 1],
      new GrowArrow(arrows[index], { duration: 0.5 }),
      new FadeIn(weightLabels[index], { duration: 0.5 }),
      new FadeIn(outputs[index], {
        duration: 0.5,
        shift: [0.2, 0, 0],
      }),
    );
    stage.track(arrows[index], weightLabels[index], outputs[index]);
  }

  const beats19 = barBeats(19);
  await clock.hit(scene, beats19[0], new Write(shape, { duration: 0.5 }));
  stage.track(shape);
  await clock.hit(
    scene,
    beats19[1],
    new FadeIn(slabs, {
      duration: 0.55,
      shift: [2.6, 0, 0],
      scale: 0.25,
    }),
  );
  stage.track(slabs);
  await clock.hit(
    scene,
    beats19[2],
    new FadeIn(slabCaption, {
      duration: 0.4,
      shift: [0, 0.16, 0],
      scale: 0.96,
    }),
  );
  stage.track(slabCaption);
  await clock.hit(
    scene,
    beats19[3],
    new Indicate(shape, {
      duration: 0.5,
      color: palette.parameter,
      scaleFactor: 1.06,
    }),
  );
}

async function attentionGrid(stage: DropOneStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = stage.useMode('dark');
  const equation = await formula.math(
    String.raw`A=\operatorname{softmax}_{\mathrm{row}}\!\left(\frac{QK^\top}{\sqrt{d_k}}\right)\qquad Z=AV`,
    {
      color: palette.ink,
      fontSize: 46,
      maxWidth: 10.6,
      position: [0.8, 2.75, 0],
      fitStage: false,
    },
  );

  // QK^T uses query rows and key columns. Keeping those semantics explicit
  // also moves q_4 away from the dedicated output lane on the right.
  const size = 4;
  const columnX = [-3.55, -2.1, -0.65, 0.8] as const;
  const rowY = [1.25, 0.45, -0.35, -1.15] as const;
  const queryLabels = new VGroup();
  const keyLabels = new VGroup();
  for (let index = 0; index < size; index += 1) {
    queryLabels.add(
      await formula.math(String.raw`\vec q_{${index + 1}}`, {
        color: palette.input,
        fontSize: 36,
        position: [-5.2, rowY[index], 0],
        fitStage: false,
      }),
    );
    keyLabels.add(
      await formula.math(String.raw`\vec k_{${index + 1}}`, {
        color: palette.loss,
        fontSize: 36,
        position: [columnX[index], 2.05, 0],
        fitStage: false,
      }),
    );
  }

  const verticalLines = new VGroup();
  const horizontalLines = new VGroup();
  const xBoundaries = [-4.28, -2.83, -1.38, 0.07, 1.52] as const;
  const yBoundaries = [1.65, 0.85, 0.05, -0.75, -1.55] as const;
  for (const x of xBoundaries) {
    verticalLines.add(
      new Line({
        start: [x, yBoundaries[0], 0],
        end: [x, yBoundaries[yBoundaries.length - 1], 0],
        color: palette.dim,
        strokeWidth: 1,
      }),
    );
  }
  for (const y of yBoundaries) {
    horizontalLines.add(
      new Line({
        start: [xBoundaries[0], y, 0],
        end: [xBoundaries[xBoundaries.length - 1], y, 0],
        color: palette.dim,
        strokeWidth: 1,
      }),
    );
  }

  const heatRng = new SeededRng('drop-one:attention-heat');
  const normalizedHeat: number[][] = [];
  for (let row = 0; row < size; row += 1) {
    const raw = Array.from({ length: size }, () => heatRng.range(0.05, 1) ** 2);
    const sum = raw.reduce((total, value) => total + value, 0);
    normalizedHeat.push(raw.map((value) => value / sum));
  }

  const cells = new VGroup();
  const cellList: Rectangle[] = [];
  const dotProducts = new VGroup();
  const dotProductList: Mobject[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const center: Vector3Tuple = [columnX[column], rowY[row], 0];
      const cell = filledRectangle(1.32, 0.67, palette.loss, 0, center, 0);
      const dotProduct = await formula.math(
        String.raw`\vec q_{${row + 1}}\!\cdot\!\vec k_{${column + 1}}`,
        {
          color: palette.dim,
          fontSize: 26,
          position: center,
          fitStage: false,
        },
      );
      cells.add(cell);
      cellList.push(cell);
      dotProducts.add(dotProduct);
      dotProductList.push(dotProduct);
    }
  }

  const scaleCaption = await formula.math(
    String.raw`\frac{1}{\sqrt{d_k}}\textsf{ rescales logits so softmax and gradients stay responsive}`,
    {
      color: palette.parameter,
      fontSize: 28,
      maxWidth: 9.4,
      position: [-0.85, -2.55, 0],
      fitStage: false,
    },
  );

  // Output occupies a separate lane beyond a visible gutter. No query/key
  // label, heat cell, or caption crosses x=2.35.
  const outputDivider = new Line({
    start: [2.35, 1.8, 0],
    end: [2.35, -2.05, 0],
    color: palette.dim,
    strokeWidth: 1,
  });
  const output = await matrixBlock(context, 1.25, 2.05, palette.output, 'Z', [5.25, -0.2, 0]);
  const outputLabel = await formula.math(String.raw`Z=AV`, {
    color: palette.output,
    fontSize: 40,
    position: [5.25, 1.35, 0],
    fitStage: false,
  });
  const outputArrow = new Arrow({
    start: [1.75, -0.2, 0],
    end: [4.45, -0.2, 0],
    color: palette.output,
    strokeWidth: 2.4,
    buff: 0.08,
  });

  const beats20 = barBeats(20);
  await stage.beginPair(
    20,
    'scaled dot-product attention',
    palette,
    [equation],
    [new Write(equation, { duration: 0.6 })],
  );
  await clock.hit(
    scene,
    beats20[1],
    new LaggedStart(
      queryLabels.children.map(
        (query) =>
          new FadeIn(query, {
            duration: 0.32,
            shift: [0.15, 0, 0],
          }),
      ),
      { lagRatio: 0.1 },
    ),
    new LaggedStart(
      keyLabels.children.map(
        (key) =>
          new FadeIn(key, {
            duration: 0.32,
            shift: [0, -0.15, 0],
          }),
      ),
      { lagRatio: 0.1 },
    ),
    new Create(verticalLines, { duration: 0.6 }),
    new Create(horizontalLines, { duration: 0.6 }),
    new Create(outputDivider, { duration: 0.6 }),
  );
  stage.track(queryLabels, keyLabels, verticalLines, horizontalLines, outputDivider);
  await clock.hit(
    scene,
    beats20[2],
    new LaggedStart(
      dotProductList
        .slice(0, 8)
        .map((dotProduct) => new FadeIn(dotProduct, { duration: 0.3, scale: 0.5 })),
      { lagRatio: 0.08 },
    ),
  );
  await clock.hit(
    scene,
    beats20[3],
    new LaggedStart(
      dotProductList
        .slice(8)
        .map((dotProduct) => new FadeIn(dotProduct, { duration: 0.3, scale: 0.5 })),
      { lagRatio: 0.08 },
    ),
  );
  stage.track(dotProducts);

  const heatRow = (row: number): Animation[] =>
    Array.from({ length: size }, (_, column) => {
      const cell = cellList[row * size + column];
      const dotProduct = dotProductList[row * size + column];
      const heat = normalizedHeat[row][column];
      const cellTarget = cell.copy();
      cellTarget.setFill(palette.loss, 0.1 + 0.7 * heat);
      const dotProductTarget = dotProduct.copy();
      dotProductTarget.setColor(interpolateHex(palette.dim, palette.ink, heat * 2.2));
      return [
        new Transform(cell, cellTarget, { duration: 0.45 }),
        new Transform(dotProduct, dotProductTarget, { duration: 0.45 }),
      ];
    }).flat();

  const beats21 = barBeats(21);
  await clock.hit(
    scene,
    beats21[0],
    ...heatRow(0),
    new FadeIn(scaleCaption, {
      duration: 0.4,
      shift: [0, 0.15, 0],
      scale: 0.96,
    }),
  );
  stage.track(cells, scaleCaption);
  await clock.hit(scene, beats21[1], ...heatRow(1), ...heatRow(2));
  await clock.hit(scene, beats21[2], ...heatRow(3));
  await clock.hit(
    scene,
    beats21[3],
    new GrowArrow(outputArrow, { duration: 0.6 }),
    new FadeIn(output, {
      duration: 0.6,
      shift: [-1.2, 0, 0],
      scale: 0.75,
    }),
    new Write(outputLabel, { duration: 0.6 }),
  );
  stage.track(outputArrow, output, outputLabel);
}

async function multiHeadAttention(stage: DropOneStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = stage.useMode('light');
  const headColors = [palette.input, palette.loss, palette.parameter, palette.output] as const;
  const headCenters = [-4.5, -1.5, 1.5, 4.5] as const;
  const paneRng = new SeededRng('drop-one:attention-heads');
  const panes: VGroup[] = [];
  for (let head = 0; head < 4; head += 1) {
    const cells = new VGroup();
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        cells.add(
          filledSquare(
            0.28,
            headColors[head],
            paneRng.range(0.05, 0.85),
            [headCenters[head] - 0.42 + column * 0.28, 1.45 - row * 0.28, 0],
            0.8,
          ),
        );
      }
    }
    const label = await formula.math(String.raw`\operatorname{head}_{${head + 1}}`, {
      color: headColors[head],
      fontSize: 32,
      position: [headCenters[head], 2.05, 0],
      fitStage: false,
    });
    panes.push(new VGroup(cells, label));
  }
  const caption = await formula.caption('each head learns its own interaction pattern', {
    color: palette.dim,
    fontSize: 30,
    position: [0, 0.2, 0],
    fitStage: false,
  });
  const formulaLine = await formula.math(
    String.raw`\operatorname{MHA}(X)=\operatorname{Concat}\!\left(\operatorname{head}_1,\ldots,\operatorname{head}_H\right)W^O`,
    {
      color: palette.ink,
      fontSize: 45,
      maxWidth: 10.8,
      position: [0, -1.25, 0],
      fitStage: false,
    },
  );
  const note = await formula.math(
    String.raw`\textsf{fixed }d\Longrightarrow\textsf{ heads reallocate width; parameters do not scale by }H`,
    {
      color: palette.latent,
      fontSize: 29,
      maxWidth: 10.2,
      position: [0, -3, 0],
      fitStage: false,
    },
  );

  const beats22 = barBeats(22);
  await stage.beginPair(
    22,
    'multi-head attention',
    palette,
    [panes[0]],
    [new FadeIn(panes[0], { duration: 0.5, scale: 0.7 })],
  );
  for (let index = 1; index < panes.length; index += 1) {
    await clock.hit(scene, beats22[index], new FadeIn(panes[index], { duration: 0.5, scale: 0.7 }));
    stage.track(panes[index]);
  }

  const beats23 = barBeats(23);
  await clock.hit(scene, beats23[0], new FadeIn(caption, { duration: 0.4 }));
  stage.track(caption);
  const compressedCenters = [-2.25, -0.75, 0.75, 2.25] as const;
  await clock.hit(
    scene,
    beats23[1],
    ...panes.map((pane, index) => {
      const target = pane.copy();
      target.moveTo([compressedCenters[index], 1.3, 0]);
      return new Transform(pane, target, { duration: 0.55 });
    }),
  );
  await clock.hit(scene, beats23[2], new Write(formulaLine, { duration: 0.55 }));
  stage.track(formulaLine);
  await clock.hit(
    scene,
    beats23[3],
    new FadeIn(note, {
      duration: 0.4,
      shift: [0, 0.15, 0],
      scale: 0.96,
    }),
  );
  stage.track(note);
}

async function ffnResidualNormalization(
  stage: DropOneStage,
  context: EsapSceneContext,
): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = stage.useMode('light');
  const tokens: Rectangle[] = [];
  for (let index = 0; index < 5; index += 1) {
    tokens.push(
      filledRectangle(0.62, 1.75, palette.input, 0.15, [-4.15 + index * 1.25, 1.05, 0], 1.8),
    );
  }
  const tokenGroup = new VGroup(...tokens);
  const attentionArrows = new VGroup(
    new CurvedArrow({
      startPoint: tokens[0].getTop(),
      endPoint: tokens[2].getTop(),
      angle: -0.9,
      color: palette.loss,
      strokeWidth: 2,
      tipLength: 0.18,
    }),
    new CurvedArrow({
      startPoint: tokens[1].getTop(),
      endPoint: tokens[4].getTop(),
      angle: -0.78,
      color: palette.loss,
      strokeWidth: 2,
      tipLength: 0.18,
    }),
    new CurvedArrow({
      startPoint: tokens[3].getTop(),
      endPoint: tokens[1].getTop(),
      angle: -0.9,
      color: palette.loss,
      strokeWidth: 2,
      tipLength: 0.18,
    }),
  );
  const attentionCaption = await formula.caption('attention mixes ACROSS positions', {
    color: palette.loss,
    fontSize: 29,
    position: [-1.65, 2.72, 0],
    fitStage: false,
  });
  const ffnArrowList = tokens.map(
    (token) =>
      new Arrow({
        start: token.getBottom(),
        end: [token.getBottom()[0], token.getBottom()[1] - 0.42, 0],
        color: palette.output,
        strokeWidth: 2.4,
        buff: 0.02,
        tipLength: 0.18,
      }),
  );
  const ffnArrows = new VGroup(...ffnArrowList);
  const ffnCaption = await formula.caption('FFN transforms WITHIN each position', {
    color: palette.output,
    fontSize: 29,
    position: [-1.65, -0.35, 0],
    fitStage: false,
  });
  const ffnEquation = await formula.math(
    String.raw`\operatorname{FFN}(x)=W_2\phi(W_1x+b_1)+b_2\qquad d\longrightarrow d_{\mathrm{ff}}\longrightarrow d`,
    {
      color: palette.ink,
      fontSize: 37,
      maxWidth: 10.2,
      position: [0.2, -1.1, 0],
      fitStage: false,
    },
  );

  const sublayer = roundedBlock(2.25, 0.76, palette.parameter, 0.08, [-3.75, -2.65, 0]);
  const sublayerLabel = await formula.label('sublayer', {
    color: palette.parameter,
    fontSize: 27,
    position: sublayer.getCenter(),
    fitStage: false,
  });
  const input = new Dot({
    point: [-5.65, -2.65, 0],
    color: palette.ink,
    radius: 0.06,
  });
  const plus = await formula.math('+', {
    color: palette.input,
    fontSize: 46,
    position: [-1.95, -2.65, 0],
    fitStage: false,
  });
  const intoSublayer = new Arrow({
    start: input.getCenter(),
    end: sublayer.getLeft(),
    color: palette.dim,
    strokeWidth: 2,
    buff: 0.12,
  });
  const outOfSublayer = new Arrow({
    start: sublayer.getRight(),
    end: plus.getLeft(),
    color: palette.dim,
    strokeWidth: 2,
    buff: 0.12,
  });
  const skip = new ArcBetweenPoints({
    start: input.getCenter(),
    end: [plus.getTop()[0], plus.getTop()[1] + 0.06, 0],
    angle: -0.9,
    color: palette.input,
    strokeWidth: 2.5,
  });
  const normalization = await formula.math(
    String.raw`\begin{aligned}y&=\operatorname{LN}\!\left(x+\operatorname{Sublayer}(x)\right)\\[2pt]\operatorname{LN}(x)&=\gamma\odot\frac{x-\mu}{\sqrt{\sigma^2+\epsilon}}+\beta\end{aligned}`,
    {
      color: palette.ink,
      fontSize: 33,
      maxWidth: 5.4,
      position: [3.1, -2.5, 0],
      fitStage: false,
    },
  );

  const beats24 = barBeats(24);
  await stage.beginPair(
    24,
    'ffn · residual · layernorm',
    palette,
    [tokenGroup],
    [new FadeIn(tokenGroup, { duration: 0.5 })],
  );
  await clock.hit(
    scene,
    beats24[1],
    new Create(attentionArrows, { duration: 0.55 }),
    new FadeIn(attentionCaption, {
      duration: 0.45,
      shift: [0, -0.12, 0],
    }),
  );
  stage.track(attentionArrows, attentionCaption);
  await clock.hit(
    scene,
    beats24[2],
    ...ffnArrowList.map((arrow) => new GrowArrow(arrow, { duration: 0.55 })),
    new FadeIn(ffnCaption, {
      duration: 0.45,
      shift: [0, 0.12, 0],
    }),
  );
  stage.track(ffnArrows, ffnCaption);
  await clock.hit(scene, beats24[3], new Write(ffnEquation, { duration: 0.5 }));
  stage.track(ffnEquation);

  const beats25 = barBeats(25);
  await clock.hit(
    scene,
    beats25[0],
    new Create(sublayer, { duration: 0.5 }),
    new FadeIn(sublayerLabel, { duration: 0.5 }),
    new FadeIn(input, { duration: 0.5 }),
    new GrowArrow(intoSublayer, { duration: 0.5 }),
    new GrowArrow(outOfSublayer, { duration: 0.5 }),
  );
  stage.track(sublayer, sublayerLabel, input, intoSublayer, outOfSublayer);
  await clock.hit(
    scene,
    beats25[1],
    new Create(skip, { duration: 0.5 }),
    new FadeIn(plus, { duration: 0.5 }),
  );
  stage.track(skip, plus);
  await clock.hit(scene, beats25[2], new Write(normalization, { duration: 0.55 }));
  stage.track(normalization);
  await clock.hit(
    scene,
    beats25[3],
    new Indicate(skip, {
      duration: 0.5,
      color: palette.input,
      scaleFactor: 1.04,
    }),
  );
}

async function causalMaskAndCache(stage: DropOneStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = stage.useMode('dark');
  const size = 5;
  const cellSize = 0.48;
  const maskCells = new VGroup();
  const maskCellList: Square[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const cell = filledSquare(
        cellSize,
        palette.output,
        0.35,
        [-4.3 + column * cellSize, 1.7 - row * cellSize, 0],
        1.1,
      );
      cell.setStroke(palette.dim, 1.1, 1);
      maskCells.add(cell);
      maskCellList.push(cell);
    }
  }
  const maskFormula = await formula.math(
    String.raw`M_{ij}=\begin{cases}0,&j\le i\\-\infty,&j>i\end{cases}`,
    {
      color: palette.ink,
      fontSize: 30,
      position: [-3.34, -1.2, 0],
      fitStage: false,
    },
  );
  const keyLabel = await formula.math(String.raw`K_{1:t-1}`, {
    color: palette.loss,
    fontSize: 34,
    position: [1.6, 2.15, 0],
    fitStage: false,
  });
  const valueLabel = await formula.math(String.raw`V_{1:t-1}`, {
    color: palette.parameter,
    fontSize: 34,
    position: [3.6, 2.15, 0],
    fitStage: false,
  });
  const cacheCaption = await formula.math(
    String.raw`\textsf{append one new }k,v\textsf{ row; never recompute the past}`,
    {
      color: palette.output,
      fontSize: 28,
      maxWidth: 9.3,
      position: [1.5, -3.35, 0],
      fitStage: false,
    },
  );

  const beats26 = barBeats(26);
  await stage.beginPair(
    26,
    'causal mask · kv cache',
    palette,
    [maskCells, maskFormula],
    [new Create(maskCells, { duration: 0.55 }), new Write(maskFormula, { duration: 0.55 })],
  );
  const maskBands = [
    [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ],
    [
      [0, 2],
      [1, 3],
      [2, 4],
    ],
    [
      [0, 3],
      [1, 4],
      [0, 4],
    ],
  ] as const;
  for (let band = 0; band < maskBands.length; band += 1) {
    const animations = maskBands[band].map(([row, column]) => {
      const cell = maskCellList[row * size + column];
      return new PaintStyleAnimation(cell, {
        fillColor: '#000000',
        fillOpacity: 0.9,
        strokeColor: palette.dim,
        strokeOpacity: 1,
        strokeWidth: 0.6,
        duration: 0.4,
      });
    });
    await clock.hit(scene, beats26[band + 1], ...animations);
  }

  const beats27 = barBeats(27);
  await clock.hit(
    scene,
    beats27[0],
    new FadeIn(keyLabel, { duration: 0.45 }),
    new FadeIn(valueLabel, { duration: 0.45 }),
    new FadeIn(cacheCaption, {
      duration: 0.45,
      shift: [0, 0.14, 0],
      scale: 0.96,
    }),
  );
  stage.track(keyLabel, valueLabel, cacheCaption);
  for (let step = 0; step < 3; step += 1) {
    const y = 1.6 - step * 0.5;
    const keyRow = filledRectangle(1.7, 0.36, palette.loss, 0.3, [1.6, y, 0], 1.6);
    const valueRow = filledRectangle(1.7, 0.36, palette.parameter, 0.3, [3.6, y, 0], 1.6);
    const query = new Dot({
      point: [0.4, y, 0],
      color: palette.input,
      radius: 0.07,
    });
    await clock.hit(
      scene,
      beats27[step + 1],
      new FadeIn(keyRow, {
        duration: 0.45,
        shift: [0, -0.15, 0],
      }),
      new FadeIn(valueRow, {
        duration: 0.45,
        shift: [0, -0.15, 0],
      }),
      new FadeIn(query, { duration: 0.45 }),
    );
    stage.track(keyRow, valueRow, query);
  }
}

async function loraAndMixtureOfExperts(
  stage: DropOneStage,
  context: EsapSceneContext,
): Promise<void> {
  const { scene, clock, formula } = context;
  const palette = stage.useMode('dark');
  const weight = filledRectangle(2.05, 2.05, palette.input, 0.1, [-4.85, 1.25, 0], 2.5);
  const weightLabel = await formula.math('W', {
    color: palette.input,
    fontSize: 52,
    position: weight.getCenter(),
    fitStage: false,
  });
  const frozen = await formula.label('FROZEN', {
    color: palette.input,
    fontSize: 25,
    position: [-4.85, -0.05, 0],
    fitStage: false,
  });
  const factorB = filledRectangle(0.43, 2.05, palette.parameter, 0.35, [-3.35, 1.25, 0], 2);
  const factorA = filledRectangle(2.05, 0.43, palette.parameter, 0.35, [-1.9, 2.06, 0], 2);
  const loraFormula = await formula.math(
    String.raw`W'=W+\frac{\alpha}{r}BA\qquad r\!\left(d_{\mathrm{in}}+d_{\mathrm{out}}\right)\ll d_{\mathrm{in}}d_{\mathrm{out}}`,
    {
      color: palette.parameter,
      fontSize: 34,
      maxWidth: 5.7,
      position: [-1.8, -0.35, 0],
      fitStage: false,
    },
  );
  const denseBar = filledRectangle(4.1, 0.38, palette.loss, 0.4, [-4.15, -1.55, 0], 1.5);
  const denseLabel = await formula.math(String.raw`d\cdot d`, {
    color: palette.loss,
    fontSize: 31,
    position: [-1.7, -1.55, 0],
    fitStage: false,
  });
  const lowRankBar = filledRectangle(0.62, 0.38, palette.valid, 0.5, [-5.9, -2.25, 0], 1.5);
  const lowRankLabel = await formula.math(String.raw`2dr`, {
    color: palette.valid,
    fontSize: 31,
    position: [-5.05, -2.25, 0],
    fitStage: false,
  });

  const experts: RoundedRectangle[] = [];
  const expertGroup = new VGroup();
  for (let index = 0; index < 8; index += 1) {
    const expert = roundedBlock(0.64, 0.94, palette.dim, 0, [1.15 + index * 0.76, 1.05, 0]);
    experts.push(expert);
    expertGroup.add(expert);
  }
  const router = await formula.math(String.raw`g(x)=\operatorname{softmax}(W_gx)`, {
    color: palette.latent,
    fontSize: 34,
    position: [3.8, 2.05, 0],
    fitStage: false,
  });
  const moeCaption = await formula.math(
    String.raw`\operatorname{top}\text{-}k\textsf{ routing raises capacity while per-token compute stays nearly flat}`,
    {
      color: palette.latent,
      fontSize: 28,
      maxWidth: 6.2,
      position: [3.8, -0.1, 0],
      fitStage: false,
    },
  );

  const beats28 = barBeats(28);
  await stage.beginPair(
    28,
    'lora · mixture of experts',
    palette,
    [weight, weightLabel, frozen],
    [
      new Create(weight, { duration: 0.5 }),
      new Write(weightLabel, { duration: 0.5 }),
      new FadeIn(frozen, { duration: 0.5 }),
    ],
  );
  await clock.hit(
    scene,
    beats28[1],
    new FadeIn(factorB, {
      duration: 0.55,
      shift: [-0.2, 0, 0],
    }),
    new FadeIn(factorA, {
      duration: 0.55,
      shift: [-0.2, 0, 0],
    }),
    new Write(loraFormula, { duration: 0.55 }),
  );
  stage.track(factorB, factorA, loraFormula);
  await clock.hit(
    scene,
    beats28[2],
    new FadeIn(denseBar, { duration: 0.45 }),
    new FadeIn(denseLabel, { duration: 0.45 }),
  );
  stage.track(denseBar, denseLabel);
  const denseBarCopy = denseBar.copy();
  await clock.hit(
    scene,
    beats28[3],
    new Transform(denseBarCopy, lowRankBar, { duration: 0.5 }),
    new FadeIn(lowRankLabel, { duration: 0.5 }),
  );
  stage.track(denseBarCopy, lowRankLabel);

  const beats29 = barBeats(29);
  await clock.hit(
    scene,
    beats29[0],
    new Create(expertGroup, { duration: 0.5 }),
    new Write(router, { duration: 0.5 }),
    new FadeIn(moeCaption, {
      duration: 0.45,
      shift: [0, 0.14, 0],
      scale: 0.96,
    }),
  );
  stage.track(expertGroup, router, moeCaption);
  const routeRng = new SeededRng('drop-one:expert-routing');
  for (let beat = 1; beat < beats29.length; beat += 1) {
    const firstPick = routeRng.integer(0, experts.length);
    let secondPick = routeRng.integer(0, experts.length - 1);
    if (secondPick >= firstPick) secondPick += 1;
    const animations = experts.map((expert, index) => {
      if (index === firstPick || index === secondPick) {
        return new PaintStyleAnimation(expert, {
          fillColor: palette.parameter,
          fillOpacity: 0.3,
          strokeColor: palette.parameter,
          strokeOpacity: 1,
          strokeWidth: 3,
          duration: 0.4,
        });
      }
      return new PaintStyleAnimation(expert, {
        fillColor: palette.background,
        fillOpacity: 0,
        strokeColor: palette.dim,
        strokeOpacity: 1,
        strokeWidth: 1.8,
        duration: 0.4,
      });
    });
    await clock.hit(scene, beats29[beat], ...animations);
  }
}

export const dropOneScene = defineEsapScene({
  id: 'drop-1',
  title: 'Transformers',
  status: 'implemented',
  async build(context) {
    const stage = new DropOneStage(context);
    await titleAndEmbeddings(stage, context);
    await positionalInformation(stage, context);
    await qkvProjections(stage, context);
    await attentionGrid(stage, context);
    await multiHeadAttention(stage, context);
    await ffnResidualNormalization(stage, context);
    await causalMaskAndCache(stage, context);
    await loraAndMixtureOfExperts(stage, context);
    await stage.finish();
  },
});
