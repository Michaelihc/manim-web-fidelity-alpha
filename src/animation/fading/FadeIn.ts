/**
 * FadeIn animation - fades a mobject from transparent to its original style.
 * Supports optional shift and relative starting scale.
 */

import { Mobject } from '../../core/Mobject';
import { FadeAnimation, type FadeOptions } from './FadeAnimation';

export class FadeIn extends FadeAnimation {
  constructor(mobject: Mobject, options: FadeOptions = {}) {
    super(mobject, 'in', options);
  }
}

/**
 * Create a FadeIn animation for a mobject.
 * @param mobject The mobject to fade in
 * @param options Animation options (duration, rateFunc, shift, scale)
 */
export function fadeIn(mobject: Mobject, options?: FadeOptions): FadeIn {
  return new FadeIn(mobject, options);
}
