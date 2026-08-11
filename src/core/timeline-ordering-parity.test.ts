import { describe, expect, it } from 'vitest';
import { FadeOut } from '../animation/fading/FadeOut';
import { ReplacementTransform } from '../animation/transform/Transform';
import { Circle } from '../mobjects/geometry/Circle';
import { Scene } from './Scene';

function renderRank(circle: Circle): number {
  const ranks: number[] = [];
  circle.getThreeObject().traverse((object) => {
    if ('material' in object) ranks.push(object.renderOrder);
  });
  return Math.max(...ranks);
}

describe('timeline scene-order restoration', () => {
  it('restores a replaced foreground root to the foreground band on rewind', async () => {
    const scene = Scene.createHeadless({ autoRender: false });
    const source = new Circle().setZIndex(-1_000_000, false);
    const target = new Circle().shift([2, 0, 0]);
    const highNormal = new Circle().setZIndex(1_000_000, false);

    try {
      scene.addForegroundMobject(source);
      scene.add(highNormal);
      await scene.play(new ReplacementTransform(source, target, { duration: 0.01 }));

      expect(scene.mobjects.has(source)).toBe(false);
      expect(scene.mobjects.has(target)).toBe(true);

      scene.seek(0);
      scene.render();

      expect(scene.mobjects.has(source)).toBe(true);
      expect(scene.mobjects.has(target)).toBe(false);
      expect(renderRank(source)).toBeGreaterThan(renderRank(highNormal));
    } finally {
      scene.dispose();
    }
  });

  it('restores initial equal-z insertion order while retaining later unrelated roots', async () => {
    const scene = Scene.createHeadless({ autoRender: false });
    const first = new Circle();
    const second = new Circle();
    const later = new Circle();

    try {
      scene.add(first, second);
      await scene.play(new FadeOut(first, { duration: 0.01 }));
      scene.add(later);

      expect([...scene.mobjects]).toEqual([second, later]);

      scene.seek(0);
      scene.render();
      expect([...scene.mobjects]).toEqual([first, second, later]);
      expect(renderRank(first)).toBeLessThan(renderRank(second));
      expect(renderRank(second)).toBeLessThan(renderRank(later));

      scene.seek(0.01);
      expect([...scene.mobjects]).toEqual([second, later]);

      scene.seek(0);
      expect([...scene.mobjects]).toEqual([first, second, later]);
    } finally {
      scene.dispose();
    }
  });
});
