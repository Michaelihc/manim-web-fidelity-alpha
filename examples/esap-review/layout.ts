import type { Mobject } from '../../src/index.ts';

export const ESAP_STAGE = Object.freeze({
  worldWidth: 14.22,
  worldHeight: 8,
  pixelWidth: 1280,
  pixelHeight: 720,
  defaultMargin: 0.42,
});

export interface Bounds2D {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
}

export interface NamedBounds extends Bounds2D {
  readonly name: string;
}

export interface Collision {
  readonly first: string;
  readonly second: string;
  readonly horizontalOverlap: number;
  readonly verticalOverlap: number;
}

export function stageBounds(margin = 0): Bounds2D {
  if (margin < 0 || margin * 2 >= Math.min(ESAP_STAGE.worldWidth, ESAP_STAGE.worldHeight)) {
    throw new RangeError('stageBounds margin must leave a non-empty stage');
  }
  return {
    left: -ESAP_STAGE.worldWidth / 2 + margin,
    right: ESAP_STAGE.worldWidth / 2 - margin,
    bottom: -ESAP_STAGE.worldHeight / 2 + margin,
    top: ESAP_STAGE.worldHeight / 2 - margin,
  };
}

export function mobjectBounds(mobject: Mobject): Bounds2D {
  const bounds = mobject.getBounds();
  return {
    left: bounds.min.x,
    right: bounds.max.x,
    bottom: bounds.min.y,
    top: bounds.max.y,
  };
}

export function inflateBounds(bounds: Bounds2D, amount: number): Bounds2D {
  if (amount < 0) throw new RangeError('inflateBounds amount cannot be negative');
  return {
    left: bounds.left - amount,
    right: bounds.right + amount,
    bottom: bounds.bottom - amount,
    top: bounds.top + amount,
  };
}

export function boundsOverlap(first: Bounds2D, second: Bounds2D, minimumGap = 0): boolean {
  if (minimumGap < 0) throw new RangeError('boundsOverlap minimumGap cannot be negative');
  return !(
    first.right + minimumGap <= second.left ||
    second.right + minimumGap <= first.left ||
    first.top + minimumGap <= second.bottom ||
    second.top + minimumGap <= first.bottom
  );
}

export function boundsInside(inner: Bounds2D, outer: Bounds2D): boolean {
  return (
    inner.left >= outer.left &&
    inner.right <= outer.right &&
    inner.bottom >= outer.bottom &&
    inner.top <= outer.top
  );
}

export function findCollisions(items: readonly NamedBounds[], minimumGap = 0): Collision[] {
  const collisions: Collision[] = [];
  for (let firstIndex = 0; firstIndex < items.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < items.length; secondIndex += 1) {
      const first = items[firstIndex];
      const second = items[secondIndex];
      if (!boundsOverlap(first, second, minimumGap)) continue;
      collisions.push({
        first: first.name,
        second: second.name,
        horizontalOverlap: Math.max(
          0,
          Math.min(first.right, second.right) - Math.max(first.left, second.left),
        ),
        verticalOverlap: Math.max(
          0,
          Math.min(first.top, second.top) - Math.max(first.bottom, second.bottom),
        ),
      });
    }
  }
  return collisions;
}

export function assertNoCollisions(items: readonly NamedBounds[], minimumGap = 0): void {
  const collisions = findCollisions(items, minimumGap);
  if (collisions.length === 0) return;
  const pairs = collisions
    .map(
      ({ first, second, horizontalOverlap, verticalOverlap }) =>
        `${first} with ${second} (${horizontalOverlap.toFixed(3)}×${verticalOverlap.toFixed(3)})`,
    )
    .join(', ');
  const bounds = items
    .map(
      ({ name, left, right, bottom, top }) =>
        `${name}=[${left.toFixed(3)},${right.toFixed(3)}]×[${bottom.toFixed(3)},${top.toFixed(3)}]`,
    )
    .join('; ');
  throw new Error(`Layout collision detected: ${pairs}. Bounds: ${bounds}`);
}

/**
 * Shrink and translate a rendered mobject into the safe stage rectangle.
 *
 * Async text must complete `waitForRender()` before calling this function.
 */
export function fitInsideStage<T extends Mobject>(
  mobject: T,
  margin: number = ESAP_STAGE.defaultMargin,
): T {
  const safe = stageBounds(margin);
  const availableWidth = safe.right - safe.left;
  const availableHeight = safe.top - safe.bottom;
  const width = mobject.getWidth();
  const height = mobject.getHeight();
  const scale = Math.min(1, availableWidth / width, availableHeight / height);
  if (scale < 1) mobject.scale(scale);

  const bounds = mobjectBounds(mobject);
  let shiftX = 0;
  let shiftY = 0;
  if (bounds.left < safe.left) shiftX = safe.left - bounds.left;
  if (bounds.right > safe.right) shiftX = safe.right - bounds.right;
  if (bounds.bottom < safe.bottom) shiftY = safe.bottom - bounds.bottom;
  if (bounds.top > safe.top) shiftY = safe.top - bounds.top;
  if (shiftX !== 0 || shiftY !== 0) mobject.shift([shiftX, shiftY, 0]);
  return mobject;
}

export function namedMobjectBounds(name: string, mobject: Mobject): NamedBounds {
  return { name, ...mobjectBounds(mobject) };
}
