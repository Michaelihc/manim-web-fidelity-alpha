import { Mobject } from '../../core/Mobject';
import { Animation } from '../Animation';

/**
 * Contract shared by all three methods:
 *   - `target` is never mutated; it is read-only reference geometry.
 *   - `source` is the live scene object that is mutated in place.
 *
 * Per-method contracts:
 *
 * begin(source, target)
 *   @pre  source and target are fully initialised (points, style, transform set).
 *   @post source may have its points re-aligned for interpolation;
 *         all values needed for interpolation are captured and frozen.
 *
 * interpolate(source, target, alpha)
 *   @pre  begin() has been called; alpha ∈ [0, 1].
 *   @post source.{geometry, style, transform} are lerped toward target's captured-at-begin state.
 *
 * finish(source, target)
 *   @pre  begin() has been called.
 *   @post source is in the exact visual state of target as captured at begin():
 *         points, color, fillColor, opacity, fillOpacity, strokeWidth,
 *         position, rotation, scaleVector all match target's values.
 *         source's transform-subpath metadata matches target's topology.
 */
export interface MorphStrategy {
  begin(animation: Animation, source: Mobject, target: Mobject): void;
  interpolate(animation: Animation, source: Mobject, target: Mobject, alpha: number): void;
  finish(animation: Animation, source: Mobject, target: Mobject): void;
  /**
   * Restore any source/target state changed by begin/interpolate/finish.
   *
   * Transform strategies are allowed to align geometry and temporarily attach
   * target render objects.  Timeline backward seeking therefore needs a
   * strategy-level reset in addition to Animation's root-property snapshot.
   */
  reset?(animation: Animation, source: Mobject, target: Mobject): void;
}
