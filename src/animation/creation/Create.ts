/**
 * Create animation - progressively slices the mobject's cubic Bézier geometry.
 * Compound VMobject contours stay disconnected; raster/text fallbacks retain
 * their renderer-specific reveal paths.
 */

import * as THREE from 'three';
import { Mobject } from '../../core/Mobject';
import { VMobject } from '../../core/VMobject';
import { Animation, AnimationOptions } from '../Animation';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { TextGlyphGroup } from '../../mobjects/text/TextGlyphGroup';
import type { GlyphVMobject } from '../../mobjects/text/GlyphVMobject';
import { doubleSmooth, linear } from '../../rate-functions';
import { VectorPathReveal } from './VectorPathReveal';
import {
  applyPaintOpacityFactor,
  capturePaintOpacity,
  restorePaintOpacity,
  type PaintOpacitySnapshot,
} from '../transform/PaintOpacity';

/**
 * Interface for mobjects that support glyph-stroke animation (e.g. Text).
 */
interface GlyphStrokeMobject {
  getGlyphGroup(): TextGlyphGroup | null;
  getTextureMesh(): THREE.Mesh | null;
}

/**
 * Interface for mobjects that support left-to-right reveal (e.g. MathTex).
 */
interface RevealProgressMobject {
  setRevealProgress(alpha: number): void;
}

/**
 * Interface for mobjects that support getText/setText (e.g. Text).
 */
interface TextAccessMobject {
  getText(): string;
  setText(text: string): void;
}

/**
 * Interface for glyph mobjects that may have a skeleton path.
 */
interface SkeletonPathMobject {
  getSkeletonPath(): number[][] | null;
}

/**
 * Extract the total line distance from a Line2's geometry after computeLineDistances().
 * The instanceDistanceEnd attribute is an InterleavedBufferAttribute whose backing
 * data lives in `.data.array`, or a plain BufferAttribute with `.array`.
 */
export function getLine2TotalLength(child: Line2): number {
  const geom = child.geometry;
  const distEnd = geom.getAttribute('instanceDistanceEnd') as
    | THREE.InterleavedBufferAttribute
    | THREE.BufferAttribute
    | null;
  if (distEnd && distEnd.count > 0) {
    const arr = 'data' in distEnd && distEnd.data ? distEnd.data.array : distEnd.array;
    return (arr[arr.length - 1] as number) || 1;
  }
  return 1;
}

/**
 * Check whether a mobject's Three.js subtree contains at least one Line2 child.
 * Used by legacy raster-glyph and Uncreate fallbacks.
 */
export function hasLine2Children(mobject: Mobject): boolean {
  let found = false;
  mobject.getThreeObject().traverse((child) => {
    if (child instanceof Line2) found = true;
  });
  return found;
}

export interface CreateOptions extends AnimationOptions {
  /** Stagger ratio between point-bearing family members. Default: 1 */
  lagRatio?: number;
}

export class Create extends Animation {
  private readonly _vectorReveal: VectorPathReveal;
  private _useVectorReveal: boolean = false;
  private _savedOpacities: Array<[Mobject, number]> = [];

  constructor(mobject: Mobject, options: CreateOptions = {}) {
    super(mobject, { ...options, duration: options.duration ?? 1 });
    this._vectorReveal = new VectorPathReveal(mobject, {
      lagRatio: options.lagRatio ?? 1,
      rateFunc: this.rateFunc,
      drawBorderThenFill: false,
    });
  }

  override begin(): void {
    super.begin();
    this._useVectorReveal = this._vectorReveal.begin();
    if (!this._useVectorReveal) {
      this._savedOpacities = [];
      this._collectOpacities(this.mobject);
      this.mobject.setStrokeOpacity(0);
    }
  }

  private _collectOpacities(mob: Mobject): void {
    this._savedOpacities.push([mob, mob.opacity]);
    for (const child of mob.children) this._collectOpacities(child);
  }

  private _applyScaledOpacities(factor: number): void {
    for (const [mob, origOpacity] of this._savedOpacities) {
      Mobject.prototype.setStrokeOpacity.call(mob, origOpacity * factor);
    }
  }

  interpolate(alpha: number): void {
    if (this._useVectorReveal) this._vectorReveal.interpolate(alpha);
    else this._applyScaledOpacities(alpha);
  }

  protected override _interpolateRawAlpha(rawAlpha: number): void {
    this.interpolate(this._useVectorReveal ? rawAlpha : this.rateFunc(rawAlpha));
  }

  override finish(): void {
    if (this._useVectorReveal) this._vectorReveal.restore();
    else this._applyScaledOpacities(1);
    super.finish();
  }

  override reset(): void {
    // Vector reveal changes every leaf's point count. Restore the leaf topology
    // before Animation.reset() asks a VGroup root to repartition its aggregate
    // snapshot across those children.
    this._vectorReveal.restore(false);
    super.reset();
    if (this._useVectorReveal) this._vectorReveal.restore();
    else this._applyScaledOpacities(1);
    this._useVectorReveal = false;
  }
}

/**
 * Create a Create animation for a mobject.
 * Progressively draws the mobject's stroke.
 * @param mobject The mobject to create (should be a VMobject)
 * @param options Animation options (duration, rateFunc)
 */
export function create(mobject: Mobject, options?: CreateOptions): Create {
  return new Create(mobject, options);
}

/**
 * DrawBorderThenFill - draws the border progressively, then fills.
 * A variant of Create that traces the stroke first, then fades in the fill.
 */
export interface DrawBorderThenFillOptions extends AnimationOptions {
  /** Stagger between leaf paths. Default: 0 (simultaneous). */
  lagRatio?: number;
  /** Width of the temporary outline drawn before the fill. Default: 2. */
  strokeWidth?: number;
}

export class DrawBorderThenFill extends Animation {
  private readonly _vectorReveal: VectorPathReveal;
  private _useVectorReveal: boolean = false;

  constructor(mobject: Mobject, options: DrawBorderThenFillOptions = {}) {
    super(mobject, {
      ...options,
      duration: options.duration ?? 2,
      rateFunc: options.rateFunc ?? doubleSmooth,
    });
    this._vectorReveal = new VectorPathReveal(mobject, {
      lagRatio: options.lagRatio ?? 0,
      outlineStrokeWidth: options.strokeWidth,
      rateFunc: this.rateFunc,
    });
  }

  override begin(): void {
    super.begin();
    this._useVectorReveal = this._vectorReveal.begin();
  }

  interpolate(alpha: number): void {
    if (this._useVectorReveal) this._vectorReveal.interpolate(alpha);
  }

  protected override _interpolateRawAlpha(rawAlpha: number): void {
    this.interpolate(rawAlpha);
  }

  override finish(): void {
    if (this._useVectorReveal) this._vectorReveal.restore();
    super.finish();
  }

  override reset(): void {
    // See Create.reset(): a partial family cannot accept the root's full
    // aggregate point snapshot until its leaves have been restored.
    this._vectorReveal.restore(false);
    super.reset();
    this._vectorReveal.restore();
    this._useVectorReveal = false;
  }
}

/**
 * Create a DrawBorderThenFill animation.
 */
export function drawBorderThenFill(
  mobject: Mobject,
  options?: DrawBorderThenFillOptions,
): DrawBorderThenFill {
  return new DrawBorderThenFill(mobject, options);
}

/**
 * Uncreate animation - reverse of Create, erases the stroke progressively.
 * Uses dashed lines to progressively hide the stroke from end to start.
 */
export class Uncreate extends Animation {
  /** Total path length for dash-based reveal */
  private _totalLength: number = 0;
  /** Whether to use dash-based reveal */
  private _useDashReveal: boolean = false;
  private _fallbackPaint: PaintOpacitySnapshot = [];

  constructor(mobject: Mobject, options: AnimationOptions = {}) {
    // Manim default for Uncreate is 2 seconds
    super(mobject, { duration: options.duration ?? 2, ...options });
  }

  override begin(): void {
    super.begin();
    this._useDashReveal = this.mobject instanceof VMobject && hasLine2Children(this.mobject);
    this._fallbackPaint = capturePaintOpacity(this.mobject);

    if (this._useDashReveal) {
      const threeObj = this.mobject.getThreeObject();
      threeObj.traverse((child) => {
        if (child instanceof Line2) {
          const material = child.material as LineMaterial;
          material.dashed = true;
          material.dashScale = 1;

          child.computeLineDistances();
          this._totalLength = getLine2TotalLength(child);

          material.dashSize = this._totalLength;
          material.gapSize = 0;
          material.needsUpdate = true;
        }
      });
    }
  }

  interpolate(alpha: number): void {
    if (this._useDashReveal) {
      const threeObj = this.mobject.getThreeObject();
      threeObj.traverse((child) => {
        if (child instanceof Line2) {
          const material = child.material as LineMaterial;
          const visibleLength = (1 - alpha) * this._totalLength;
          material.dashSize = visibleLength;
          material.gapSize = this._totalLength - visibleLength + 0.0001;
          material.needsUpdate = true;
        }
      });
    } else {
      applyPaintOpacityFactor(this._fallbackPaint, 1 - alpha);
    }
  }

  override finish(): void {
    if (this._useDashReveal) {
      const threeObj = this.mobject.getThreeObject();
      threeObj.traverse((child) => {
        if (child instanceof Line2) {
          const material = child.material as LineMaterial;
          material.dashSize = 0;
          material.gapSize = this._totalLength;
          material.needsUpdate = true;
        }
      });
    } else {
      applyPaintOpacityFactor(this._fallbackPaint, 0);
    }
    super.finish();
  }

  override reset(): void {
    super.reset();
    restorePaintOpacity(this._fallbackPaint);
  }
}

/**
 * Create an Uncreate animation for a mobject.
 */
export function uncreate(mobject: Mobject, options?: AnimationOptions): Uncreate {
  return new Uncreate(mobject, options);
}

// =============================================================================
// Write Animations - specifically for Text mobjects
// =============================================================================

export interface WriteOptions extends AnimationOptions {
  /** Stagger between characters, default 0.05 */
  lagRatio?: number;
  /** Write in reverse (right to left), default false */
  reverse?: boolean;
  /** Remove after animation, default false */
  remover?: boolean;
  /** Ratio of animation time spent on stroke drawing vs cross-fade (default 0.7 = 70% stroke, 30% crossfade) */
  strokeRatio?: number;
  /**
   * When true, the Write animation uses the glyph's skeleton (medial axis)
   * for stroke drawing, producing natural center-line pen strokes instead
   * of perimeter outlines. Requires glyphs to be loaded with
   * `useSkeletonStroke: true`. Default: false (uses outline strokes).
   */
  useSkeletonStroke?: boolean;
}

function defaultWriteDuration(mobject: Mobject): number {
  const pointBearingLeaves = mobject
    .getFamily()
    .filter(
      (member) =>
        member instanceof VMobject &&
        member.children.length === 0 &&
        member.getLocalPoints().length > 0,
    ).length;
  return pointBearingLeaves < 15 ? 1 : 2;
}

/**
 * Write animation specifically for Text and MathTex mobjects.
 * Reveals text character by character with a pen-stroke effect.
 *
 * Rendering paths:
 * 1. Glyph stroke mode — Text with loaded glyph group (via loadGlyphs()) gets stroke-draw
 *    of each character's outline, then cross-fades to the Canvas 2D texture.
 * 2. Dash-based reveal — for VMobjects that already have Line2 children.
 * 3. Opacity fallback.
 */
export class Write extends Animation {
  protected readonly lagRatio: number;
  private _reverse: boolean;
  private _remover: boolean;
  private _strokeRatio: number;
  private _originalOpacity: number = 1;
  private _fallbackPaint: PaintOpacitySnapshot = [];

  // Rendering mode flags (mutually exclusive)
  private _useGlyphStroke: boolean = false;
  private _useVectorReveal: boolean = false;
  private _useRevealProgress: boolean = false;
  private readonly _vectorReveal: VectorPathReveal;

  // Glyph stroke state
  private _glyphGroup: TextGlyphGroup | null = null;
  private _textMesh: THREE.Mesh | null = null;
  private _glyphTotalLengths: number[] = [];
  private _parentThreeObj: THREE.Object3D | null = null;

  // Skeleton stroke state: when a glyph has a skeleton, we create
  // a temporary VMobject with skeleton points and animate that instead.
  // _skeletonVMobs[i] is non-null if glyph child i has a skeleton path.
  private _skeletonVMobs: (VMobject | null)[] = [];
  private _skeletonTotalLengths: number[] = [];

  constructor(mobject: Mobject, options: WriteOptions = {}) {
    super(mobject, {
      ...options,
      duration: options.duration ?? defaultWriteDuration(mobject),
      rateFunc: options.rateFunc ?? linear,
    });
    this.lagRatio = options.lagRatio ?? 0.05;
    this._reverse = options.reverse ?? false;
    this._remover = options.remover ?? false;
    this.remover = this._remover;
    this._strokeRatio = options.strokeRatio ?? 0.7;
    this._vectorReveal = new VectorPathReveal(mobject, {
      lagRatio: options.lagRatio,
      outlineStrokeWidth: 2,
      rateFunc: this.rateFunc,
      reverseFamily: this._reverse,
    });
  }

  override begin(): void {
    super.begin();
    this._originalOpacity = this.mobject.opacity;
    this._fallbackPaint = capturePaintOpacity(this.mobject);

    // Priority 1: Check for glyph stroke mode
    if (
      'getGlyphGroup' in this.mobject &&
      typeof (this.mobject as unknown as GlyphStrokeMobject).getGlyphGroup === 'function'
    ) {
      const glyphGroup = (this.mobject as unknown as GlyphStrokeMobject).getGlyphGroup();
      if (glyphGroup && glyphGroup.length > 0) {
        this._useGlyphStroke = true;
        this._glyphGroup = glyphGroup;
        this._beginGlyphStroke();
        return;
      }
    }

    // Priority 2: Left-to-right reveal for mobjects with setRevealProgress (MathTex)
    if (
      'setRevealProgress' in this.mobject &&
      typeof (this.mobject as unknown as RevealProgressMobject).setRevealProgress === 'function'
    ) {
      this._useRevealProgress = true;
      (this.mobject as unknown as RevealProgressMobject).setRevealProgress(this._reverse ? 1 : 0);
      return;
    }

    // Priority 3: family-aware vector reveal for MathTex and other VMobjects.
    this._useVectorReveal = this._vectorReveal.begin();

    if (this._useVectorReveal) {
      if (this._reverse) this._vectorReveal.interpolate(1);
    } else {
      applyPaintOpacityFactor(this._fallbackPaint, this._reverse ? 1 : 0);
    }
  }

  /**
   * Set up glyph-stroke mode: hide the texture mesh, attach the glyph group
   * to the Text's Three.js parent, and prepare dash reveal for each glyph child.
   *
   * When a glyph has a skeleton path (medial axis), a temporary VMobject is
   * created with the skeleton points and used for the dash-reveal animation
   * instead of the outline. The outline glyph is hidden in that case.
   */
  private _beginGlyphStroke(): void {
    const glyphGroup = this._glyphGroup!;

    // Hide the Text's texture mesh
    if (
      'getTextureMesh' in this.mobject &&
      typeof (this.mobject as unknown as GlyphStrokeMobject).getTextureMesh === 'function'
    ) {
      this._textMesh = (this.mobject as unknown as GlyphStrokeMobject).getTextureMesh();
    }
    if (this._textMesh) {
      this._textMesh.visible = false;
    }

    // Attach glyph group's Three.js object to the Text's Three.js parent
    const textThreeObj = this.mobject.getThreeObject();
    this._parentThreeObj = textThreeObj;
    const glyphThreeObj = glyphGroup.getThreeObject();

    // Center the glyph group to match the centered canvas texture.
    // Compute bounding box BEFORE adding to parent so it's in local space.
    const glyphBounds = new THREE.Box3().setFromObject(glyphThreeObj);
    if (!glyphBounds.isEmpty()) {
      const glyphCenterX = (glyphBounds.min.x + glyphBounds.max.x) / 2;
      const glyphCenterY = (glyphBounds.min.y + glyphBounds.max.y) / 2;
      glyphThreeObj.position.x = -glyphCenterX;
      glyphThreeObj.position.y = -glyphCenterY;
    }
    this._parentThreeObj.add(glyphThreeObj);

    // Set up dash reveal for each glyph child's Line2 children
    this._glyphTotalLengths = [];
    this._skeletonVMobs = [];
    this._skeletonTotalLengths = [];
    const children = glyphGroup.children;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childThreeObj = child.getThreeObject();

      // Check if this glyph has a skeleton path
      const glyphChild = child as unknown as GlyphVMobject;
      let skeletonPath: number[][] | null = null;
      if (
        'getSkeletonPath' in glyphChild &&
        typeof (glyphChild as unknown as SkeletonPathMobject).getSkeletonPath === 'function'
      ) {
        skeletonPath = (glyphChild as unknown as SkeletonPathMobject).getSkeletonPath();
      }

      if (skeletonPath && skeletonPath.length >= 4) {
        // --- Skeleton mode for this glyph ---
        // Hide the outline glyph
        childThreeObj.visible = false;

        // Create a temporary VMobject with skeleton points
        const skelVMob = new VMobject();
        skelVMob.setColor(child.color || '#ffffff');
        skelVMob.strokeWidth = child.strokeWidth ?? 2;
        skelVMob.fillOpacity = 0;
        skelVMob.setPoints3D(skeletonPath);

        // Attach skeleton VMobject's Three.js object into the glyph group
        const skelThreeObj = skelVMob.getThreeObject();
        glyphThreeObj.add(skelThreeObj);

        // Set up dash reveal on the skeleton's Line2
        let skelTotalLen = 1;
        skelThreeObj.traverse((obj) => {
          if (obj instanceof Line2) {
            const material = obj.material as LineMaterial;
            material.dashed = true;
            material.dashScale = 1;

            obj.computeLineDistances();
            skelTotalLen = getLine2TotalLength(obj);

            material.dashSize = 0;
            material.gapSize = skelTotalLen;
            material.needsUpdate = true;
          }
        });

        this._skeletonVMobs.push(skelVMob);
        this._skeletonTotalLengths.push(skelTotalLen);
        this._glyphTotalLengths.push(1); // placeholder (unused when skeleton active)
      } else {
        // --- Standard outline mode for this glyph ---
        this._skeletonVMobs.push(null);
        this._skeletonTotalLengths.push(0);

        let totalLen = 1;
        childThreeObj.traverse((obj) => {
          if (obj instanceof Line2) {
            const material = obj.material as LineMaterial;
            material.dashed = true;
            material.dashScale = 1;

            obj.computeLineDistances();
            totalLen = getLine2TotalLength(obj);

            // Start fully hidden
            material.dashSize = 0;
            material.gapSize = totalLen;
            material.needsUpdate = true;
          }
        });

        this._glyphTotalLengths.push(totalLen);
      }
    }
  }

  interpolate(alpha: number): void {
    const effectiveAlpha = this._reverse ? 1 - alpha : alpha;

    if (this._useGlyphStroke) {
      this._interpolateGlyphStroke(effectiveAlpha);
    } else if (this._useRevealProgress) {
      (this.mobject as unknown as RevealProgressMobject).setRevealProgress(effectiveAlpha);
    } else if (this._useVectorReveal) {
      this._vectorReveal.interpolate(effectiveAlpha);
    } else {
      applyPaintOpacityFactor(this._fallbackPaint, effectiveAlpha);
    }
  }

  protected override _interpolateRawAlpha(rawAlpha: number): void {
    this.interpolate(this._useVectorReveal ? rawAlpha : this.rateFunc(rawAlpha));
  }

  /**
   * Glyph stroke interpolation:
   * Phase 1 (0 -> strokeRatio): Dash-reveal glyph outlines (or skeletons) with lag stagger
   * Phase 2 (strokeRatio -> 1): Cross-fade from glyph strokes to texture mesh
   *
   * When a glyph has a skeleton VMobject, the skeleton is used for the
   * dash-reveal animation instead of the outline, producing a natural
   * center-line pen-stroke effect.
   */
  private _interpolateGlyphStroke(alpha: number): void {
    const glyphGroup = this._glyphGroup!;
    const children = glyphGroup.children;
    const numChildren = children.length;
    const strokeRatio = this._strokeRatio;

    if (alpha <= strokeRatio) {
      // Phase 1: Progressive dash-reveal across all glyph children
      const strokeAlpha = alpha / strokeRatio; // normalize to 0-1

      for (let i = 0; i < numChildren; i++) {
        // Compute per-character alpha with stagger
        const charStart = (i / numChildren) * (1 - this.lagRatio);
        const charEnd = charStart + this.lagRatio + (1 - this.lagRatio) / numChildren;
        const charAlpha = Math.max(
          0,
          Math.min(1, (strokeAlpha - charStart) / (charEnd - charStart)),
        );

        const skelVMob = this._skeletonVMobs[i];

        if (skelVMob) {
          // Skeleton mode: animate the skeleton VMobject
          const totalLen = this._skeletonTotalLengths[i] || 1;
          const skelThreeObj = skelVMob.getThreeObject();

          skelThreeObj.traverse((obj) => {
            if (obj instanceof Line2) {
              const material = obj.material as LineMaterial;
              const visibleLength = charAlpha * totalLen;
              material.dashSize = visibleLength;
              material.gapSize = totalLen - visibleLength + 0.0001;
              material.needsUpdate = true;
            }
          });
        } else {
          // Standard outline mode
          const totalLen = this._glyphTotalLengths[i] || 1;
          const child = children[i];
          const childThreeObj = child.getThreeObject();

          childThreeObj.traverse((obj) => {
            if (obj instanceof Line2) {
              const material = obj.material as LineMaterial;
              const visibleLength = charAlpha * totalLen;
              material.dashSize = visibleLength;
              material.gapSize = totalLen - visibleLength + 0.0001;
              material.needsUpdate = true;
            }
          });
        }
      }

      // Ensure texture mesh stays hidden during stroke phase
      if (this._textMesh) {
        this._textMesh.visible = false;
      }
    } else {
      // Phase 2: Cross-fade — strokes fully visible, fade in texture, fade out strokes
      const fadeAlpha = (alpha - strokeRatio) / (1 - strokeRatio); // normalize to 0-1

      // Ensure all glyph strokes are fully revealed, then fade out
      for (let i = 0; i < numChildren; i++) {
        const skelVMob = this._skeletonVMobs[i];

        if (skelVMob) {
          // Fade out skeleton stroke
          const totalLen = this._skeletonTotalLengths[i] || 1;
          const skelThreeObj = skelVMob.getThreeObject();

          skelThreeObj.traverse((obj) => {
            if (obj instanceof Line2) {
              const material = obj.material as LineMaterial;
              material.dashSize = totalLen;
              material.gapSize = 0.0001;
              material.opacity = 1 - fadeAlpha;
              material.needsUpdate = true;
            }
          });
        } else {
          // Fade out outline stroke
          const totalLen = this._glyphTotalLengths[i] || 1;
          const child = children[i];
          const childThreeObj = child.getThreeObject();

          childThreeObj.traverse((obj) => {
            if (obj instanceof Line2) {
              const material = obj.material as LineMaterial;
              material.dashSize = totalLen;
              material.gapSize = 0.0001;
              material.opacity = 1 - fadeAlpha;
              material.needsUpdate = true;
            }
          });
        }
      }

      // Fade in the texture mesh
      if (this._textMesh) {
        this._textMesh.visible = true;
        const material = this._textMesh.material as THREE.MeshBasicMaterial;
        if (material) {
          material.opacity = this._originalOpacity * fadeAlpha;
        }
      }
    }
  }

  override finish(): void {
    if (this._useGlyphStroke) {
      this._finishGlyphStroke();
      super.finish();
      return;
    }

    if (this._useRevealProgress) {
      if (this._remover) {
        (this.mobject as unknown as RevealProgressMobject).setRevealProgress(0);
      } else {
        (this.mobject as unknown as RevealProgressMobject).setRevealProgress(1);
      }
      super.finish();
      return;
    }

    if (this._remover) {
      if (this._useVectorReveal) this._vectorReveal.hide();
      if (!this._useVectorReveal) applyPaintOpacityFactor(this._fallbackPaint, 0);
    } else {
      if (this._useVectorReveal) this._vectorReveal.restore();
      else restorePaintOpacity(this._fallbackPaint);
    }
    super.finish();
  }

  override reset(): void {
    // Family-aware Write slices vector leaves, so restore their exact point
    // counts before the base VGroup snapshot is repartitioned.
    if (this._useGlyphStroke && this._glyphGroup) {
      const remover = this._remover;
      this._remover = false;
      this._finishGlyphStroke();
      this._remover = remover;
    } else if (this._useVectorReveal) {
      this._vectorReveal.restore(false);
    }
    super.reset();
    if (this._useVectorReveal) {
      this._vectorReveal.restore();
    } else if (!this._useGlyphStroke && !this._useRevealProgress) {
      restorePaintOpacity(this._fallbackPaint);
    }
    this._useGlyphStroke = false;
    this._useVectorReveal = false;
    this._useRevealProgress = false;
  }

  /**
   * Clean up glyph stroke mode: remove glyph group and skeleton VMobjects
   * from scene, restore texture mesh to full opacity.
   */
  private _finishGlyphStroke(): void {
    const glyphGroup = this._glyphGroup!;
    const glyphThreeObj = glyphGroup.getThreeObject();

    if (this._remover) {
      // Unwrite: hide everything
      if (this._textMesh) {
        this._textMesh.visible = false;
      }
      this.mobject.setStrokeOpacity(0);
    } else {
      // Write complete: show texture, hide glyphs
      if (this._textMesh) {
        this._textMesh.visible = true;
        const material = this._textMesh.material as THREE.MeshBasicMaterial;
        if (material) {
          material.opacity = this._originalOpacity;
        }
      }
      this.mobject.setStrokeOpacity(this._originalOpacity);
    }

    // Clean up skeleton VMobjects
    for (let i = 0; i < this._skeletonVMobs.length; i++) {
      const skelVMob = this._skeletonVMobs[i];
      if (skelVMob) {
        const skelThreeObj = skelVMob.getThreeObject();
        // Remove skeleton Three.js object from glyph group
        glyphThreeObj.remove(skelThreeObj);
        // Restore outline glyph visibility
        if (i < glyphGroup.children.length) {
          glyphGroup.children[i].getThreeObject().visible = true;
        }
        // Dispose skeleton VMobject resources
        skelVMob.dispose();
      }
    }
    this._skeletonVMobs = [];
    this._skeletonTotalLengths = [];

    // Remove glyph group from the Three.js scene
    if (this._parentThreeObj) {
      this._parentThreeObj.remove(glyphThreeObj);
    }

    // Disable dashing on glyph strokes
    for (const child of glyphGroup.children) {
      child.getThreeObject().traverse((obj) => {
        if (obj instanceof Line2) {
          const material = obj.material as LineMaterial;
          material.dashed = false;
          material.needsUpdate = true;
        }
      });
    }

    this._glyphGroup = null;
    this._textMesh = null;
    this._parentThreeObj = null;
  }
}

/**
 * Create a Write animation for a mobject.
 * Progressively reveals text with a pen-stroke effect.
 * @param mobject The mobject to write (typically Text or MathTex)
 * @param options Write animation options
 */
export function write(mobject: Mobject, options?: WriteOptions): Write {
  return new Write(mobject, options);
}

/**
 * Unwrite animation - reverse of Write, erases text character by character.
 */
export class Unwrite extends Write {
  constructor(mobject: Mobject, options: WriteOptions = {}) {
    super(mobject, { ...options, reverse: true, remover: true });
  }
}

/**
 * Create an Unwrite animation for a mobject.
 * Progressively erases text with a pen-stroke effect.
 * @param mobject The mobject to unwrite (typically Text or MathTex)
 * @param options Write animation options
 */
export function unwrite(mobject: Mobject, options?: WriteOptions): Unwrite {
  return new Unwrite(mobject, options);
}

// =============================================================================
// Letter-by-Letter Animations
// =============================================================================

export interface AddTextLetterByLetterOptions extends AnimationOptions {
  /** Time per character in seconds, default 0.1 */
  timePerChar?: number;
  /**
   * When true, animate in reverse: remove letters one by one instead of adding them.
   * Used internally by RemoveTextLetterByLetter.
   */
  reverse?: boolean;
}

/**
 * Types out text letter by letter (typewriter effect).
 * Works with Text mobjects that support partial text display.
 * When `reverse` is true, removes letters one by one instead.
 */
export class AddTextLetterByLetter extends Animation {
  /** Time per character for duration calculation */
  protected readonly timePerChar: number;
  /** Whether to run in reverse (remove letters) */
  protected readonly reverse: boolean;
  protected _fullText: string = '';

  constructor(mobject: Mobject, options: AddTextLetterByLetterOptions = {}) {
    const timePerChar = options.timePerChar ?? 0.1;
    // Duration depends on text length - will be set in begin()
    // For now, use a default or the provided duration
    super(mobject, { ...options, duration: options.duration ?? 1 });
    this.timePerChar = timePerChar;
    this.reverse = options.reverse ?? false;
  }

  override begin(): void {
    super.begin();
    if (
      'getText' in this.mobject &&
      typeof (this.mobject as unknown as TextAccessMobject).getText === 'function'
    ) {
      this._fullText = (this.mobject as unknown as TextAccessMobject).getText();
      if (
        !this.reverse &&
        'setText' in this.mobject &&
        typeof (this.mobject as unknown as TextAccessMobject).setText === 'function'
      ) {
        (this.mobject as unknown as TextAccessMobject).setText('');
      }
    }
  }

  interpolate(alpha: number): void {
    if (
      'setText' in this.mobject &&
      typeof (this.mobject as unknown as TextAccessMobject).setText === 'function' &&
      this._fullText
    ) {
      if (this.reverse) {
        const numCharsToRemove = Math.floor(alpha * this._fullText.length);
        const remainingChars = this._fullText.length - numCharsToRemove;
        (this.mobject as unknown as TextAccessMobject).setText(
          this._fullText.substring(0, remainingChars),
        );
      } else {
        const numChars = Math.floor(alpha * this._fullText.length);
        (this.mobject as unknown as TextAccessMobject).setText(
          this._fullText.substring(0, numChars),
        );
      }
    }
  }

  override finish(): void {
    if (
      'setText' in this.mobject &&
      typeof (this.mobject as unknown as TextAccessMobject).setText === 'function'
    ) {
      if (this.reverse) {
        (this.mobject as unknown as TextAccessMobject).setText('');
      } else if (this._fullText) {
        (this.mobject as unknown as TextAccessMobject).setText(this._fullText);
      }
    }
    super.finish();
  }
}

/**
 * Create an AddTextLetterByLetter animation.
 * Types out text letter by letter (typewriter effect).
 * @param mobject The mobject to animate (must support getText/setText)
 * @param options Animation options including timePerChar
 */
export function addTextLetterByLetter(
  mobject: Mobject,
  options?: AddTextLetterByLetterOptions,
): AddTextLetterByLetter {
  return new AddTextLetterByLetter(mobject, options);
}

/**
 * Removes text letter by letter (reverse typewriter effect).
 * Works with Text mobjects that support partial text display.
 *
 * Extends AddTextLetterByLetter with `reverse: true` — all logic is shared,
 * this class exists only for backward-compatible exports.
 */
export class RemoveTextLetterByLetter extends AddTextLetterByLetter {
  constructor(mobject: Mobject, options: AddTextLetterByLetterOptions = {}) {
    super(mobject, { ...options, reverse: true });
  }
}

/**
 * Create a RemoveTextLetterByLetter animation.
 * Removes text letter by letter (reverse typewriter effect).
 * @param mobject The mobject to animate (must support getText/setText)
 * @param options Animation options including timePerChar
 */
export function removeTextLetterByLetter(
  mobject: Mobject,
  options?: AddTextLetterByLetterOptions,
): RemoveTextLetterByLetter {
  return new RemoveTextLetterByLetter(mobject, options);
}
