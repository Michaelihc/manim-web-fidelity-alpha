import { Mobject } from '../../core/Mobject';
import { Animation } from '../Animation';
import { MorphStrategy } from './MorphStrategy';
import type * as THREE from 'three';
import {
  applyPaintOpacityFactor,
  capturePaintOpacity,
  restorePaintOpacity,
  type PaintOpacitySnapshot,
} from './PaintOpacity';

interface FadeStateSnapshot {
  positionX: number;
  positionY: number;
  positionZ: number;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  zIndex: number;
}

export class FadeMorphStrategy implements MorphStrategy {
  private _sourceSnapshot: FadeStateSnapshot | null = null;
  private _targetSnapshot: FadeStateSnapshot | null = null;
  private _startPositionX = 0;
  private _startPositionY = 0;
  private _startPositionZ = 0;
  private _targetPositionX = 0;
  private _targetPositionY = 0;
  private _targetPositionZ = 0;
  private _targetThreeParent: THREE.Object3D | null = null;
  private _sourcePaint: PaintOpacitySnapshot = [];
  private _targetPaint: PaintOpacitySnapshot = [];

  private _snapshotState(mobject: Mobject): FadeStateSnapshot {
    return {
      positionX: mobject.position.x,
      positionY: mobject.position.y,
      positionZ: mobject.position.z,
      rotation: mobject.rotation.clone(),
      scale: mobject.scaleVector.clone(),
      zIndex: mobject.zIndex,
    };
  }

  begin(_animation: Animation, source: Mobject, target: Mobject): void {
    this._sourceSnapshot = this._snapshotState(source);
    this._targetSnapshot = this._snapshotState(target);
    this._sourcePaint = capturePaintOpacity(source);
    this._targetPaint = capturePaintOpacity(target);
    this._startPositionX = this._sourceSnapshot.positionX;
    this._startPositionY = this._sourceSnapshot.positionY;
    this._startPositionZ = this._sourceSnapshot.positionZ;
    this._targetPositionX = this._targetSnapshot.positionX;
    this._targetPositionY = this._targetSnapshot.positionY;
    this._targetPositionZ = this._targetSnapshot.positionZ;
    const sourceObj = source.getThreeObject();
    const targetObj = target.getThreeObject();
    this._targetThreeParent = targetObj.parent;
    if (sourceObj.parent && !targetObj.parent) sourceObj.parent.add(targetObj);
    applyPaintOpacityFactor(this._targetPaint, 0);
    target._syncToThree();
  }

  interpolate(_animation: Animation, source: Mobject, target: Mobject, alpha: number): void {
    if (!this._sourceSnapshot) {
      throw new Error('FadeMorphStrategy.interpolate requires source snapshot');
    }
    if (!this._targetSnapshot) {
      throw new Error('FadeMorphStrategy.interpolate requires target snapshot');
    }

    source.position.set(
      this._startPositionX + (this._targetPositionX - this._startPositionX) * alpha,
      this._startPositionY + (this._targetPositionY - this._startPositionY) * alpha,
      this._startPositionZ + (this._targetPositionZ - this._startPositionZ) * alpha,
    );
    target.position.copy(source.position);
    applyPaintOpacityFactor(this._sourcePaint, 1 - alpha);
    applyPaintOpacityFactor(this._targetPaint, alpha);
    target._syncToThree();
    source._markDirty();
  }

  finish(_animation: Animation, source: Mobject, target: Mobject): void {
    if (!this._targetSnapshot) {
      throw new Error('FadeMorphStrategy.finish requires target snapshot');
    }
    source.position.set(this._targetPositionX, this._targetPositionY, this._targetPositionZ);
    applyPaintOpacityFactor(this._sourcePaint, 0);
    target.position.set(this._targetPositionX, this._targetPositionY, this._targetPositionZ);
    restorePaintOpacity(this._targetPaint);
    target._syncToThree();
    source._markDirty();
  }

  reset(_animation: Animation, source: Mobject, target: Mobject): void {
    if (!this._sourceSnapshot || !this._targetSnapshot) return;
    this._restoreState(source, this._sourceSnapshot);
    this._restoreState(target, this._targetSnapshot);
    restorePaintOpacity(this._sourcePaint);
    restorePaintOpacity(this._targetPaint);

    const targetObject = target.getThreeObject();
    if (targetObject.parent !== this._targetThreeParent) {
      targetObject.parent?.remove(targetObject);
      this._targetThreeParent?.add(targetObject);
    }
    source._markDirty();
    target._markDirty();
  }

  private _restoreState(mobject: Mobject, state: FadeStateSnapshot): void {
    mobject.position.set(state.positionX, state.positionY, state.positionZ);
    mobject.rotation.copy(state.rotation);
    mobject.scaleVector.copy(state.scale);
    mobject.zIndex = state.zIndex;
  }
}
