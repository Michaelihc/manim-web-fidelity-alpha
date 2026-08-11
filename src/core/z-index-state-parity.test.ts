import { afterEach, describe, expect, it } from 'vitest';
import { Circle } from '../mobjects/geometry/Circle';
import { Scene } from './Scene';
import { snapshotFromJSON, snapshotToJSON } from './StateManager';
import { VGroup } from './VGroup';

const scenes: Scene[] = [];

function track(scene: Scene): Scene {
  scenes.push(scene);
  return scene;
}

function renderRank(circle: Circle): number {
  const ranks: number[] = [];
  circle.getThreeObject().traverse((object) => {
    if ('material' in object) ranks.push(object.renderOrder);
  });
  return Math.max(...ranks);
}

afterEach(() => {
  for (const scene of scenes.splice(0)) scene.dispose();
});

describe('z-index state persistence', () => {
  it('Mobject.saveState() restores independent z-index values across the child family', () => {
    const leaf = new Circle().setZIndex(-3.75, false);
    const nested = new VGroup(leaf).setZIndex(11.5, false);
    const root = new VGroup(nested).setZIndex(2.25, false);

    root.saveState();

    const internal = root.__savedMobjectState as {
      zIndex: number;
      children: Array<{ zIndex: number; children: Array<{ zIndex: number }> }>;
    };
    expect(internal.zIndex).toBe(2.25);
    expect(internal.children[0].zIndex).toBe(11.5);
    expect(internal.children[0].children[0].zIndex).toBe(-3.75);

    root.setZIndex(100, false);
    nested.setZIndex(101, false);
    leaf.setZIndex(102, false);

    expect(root.restoreState()).toBe(true);
    expect(root.zIndex).toBe(2.25);
    expect(nested.zIndex).toBe(11.5);
    expect(leaf.zIndex).toBe(-3.75);
  });

  it('Scene snapshots preserve root and child z-index through JSON, setState, undo, and redo', () => {
    const scene = track(Scene.createHeadless({ autoRender: false }));
    const first = new Circle({ fillOpacity: 0.7, strokeWidth: 8 }).setZIndex(-8.125, false);
    const second = new Circle().setZIndex(4.5, false);
    const root = new VGroup(first, second).setZIndex(1.25, false);
    const later = new Circle().setZIndex(900, false);
    scene.add(root, later);
    scene.addForegroundMobject(root);
    const insertionOrder = [...scene.mobjects];

    const parsed = snapshotFromJSON(snapshotToJSON(scene.getState('z-index')));
    expect(parsed.mobjects[0].zIndex).toBe(1.25);
    expect(parsed.mobjects[0].children.map((child) => child.zIndex)).toEqual([-8.125, 4.5]);
    expect(parsed.mobjects[0].children[0].fillOpacity).toBe(0.7);
    expect(parsed.mobjects[0].children[0].strokeWidth).toBe(8);
    expect(parsed.mobjects[0].children[0].style.fillOpacity).toBe(0.7);
    expect(parsed.mobjects[0].children[0].style.strokeWidth).toBe(8);

    root.setZIndex(20, false);
    first.setZIndex(21, false);
    first.setFillOpacity(0.1);
    first.setStrokeWidth(2);
    second.setZIndex(22, false);
    scene.setState(parsed);

    expect(root.zIndex).toBe(1.25);
    expect(first.zIndex).toBe(-8.125);
    expect(second.zIndex).toBe(4.5);
    expect(first.fillOpacity).toBe(0.7);
    expect(first.strokeWidth).toBe(8);
    expect(first.style.fillOpacity).toBe(0.7);
    expect(first.style.strokeWidth).toBe(8);
    expect([...scene.mobjects]).toEqual(insertionOrder);
    scene.render();
    expect(renderRank(first)).toBeGreaterThan(renderRank(later));

    scene.saveState('before mutation');
    root.setZIndex(-100, false);
    first.setZIndex(-101, false);
    second.setZIndex(-102, false);

    expect(scene.undo()).toBe(true);
    expect([root.zIndex, first.zIndex, second.zIndex]).toEqual([1.25, -8.125, 4.5]);
    expect(scene.redo()).toBe(true);
    expect([root.zIndex, first.zIndex, second.zIndex]).toEqual([-100, -101, -102]);
    expect([...scene.mobjects]).toEqual(insertionOrder);
    scene.render();
    expect(renderRank(first)).toBeGreaterThan(renderRank(later));
  });

  it('leaves z-index unchanged when restoring a legacy snapshot without the field', () => {
    const scene = track(Scene.createHeadless({ autoRender: false }));
    const circle = new Circle().setZIndex(17, false);
    scene.add(circle);
    const snapshot = scene.getState();
    delete snapshot.mobjects[0].zIndex;

    circle.setZIndex(-6, false);
    scene.setState(snapshot);

    expect(circle.zIndex).toBe(-6);
  });
});
