import type { MobjectLike, Vector3Tuple } from './MobjectTypes';

/**
 * Get the center point of a mobject.
 */
export function getCenterImpl(mob: MobjectLike): Vector3Tuple {
  const b = mob.getBounds();
  return [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2];
}

/**
 * Get bounding box dimensions.
 * Uses object pooling to avoid allocations in hot paths.
 */
export function getBoundingBoxImpl(mob: MobjectLike): {
  width: number;
  height: number;
  depth: number;
} {
  // VMobject supplies a point-based getBounds() implementation because Three's
  // Box3 cannot reliably measure Line2 geometry. Going through the polymorphic
  // bounds API keeps generic sizing helpers correct for every mobject family.
  // Empty containers retain their historical zero-size bounding box.
  if (mob.isEmpty()) return { width: 0, height: 0, depth: 0 };
  const bounds = mob.getBounds();
  return {
    width: bounds.max.x - bounds.min.x,
    height: bounds.max.y - bounds.min.y,
    depth: bounds.max.z - bounds.min.z,
  };
}

/**
 * Get the edge point of the bounding box in a direction.
 */
export function getEdgeInDirectionImpl(mob: MobjectLike, direction: Vector3Tuple): Vector3Tuple {
  const center = mob.getCenter();
  const bounds = mob.getBoundingBox();

  // Use sign only (matches Manim's get_critical_point behavior)
  return [
    center[0] + (Math.sign(direction[0]) * bounds.width) / 2,
    center[1] + (Math.sign(direction[1]) * bounds.height) / 2,
    center[2] + (Math.sign(direction[2]) * bounds.depth) / 2,
  ];
}

/**
 * Move a mobject to the edge of the frame.
 */
export function toEdgeImpl(
  mob: MobjectLike,
  direction: Vector3Tuple,
  buff: number,
  frameDimensions?: [number, number],
): void {
  const frameWidth = frameDimensions?.[0] ?? 14;
  const frameHeight = frameDimensions?.[1] ?? 8;
  const bbox = mob.getBoundingBox();
  const center = mob.getCenter();

  const targetX =
    direction[0] !== 0 ? direction[0] * (frameWidth / 2 - buff - bbox.width / 2) : center[0];
  const targetY =
    direction[1] !== 0 ? direction[1] * (frameHeight / 2 - buff - bbox.height / 2) : center[1];

  mob.moveTo([targetX, targetY, center[2]]);
}
