import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Circle } from '../mobjects/geometry/Circle';
import { PointMobject } from '../mobjects/point/PointMobject';
import { Group } from './Group';
import { Scene } from './Scene';
import { ThreeDScene } from './ThreeDScene';
import { VGroup } from './VGroup';
import type { Mobject } from './Mobject';

interface RenderingInternals {
  _fillMaterial: THREE.MeshBasicMaterial | null;
  _strokeMaterial: LineMaterial | null;
  _cachedFillMesh: THREE.Mesh | null;
  _cachedStrokeMesh: THREE.Mesh | null;
}

const scenes: Scene[] = [];

function track<T extends Scene>(scene: T): T {
  scenes.push(scene);
  return scene;
}

function renderObjects(mobject: Mobject): THREE.Object3D[] {
  const objects: THREE.Object3D[] = [];
  mobject.getThreeObject().traverse((object) => objects.push(object));
  return objects;
}

function renderMaterials(mobject: Mobject): THREE.Material[] {
  const materials = new Set<THREE.Material>();
  for (const object of renderObjects(mobject)) {
    const material = (
      object as THREE.Object3D & {
        material?: THREE.Material | THREE.Material[];
      }
    ).material;
    if (!material) continue;
    for (const item of Array.isArray(material) ? material : [material]) materials.add(item);
  }
  return Array.from(materials);
}

function ownedRenderableObjects(mobject: Mobject): THREE.Object3D[] {
  const root = mobject.getThreeObject();
  const childRoots = new Set(mobject.children.map((child) => child.getThreeObject()));
  const objects: THREE.Object3D[] = [];

  const visit = (object: THREE.Object3D, isRoot: boolean): void => {
    if (!isRoot && childRoots.has(object)) return;
    const material = (
      object as THREE.Object3D & {
        material?: THREE.Material | THREE.Material[];
      }
    ).material;
    if (material) objects.push(object);
    for (const child of object.children) visit(child, false);
  };

  visit(root, true);
  return objects;
}

function expectOwnedRank(mobject: Mobject, rank: number): void {
  const objects = ownedRenderableObjects(mobject);
  expect(objects.length).toBeGreaterThan(0);
  for (const object of objects) expect(object.renderOrder).toBe(rank);
}

afterEach(() => {
  for (const scene of scenes.splice(0)) scene.dispose();
});

describe('2D z-index renderer ordering', () => {
  it('uses scene insertion order for equal z-index, independent of construction order', () => {
    const scene = track(Scene.createHeadless({ autoRender: false }));
    const constructedFirst = new Circle();
    const constructedSecond = new Circle();

    scene.add(constructedSecond, constructedFirst);
    scene.render();

    expectOwnedRank(constructedSecond, 0);
    expectOwnedRank(constructedFirst, 1);
  });

  it('densely orders arbitrary negative and fractional z-index values', () => {
    const scene = track(Scene.createHeadless({ autoRender: false }));
    const middle = new Circle().setZIndex(0, false);
    const high = new Circle().setZIndex(0.125, false);
    const low = new Circle().setZIndex(-2.75, false);

    scene.add(middle, high, low);
    scene.render();

    expectOwnedRank(low, 0);
    expectOwnedRank(middle, 1);
    expectOwnedRank(high, 2);
  });

  it('reranks after a runtime z-index change', () => {
    const scene = track(Scene.createHeadless({ autoRender: false }));
    const first = new Circle();
    const second = new Circle();
    scene.add(first, second);
    scene.render();

    expectOwnedRank(first, 0);
    expectOwnedRank(second, 1);

    first.setZIndex(10, false);
    scene.render();

    expectOwnedRank(second, 0);
    expectOwnedRank(first, 1);
  });

  it('keeps child ties in preorder while preserving independent child z-index', () => {
    const scene = track(Scene.createHeadless({ autoRender: false }));
    const first = new Circle();
    const second = new Circle();
    const group = new VGroup(first, second);
    scene.add(group);
    scene.render();

    expect(group.getThreeObject().renderOrder).toBe(0);
    expectOwnedRank(first, 1);
    expectOwnedRank(second, 2);

    group.setZIndex(2, false);
    scene.render();

    expectOwnedRank(first, 0);
    expectOwnedRank(second, 1);
    expect(group.getThreeObject().renderOrder).toBe(0);
  });

  it('keeps foreground objects above normal objects regardless of z-index', () => {
    const scene = track(Scene.createHeadless({ autoRender: false }));
    const foreground = new Circle().setZIndex(-1_000_000, false);
    const normal = new Circle().setZIndex(1_000_000, false);

    scene.addForegroundMobject(foreground);
    scene.add(normal);
    scene.render();

    expectOwnedRank(normal, 0);
    expectOwnedRank(foreground, 1);
  });

  it('does not let a container groupOrder trap child renderables in the parent z band', () => {
    const scene = track(Scene.createHeadless({ autoRender: false }));
    const child = new PointMobject().setZIndex(-10, false);
    const group = new Group(child).setZIndex(10, false);
    const external = new PointMobject().setZIndex(0, false);

    scene.add(group, external);
    scene.render();

    expect(group.getThreeObject()).toBeInstanceOf(THREE.Group);
    expect(group.getThreeObject().renderOrder).toBe(0);
    expectOwnedRank(child, 0);
    expectOwnedRank(external, 1);
  });

  it('applies the owner rank to rebuilt VMobject fill and stroke parts', () => {
    const scene = track(Scene.createHeadless({ autoRender: false }));
    const back = new Circle();
    const front = new Circle({ fillOpacity: 0.5 }).setZIndex(1, false);
    scene.add(back, front);
    scene.render();

    const rendering = front as unknown as RenderingInternals;
    const initialFill = rendering._cachedFillMesh;
    expect(initialFill).not.toBeNull();

    front.setFillOpacity(0);
    front.markGeometryDirty();
    scene.render();
    expect(rendering._cachedFillMesh).toBeNull();

    front.setFillOpacity(0.6);
    front.useStrokeMesh = true;
    front.markGeometryDirty();
    scene.render();

    const rank = 1;
    expect(rendering._cachedFillMesh).not.toBe(initialFill);
    expect(rendering._cachedStrokeMesh).not.toBeNull();
    expect(rendering._cachedFillMesh?.renderOrder).toBe(rank);
    expect(rendering._cachedStrokeMesh?.renderOrder).toBe(rank);
  });

  it('normalizes opaque strokes and transparent fills into one 2D painter queue', () => {
    const scene = track(Scene.createHeadless({ autoRender: false }));
    const circle = new Circle();
    circle.setFill('#123456', 0.4);
    circle.setStroke('#abcdef', 4, 1);
    scene.add(circle);
    scene.render();

    const rendering = circle as unknown as RenderingInternals;
    expect(rendering._fillMaterial).not.toBeNull();
    expect(rendering._strokeMaterial).not.toBeNull();

    const materials = renderMaterials(circle);
    expect(materials.length).toBeGreaterThanOrEqual(2);
    for (const material of materials) {
      expect(material.transparent).toBe(true);
      expect(material.depthTest).toBe(false);
      expect(material.depthWrite).toBe(false);
    }
  });
});

describe('ThreeDScene z-index gate', () => {
  it('keeps depth sorting and renderOrder zero despite z-index changes', () => {
    const scene = track(
      ThreeDScene.createHeadless({
        autoRender: false,
        enableOrbitControls: false,
        setupLighting: false,
      }),
    );
    const circle = new Circle();
    circle.setFill('#123456', 0.4);
    circle.setStroke('#abcdef', 4, 1);
    circle.setZIndex(25, false);

    scene.add(circle);
    scene.render();
    circle.setZIndex(-12.5, false);
    scene.render();

    for (const object of renderObjects(circle)) {
      expect(object.renderOrder).toBe(0);
    }

    const rendering = circle as unknown as RenderingInternals;
    expect(rendering._strokeMaterial?.transparent).toBe(false);
    expect(rendering._strokeMaterial?.depthTest).toBe(true);
    expect(rendering._strokeMaterial?.depthWrite).toBe(true);
    expect(rendering._fillMaterial?.transparent).toBe(true);
    expect(rendering._fillMaterial?.depthTest).toBe(true);
    expect(rendering._fillMaterial?.depthWrite).toBe(false);
  });

  it('restores an opaque stroke when moving a mobject from 2D into 3D', () => {
    const scene2D = track(Scene.createHeadless({ autoRender: false }));
    const scene3D = track(
      ThreeDScene.createHeadless({
        autoRender: false,
        enableOrbitControls: false,
        setupLighting: false,
      }),
    );
    const circle = new Circle();
    circle.setStrokeOpacity(1);
    const rendering = circle as unknown as RenderingInternals;

    scene2D.add(circle);
    scene2D.render();
    expect(rendering._strokeMaterial?.transparent).toBe(true);
    expect(rendering._strokeMaterial?.depthTest).toBe(false);

    scene2D.remove(circle);
    scene3D.add(circle);
    scene3D.render();

    expect(rendering._strokeMaterial?.transparent).toBe(false);
    expect(rendering._strokeMaterial?.depthTest).toBe(true);
    expect(rendering._strokeMaterial?.depthWrite).toBe(true);
    for (const object of renderObjects(circle)) expect(object.renderOrder).toBe(0);
  });
});
