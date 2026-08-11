import {
  Animation,
  Dot,
  MathTex,
  Mobject,
  Rectangle,
  VGroup,
  addVec,
  type Vector3Tuple,
} from '../../../src/index.ts';
import type { FormulaOptions } from '../formula';
import { fitInsideStage, boundsOverlap, namedMobjectBounds, type NamedBounds } from '../layout';
import type { EsapPalette } from '../palette';
import { quantizeDuration } from '../timing';
import type { EsapSceneContext } from './types';

interface OpacityState {
  readonly mobject: Mobject;
  readonly fill: number;
  readonly stroke: number;
}

class FamilyFadeOut extends Animation {
  private _states: OpacityState[] = [];

  constructor(mobject: Mobject, duration: number) {
    super(mobject, { duration });
    this.remover = true;
  }

  override begin(): void {
    super.begin();
    this._states = this.mobject.getFamily().map((member) => ({
      mobject: member,
      fill: member.fillOpacity,
      stroke: member.opacity,
    }));
  }

  interpolate(alpha: number): void {
    for (const state of this._states) {
      state.mobject.setFillOpacity(state.fill * (1 - alpha));
      state.mobject.setStrokeOpacity(state.stroke * (1 - alpha));
    }
  }

  override finish(): void {
    this.interpolate(1);
    super.finish();
  }

  override reset(): void {
    super.reset();
    for (const state of this._states) {
      state.mobject.setFillOpacity(state.fill);
      state.mobject.setStrokeOpacity(state.stroke);
    }
  }
}

class PalettePulse extends Animation {
  private readonly _peakOpacity: number;

  constructor(overlay: Rectangle, duration: number, peakOpacity: number) {
    super(overlay, { duration });
    this._peakOpacity = peakOpacity;
    this.remover = true;
  }

  override begin(): void {
    super.begin();
    this.mobject.setFillOpacity(0);
    this.mobject.setStrokeOpacity(0);
  }

  interpolate(alpha: number): void {
    this.mobject.setFillOpacity(Math.sin(Math.PI * alpha) * this._peakOpacity);
  }

  override finish(): void {
    this.mobject.setFillOpacity(0);
    super.finish();
  }
}

export interface StarfieldOptions {
  readonly count?: number;
  readonly drift?: number;
  readonly minOpacity?: number;
  readonly maxOpacity?: number;
}

export function createStarfield(
  context: Pick<EsapSceneContext, 'rng' | 'palette'>,
  options: StarfieldOptions = {},
): VGroup {
  const { count = 70, drift = 0.04, minOpacity = 0.15, maxOpacity = 0.5 } = options;
  const dots: Dot[] = [];
  const velocities: Vector3Tuple[] = [];

  for (let index = 0; index < count; index += 1) {
    const opacity = context.rng.range(minOpacity, maxOpacity);
    const dot = new Dot({
      point: [context.rng.range(-7.1, 7.1), context.rng.range(-4, 4), 0],
      radius: context.rng.range(0.006, 0.02),
      color: context.palette.ink,
      fillOpacity: opacity,
      strokeWidth: 0,
    });
    dot.setFill(context.palette.ink, opacity);
    dots.push(dot);
    velocities.push([context.rng.range(-drift, drift), context.rng.range(-drift, drift), 0]);
  }

  const field = new VGroup(...dots);
  field.addUpdater((_mobject, deltaTime) => {
    dots.forEach((dot, index) =>
      dot.shift([velocities[index][0] * deltaTime, velocities[index][1] * deltaTime, 0]),
    );
  });
  return field;
}

export function createBackdrop(palette: EsapPalette): Rectangle {
  const backdrop = new Rectangle({
    width: 15.6,
    height: 9.6,
    color: palette.background,
    fillOpacity: 1,
    strokeWidth: 0,
  });
  backdrop.setFill(palette.background, 1);
  return backdrop;
}

export async function titleChip(
  context: Pick<EsapSceneContext, 'formula' | 'palette'>,
  copy: string,
  options: FormulaOptions = {},
): Promise<MathTex> {
  return context.formula.label(copy, {
    uppercase: true,
    color: context.palette.ink,
    fontSize: 28,
    maxWidth: 5.2,
    ...options,
  });
}

const DEFAULT_PLACEMENT_OFFSETS: readonly Vector3Tuple[] = [
  [0, 0, 0],
  [0, -0.55, 0],
  [0, 0.55, 0],
  [-0.7, 0, 0],
  [0.7, 0, 0],
  [-0.7, -0.55, 0],
  [0.7, -0.55, 0],
];

export interface SafePlacement {
  readonly name: string;
  readonly position: Vector3Tuple;
  readonly occupied: NamedBounds[];
  readonly minimumGap?: number;
  readonly stageMargin?: number;
  readonly fallbackOffsets?: readonly Vector3Tuple[];
}

/**
 * Try a short, deterministic set of nearby placements and reserve the winner.
 * Throws instead of silently accepting a collision.
 */
export function placeSafely<T extends Mobject>(mobject: T, placement: SafePlacement): T {
  const {
    name,
    position,
    occupied,
    minimumGap = 0.16,
    stageMargin,
    fallbackOffsets = DEFAULT_PLACEMENT_OFFSETS,
  } = placement;

  for (const offset of fallbackOffsets) {
    mobject.moveTo(addVec(position, offset));
    fitInsideStage(mobject, stageMargin);
    const candidate = namedMobjectBounds(name, mobject);
    const collision = occupied.some((bounds) => boundsOverlap(bounds, candidate, minimumGap));
    if (!collision) {
      occupied.push(candidate);
      return mobject;
    }
  }

  const blockers = occupied.map(({ name: blocker }) => blocker).join(', ');
  throw new Error(`No collision-free placement found for "${name}"; checked against ${blockers}`);
}

export async function safeCaption(
  context: Pick<EsapSceneContext, 'formula'>,
  copy: string,
  placement: SafePlacement,
  options: FormulaOptions = {},
): Promise<MathTex> {
  const caption = await context.formula.caption(copy, {
    fitStage: false,
    ...options,
  });
  return placeSafely(caption, placement);
}

export async function paletteFlash(
  context: Pick<EsapSceneContext, 'scene' | 'clock' | 'palette'>,
  color = context.palette.ink,
  seconds = 0.16,
  peakOpacity = 0.42,
): Promise<void> {
  const duration = quantizeDuration(seconds);
  const overlay = createBackdrop({ ...context.palette, background: color });
  overlay.setFill(color, 0);
  await context.clock.play(context.scene, new PalettePulse(overlay, duration, peakOpacity));
}

/** Fade every family member, then remove roots at an exact frame boundary. */
export async function removeFrameSafe(
  context: Pick<EsapSceneContext, 'scene' | 'clock'>,
  mobjects: readonly Mobject[],
  seconds = 1 / 60,
): Promise<void> {
  if (mobjects.length === 0) return;
  const duration = quantizeDuration(seconds);
  await context.clock.play(
    context.scene,
    ...mobjects.map((mobject) => new FamilyFadeOut(mobject, duration)),
  );
}

export const clearFrameSafe = removeFrameSafe;
