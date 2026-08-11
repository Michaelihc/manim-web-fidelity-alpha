/**
 * MoveAlongPath animation - moves a mobject along a path defined by a VMobject.
 */

import { Mobject } from '../../core/Mobject';
import { VMobject } from '../../core/VMobject';
import { Animation, AnimationOptions } from '../Animation';

export interface MoveAlongPathOptions extends AnimationOptions {
  /** The path to follow (VMobject) */
  path: VMobject;
  /** Whether to orient the mobject tangent to the path, default false */
  rotateAlongPath?: boolean;
}

export class MoveAlongPath extends Animation {
  /** The path to follow */
  readonly path: VMobject;

  /** Whether to orient tangent to the path */
  readonly rotateAlongPath: boolean;

  /** Whether the path contains at least one cubic segment. */
  private _hasPath: boolean = false;

  /** Offset from mobject.position to mobject.getCenter() (accounts for geometry offset, e.g. Dot) */
  private _centerOffset: number[] = [0, 0, 0];

  constructor(mobject: Mobject, options: MoveAlongPathOptions) {
    super(mobject, options);
    this.path = options.path;
    this.rotateAlongPath = options.rotateAlongPath ?? false;
  }

  /**
   * Set up the animation - compute path data
   */
  override begin(): void {
    super.begin();

    this._hasPath = this.path.getLocalPoints().length >= 4;

    // Calculate offset between mobject's center and its position.
    // Mobjects like Dot have internal geometry offset from their position,
    // so getCenter() != position. We need this offset to correctly set position
    // such that the mobject's center lands on the path point.
    const center = this.mobject.getCenter();
    this._centerOffset = [
      center[0] - this.mobject.position.x,
      center[1] - this.mobject.position.y,
      center[2] - this.mobject.position.z,
    ];
  }

  /**
   * Get position and tangent at alpha (0 to 1) along the path
   */
  private _getPositionAndTangent(alpha: number): { position: number[]; tangent: number[] } {
    if (!this._hasPath) {
      // No valid path, stay at current position
      const pos = this.mobject.position;
      return {
        position: [pos.x, pos.y, pos.z],
        tangent: [1, 0, 0],
      };
    }

    const clampedAlpha = Math.max(0, Math.min(1, alpha));
    const position = this.path.pointFromProportion(clampedAlpha);
    const epsilon = 1e-4;
    const before = this.path.pointFromProportion(Math.max(0, clampedAlpha - epsilon));
    const after = this.path.pointFromProportion(Math.min(1, clampedAlpha + epsilon));
    const tangent = [after[0] - before[0], after[1] - before[1], after[2] - before[2]];

    return { position, tangent };
  }

  /**
   * Interpolate the position (and optionally rotation) at the given alpha
   */
  interpolate(alpha: number): void {
    const { position, tangent } = this._getPositionAndTangent(alpha);

    // Set position, compensating for the mobject's internal center offset.
    // For a Dot, getCenter() = _point + position, so we need
    // position = desired_point - _point = desired_point - centerOffset.
    this.mobject.position.set(
      position[0] - this._centerOffset[0],
      position[1] - this._centerOffset[1],
      position[2] - this._centerOffset[2],
    );

    // Optionally set rotation to tangent direction
    if (this.rotateAlongPath) {
      const length = Math.hypot(tangent[0], tangent[1], tangent[2]);

      if (length > 0.0001) {
        // Calculate rotation to align with tangent
        const angle = Math.atan2(tangent[1], tangent[0]);
        this.mobject.rotation.set(0, 0, angle);
      }
    }

    this.mobject._markDirty();
  }

  /**
   * Ensure the position is exact at the end
   */
  override finish(): void {
    this.interpolate(1);
    super.finish();
  }
}

/**
 * Create a MoveAlongPath animation for a mobject.
 * @param mobject The mobject to move along the path
 * @param path The VMobject path to follow
 * @param options Animation options (duration, rateFunc, rotateAlongPath)
 */
export function moveAlongPath(
  mobject: Mobject,
  path: VMobject,
  options?: Omit<MoveAlongPathOptions, 'path'>,
): MoveAlongPath {
  return new MoveAlongPath(mobject, { ...options, path });
}
