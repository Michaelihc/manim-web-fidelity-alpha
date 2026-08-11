import type { Mobject, Vector3Tuple } from '../../../src/index.ts';
import { ESAP_STAGE } from '../layout';

export interface MobjectCollectionBounds {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
}

export function mobjectCollectionBounds(mobjects: readonly Mobject[]): MobjectCollectionBounds {
  if (mobjects.length === 0) {
    throw new RangeError('mobjectCollectionBounds requires at least one mobject');
  }

  const first = mobjects[0].getBounds();
  let left = first.min.x;
  let right = first.max.x;
  let bottom = first.min.y;
  let top = first.max.y;

  for (const mobject of mobjects.slice(1)) {
    const bounds = mobject.getBounds();
    left = Math.min(left, bounds.min.x);
    right = Math.max(right, bounds.max.x);
    bottom = Math.min(bottom, bounds.min.y);
    top = Math.max(top, bounds.max.y);
  }

  return { left, right, bottom, top };
}

export function centerMobjectsAt(mobjects: readonly Mobject[], target: Vector3Tuple): void {
  const bounds = mobjectCollectionBounds(mobjects);
  const shift: Vector3Tuple = [
    target[0] - (bounds.left + bounds.right) / 2,
    target[1] - (bounds.bottom + bounds.top) / 2,
    target[2],
  ];
  for (const mobject of mobjects) mobject.shift(shift);
}

export function placeMobjectsAtBottomEdge(mobjects: readonly Mobject[], buff: number): void {
  const bounds = mobjectCollectionBounds(mobjects);
  const shift: Vector3Tuple = [
    -(bounds.left + bounds.right) / 2,
    -ESAP_STAGE.worldHeight / 2 + buff - bounds.bottom,
    0,
  ];
  for (const mobject of mobjects) mobject.shift(shift);
}
