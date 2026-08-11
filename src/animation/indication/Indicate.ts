/**
 * Indicate animation - draws attention to a mobject by scaling it up
 * and changing its color, then returning to the original state.
 *
 * This mimics Manim's Indicate animation, which scales the mobject up
 * to a larger size while changing to a highlight color, then returns
 * to the original state.
 */

import * as THREE from 'three';
import { Mobject } from '../../core/Mobject';
import { Animation, AnimationOptions } from '../Animation';
import { thereAndBack } from '../../rate-functions';
import { YELLOW } from '../../constants';

export interface IndicateOptions extends AnimationOptions {
  /** Scale factor at peak of indication. Default: 1.2 */
  scaleFactor?: number;
  /** Color to use for indication highlight. Default: YELLOW */
  color?: string;
}

interface IndicateFamilyState {
  mobject: Mobject;
  color: string;
  fillColor: string;
  strokeColor: string;
  fillOpacity: number;
  strokeOpacity: number;
  strokeWidth: number;
}

export class Indicate extends Animation {
  /** Scale factor at peak */
  readonly scaleFactor: number;

  /** Highlight color */
  readonly indicateColor: string;

  /** Original scale */
  private _originalScale: THREE.Vector3 = new THREE.Vector3();

  /** Original position and the target transform produced by scale-about-center. */
  private _originalPosition: THREE.Vector3 = new THREE.Vector3();
  private _targetScale: THREE.Vector3 = new THREE.Vector3();
  private _targetPosition: THREE.Vector3 = new THREE.Vector3();

  /** Per-family style is required for colored/dim MathTex and nested VGroups. */
  private _familyStates: IndicateFamilyState[] = [];

  private readonly _targetColor = new THREE.Color();
  private readonly _scratchColor = new THREE.Color();

  constructor(mobject: Mobject, options: IndicateOptions = {}) {
    // Use thereAndBack rate function by default for smooth there-and-back motion
    super(mobject, {
      duration: options.duration ?? 1,
      rateFunc: options.rateFunc ?? thereAndBack,
    });
    this.scaleFactor = options.scaleFactor ?? 1.2;
    this.indicateColor = options.color ?? YELLOW;
    this._targetColor.set(this.indicateColor);
  }

  override begin(): void {
    super.begin();

    this._originalScale.copy(this.mobject.scaleVector);
    this._originalPosition.copy(this.mobject.position);
    this._familyStates = this.mobject.getFamily().map((mobject) => ({
      mobject,
      color: mobject.color,
      fillColor: mobject.fillColor ?? mobject.color,
      strokeColor: mobject.strokeColor ?? mobject.color,
      fillOpacity: mobject.fillOpacity,
      strokeOpacity: mobject.opacity,
      strokeWidth: mobject.strokeWidth,
    }));

    // Match target.scale(scaleFactor): the object's geometric center stays
    // fixed even when its local origin/position is not at that center.
    //
    // A few legacy animation tests instantiate abstract Mobject directly. It
    // has no renderer geometry from which to compute a center, so its position
    // is necessarily the scale anchor.
    const hasConcreteGeometry =
      typeof Reflect.get(this.mobject, '_createThreeObject') === 'function';
    if (hasConcreteGeometry && !this.mobject.isEmpty()) {
      this.mobject.scale(this.scaleFactor);
      this._targetScale.copy(this.mobject.scaleVector);
      this._targetPosition.copy(this.mobject.position);
      this.mobject.scaleVector.copy(this._originalScale);
      this.mobject.position.copy(this._originalPosition);
    } else {
      this._targetScale.copy(this._originalScale).multiplyScalar(this.scaleFactor);
      this._targetPosition.copy(this._originalPosition);
    }
    this.mobject._markDirty();
  }

  interpolate(alpha: number): void {
    this.mobject.position.lerpVectors(this._originalPosition, this._targetPosition, alpha);
    this.mobject.scaleVector.lerpVectors(this._originalScale, this._targetScale, alpha);

    for (const state of this._familyStates) {
      if (alpha === 0) {
        this._applyFamilyStyle(state, state.color, state.fillColor, state.strokeColor);
        continue;
      }

      const color =
        '#' +
        this._scratchColor
          .lerpColors(new THREE.Color(state.color), this._targetColor, alpha)
          .getHexString();
      const fillColor =
        '#' +
        this._scratchColor
          .lerpColors(new THREE.Color(state.fillColor), this._targetColor, alpha)
          .getHexString();
      const strokeColor =
        '#' +
        this._scratchColor
          .lerpColors(new THREE.Color(state.strokeColor), this._targetColor, alpha)
          .getHexString();
      this._applyFamilyStyle(state, color, fillColor, strokeColor);
    }
    this.mobject._markDirty();
  }

  override finish(): void {
    // Preserve the actual endpoint selected by the rate function. The default
    // thereAndBack(1) is zero and therefore still returns to the start, while a
    // custom monotonic rate function (for example easeInOutSine) correctly
    // leaves the indicated target in place at the cut.
    this.interpolate(this.rateFunc(1));
    super.finish();
  }

  override reset(): void {
    super.reset();
    this._restoreOriginalState();
  }

  private _applyFamilyStyle(
    state: IndicateFamilyState,
    color: string,
    fillColor: string,
    strokeColor: string,
  ): void {
    const { mobject } = state;

    // Call base style setters directly so a VGroup/MathTex node does not
    // recursively overwrite descendants that have their own starting styles.
    mobject.color = color;
    mobject.fillColor = fillColor;
    mobject.strokeColor = strokeColor;
    // strokeColor's public setter keeps the legacy renderer color in sync.
    // Preserve a separately captured semantic color as well.
    Reflect.set(mobject, '_color', color);
    Mobject.prototype.setFillOpacity.call(mobject, state.fillOpacity);
    Mobject.prototype.setStrokeOpacity.call(mobject, state.strokeOpacity);
    Mobject.prototype.setStrokeWidth.call(mobject, state.strokeWidth);
    mobject._markDirty();
  }

  private _restoreOriginalState(): void {
    if (this._familyStates.length === 0) return;

    this.mobject.position.copy(this._originalPosition);
    this.mobject.scaleVector.copy(this._originalScale);
    for (const state of this._familyStates) {
      this._applyFamilyStyle(state, state.color, state.fillColor, state.strokeColor);
    }
    this.mobject._markDirty();
  }
}

/**
 * Create an Indicate animation for a mobject.
 * Draws attention by scaling up and changing color, then returning to original.
 * @param mobject The mobject to indicate
 * @param options Indicate options (scaleFactor, color, duration, rateFunc)
 */
export function indicate(mobject: Mobject, options?: IndicateOptions): Indicate {
  return new Indicate(mobject, options);
}
