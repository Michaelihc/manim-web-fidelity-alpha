import { Add, Create, FadeIn, Line, Remove, Write } from '../../../src/index.ts';
import { type NamedBounds } from '../layout';
import { SeededRng } from '../rng';
import { BEATS, bar } from '../timing';
import { createStarfield, placeSafely } from './helpers';
import { defineEsapScene } from './types';

export const introScene = defineEsapScene({
  id: 'intro',
  title: 'Machine learning in three minutes',
  status: 'implemented',
  async build(context) {
    const { scene, clock, formula, palette } = context;
    const starfield = createStarfield({ rng: new SeededRng(7), palette }, { count: 40 });
    const occupied: NamedBounds[] = [];

    const title = await formula.title('MACHINE LEARNING', {
      color: palette.ink,
      fontSize: 72,
      maxWidth: 9.3,
      fitStage: false,
    });
    placeSafely(title, {
      name: 'opening title',
      position: [0, 0, 0],
      occupied,
      minimumGap: 0.28,
      fallbackOffsets: [[0, 0, 0]],
    });

    const subtitle = await formula.label('COMPLETE REVIEW', {
      color: palette.input,
      fontSize: 34,
      fitStage: false,
    });
    placeSafely(subtitle, {
      name: 'opening subtitle',
      position: [0, title.getBottom()[1] - 0.4 - subtitle.getHeight() / 2, 0],
      occupied,
      minimumGap: 0.28,
      fallbackOffsets: [[0, 0, 0]],
    });

    const ruleY = subtitle.getBottom()[1] - 0.35;
    const rule = new Line({
      start: [-3.2, ruleY, 0],
      end: [3.2, ruleY, 0],
      color: palette.parameter,
      strokeWidth: 2,
    });

    // The reference begins with a quiet starfield before the first downbeat.
    await clock.play(scene, new Add(starfield));
    await clock.hit(scene, bar(1), new Write(title, { duration: 0.9 }));
    await clock.hit(
      scene,
      BEATS[4],
      new FadeIn(subtitle, { duration: 0.5, shift: [0, 0.2, 0] }),
      new Create(rule, { duration: 0.5 }),
    );

    // Independent Python sections hard-cut at their exact frame boundary.
    await clock.finish(scene);
    await clock.play(
      scene,
      ...[starfield, title, subtitle, rule].map((mobject) => new Remove(mobject)),
    );
  },
});
