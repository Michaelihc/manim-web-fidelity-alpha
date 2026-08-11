/**
 * FadeOut animation - fades a mobject from its original style to transparent.
 * Supports optional shift and relative ending scale.
 */

import { Mobject } from '../../core/Mobject';
import { type AnimationScene } from '../Animation';
import { FadeAnimation, type FadeOptions } from './FadeAnimation';

export class FadeOut extends FadeAnimation {
  constructor(mobject: Mobject, options: FadeOptions = {}) {
    super(mobject, 'out', options);
    this.remover = true;
  }

  /**
   * Manim restores a faded-out mobject after removing it, allowing the same
   * instance to be reused or reconstructed during backward seeking.
   */
  override cleanUpFromScene(scene: AnimationScene): void {
    super.cleanUpFromScene(scene);
    this.restoreOriginalState();
  }
}

/**
 * Create a FadeOut animation for a mobject.
 * @param mobject The mobject to fade out
 * @param options Animation options (duration, rateFunc, shift, scale)
 */
export function fadeOut(mobject: Mobject, options?: FadeOptions): FadeOut {
  return new FadeOut(mobject, options);
}
