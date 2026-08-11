/**
 * Blink animation - makes a mobject blink (fade out and back in) repeatedly.
 *
 * This animation creates a blinking effect by modulating the opacity of
 * the mobject, making it fade out and back in a configurable number of times.
 */

import * as THREE from 'three';
import { Mobject } from '../../core/Mobject';
import { Animation, AnimationOptions } from '../Animation';
import { linear } from '../../rate-functions';
import {
  applyPaintOpacityFactor,
  capturePaintOpacity,
  restorePaintOpacity,
  type PaintOpacitySnapshot,
} from '../transform/PaintOpacity';

export interface BlinkOptions extends AnimationOptions {
  /** Number of blinks. Default: 2 */
  nBlinks?: number;
  /** Minimum opacity during blink (0-1). Default: 0 (fully invisible) */
  minOpacity?: number;
  /** Time proportion spent at minimum opacity per blink. Default: 0.3 */
  blinkDuration?: number;
}

export class Blink extends Animation {
  /** Number of blinks */
  readonly nBlinks: number;

  /** Minimum opacity during blink */
  readonly minOpacity: number;

  /** Time proportion spent at minimum opacity */
  readonly blinkDuration: number;

  private _paint: PaintOpacitySnapshot = [];

  /** Materials that need opacity updates */
  private _materials: THREE.Material[] = [];
  private _materialOpacities = new Map<THREE.Material, number>();

  constructor(mobject: Mobject, options: BlinkOptions = {}) {
    super(mobject, {
      duration: options.duration ?? 1,
      rateFunc: options.rateFunc ?? linear,
    });
    this.nBlinks = options.nBlinks ?? 2;
    this.minOpacity = options.minOpacity ?? 0;
    this.blinkDuration = options.blinkDuration ?? 0.3;
  }

  override begin(): void {
    super.begin();

    // Store original paint and collect materials
    this._paint = capturePaintOpacity(this.mobject);
    this._materials = [];
    this._materialOpacities.clear();

    // Traverse to find all materials
    const threeObj = this.mobject.getThreeObject();
    threeObj.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        const material = (child as THREE.Mesh).material;
        if (Array.isArray(material)) {
          this._materials.push(...material);
        } else if (material) {
          this._materials.push(material);
        }
      }
    });

    // Enable transparency on all materials
    for (const material of this._materials) {
      this._materialOpacities.set(material, material.opacity);
      material.transparent = true;
    }
  }

  interpolate(alpha: number): void {
    // Calculate blink phase
    // Each blink cycle: fade out -> stay at min -> fade in
    const blinkPhase = (alpha * this.nBlinks) % 1;

    // Compute opacity based on blink phase
    // 0.0 - fadeOutEnd: fading out
    // fadeOutEnd - fadeInStart: at minimum
    // fadeInStart - 1.0: fading in
    const fadeOutEnd = (1 - this.blinkDuration) / 2;
    const fadeInStart = 1 - fadeOutEnd;

    let opacityFactor: number;

    if (blinkPhase < fadeOutEnd) {
      // Fading out
      const fadeProgress = blinkPhase / fadeOutEnd;
      opacityFactor = 1 + (this.minOpacity - 1) * fadeProgress;
    } else if (blinkPhase < fadeInStart) {
      // At minimum opacity
      opacityFactor = this.minOpacity;
    } else {
      // Fading in
      const fadeProgress = (blinkPhase - fadeInStart) / (1 - fadeInStart);
      opacityFactor = this.minOpacity + (1 - this.minOpacity) * fadeProgress;
    }

    // Apply opacity to mobject and all materials
    applyPaintOpacityFactor(this._paint, opacityFactor);

    for (const material of this._materials) {
      material.opacity = (this._materialOpacities.get(material) ?? 1) * opacityFactor;
      material.needsUpdate = true;
    }

    this.mobject._markDirty();
  }

  override finish(): void {
    // Restore original opacity
    restorePaintOpacity(this._paint);

    for (const material of this._materials) {
      material.opacity = this._materialOpacities.get(material) ?? 1;
      material.needsUpdate = true;
    }

    this.mobject._markDirty();
    super.finish();
  }

  override reset(): void {
    super.reset();
    restorePaintOpacity(this._paint);
    for (const [material, opacity] of this._materialOpacities) {
      material.opacity = opacity;
      material.needsUpdate = true;
    }
  }
}

/**
 * Create a Blink animation for a mobject.
 * Makes the mobject blink (fade out and back in) a specified number of times.
 * @param mobject The mobject to blink
 * @param options Blink options (nBlinks, minOpacity, blinkDuration)
 */
export function blink(mobject: Mobject, options?: BlinkOptions): Blink {
  return new Blink(mobject, options);
}
