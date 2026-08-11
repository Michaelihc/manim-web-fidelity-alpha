import { describe, expect, it } from 'vitest';
import { Rectangle } from './index';
import {
  centerMobjectsAt,
  mobjectCollectionBounds,
  placeMobjectsAtBottomEdge,
} from '../examples/esap-review/scenes/verse-layout';

describe('VERSE reference layout helpers', () => {
  // MIGRATION: examples for the property that bounds-based group placement is
  // independent of the members' widths and construction positions.
  it('centers a collection around the requested point', () => {
    const left = new Rectangle({ width: 1, height: 0.5, center: [-3, 2, 0] });
    const right = new Rectangle({ width: 3, height: 1.5, center: [2, -1, 0] });

    centerMobjectsAt([left, right], [0, -0.2, 0]);

    const bounds = mobjectCollectionBounds([left, right]);
    expect((bounds.left + bounds.right) / 2).toBeCloseTo(0, 8);
    expect((bounds.bottom + bounds.top) / 2).toBeCloseTo(-0.2, 8);
  });

  it('places a collection against the 8-unit frame bottom', () => {
    const first = new Rectangle({ width: 2, height: 0.4, center: [-2, 1, 0] });
    const second = new Rectangle({ width: 1, height: 0.8, center: [1.5, -0.5, 0] });

    placeMobjectsAtBottomEdge([first, second], 0.4);

    const bounds = mobjectCollectionBounds([first, second]);
    expect(bounds.bottom).toBeCloseTo(-3.6, 8);
    expect((bounds.left + bounds.right) / 2).toBeCloseTo(0, 8);
  });
});
