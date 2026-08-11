import * as THREE from 'three';
import { VMobject } from '../../core/VMobject';
import { VGroup } from '../../core/VGroup';
import { Mobject, type MobjectStyle } from '../../core/Mobject';
import { Animation } from '../Animation';
import { lerpPoint } from '../../utils/math';
import { collectLeafVMobjectSnapshots } from '../../core/MobjectTraversal';
import {
  alignVmobjectPair,
  canMorphByPoints,
  pairLeafSnapshotsByIndex,
  type LeafPairByIndex,
} from './TransformPairing';
import { MorphStrategy } from './MorphStrategy';

interface ChildStyle {
  opacity: number;
  fillOpacity: number;
  strokeWidth: number;
  color: string;
  fillColor: string;
  zIndex: number;
}
interface VGroupLeafState {
  child: VMobject;
  startPoints: number[][];
  targetPoints: number[][];
  // Detached normalized family snapshots bake ancestor transforms into leaf
  // points, leaving both positions in the same identity-root frame.
  startPosition: THREE.Vector3;
  targetPosition: THREE.Vector3;
  finalTargetPoints: number[][];
  finalTargetSubpathLengths?: number[];
  startStyle: ChildStyle;
  targetStyle: ChildStyle;
  strokeColorPair: { start: THREE.Color; target: THREE.Color; interpolate: boolean };
  fillColorPair: { start: THREE.Color; target: THREE.Color; interpolate: boolean };
}
const scratchColor = new THREE.Color();

interface FamilyNodeState {
  node: Mobject;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  style: MobjectStyle;
  zIndex: number;
  points?: number[][];
  transformSubpathLengths?: number[];
}

interface VMobjectTopologyInternals {
  _transformSubpathLengths?: number[];
}

function captureCurrentStyle(node: Mobject): MobjectStyle {
  return {
    ...node.style,
    fillColor: node.fillColor || node.color,
    fillOpacity: node.fillOpacity,
    strokeColor: node.strokeColor || node.color,
    strokeOpacity: node.opacity,
    strokeWidth: node.strokeWidth,
  };
}

function applyOwnStyle(node: Mobject, style: MobjectStyle): void {
  if (style.fillColor !== undefined) node.fillColor = style.fillColor;
  if (style.strokeColor !== undefined) node.strokeColor = style.strokeColor;
  if (style.fillOpacity !== undefined) {
    Mobject.prototype.setFillOpacity.call(node, style.fillOpacity);
  }
  if (style.strokeOpacity !== undefined) {
    Mobject.prototype.setStrokeOpacity.call(node, style.strokeOpacity);
  }
  if (style.strokeWidth !== undefined) {
    Mobject.prototype.setStrokeWidth.call(node, style.strokeWidth);
  }
}

function captureFamilyState(root: Mobject): FamilyNodeState[] {
  const states: FamilyNodeState[] = [];
  const visit = (node: Mobject) => {
    const vmobject = node instanceof VMobject ? node : undefined;
    const topology = vmobject as unknown as VMobjectTopologyInternals | undefined;
    states.push({
      node,
      position: node.position.clone(),
      rotation: node.rotation.clone(),
      scale: node.scaleVector.clone(),
      style: captureCurrentStyle(node),
      zIndex: node.zIndex,
      points: vmobject?.getLocalPoints().map((point) => [...point]),
      transformSubpathLengths: topology?._transformSubpathLengths
        ? [...topology._transformSubpathLengths]
        : undefined,
    });
    for (const child of node.children) visit(child);
  };
  visit(root);
  return states;
}

function restoreFamilyState(states: FamilyNodeState[]): void {
  for (const state of states) {
    const { node } = state;
    node.position.copy(state.position);
    node.rotation.copy(state.rotation);
    node.scaleVector.copy(state.scale);
    applyOwnStyle(node, state.style);
    node.zIndex = state.zIndex;
    node._markDirty();
  }

  // Family alignment can increase a leaf's point count. Restore geometry
  // deepest-first so each VGroup once again has its captured child partition
  // before its aggregate snapshot is passed through VGroup.setPoints().
  for (let index = states.length - 1; index >= 0; index--) {
    const state = states[index];
    if (!(state.node instanceof VMobject) || !state.points) continue;
    state.node.setPoints(state.points);
    state.node.setTransformSubpathLengths(state.transformSubpathLengths);
    state.node._markDirty();
  }
}

/**
 * Clone a VMobject family without invoking an async VGroup subclass constructor.
 *
 * MathTex is a VGroup whose copy() starts another MathJax render.  Transform
 * alignment only needs a frozen structural snapshot, so rebuild containers as
 * plain VGroups and leaves as plain VMobjects.  This also lets arbitrary parent
 * stretches bake into a circle/arc's points without mutating or rejecting its
 * class-authoritative parameters.
 */
function copyVmobjectFamily(root: VMobject): VMobject {
  const clone = root instanceof VGroup ? new VGroup() : new VMobject();
  clone.position.copy(root.position);
  clone.rotation.copy(root.rotation);
  clone.scaleVector.copy(root.scaleVector);
  clone.setStyle(captureCurrentStyle(root));
  clone.zIndex = root.zIndex;
  clone.setBaseSubpathLengths(root.getEffectiveSubpathLengths());

  if (!(root instanceof VGroup)) {
    clone.setPoints(root.getLocalPoints());
    return clone;
  }

  for (const child of root.children) {
    clone.add(child instanceof VMobject ? copyVmobjectFamily(child) : child.copy());
  }
  return clone;
}

function captureStyle(m: VMobject): ChildStyle {
  return {
    opacity: m.opacity,
    fillOpacity: m.fillOpacity,
    strokeWidth: m.strokeWidth,
    color: m.strokeColor || m.color,
    fillColor: m.fillColor || m.color,
    zIndex: m.zIndex,
  };
}
function captureStyleFaded(m: VMobject): ChildStyle {
  return {
    opacity: 0,
    fillOpacity: 0,
    strokeWidth: m.strokeWidth,
    color: m.strokeColor || m.color,
    fillColor: m.fillColor || m.color,
    zIndex: m.zIndex,
  };
}

export class PointMorphStrategy implements MorphStrategy {
  private _startPoints: number[][] = [];
  private _targetPoints: number[][] = [];
  private _finalTargetPoints: number[][] = [];
  private _finalTargetSubpathLengths?: number[];
  private _alignedSubpathLengths?: number[];
  private _startOpacity = 1;
  private _targetOpacity = 1;
  private _startFillOpacity = 0;
  private _targetFillOpacity = 0;
  private _startStrokeWidth = 2;
  private _targetStrokeWidth = 2;
  private _startColor = new THREE.Color();
  private _targetColor = new THREE.Color();
  private _interpolateColor = false;
  private _startFillColor = new THREE.Color();
  private _targetFillColor = new THREE.Color();
  private _interpolateFillColor = false;
  private _startPosition = new THREE.Vector3();
  private _targetPosition = new THREE.Vector3();
  private _startRotation = new THREE.Euler();
  private _targetRotation = new THREE.Euler();
  private _startScale = new THREE.Vector3(1, 1, 1);
  private _targetScale = new THREE.Vector3(1, 1, 1);
  private _isFamilyTransform = false;
  private _vgroupLeafStates: VGroupLeafState[] = [];
  private _sourceFamilyState: FamilyNodeState[] = [];
  private _addedPlaceholders: VMobject[] = [];
  private _targetGroupStyle: MobjectStyle | null = null;
  private _targetGroupZIndex = 0;

  begin(_animation: Animation, source: Mobject, target: Mobject): void {
    if (!(source instanceof VMobject) || !(target instanceof VMobject))
      throw new Error('PointMorphStrategy requires VMobject inputs');
    this._sourceFamilyState = captureFamilyState(source);
    if (source instanceof VGroup || target instanceof VGroup) {
      this._beginFamily(source, target);
      return;
    }
    const aligned = alignVmobjectPair(source, target);
    this._startPoints = aligned.startPoints;
    this._targetPoints = aligned.targetPoints;
    this._alignedSubpathLengths = aligned.alignedSubpathLengths;
    this._finalTargetPoints = aligned.finalTargetPoints;
    this._finalTargetSubpathLengths = aligned.finalTargetSubpathLengths;
    this._startOpacity = source.opacity;
    this._targetOpacity = target.opacity;
    this._startFillOpacity = source.fillOpacity;
    this._targetFillOpacity = target.fillOpacity;
    this._startStrokeWidth = source.strokeWidth;
    this._targetStrokeWidth = target.strokeWidth;
    const sourceStrokeColor = source.strokeColor || source.color;
    const targetStrokeColor = target.strokeColor || target.color;
    this._startColor.set(sourceStrokeColor);
    this._targetColor.set(targetStrokeColor);
    this._interpolateColor = sourceStrokeColor !== targetStrokeColor;
    const sc = source.fillColor || source.color;
    const tc = target.fillColor || target.color;
    this._startFillColor.set(sc);
    this._targetFillColor.set(tc);
    this._interpolateFillColor = sc !== tc;
    this._startPosition.copy(source.position);
    this._targetPosition.copy(target.position);
    this._startRotation.copy(source.rotation);
    this._targetRotation.copy(target.rotation);
    this._startScale.copy(source.scaleVector);
    this._targetScale.copy(target.scaleVector);
    source.setPoints(this._startPoints);
    source.setTransformSubpathLengths(this._alignedSubpathLengths);
  }
  /**
   * @pre  source and target each contain ≥ 1 leaf VMobject.
   * @side-effect source.normalizeTransform() is called in place:
   *              world-space geometry is unchanged, but local points are recentered
   *              around the origin and source.position is set to the bbox center.
   * @post this._vgroupLeafStates pairs every source leaf with a corresponding
   *       target leaf (or a faded placeholder), with positions expressed in
   *       source's parent-local coordinate system.
   */
  private _beginFamily(source: VMobject, target: VMobject): void {
    this._isFamilyTransform = true;
    const normalizedSource = copyVmobjectFamily(source);
    const normalizedTarget = copyVmobjectFamily(target);
    normalizedSource.normalizeTransform();
    normalizedTarget.normalizeTransform();

    const liveSourceLeaves = collectLeafVMobjectSnapshots(source).map((snapshot) => snapshot.leaf);

    // The normalized copies hold all ancestor transforms in their leaf points.
    // Put the live VMobject family into the same identity frame without calling
    // normalizeTransform() on concrete leaves (which mutates class-authoritative
    // fields such as Circle._radius and cannot be undone by Animation.reset()).
    for (const state of this._sourceFamilyState) {
      if (!(state.node instanceof VMobject)) continue;
      state.node.position.set(0, 0, 0);
      state.node.rotation.set(0, 0, 0);
      state.node.scaleVector.set(1, 1, 1);
      state.node._markDirty();
    }

    const pairs = pairLeafSnapshotsByIndex(normalizedSource, normalizedTarget);
    for (let index = 0; index < pairs.length; index++) {
      this._vgroupLeafStates.push(this._build(source, pairs[index], liveSourceLeaves[index]));
    }
    // _startPosition / _targetPosition are the group's own position vectors (parent-local).
    this._startPosition.copy(normalizedSource.position);
    this._targetPosition.copy(normalizedTarget.position);
    this._startRotation.copy(normalizedSource.rotation);
    this._targetRotation.copy(normalizedTarget.rotation);
    this._startScale.copy(normalizedSource.scaleVector);
    this._targetScale.copy(normalizedTarget.scaleVector);
    this._targetGroupStyle = captureCurrentStyle(normalizedTarget);
    this._targetGroupZIndex = normalizedTarget.zIndex;
  }
  private _build(
    group: VMobject,
    pair: LeafPairByIndex,
    liveSourceLeaf: VMobject | undefined,
  ): VGroupLeafState {
    const { source: src, target: tgt, sourceIsPlaceholder, targetIsPlaceholder } = pair;
    const sc = src.leaf;
    const tc = tgt.leaf;
    const child = this._resolveLiveChild(group, tc, sourceIsPlaceholder, liveSourceLeaf);
    const canMorph = canMorphByPoints(sc, tc) && !sourceIsPlaceholder && !targetIsPlaceholder;
    const aligned = canMorph ? alignVmobjectPair(sc, tc) : undefined;
    const startPoints = aligned?.startPoints ?? child.getLocalPoints();
    const targetPoints = aligned?.targetPoints ?? child.getLocalPoints();
    const finalTargetPoints = aligned?.finalTargetPoints ?? child.getLocalPoints();
    const finalTargetSubpathLengths = aligned?.finalTargetSubpathLengths;
    if (aligned) {
      child.setPoints(aligned.startPoints);
      child.setTransformSubpathLengths(aligned.alignedSubpathLengths);
    } else child.setTransformSubpathLengths(undefined);
    const startStyle = sourceIsPlaceholder ? captureStyleFaded(tc) : captureStyle(child);
    const targetStyle = targetIsPlaceholder ? captureStyleFaded(sc) : captureStyle(tc);
    return {
      child,
      startPoints,
      targetPoints,
      startPosition: src.worldPosition.clone(),
      targetPosition: tgt.worldPosition.clone(),
      finalTargetPoints,
      finalTargetSubpathLengths,
      startStyle,
      targetStyle,
      strokeColorPair: {
        start: new THREE.Color(startStyle.color),
        target: new THREE.Color(targetStyle.color),
        interpolate: startStyle.color !== targetStyle.color,
      },
      fillColorPair: {
        start: new THREE.Color(startStyle.fillColor),
        target: new THREE.Color(targetStyle.fillColor),
        interpolate: startStyle.fillColor !== targetStyle.fillColor,
      },
    };
  }

  private _resolveLiveChild(
    group: VMobject,
    targetLeaf: VMobject,
    sourceIsPlaceholder: boolean,
    liveSourceLeaf: VMobject | undefined,
  ): VMobject {
    if (!sourceIsPlaceholder) {
      if (!liveSourceLeaf) {
        throw new Error('PointMorphStrategy lost a live source leaf during family alignment');
      }
      return liveSourceLeaf;
    }

    const child = targetLeaf.copy() as VMobject;
    child.opacity = 0;
    child.fillOpacity = 0;
    group.add(child);
    this._addedPlaceholders.push(child);
    return child;
  }

  interpolate(_animation: Animation, source: Mobject, _target: Mobject, alpha: number): void {
    if (this._isFamilyTransform) {
      // The detached normalized snapshots bake family translation into leaf
      // geometry, so the live root remains in the identity frame throughout.
      for (const leaf of this._vgroupLeafStates) {
        const interpolated: number[][] = [];
        for (let i = 0; i < leaf.startPoints.length; i++)
          interpolated.push(lerpPoint(leaf.startPoints[i], leaf.targetPoints[i], alpha));
        leaf.child.setPoints(interpolated);
        leaf.child.position.lerpVectors(leaf.startPosition, leaf.targetPosition, alpha);
        const ss = leaf.startStyle,
          ts = leaf.targetStyle;
        leaf.child.opacity = ss.opacity + (ts.opacity - ss.opacity) * alpha;
        leaf.child.fillOpacity = ss.fillOpacity + (ts.fillOpacity - ss.fillOpacity) * alpha;
        leaf.child.strokeWidth = ss.strokeWidth + (ts.strokeWidth - ss.strokeWidth) * alpha;
        if (leaf.strokeColorPair.interpolate)
          leaf.child.strokeColor =
            '#' +
            scratchColor
              .lerpColors(leaf.strokeColorPair.start, leaf.strokeColorPair.target, alpha)
              .getHexString();
        if (leaf.fillColorPair.interpolate)
          leaf.child.fillColor =
            '#' +
            scratchColor
              .lerpColors(leaf.fillColorPair.start, leaf.fillColorPair.target, alpha)
              .getHexString();
        leaf.child._markDirty();
      }
      return;
    }
    const vmobject = source as VMobject;
    const interpolatedPoints: number[][] = [];
    for (let i = 0; i < this._startPoints.length; i++)
      interpolatedPoints.push(lerpPoint(this._startPoints[i], this._targetPoints[i], alpha));
    vmobject.setPoints(interpolatedPoints);
    vmobject.setTransformSubpathLengths(this._alignedSubpathLengths);
    vmobject.opacity = this._startOpacity + (this._targetOpacity - this._startOpacity) * alpha;
    vmobject.fillOpacity =
      this._startFillOpacity + (this._targetFillOpacity - this._startFillOpacity) * alpha;
    vmobject.strokeWidth =
      this._startStrokeWidth + (this._targetStrokeWidth - this._startStrokeWidth) * alpha;
    if (this._interpolateColor)
      vmobject.strokeColor =
        '#' +
        new THREE.Color().lerpColors(this._startColor, this._targetColor, alpha).getHexString();
    if (this._interpolateFillColor)
      vmobject.fillColor =
        '#' +
        new THREE.Color()
          .lerpColors(this._startFillColor, this._targetFillColor, alpha)
          .getHexString();
    vmobject.position.lerpVectors(this._startPosition, this._targetPosition, alpha);
    vmobject.rotation.set(
      this._startRotation.x + (this._targetRotation.x - this._startRotation.x) * alpha,
      this._startRotation.y + (this._targetRotation.y - this._startRotation.y) * alpha,
      this._startRotation.z + (this._targetRotation.z - this._startRotation.z) * alpha,
    );
    vmobject.scaleVector.lerpVectors(this._startScale, this._targetScale, alpha);
    vmobject._markDirty();
  }
  /**
   * VMobject path:
   *   @post source.getLocalPoints() === target's original (pre-normalization) points
   *   @post source.{color, fillColor, opacity, fillOpacity, strokeWidth} === target's captured-at-begin values
   *   @post source.{position, rotation, scaleVector} === target's captured-at-begin values
   *   @post source.getEffectiveSubpathLengths() matches target's topology
   *
   * Family path (either root is a VGroup):
   *   @post source.position === normalizedTarget.position
   *         (normalizedTarget is target.copy() after normalizeTransform(), built during begin())
   *   @post for every leaf i: source.children[i].position === target.children[i]'s position
   *         re-expressed in source's post-animation local frame
   *   @post for every leaf i: source.children[i].getLocalPoints() === the original pre-normalization
   *         geometry of target.children[i] (i.e. finalTargetPoints, not the aligned interpolation copy)
   *   @post for every leaf i: source.children[i].{color, fillColor, opacity, fillOpacity, strokeWidth}
   *         === target.children[i]'s captured-at-begin style
   */
  finish(_animation: Animation, source: Mobject, target: Mobject): void {
    if (this._isFamilyTransform) {
      const group = source as VMobject;
      // leaf.targetPosition is in source-local space: P_target - P_source + target_child.localPos.
      // Re-express in target-local space by subtracting (P_target - P_source).
      const posOffset = new THREE.Vector3().subVectors(this._targetPosition, this._startPosition);
      for (const leaf of this._vgroupLeafStates) {
        leaf.child.setPoints(leaf.finalTargetPoints);
        leaf.child.position.copy(leaf.targetPosition).sub(posOffset);
        const ts = leaf.targetStyle;
        leaf.child.opacity = ts.opacity;
        leaf.child.fillOpacity = ts.fillOpacity;
        leaf.child.strokeWidth = ts.strokeWidth;
        leaf.child.strokeColor = ts.color;
        leaf.child.fillColor = ts.fillColor;
        leaf.child.zIndex = ts.zIndex;
        leaf.child.setTransformSubpathLengths(leaf.finalTargetSubpathLengths);
        leaf.child._markDirty();
      }
      group.position.copy(this._targetPosition);
      group.rotation.copy(this._targetRotation);
      group.scaleVector.copy(this._targetScale);
      if (source instanceof VGroup) {
        if (this._targetGroupStyle) applyOwnStyle(group, this._targetGroupStyle);
        group.zIndex = this._targetGroupZIndex;
      }
      group._markDirty();
      return;
    }
    const vmobject = source as VMobject;
    const vtarget = target as VMobject;
    vmobject.setPoints(
      this._finalTargetPoints.length > 0 ? this._finalTargetPoints : this._targetPoints,
    );
    vmobject.setTransformSubpathLengths(this._finalTargetSubpathLengths);
    vmobject.opacity = this._targetOpacity;
    vmobject.fillOpacity = this._targetFillOpacity;
    vmobject.strokeWidth = this._targetStrokeWidth;
    vmobject.strokeColor = vtarget.strokeColor || vtarget.color;
    vmobject.fillColor = vtarget.fillColor || vtarget.color;
    vmobject.position.copy(this._targetPosition);
    vmobject.rotation.copy(this._targetRotation);
    vmobject.scaleVector.copy(this._targetScale);
    vmobject.zIndex = vtarget.zIndex;
    vmobject._markDirty();
  }

  reset(_animation: Animation, _source: Mobject, _target: Mobject): void {
    for (const placeholder of this._addedPlaceholders) {
      if (placeholder.parent) placeholder.parent.remove(placeholder);
    }
    restoreFamilyState(this._sourceFamilyState);
  }
}
