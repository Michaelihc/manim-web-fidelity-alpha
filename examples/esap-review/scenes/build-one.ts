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
  MathTex,
  Mobject,
  MoveAlongPath,
  Remove,
  ShowPassingFlash,
  SurroundingRectangle,
  VGroup,
  Write,
  easeInOutSine,
  easeOutSine,
  smooth,
  type Vector3Tuple,
} from '../../../src/index.ts';
import { assertNoCollisions, namedMobjectBounds, type NamedBounds } from '../layout';
import { SeededRng } from '../rng';
import { BEAT_DURATION, CUTOUTS, barBeats, frameAlignedSectionCue } from '../timing';
import { createStarfield, titleChip } from './helpers';
import { defineEsapScene, type EsapSceneContext } from './types';

const FRAME = 1 / 60;
const STAGE_DIMENSIONS: [number, number] = [14.22, 8];

function laggedChildDuration(total: number, count: number, lagRatio: number): number {
  return count <= 1 ? total : total / (1 + (count - 1) * lagRatio);
}

function arrangeFormulaRow(formulas: readonly MathTex[], center: Vector3Tuple, gap: number): void {
  const totalWidth =
    formulas.reduce((sum, formula) => sum + formula.getWidth(), 0) +
    Math.max(0, formulas.length - 1) * gap;
  let cursor = center[0] - totalWidth / 2;
  for (const formula of formulas) {
    const width = formula.getWidth();
    formula.moveTo([cursor + width / 2, center[1], center[2]]);
    cursor += width + gap;
  }
}

/**
 * A fade whose scheduled span is only the visible prefix of a longer source
 * animation. FadeAnimation.finish() normally forces alpha=1; this variant
 * leaves the endpoint produced by the clipped rate function intact.
 */
class BoundaryClippedFadeIn extends FadeIn {
  override finish(): void {
    this.interpolate(this.rateFunc(1));
    Animation.prototype.finish.call(this);
  }
}

interface DiagramNode {
  readonly root: VGroup;
  readonly circle: Circle;
}

async function diagramNode(
  context: EsapSceneContext,
  copy: string,
  center: Vector3Tuple,
  circleColor: string,
  labelColor = context.palette.ink,
  radius = 0.42,
): Promise<DiagramNode> {
  const circle = new Circle({
    radius,
    color: circleColor,
    strokeWidth: 2.2,
    center,
  });
  const label = await context.formula.math(copy, {
    color: labelColor,
    fontSize: 38,
    position: center,
    fitStage: false,
  });
  return { root: new VGroup(circle, label), circle };
}

class BuildOneStage {
  private readonly _context: EsapSceneContext;
  private readonly _starfield: VGroup;
  private _starfieldIntroduced = false;
  private _active: Mobject[] = [];

  constructor(context: EsapSceneContext) {
    this._context = context;
    this._starfield = createStarfield(
      { rng: new SeededRng(23), palette: context.palette },
      { count: 55 },
    );
  }

  async beginBar(
    barNumber: number,
    chipCopy: string,
    chipColor: string,
    roots: readonly Mobject[],
    firstBeatAnimations: readonly Animation[],
    startCue?: number,
  ): Promise<readonly number[]> {
    const beats = barBeats(barNumber);
    const chip = await titleChip(this._context, chipCopy, { color: chipColor });
    chip.toCorner([-1, 1, 0], 0.45, STAGE_DIMENSIONS);

    // Scene.clear()/add() are hard cuts in the reference. Record the same
    // membership change on the timeline instead of spending a frame fading
    // through a blank/doubled boundary.
    const transitions: Animation[] = this._active.map((mobject) => new Remove(mobject));
    if (!this._starfieldIntroduced) {
      transitions.push(new Add(this._starfield));
      this._starfieldIntroduced = true;
    }
    transitions.push(new Add(chip));

    await this._context.clock.holdExact(
      this._context.scene,
      Math.max(0, (startCue ?? beats[0]) - this._context.clock.now),
    );
    await this._context.clock.play(this._context.scene, ...transitions, ...firstBeatAnimations);
    this._active = [chip, ...roots];
    return beats;
  }

  async beginCutout(
    trackTime: number,
    roots: readonly Mobject[],
    entranceAnimations: readonly Animation[],
  ): Promise<void> {
    const transitions = this._active.map((mobject) => new Remove(mobject));
    await this._context.clock.holdExact(
      this._context.scene,
      Math.max(0, trackTime - this._context.clock.now),
    );
    await this._context.clock.play(this._context.scene, ...transitions, ...entranceAnimations);
    this._active = [...roots];
  }

  async finish(): Promise<void> {
    const { scene, clock } = this._context;
    await clock.holdExact(scene, clock.remaining);
    // Hide at the exact section boundary. A one-frame FadeOut visibly dimmed
    // the final gold hold before the drop even though the reference hard-cuts.
    await clock.play(
      scene,
      ...[this._starfield, ...this._active].map((mobject) => new Remove(mobject)),
    );
  }
}

async function barChainRule(stage: BuildOneStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula, palette } = context;
  const names = ['w', 'a', 'h', 'z', 'L'] as const;
  const nodes = await Promise.all(
    names.map((name, index) =>
      diagramNode(context, name, [-4.8 + index * 2.4, 1.3, 0], palette.input),
    ),
  );
  const links = nodes.slice(0, -1).map(
    (node, index) =>
      new Arrow({
        start: node.circle.getRight(),
        end: nodes[index + 1].circle.getLeft(),
        color: palette.dim,
        buff: 0.1,
        strokeWidth: 2.2,
      }),
  );

  const product = await Promise.all([
    formula.math(String.raw`\frac{\partial L}{\partial w}`, {
      color: palette.ink,
      fontSize: 39,
      fitStage: false,
    }),
    formula.math('=', {
      color: palette.ink,
      fontSize: 39,
      fitStage: false,
    }),
    formula.math(String.raw`\frac{\partial L}{\partial z}`, {
      color: palette.loss,
      fontSize: 39,
      fitStage: false,
    }),
    formula.math(String.raw`\frac{\partial z}{\partial h}`, {
      color: palette.parameter,
      fontSize: 39,
      fitStage: false,
    }),
    formula.math(String.raw`\frac{\partial h}{\partial a}`, {
      color: palette.output,
      fontSize: 39,
      fitStage: false,
    }),
    formula.math(String.raw`\frac{\partial a}{\partial w}`, {
      color: palette.input,
      fontSize: 39,
      fitStage: false,
    }),
  ]);
  arrangeFormulaRow(product, [0, -1.4, 0], 0.17);

  const nodeAnimations = nodes.map(
    ({ root }) =>
      new FadeIn(root, {
        duration: laggedChildDuration(0.6, nodes.length, 0.12),
        scale: 0.6,
      }),
  );
  const linkAnimations = links.map(
    (link) =>
      new GrowArrow(link, {
        duration: laggedChildDuration(0.6, links.length, 0.12),
      }),
  );
  const beats = await stage.beginBar(
    10,
    'chain rule',
    palette.loss,
    [...nodes.map(({ root }) => root), ...links, ...product],
    [
      new LaggedStart(nodeAnimations, { lagRatio: 0.12 }),
      new LaggedStart(linkAnimations, { lagRatio: 0.12 }),
    ],
  );

  await clock.hit(
    scene,
    beats[1],
    ...product.slice(0, 3).map((part) => new Write(part, { duration: 0.5 })),
  );
  await clock.hit(
    scene,
    beats[2],
    ...product.slice(3, 5).map((part) => new Write(part, { duration: 0.5 })),
  );
  await clock.hit(scene, beats[3], new Write(product[5], { duration: 0.5 }));
}

async function barBackprop(stage: BuildOneStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula, palette } = context;
  const specs = [
    ['x', palette.input],
    ['a', palette.ink],
    ['h', palette.ink],
    ['z', palette.ink],
    ['p', palette.output],
    ['L', palette.loss],
  ] as const;
  const nodes = await Promise.all(
    specs.map(([copy, color], index) =>
      diagramNode(context, copy, [-5.5 + index * 2.2, 1.4, 0], color, color, 0.4),
    ),
  );
  const links = nodes.slice(0, -1).map(
    (node, index) =>
      new Arrow({
        start: node.circle.getRight(),
        end: nodes[index + 1].circle.getLeft(),
        color: palette.dim,
        buff: 0.08,
        strokeWidth: 2,
      }),
  );
  const operationSources = [
    String.raw`w^\top x+b_1`,
    String.raw`\mathrm{ReLU}`,
    String.raw`v h+b_2`,
    String.raw`\sigma`,
    String.raw`\mathrm{BCE}`,
  ] as const;
  const operationLabels = await Promise.all(
    operationSources.map((source) =>
      formula.math(source, {
        color: palette.dim,
        fontSize: 23,
        maxWidth: 1.7,
      }),
    ),
  );
  operationLabels.forEach((label, index) => {
    label.nextTo(links[index], [0, 1, 0], 0.12);
  });

  const key = await formula.math([String.raw`\frac{\partial L}{\partial z}`, '=', 'p-y'], {
    color: palette.ink,
    fontSize: 48,
    position: [0, -1.1, 0],
    maxWidth: 6,
  });
  key.getPart(2).setColor(palette.loss);
  const keyBox = new SurroundingRectangle(key, {
    color: palette.parameter,
    buff: 0.22,
    cornerRadius: 0.1,
    strokeWidth: 4,
  });
  // Python Manim's SurroundingRectangle is static. The web implementation
  // tracks its target by default, which would regenerate the full perimeter
  // after Create slices it whenever the parallel Write changes key's bounds.
  keyBox.clearUpdaters();
  const keyCaption = await formula.caption('the master key — everything chains from here', {
    color: palette.parameter,
    fontSize: 27,
    fitStage: false,
    maxWidth: 8.8,
  });
  keyCaption.nextTo(keyBox, [0, -1, 0], 0.25);

  const forwardGlow = nodes.map(({ circle }) => {
    const glow = circle.copy();
    glow.setStroke(palette.input, 6, 0.9);
    return glow;
  });
  const forwardDuration = 2 * BEAT_DURATION;
  const forwardChildDuration = laggedChildDuration(forwardDuration, forwardGlow.length, 0.15);
  const beats = await stage.beginBar(
    11,
    'backpropagation — the full graph',
    palette.loss,
    [...nodes.map(({ root }) => root), ...links, ...operationLabels, key, keyBox, keyCaption],
    [
      ...nodes.map(({ root }) => new Add(root)),
      ...links.map((link) => new Add(link)),
      ...operationLabels.map((label) => new Add(label)),
      new LaggedStart(
        forwardGlow.map(
          (glow) =>
            new ShowPassingFlash(glow, {
              duration: forwardChildDuration,
              timeWidth: 0.6,
            }),
        ),
        { lagRatio: 0.15 },
      ),
    ],
  );

  await clock.hit(
    scene,
    beats[2],
    new Write(key, { duration: 0.55 }),
    new Create(keyBox, { duration: 0.55 }),
  );

  const backwardGlow = [...links].reverse().map((link) => {
    const glow = link.copy();
    glow.setColor(palette.loss);
    glow.setStroke(palette.loss, 5, 1);
    return glow;
  });
  const backwardChildDuration = laggedChildDuration(0.6, backwardGlow.length, 0.15);
  await clock.hit(
    scene,
    beats[3],
    new LaggedStart(
      backwardGlow.map(
        (glow) =>
          new ShowPassingFlash(glow, {
            duration: backwardChildDuration,
            // The web stroke renderer needs a narrower interval than Cairo to
            // keep the backward wave local to the active link.
            timeWidth: 0.35,
          }),
      ),
      { lagRatio: 0.15 },
    ),
    new FadeIn(keyCaption, { duration: 0.6 }),
  );
}

async function barDerivativeCascade(
  stage: BuildOneStage,
  context: EsapSceneContext,
): Promise<void> {
  const { scene, clock, formula, palette } = context;
  const rows = await Promise.all(
    [
      String.raw`\frac{\partial L}{\partial h}=v\,(p-y)`,
      String.raw`\frac{\partial L}{\partial a}=v\,(p-y)\,\mathbf{1}[a>0]`,
      String.raw`\frac{\partial L}{\partial w}=\frac{\partial L}{\partial a}\,x\qquad \frac{\partial L}{\partial b_1}=\frac{\partial L}{\partial a}`,
      String.raw`\frac{\partial L}{\partial v}=(p-y)\,h\qquad \frac{\partial L}{\partial b_2}=p-y`,
    ].map((source) =>
      formula.math(source, {
        color: palette.ink,
        fontSize: 35,
        fitStage: false,
      }),
    ),
  );

  // Match the reference's single left-aligned MathTex column. In particular,
  // rows three and four must be one reveal path each: independently writing
  // their two halves makes the right equations appear far too early.
  const column = new VGroup(...rows);
  column.arrange([0, -1, 0], 0.5, { alignedEdge: [-1, 0, 0] });
  for (const row of rows) row.shift([-1, -0.25, 0]);
  // RecordingScene animates each row as a root. Detach them after using VGroup
  // for layout so Three.js does not reparent them and discard the column shift.
  column.remove(...rows);

  const gate = await formula.math(
    String.raw`\text{ReLU gate: }a\le 0\ \Rightarrow\ \text{no gradient reaches }w,\,b_1`,
    {
      color: palette.latent,
      fontSize: 26,
      maxWidth: 11.8,
      fitStage: false,
    },
  );
  gate.toEdge([0, -1, 0], 0.4, STAGE_DIMENSIONS);

  const occupied: NamedBounds[] = [
    ...rows.map((row, index) => namedMobjectBounds(`cascade row ${index + 1}`, row)),
    namedMobjectBounds('ReLU gate', gate),
  ];
  assertNoCollisions(occupied, 0.14);

  const cascadeBeats = barBeats(12);
  const beats = await stage.beginBar(
    12,
    'derivative cascade',
    palette.loss,
    [...rows, gate],
    [new Write(rows[0], { duration: 0.55 })],
    // The reference renders each section independently, then concatenates
    // whole-frame spans. Align this cue to BUILD ONE's local frame grid so the
    // assembled hard cut lands on reference frame 2074 rather than 2075.
    frameAlignedSectionCue(context.timing, cascadeBeats[0]),
  );
  for (let index = 1; index < rows.length; index += 1) {
    const animations: Animation[] = [new Write(rows[index], { duration: 0.55 })];
    if (index === 1) {
      animations.push(
        new FadeIn(gate, {
          duration: 0.55,
          shift: [0, 0.2, 0],
        }),
      );
    }
    await clock.hit(scene, beats[index], ...animations);
  }
}

async function barUpdateCutout(stage: BuildOneStage, context: EsapSceneContext): Promise<void> {
  const { scene, clock, formula, palette } = context;
  const update = await formula.math(String.raw`\theta\;\leftarrow\;\theta-\eta\,\nabla_\theta L`, {
    color: palette.ink,
    fontSize: 65,
    position: [0, 1.35, 0],
    maxWidth: 10.5,
  });
  const axes = new Axes({
    xRange: [-2.4, 2.4, 1],
    yRange: [0, 2.4, 1],
    xLength: 6,
    yLength: 2.6,
    color: palette.dim,
    axisConfig: {
      includeTicks: false,
      strokeOpacity: 0,
    },
    tips: false,
  });
  axes.moveTo([0, -1.5, 0]);
  const bowl = axes.plot((value) => 0.42 * value * value, {
    xRange: [-2.4, 2.4],
    color: palette.dim,
    strokeWidth: 2.5,
  });
  const pathOne = axes.plot((value) => 0.42 * value * value, {
    xRange: [-2.05, -0.9],
    color: palette.dim,
    strokeOpacity: 0,
  });
  const pathTwo = axes.plot((value) => 0.42 * value * value, {
    xRange: [-0.9, -0.25],
    color: palette.dim,
    strokeOpacity: 0,
  });
  const ball = new Dot({
    point: axes.inputToGraphPoint(-2.05, bowl),
    color: palette.parameter,
    radius: 0.11,
  });
  ball.setFill(palette.parameter, 1);
  const finalBallPoint = pathTwo.pointFromProportion(1);
  const eta = await formula.math(String.raw`\eta`, {
    color: palette.parameter,
    fontSize: 40,
    fitStage: false,
  });
  const finalBall = new Dot({
    point: finalBallPoint,
    color: palette.parameter,
    radius: 0.11,
  });
  eta.nextTo(finalBall, [1, 1, 0], 0.25);

  await stage.beginCutout(
    CUTOUTS[0],
    [update, bowl, ball, eta],
    [new Write(update, { duration: 0.8 })],
  );
  await clock.play(
    scene,
    new Create(bowl, { duration: 0.45 }),
    new FadeIn(ball, { duration: 0.45, scale: 0.5 }),
  );
  await clock.play(
    scene,
    new MoveAlongPath(ball, {
      path: pathOne,
      duration: 0.8,
      rateFunc: easeInOutSine,
    }),
    new Indicate(update, {
      color: palette.parameter,
      duration: 0.8,
      rateFunc: easeInOutSine,
      scaleFactor: 1.06,
    }),
  );
  await clock.play(
    scene,
    new MoveAlongPath(ball, {
      path: pathTwo,
      duration: 0.7,
      rateFunc: easeOutSine,
    }),
  );

  // The Python render is frame-trimmed during this 0.4s fade. Keep the original
  // easing progress when clipping it to the section, rather than accelerating
  // the short visible prefix to 100% opacity.
  const etaSourceDuration = 0.4;
  const etaDuration = Math.max(FRAME, Math.min(etaSourceDuration, clock.remaining));
  await clock.play(
    scene,
    new BoundaryClippedFadeIn(eta, {
      duration: etaDuration,
      scale: 1.5,
      rateFunc: (alpha) => smooth((alpha * etaDuration) / etaSourceDuration),
    }),
  );
}

export const buildOneScene = defineEsapScene({
  id: 'build-1',
  title: 'The optimization loop',
  status: 'implemented',
  async build(context) {
    const stage = new BuildOneStage(context);
    await barChainRule(stage, context);
    await barBackprop(stage, context);
    await barDerivativeCascade(stage, context);
    await barUpdateCutout(stage, context);
    await stage.finish();
  },
});
