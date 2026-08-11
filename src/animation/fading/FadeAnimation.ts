import * as THREE from 'three';
import { Mobject, type MobjectStyle, type Vector3Tuple } from '../../core/Mobject';
import { Animation, type AnimationOptions } from '../Animation';

/**
 * Options shared by FadeIn and FadeOut.
 *
 * `scale` is relative to the mobject's target size, matching Manim:
 * FadeIn starts at this factor and FadeOut ends at it.
 */
export interface FadeOptions extends AnimationOptions {
  scale?: number;
}

type FadeDirection = 'in' | 'out';

interface FamilyStyleSnapshot {
  mobject: Mobject;
  color: string;
  style: MobjectStyle;
  fillOpacity: number;
  strokeOpacity: number;
  strokeWidth: number;
}

/**
 * Shared, seek-stable implementation for Manim-style fades.
 *
 * A fade changes every member of the mobject family, rather than only the
 * container. Geometry is reconstructed from the target transform on every
 * interpolation so backward seeks cannot accumulate scale or shift.
 */
export abstract class FadeAnimation extends Animation {
  private readonly _direction: FadeDirection;
  private readonly _shift: Vector3Tuple;
  private readonly _scaleFactor: number;

  private _familyState: FamilyStyleSnapshot[] | null = null;
  private _targetPosition: THREE.Vector3 | null = null;
  private _targetScale: THREE.Vector3 | null = null;
  private _targetCenter: Vector3Tuple | null = null;

  protected constructor(mobject: Mobject, direction: FadeDirection, options: FadeOptions = {}) {
    const { scale = 1, ...animationOptions } = options;
    super(mobject, animationOptions);

    if (!Number.isFinite(scale)) {
      throw new TypeError('Fade scale must be a finite number');
    }

    this._direction = direction;
    this._shift = options.shift ? [...options.shift] : [0, 0, 0];
    this._scaleFactor = scale;
  }

  override begin(): void {
    super.begin();

    if (this._familyState === null) {
      this._familyState = this.mobject.getFamily().map((member) => ({
        mobject: member,
        color: member.color,
        style: member.style,
        fillOpacity: member.fillOpacity,
        strokeOpacity: member.opacity,
        strokeWidth: member.strokeWidth,
      }));
      this._targetPosition = this.mobject.position.clone();
      this._targetScale = this.mobject.scaleVector.clone();

      // Scaling needs the geometric center as its fixed target-space anchor.
      // Avoid querying it for the common scale=1 case so fades continue to work
      // for non-geometric test/dummy mobjects.
      if (this._scaleFactor !== 1) {
        this._targetCenter = this.mobject.getCenter();
      }
    }

    this.interpolate(0);
  }

  interpolate(alpha: number): void {
    const clampedAlpha = Math.max(0, Math.min(1, alpha));
    const visibility = this._direction === 'in' ? clampedAlpha : 1 - clampedAlpha;
    this._applyFamilyVisibility(visibility);
    this._applyTransform(clampedAlpha);
  }

  override finish(): void {
    this.interpolate(1);
    super.finish();
  }

  override reset(): void {
    super.reset();
    this.restoreOriginalState();
  }

  /**
   * Restore the exact pre-animation state. FadeOut uses this after its mobject
   * has been removed from a scene, matching Manim's reusable-mobject behavior.
   */
  protected restoreOriginalState(): void {
    if (this._targetPosition !== null && this._targetScale !== null) {
      this.mobject.position.copy(this._targetPosition);
      this.mobject.scaleVector.copy(this._targetScale);
    }

    if (this._familyState !== null) {
      for (const snapshot of this._familyState) {
        this._applyStyle(snapshot, 1);
      }
    }

    this.mobject._markDirty();
  }

  private _applyFamilyVisibility(visibility: number): void {
    if (this._familyState === null) return;

    for (const snapshot of this._familyState) {
      this._applyStyle(snapshot, visibility);
    }
  }

  private _applyStyle(snapshot: FamilyStyleSnapshot, visibility: number): void {
    const member = snapshot.mobject;

    // setStyle updates this member directly, avoiding VGroup's propagating
    // opacity setters. Each descendant receives its own original opacity.
    member.setStyle({
      ...snapshot.style,
      fillOpacity: snapshot.fillOpacity * visibility,
      strokeOpacity: snapshot.strokeOpacity * visibility,
      strokeWidth: snapshot.strokeWidth,
    });

    // Mobject.setStyle routes strokeColor through `color`, which intentionally
    // sets both paint colors. Reapply the independently snapshotted values so a
    // dim/faded mobject with distinct fill and stroke styles is restored exactly.
    member.color = snapshot.color;
    if (snapshot.style.strokeColor !== undefined) {
      member.strokeColor = snapshot.style.strokeColor;
    }
    if (snapshot.style.fillColor !== undefined) {
      member.fillColor = snapshot.style.fillColor;
    }
  }

  private _applyTransform(alpha: number): void {
    if (this._targetPosition === null || this._targetScale === null) return;

    // Always rebuild from the target transform. This makes direct interpolation
    // and timeline backward seeking deterministic instead of compounding scale.
    this.mobject.position.copy(this._targetPosition);
    this.mobject.scaleVector.copy(this._targetScale);

    const relativeScale =
      this._direction === 'in'
        ? this._scaleFactor + (1 - this._scaleFactor) * alpha
        : 1 + (this._scaleFactor - 1) * alpha;

    if (relativeScale !== 1) {
      this.mobject.scale(relativeScale, { aboutPoint: this._targetCenter! });
    }

    const shiftProgress = this._direction === 'in' ? -(1 - alpha) : alpha;
    if (this._shift[0] !== 0 || this._shift[1] !== 0 || this._shift[2] !== 0) {
      this.mobject.shift([
        this._shift[0] * shiftProgress,
        this._shift[1] * shiftProgress,
        this._shift[2] * shiftProgress,
      ]);
    }

    this.mobject._markDirty();
  }
}
