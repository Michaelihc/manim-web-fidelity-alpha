import {
  Add,
  Animation,
  Arrow,
  Axes,
  Circle,
  Create,
  Dot,
  FadeIn,
  GrowArrow,
  Indicate,
  LaggedStart,
  Line,
  MathTex,
  Mobject,
  MoveAlongPath,
  Rectangle,
  Remove,
  ReplacementTransform,
  RoundedRectangle,
  Square,
  VGroup,
  Write,
  addVec,
  normalizeVec,
  scaleVec,
  subVec,
  type Vector3Tuple,
} from '../../../src/index.ts';
import { type NamedBounds, namedMobjectBounds } from '../layout';
import { SeededRng } from '../rng';
import { barBeats } from '../timing';
import { clearFrameSafe, createStarfield, safeCaption, titleChip } from './helpers';
import { defineEsapScene, type EsapSceneContext } from './types';
import { centerMobjectsAt, placeMobjectsAtBottomEdge } from './verse-layout';

const FRAME = 1 / 60;

class VerseStage {
  private readonly _context: EsapSceneContext;
  private readonly _starfield: VGroup;
  private _starfieldIntroduced = false;
  private _active: Mobject[] = [];

  constructor(context: EsapSceneContext) {
    this._context = context;
    this._starfield = createStarfield(
      { rng: new SeededRng(11), palette: context.palette },
      { count: 55 },
    );
  }

  async beginBar(
    barNumber: number,
    chipCopy: string,
    roots: readonly Mobject[],
    firstBeatAnimations: readonly Animation[],
  ): Promise<readonly number[]> {
    const beats = barBeats(barNumber);
    const chip = await titleChip(this._context, chipCopy);
    chip.toCorner([-1, 1, 0], 0.45, [14.22, 8]);

    const transitions: Animation[] = this._active.map((mobject) => new Remove(mobject));
    if (!this._starfieldIntroduced) {
      transitions.push(new Add(this._starfield));
      this._starfieldIntroduced = true;
    }
    transitions.push(new Add(chip));

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
    await clearFrameSafe(this._context, [this._starfield, ...this._active], FRAME);
  }
}

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
  strokeWidth = 1.5,
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

function dimAxes(
  context: EsapSceneContext,
  options: {
    xRange: [number, number, number];
    yRange: [number, number, number];
    xLength: number;
    yLength: number;
    center: Vector3Tuple;
    strokeWidth?: number;
  },
): Axes {
  const axes = new Axes({
    xRange: options.xRange,
    yRange: options.yRange,
    xLength: options.xLength,
    yLength: options.yLength,
    color: context.palette.dim,
    axisConfig: {
      strokeWidth: options.strokeWidth ?? 1.5,
      includeTicks: false,
    },
    tips: true,
  });
  axes.moveTo(options.center);
  return axes;
}

async function barLearningProblem(stage: VerseStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula, palette } = context;
  const x = await formula.math('x', {
    color: palette.input,
    fontSize: 58,
    position: [-5, 0.6, 0],
  });
  const modelBox = new RoundedRectangle({
    width: 2,
    height: 1.1,
    cornerRadius: 0.15,
    color: palette.parameter,
    center: [-2.2, 0.6, 0],
  });
  const model = await formula.math(String.raw`f_{\theta}`, {
    color: palette.parameter,
    fontSize: 48,
    position: modelBox.getCenter(),
  });
  const intoModel = new Arrow({
    start: x.getRight(),
    end: modelBox.getLeft(),
    color: palette.dim,
    strokeWidth: 6,
    tipLength: 0.35,
    tipWidth: 0.175,
    buff: 0.18,
    maxTipLengthToLengthRatio: 0.25,
  });
  const prediction = await formula.math(String.raw`\hat y`, {
    color: palette.output,
    fontSize: 58,
    position: [0.9, 0.6, 0],
  });
  const fromModel = new Arrow({
    start: modelBox.getRight(),
    end: prediction.getLeft(),
    color: palette.dim,
    strokeWidth: 6,
    tipLength: 0.35,
    tipWidth: 0.175,
    buff: 0.18,
    maxTipLengthToLengthRatio: 0.25,
  });
  const target = await formula.math('y', {
    color: palette.valid,
    fontSize: 58,
    position: [4.4, 0.6, 0],
  });
  const targetLabel = await safeCaption(
    context,
    'ground truth',
    {
      name: 'ground truth label',
      position: [4.4, target.getTop()[1] + 0.33, 0],
      occupied: [namedMobjectBounds('target', target)],
      minimumGap: 0.12,
      fallbackOffsets: [[0, 0, 0]],
    },
    { color: palette.valid, fontSize: 27 },
  );
  const loss = await formula.math([String.raw`L(`, String.raw`\hat y`, String.raw`,\,`, 'y', ')'], {
    color: palette.loss,
    fontSize: 48,
    position: [2.6, -1.55, 0],
    maxWidth: 4.5,
  });
  loss.getPart(1).setColor(palette.output);
  loss.getPart(3).setColor(palette.valid);
  const predictionToLoss = new Arrow({
    start: addVec(prediction.getBottom(), [0, -0.08, 0]),
    end: addVec(loss.getPart(1).getTop(), [0, 0.08, 0]),
    color: palette.output,
    strokeWidth: 2.5,
    buff: 0.05,
    maxTipLengthToLengthRatio: 0.12,
  });
  const targetToLoss = new Arrow({
    start: addVec(target.getBottom(), [0, -0.08, 0]),
    end: addVec(loss.getPart(3).getTop(), [0, 0.08, 0]),
    color: palette.valid,
    strokeWidth: 2.5,
    buff: 0.05,
    maxTipLengthToLengthRatio: 0.12,
  });

  const roots: Mobject[] = [
    x,
    modelBox,
    model,
    intoModel,
    prediction,
    fromModel,
    target,
    targetLabel,
    loss,
    predictionToLoss,
    targetToLoss,
  ];
  const beats = await stage.beginBar(2, 'the learning problem', roots, [
    new FadeIn(x, { duration: 0.35, shift: [0.3, 0, 0] }),
  ]);
  await clock.hit(
    scene,
    beats[1],
    new Create(modelBox, { duration: 0.5 }),
    new Write(model, { duration: 0.5 }),
    new GrowArrow(intoModel, { duration: 0.5 }),
  );
  await clock.hit(
    scene,
    beats[2],
    new GrowArrow(fromModel, { duration: 0.35 }),
    new FadeIn(prediction, { duration: 0.35 }),
    new FadeIn(target, { duration: 0.35, shift: [0, -0.2, 0] }),
    new FadeIn(targetLabel, { duration: 0.35 }),
  );
  await clock.hit(
    scene,
    beats[3],
    new Write(loss, { duration: 0.55 }),
    new GrowArrow(predictionToLoss, { duration: 0.55 }),
    new GrowArrow(targetToLoss, { duration: 0.55 }),
  );
}

async function barNeuron(stage: VerseStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula, palette } = context;
  const layerX = [-4.6, -0.8, 2.6] as const;
  const layerSizes = [3, 4, 2] as const;
  const layers: Vector3Tuple[][] = layerSizes.map((size, layerIndex) =>
    Array.from({ length: size }, (_unused, index) => [
      layerX[layerIndex],
      (size - 1) * 0.75 - index * 1.5,
      0,
    ]),
  );
  const dimMembers: Mobject[] = [];
  for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex += 1) {
    for (const start of layers[layerIndex]) {
      for (const end of layers[layerIndex + 1]) {
        const line = new Line({
          start,
          end,
          color: palette.dim,
          strokeWidth: 1.1,
        });
        line.setStroke(palette.dim, 1.1, 0.22);
        dimMembers.push(line);
      }
    }
  }
  for (const layer of layers) {
    for (const center of layer) {
      const circle = new Circle({
        radius: 0.34,
        color: palette.dim,
        strokeWidth: 1.4,
        center,
      });
      circle.setStroke(palette.dim, 1.4, 0.3);
      dimMembers.push(circle);
    }
  }
  const dimNetwork = new VGroup(...dimMembers);

  const targetCenter = layers[1][1];
  const node = new Circle({
    radius: 0.42,
    color: palette.parameter,
    strokeWidth: 3,
    center: targetCenter,
  });
  const nodeLabel = await formula.math('z', {
    color: palette.parameter,
    fontSize: 36,
    position: targetCenter,
  });

  const inputLabels = await Promise.all(
    layers[0].map((position, index) =>
      formula.math(String.raw`x_{${index}}`, {
        color: palette.input,
        fontSize: 34,
        position,
      }),
    ),
  );
  const inputs = new VGroup(...inputLabels);

  const litEdges = layers[0].map((inputCenter) => {
    const direction = normalizeVec(subVec(inputCenter, targetCenter));
    return new Line({
      start: addVec(inputCenter, [0.36, 0, 0]),
      end: addVec(targetCenter, scaleVec(0.44, direction)),
      color: palette.parameter,
      strokeWidth: 2.4,
    });
  });
  const edges = new VGroup(...litEdges);
  const weightLabels = await Promise.all(
    litEdges.map((edge, index) =>
      formula.math(String.raw`w_{${index}}`, {
        color: palette.parameter,
        fontSize: 25,
        position: addVec(edge.pointFromProportion(0.45), [0, 0.26, 0]),
      }),
    ),
  );
  const weights = new VGroup(...weightLabels);

  const affine = await formula.math(String.raw`z=w^{\top}x+b`, {
    color: palette.ink,
    fontSize: 41,
    position: [4.7, 1.3, 0],
    maxWidth: 4.3,
  });
  const activation = await formula.math(String.raw`h=\phi(z)`, {
    color: palette.output,
    fontSize: 41,
    fitStage: false,
  });
  activation.nextTo(affine, [0, -1, 0], 0.55);
  activation.alignTo(affine, [-1, 0, 0]);
  const occupied: NamedBounds[] = [
    namedMobjectBounds('network', dimNetwork),
    namedMobjectBounds('affine equation', affine),
    namedMobjectBounds('activation equation', activation),
  ];
  const caption = await safeCaption(
    context,
    'every unit in the network computes this',
    {
      name: 'neuron caption',
      position: [0, -3, 0],
      occupied,
      minimumGap: 0.2,
      fallbackOffsets: [[0, 0, 0]],
    },
    { color: palette.dim, fontSize: 27, maxWidth: 8.6 },
  );
  placeMobjectsAtBottomEdge([caption], 0.4);

  const roots: Mobject[] = [
    dimNetwork,
    node,
    nodeLabel,
    inputs,
    edges,
    weights,
    affine,
    activation,
    caption,
  ];
  const beats = await stage.beginBar(3, 'one neuron', roots, [
    new FadeIn(dimNetwork, { duration: 0.5 }),
  ]);
  await clock.hit(
    scene,
    beats[1],
    new Create(node, { duration: 0.55 }),
    new Write(nodeLabel, { duration: 0.55 }),
    new FadeIn(inputs, { duration: 0.55 }),
    new Create(edges, { duration: 0.55 }),
    new FadeIn(weights, { duration: 0.55 }),
  );
  await clock.hit(scene, beats[2], new Write(affine, { duration: 0.5 }));
  await clock.hit(
    scene,
    beats[3],
    new Write(activation, { duration: 0.5 }),
    new FadeIn(caption, { duration: 0.5, scale: 1.4 }),
  );
}

async function barActivations(stage: VerseStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula, palette } = context;
  const axes = dimAxes(context, {
    xRange: [-3, 3, 1],
    yRange: [-0.6, 2.6, 1],
    xLength: 6.4,
    yLength: 3.6,
    center: [0, -0.4, 0],
    strokeWidth: 1.6,
  });
  const relu = axes.plot((value) => Math.max(0, value), {
    xRange: [-3, 3],
    color: palette.input,
    strokeWidth: 4,
    useSmoothing: false,
  });
  const sigmoid = axes.plot((value) => 2.2 / (1 + Math.exp(-1.8 * value)), {
    xRange: [-3, 3],
    color: palette.loss,
    strokeWidth: 4,
  });
  const reluLabel = await formula.math(String.raw`\mathrm{ReLU}(z)=\max(0,z)`, {
    color: palette.input,
    fontSize: 29,
    fitStage: false,
  });
  reluLabel.toCorner([1, 1, 0], 0.6, [14.22, 8]);
  reluLabel.shift([0, -0.3, 0]);
  const sigmoidLabel = await formula.math(String.raw`\sigma(z)=\tfrac{1}{1+e^{-z}}`, {
    color: palette.loss,
    fontSize: 29,
    fitStage: false,
  });
  sigmoidLabel.nextTo(reluLabel, [0, -1, 0], 0.3);
  sigmoidLabel.alignTo(reluLabel, [1, 0, 0]);
  const caption = await formula.math(
    String.raw`\text{no nonlinearity}\ \Rightarrow\ \text{stack collapses to one affine map}`,
    {
      color: palette.dim,
      fontSize: 26,
      position: [0, -3, 0],
      maxWidth: 10.8,
    },
  );
  placeMobjectsAtBottomEdge([caption], 0.4);

  const roots: Mobject[] = [axes, relu, sigmoid, reluLabel, sigmoidLabel, caption];
  const beats = await stage.beginBar(4, 'activations', roots, [
    new Create(axes, { duration: 0.5 }),
  ]);
  await clock.hit(
    scene,
    beats[1],
    new Create(relu, { duration: 0.55 }),
    new Write(reluLabel, { duration: 0.55 }),
  );
  await clock.hit(
    scene,
    beats[2],
    new Create(sigmoid, { duration: 0.55 }),
    new Write(sigmoidLabel, { duration: 0.55 }),
  );
  await clock.hit(scene, beats[3], new FadeIn(caption, { duration: 0.4, shift: [0, 0.2, 0] }));
}

async function barLosses(stage: VerseStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula, palette } = context;
  const formulas = await Promise.all([
    formula.math(String.raw`L_{\mathrm{MSE}}=\tfrac1N\sum_i(\hat y_i-y_i)^2`, {
      color: palette.ink,
      fontSize: 35,
      maxWidth: 10.8,
    }),
    formula.math(String.raw`L_{\mathrm{CE}}=-\sum_k y_k\log p_k`, {
      color: palette.ink,
      fontSize: 35,
      maxWidth: 10.8,
    }),
    formula.math(String.raw`L_{\mathrm{BCE}}=-\left[y\log p+(1-y)\log(1-p)\right]`, {
      color: palette.ink,
      fontSize: 35,
      maxWidth: 10.8,
    }),
  ]);
  formulas[1].nextTo(formulas[0], [0, -1, 0], 0.85);
  formulas[1].alignTo(formulas[0], [-1, 0, 0]);
  formulas[2].nextTo(formulas[1], [0, -1, 0], 0.85);
  formulas[2].alignTo(formulas[0], [-1, 0, 0]);
  const headers = await Promise.all([
    formula.math(String.raw`\textbf{Regression}`, {
      color: palette.input,
      fontSize: 27,
      fitStage: false,
    }),
    formula.math(String.raw`\textbf{Multi-class}`, {
      color: palette.output,
      fontSize: 27,
      fitStage: false,
    }),
    formula.math(String.raw`\textbf{Binary}`, {
      color: palette.parameter,
      fontSize: 27,
      fitStage: false,
    }),
  ]);
  headers.forEach((header, index) => {
    header.nextTo(formulas[index], [0, 1, 0], 0.18);
    header.alignTo(formulas[index], [-1, 0, 0]);
  });
  centerMobjectsAt([...formulas, ...headers], [0, -0.2, 0]);
  const formulaBounds = formulas[2].getBounds();
  const headerBounds = headers[2].getBounds();
  const left = Math.min(formulaBounds.min.x, headerBounds.min.x);
  const right = Math.max(formulaBounds.max.x, headerBounds.max.x);
  const bottom = Math.min(formulaBounds.min.y, headerBounds.min.y);
  const top = Math.max(formulaBounds.max.y, headerBounds.max.y);
  const binaryFrame = new RoundedRectangle({
    width: right - left + 0.36,
    height: top - bottom + 0.32,
    cornerRadius: 0.1,
    color: palette.parameter,
    strokeWidth: 2.5,
    center: [(left + right) / 2, (bottom + top) / 2, 0],
  });

  const roots: Mobject[] = [...formulas, ...headers, binaryFrame];
  const beats = await stage.beginBar(5, 'loss functions', roots, [
    new FadeIn(headers[0], { duration: 0.55 }),
    new Write(formulas[0], { duration: 0.55 }),
  ]);
  await clock.hit(
    scene,
    beats[1],
    new FadeIn(headers[1], { duration: 0.55 }),
    new Write(formulas[1], { duration: 0.55 }),
  );
  await clock.hit(
    scene,
    beats[2],
    new FadeIn(headers[2], { duration: 0.55 }),
    new Write(formulas[2], { duration: 0.55 }),
  );
  await clock.hit(scene, beats[3], new Create(binaryFrame, { duration: 0.45 }));
}

async function barSplits(stage: VerseStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula, palette } = context;
  const full = filledRectangle(9, 0.8, palette.dim, 0.12, [0, 1.6, 0]);
  const train = filledRectangle(5.4, 0.8, palette.input, 0.35, [-1.86, 1.6, 0]);
  const validation = filledRectangle(1.8, 0.8, palette.parameter, 0.35, [1.8, 1.6, 0]);
  const test = filledRectangle(1.8, 0.8, palette.loss, 0.35, [3.66, 1.6, 0]);
  const parts = [train, validation, test] as const;
  const splitParts = new VGroup(...parts);

  const labels = await Promise.all([
    formula.math(String.raw`\mathbf{\text{train}}\ \text{— fit }\theta\ \text{(gradients)}`, {
      color: palette.input,
      fontSize: 27,
      position: [-0.3, 0.25, 0],
      maxWidth: 10.5,
    }),
    formula.math(String.raw`\mathbf{\text{val}}\ \text{— choose }\eta,\tau,\text{ checkpoints}`, {
      color: palette.parameter,
      fontSize: 27,
      position: [-0.3, -0.8, 0],
      maxWidth: 10.5,
    }),
    formula.math(String.raw`\mathbf{\text{test}}\ \text{— touched once}`, {
      color: palette.loss,
      fontSize: 27,
      position: [-0.3, -1.85, 0],
      maxWidth: 10.5,
    }),
  ]);
  labels.forEach((label) => label.alignTo(labels[0], [-1, 0, 0]));
  const swatches = labels.map((label, index) =>
    filledSquare(0.26, [palette.input, palette.parameter, palette.loss][index], 0.55, [
      label.getLeft()[0] - 0.34,
      label.getCenter()[1],
      0,
    ]),
  );
  const occupied = labels.map((label, index) =>
    namedMobjectBounds(`split label ${index + 1}`, label),
  );
  const warning = await safeCaption(
    context,
    'related samples must stay in ONE split (group-aware)',
    {
      name: 'group-aware split warning',
      position: [0, -3, 0],
      occupied,
      minimumGap: 0.18,
      fallbackOffsets: [[0, 0, 0]],
    },
    { color: palette.latent, fontSize: 26, maxWidth: 10.5 },
  );
  placeMobjectsAtBottomEdge([warning], 0.4);

  const roots: Mobject[] = [full, splitParts, ...labels, ...swatches, warning];
  const beats = await stage.beginBar(6, 'train · validation · test', roots, [
    new FadeIn(full, { duration: 0.55 }),
    new ReplacementTransform(full.copy(), splitParts, { duration: 0.55 }),
  ]);
  await clock.hit(
    scene,
    beats[1],
    new FadeIn(labels[0], { duration: 0.45 }),
    new FadeIn(swatches[0], { duration: 0.45 }),
    new Indicate(train, {
      duration: 0.45,
      color: palette.input,
      scaleFactor: 1.03,
    }),
  );
  await clock.hit(
    scene,
    beats[2],
    new FadeIn(labels[1], { duration: 0.45 }),
    new FadeIn(swatches[1], { duration: 0.45 }),
    new Indicate(validation, {
      duration: 0.45,
      color: palette.parameter,
      scaleFactor: 1.06,
    }),
    new FadeIn(labels[2], { duration: 0.45 }),
    new FadeIn(swatches[2], { duration: 0.45 }),
    new Indicate(test, {
      duration: 0.45,
      color: palette.loss,
      scaleFactor: 1.06,
    }),
  );
  await clock.hit(scene, beats[3], new FadeIn(warning, { duration: 0.4, scale: 1.4 }));
}

async function barBiasVariance(stage: VerseStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula, palette } = context;
  const leftAxes = dimAxes(context, {
    xRange: [0, 10, 1],
    yRange: [0, 3, 1],
    xLength: 4.6,
    yLength: 2.7,
    center: [-3.3, -0.4, 0],
    strokeWidth: 1.4,
  });
  const rightAxes = dimAxes(context, {
    xRange: [0, 10, 1],
    yRange: [0, 3, 1],
    xLength: 4.6,
    yLength: 2.7,
    center: [3.3, -0.4, 0],
    strokeWidth: 1.4,
  });
  const leftTrain = leftAxes.plot((value) => 2.1 - 0.05 * value, {
    xRange: [0.3, 10],
    color: palette.input,
    strokeWidth: 3.5,
  });
  const leftValidation = leftAxes.plot((value) => 2.3 - 0.04 * value, {
    xRange: [0.3, 10],
    color: palette.loss,
    strokeWidth: 3.5,
  });
  const rightTrain = rightAxes.plot((value) => 2.2 * Math.exp(-0.45 * value) + 0.15, {
    xRange: [0.3, 10],
    color: palette.input,
    strokeWidth: 3.5,
  });
  const rightValidation = rightAxes.plot(
    (value) => 2.2 * Math.exp(-0.45 * value) + 0.15 + 0.16 * value * Math.exp(-0.12 * value),
    {
      xRange: [0.3, 10],
      color: palette.loss,
      strokeWidth: 3.5,
    },
  );
  const leftLabel = await formula.caption('high bias — both poor', {
    color: palette.parameter,
    fontSize: 26,
    fitStage: false,
  });
  leftLabel.nextTo(leftAxes, [0, 1, 0], 0.15);
  const rightLabel = await formula.caption('high variance — gap opens', {
    color: palette.loss,
    fontSize: 26,
    fitStage: false,
  });
  rightLabel.nextTo(rightAxes, [0, 1, 0], 0.15);
  const gap = rightAxes.getArea(rightValidation, [3, 10], {
    boundedGraph: rightTrain,
    color: palette.loss,
    opacity: 0.25,
  });
  const chipCopies = ['more data', 'regularize', 'early stop', 'smaller model'] as const;
  const remedyChips = await Promise.all(
    chipCopies.map((copy) =>
      formula.caption(copy, {
        color: palette.valid,
        fontSize: 25,
        maxWidth: 2.7,
        fitStage: false,
      }),
    ),
  );
  for (let index = 1; index < remedyChips.length; index += 1) {
    remedyChips[index].nextTo(remedyChips[index - 1], [1, 0, 0], 0.55);
  }
  placeMobjectsAtBottomEdge(remedyChips, 0.35);

  const roots: Mobject[] = [
    leftAxes,
    rightAxes,
    leftTrain,
    leftValidation,
    rightTrain,
    rightValidation,
    leftLabel,
    rightLabel,
    gap,
    ...remedyChips,
  ];
  const beats = await stage.beginBar(7, 'bias vs variance', roots, [
    new Create(leftAxes, { duration: 0.5 }),
    new Create(rightAxes, { duration: 0.5 }),
  ]);
  await clock.hit(
    scene,
    beats[1],
    new Create(leftTrain, { duration: 0.55 }),
    new Create(leftValidation, { duration: 0.55 }),
    new FadeIn(leftLabel, { duration: 0.55 }),
  );
  await clock.hit(
    scene,
    beats[2],
    new Create(rightTrain, { duration: 0.55 }),
    new Create(rightValidation, { duration: 0.55 }),
    new FadeIn(rightLabel, { duration: 0.55 }),
    new FadeIn(gap, { duration: 0.55 }),
  );
  const chipDuration = 0.5 / (1 + (remedyChips.length - 1) * 0.15);
  await clock.hit(
    scene,
    beats[3],
    new LaggedStart(
      remedyChips.map(
        (chip) =>
          new FadeIn(chip, {
            duration: chipDuration,
            shift: [0, 0.15, 0],
          }),
      ),
      { lagRatio: 0.15 },
    ),
  );
}

async function barMetrics(stage: VerseStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula, palette } = context;
  const cellCenters: Vector3Tuple[] = [
    [-4.12, 0.33, 0],
    [-3.07, 0.33, 0],
    [-4.12, -0.72, 0],
    [-3.07, -0.72, 0],
  ];
  const cellObjects = cellCenters.map((center) => filledSquare(1.05, palette.dim, 0.12, center, 4));
  const cells = new VGroup(...cellObjects);
  const labelCopies = ['TP', 'FP', 'FN', 'TN'] as const;
  const labelColors = [palette.valid, palette.loss, palette.loss, palette.dim] as const;
  const labelObjects = await Promise.all(
    labelCopies.map((copy, index) =>
      formula.math(copy, {
        color: labelColors[index],
        fontSize: 34,
        position: cellObjects[index].getCenter(),
      }),
    ),
  );
  const labels = new VGroup(...labelObjects);
  const precision = await formula.math(String.raw`\mathrm{precision}=\frac{TP}{TP+FP}`, {
    color: palette.ink,
    fontSize: 36,
    position: [2.6, 1.2, 0],
    maxWidth: 5.8,
  });
  const recall = await formula.math(String.raw`\mathrm{recall}=\frac{TP}{TP+FN}`, {
    color: palette.ink,
    fontSize: 36,
    fitStage: false,
    maxWidth: 5.8,
  });
  recall.nextTo(precision, [0, -1, 0], 0.5);
  recall.alignTo(precision, [-1, 0, 0]);
  const axes = new Axes({
    xRange: [0, 1.18, 0.2],
    yRange: [0, 1.18, 0.2],
    xLength: 3.1,
    yLength: 2.1,
    color: palette.dim,
    axisConfig: { includeTicks: false, strokeWidth: 1.4 },
  });
  axes.nextTo(recall, [0, -1, 0], 0.42);
  axes.alignTo(recall, [-1, 0, 0]);
  const precisionRecall = axes.plot(
    (recallValue) => Math.pow(1 - Math.pow(recallValue, 2.7), 0.55),
    {
      xRange: [0.02, 0.99],
      color: palette.parameter,
      strokeWidth: 3.5,
    },
  );
  const movingDot = new Dot({
    point: axes.inputToGraphPoint(0.15, precisionRecall),
    color: palette.ink,
    radius: 0.06,
  });
  movingDot.setFill(palette.ink, 1);

  const roots: Mobject[] = [cells, labels, precision, recall, axes, precisionRecall, movingDot];
  const beats = await stage.beginBar(8, 'imbalanced classification', roots, [
    new Create(cells, { duration: 0.55 }),
    new FadeIn(labels, { duration: 0.55 }),
  ]);
  await clock.hit(scene, beats[1], new Write(precision, { duration: 0.5 }));
  await clock.hit(scene, beats[2], new Write(recall, { duration: 0.5 }));
  await clock.waitUntil(scene, beats[3]);
  await clock.play(
    scene,
    new Create(axes, { duration: 0.3 }),
    new Create(precisionRecall, { duration: 0.3 }),
    new FadeIn(movingDot, { duration: 0.3 }),
  );
  await clock.play(
    scene,
    new MoveAlongPath(movingDot, {
      path: precisionRecall,
      duration: 0.4,
    }),
  );
}

interface TensorBlock {
  readonly group: VGroup;
  readonly rectangle: Rectangle;
  readonly label: MathTex;
}

async function tensorBlock(
  context: EsapSceneContext,
  width: number,
  color: string,
  labelCopy: string,
  center: Vector3Tuple,
): Promise<TensorBlock> {
  const rectangle = filledRectangle(width, 1.9, color, 0.22, center, 2.2);
  const label = await context.formula.math(labelCopy, {
    color,
    fontSize: 34,
    position: center,
  });
  return {
    group: new VGroup(rectangle, label),
    rectangle,
    label,
  };
}

async function barMlpShapes(stage: VerseStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula, palette } = context;
  const input = await tensorBlock(context, 1.4, palette.input, 'X', [-5, -0.5, 0]);
  const hidden = await tensorBlock(context, 2.2, palette.parameter, 'H', [-0.6, -0.5, 0]);
  const output = await tensorBlock(context, 1.05, palette.output, 'Z', [3.4, -0.5, 0]);
  const intoHidden = new Arrow({
    start: input.group.getRight(),
    end: hidden.group.getLeft(),
    color: palette.dim,
    strokeWidth: 6,
    tipLength: 0.35,
    tipWidth: 0.175,
    buff: 0.15,
    maxTipLengthToLengthRatio: 0.25,
  });
  const intoOutput = new Arrow({
    start: hidden.group.getRight(),
    end: output.group.getLeft(),
    color: palette.dim,
    strokeWidth: 6,
    tipLength: 0.35,
    tipWidth: 0.175,
    buff: 0.15,
    maxTipLengthToLengthRatio: 0.25,
  });
  const hiddenFormula = await formula.math(String.raw`H=\phi(XW_1+b_1)`, {
    color: palette.parameter,
    fontSize: 34,
    position: [intoHidden.getCenter()[0], 1.75, 0],
    maxWidth: 4.4,
  });
  const outputFormula = await formula.math(String.raw`Z=HW_2+b_2`, {
    color: palette.output,
    fontSize: 34,
    position: [intoOutput.getCenter()[0], 1.75, 0],
    maxWidth: 4.1,
  });
  const inputShape = await formula.math(String.raw`B\times d_{\mathrm{in}}`, {
    color: palette.input,
    fontSize: 27,
    fitStage: false,
  });
  inputShape.nextTo(input.group, [0, -1, 0], 0.25);
  const hiddenShape = await formula.math(String.raw`B\times d_{\mathrm{hidden}}`, {
    color: palette.parameter,
    fontSize: 27,
    fitStage: false,
  });
  hiddenShape.nextTo(hidden.group, [0, -1, 0], 0.25);
  const outputShape = await formula.math(String.raw`B\times d_{\mathrm{out}}`, {
    color: palette.output,
    fontSize: 27,
    fitStage: false,
  });
  outputShape.nextTo(output.group, [0, -1, 0], 0.25);
  const occupied: NamedBounds[] = [
    namedMobjectBounds('input tensor', input.group),
    namedMobjectBounds('hidden tensor', hidden.group),
    namedMobjectBounds('output tensor', output.group),
    namedMobjectBounds('input shape', inputShape),
    namedMobjectBounds('hidden shape', hiddenShape),
    namedMobjectBounds('output shape', outputShape),
  ];
  const caption = await safeCaption(
    context,
    'bias broadcasts across the batch dimension',
    {
      name: 'broadcast caption',
      position: [0, -3, 0],
      occupied,
      minimumGap: 0.18,
      fallbackOffsets: [[0, 0, 0]],
    },
    { color: palette.latent, fontSize: 27, maxWidth: 9 },
  );
  placeMobjectsAtBottomEdge([caption], 0.4);

  const roots: Mobject[] = [
    input.group,
    hidden.group,
    output.group,
    intoHidden,
    intoOutput,
    hiddenFormula,
    outputFormula,
    inputShape,
    hiddenShape,
    outputShape,
    caption,
  ];
  const beats = await stage.beginBar(9, 'mlp · tensor shapes', roots, [
    new FadeIn(input.group, {
      duration: 0.5,
      shift: [0.2, 0, 0],
    }),
    new FadeIn(inputShape, { duration: 0.5 }),
  ]);
  await clock.hit(
    scene,
    beats[1],
    new GrowArrow(intoHidden, { duration: 0.55 }),
    new FadeIn(hidden.group, { duration: 0.55 }),
    new Write(hiddenFormula, { duration: 0.55 }),
    new FadeIn(hiddenShape, { duration: 0.55 }),
  );
  await clock.hit(
    scene,
    beats[2],
    new GrowArrow(intoOutput, { duration: 0.55 }),
    new FadeIn(output.group, { duration: 0.55 }),
    new Write(outputFormula, { duration: 0.55 }),
    new FadeIn(outputShape, { duration: 0.55 }),
  );
  await clock.hit(scene, beats[3], new FadeIn(caption, { duration: 0.4, shift: [0, 0.2, 0] }));
}

export const verseScene = defineEsapScene({
  id: 'verse',
  title: 'Learning from data',
  status: 'implemented',
  async build(context) {
    const stage = new VerseStage(context);
    await barLearningProblem(stage, context);
    await barNeuron(stage, context);
    await barActivations(stage, context);
    await barLosses(stage, context);
    await barSplits(stage, context);
    await barBiasVariance(stage, context);
    await barMetrics(stage, context);
    await barMlpShapes(stage, context);
    await stage.finish();
  },
});
