import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Circle } from '../mobjects/geometry/Circle';

interface RenderingInternals {
  _fillMaterial: THREE.MeshBasicMaterial | null;
  _strokeMaterial: LineMaterial | null;
  _cachedFillMesh: THREE.Mesh | null;
}

describe('VMobject renderer style parity', () => {
  it('renders fill and stroke with their independent opacity channels', () => {
    const circle = new Circle();
    circle.setFill('#123456', 0.7);
    circle.setStroke('#abcdef', 3, 0.2);
    circle.getThreeObject();

    const rendering = circle as unknown as RenderingInternals;
    expect(rendering._fillMaterial?.opacity).toBeCloseTo(0.7);
    expect(rendering._strokeMaterial?.opacity).toBeCloseTo(0.2);
    expect((rendering._cachedFillMesh?.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(
      0.7,
    );

    circle.setStrokeOpacity(0.4);
    circle.getThreeObject();

    expect(rendering._fillMaterial?.opacity).toBeCloseTo(0.7);
    expect(rendering._strokeMaterial?.opacity).toBeCloseTo(0.4);
    expect((rendering._cachedFillMesh?.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(
      0.7,
    );

    circle.setOpacity(0.3);
    circle.getThreeObject();

    expect(rendering._fillMaterial?.opacity).toBeCloseTo(0.3);
    expect(rendering._strokeMaterial?.opacity).toBeCloseTo(0.3);
  });
});
