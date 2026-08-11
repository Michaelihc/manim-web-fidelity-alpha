import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Rectangle } from '../../mobjects/geometry/Rectangle';
import { linear } from '../../rate-functions';
import { FadeIn } from './FadeIn';

function fillMeshes(rectangle: Rectangle): THREE.Mesh[] {
  return rectangle
    .getThreeObject()
    .children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
}

describe('FadeIn fill topology', () => {
  it('recreates fill geometry at the first non-zero intermediate opacity', () => {
    const rectangle = new Rectangle({
      width: 2,
      height: 1,
      color: '#55d6c2',
      fillOpacity: 1,
      strokeWidth: 0,
    }).setFill('#55d6c2', 1);
    const fade = new FadeIn(rectangle, { duration: 1, rateFunc: linear });

    expect(fillMeshes(rectangle)).toHaveLength(1);

    fade.begin();
    expect(rectangle.fillOpacity).toBe(0);
    expect(fillMeshes(rectangle)).toHaveLength(0);

    fade.interpolate(0.5);
    expect(rectangle.fillOpacity).toBeCloseTo(0.5);
    const intermediateFill = fillMeshes(rectangle);
    expect(intermediateFill).toHaveLength(1);
    expect((intermediateFill[0].material as THREE.Material).opacity).toBeCloseTo(0.5);

    fade.finish();
    expect(rectangle.fillOpacity).toBe(1);
    expect(fillMeshes(rectangle)).toHaveLength(1);
  });
});
