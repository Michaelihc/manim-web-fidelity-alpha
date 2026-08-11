import type { RecordingScene } from '../../../src/player/RecordingScene.ts';
import { FormulaFactory } from '../formula';
import { SeededRng } from '../rng';
import { SECTION_IDS, SectionClock, sectionTiming } from '../timing';
import { breakdownScene } from './breakdown';
import { buildOneScene } from './build-one';
import { buildTwoScene } from './build-two';
import { dropOneScene } from './drop-one';
import { dropTwoScene } from './drop-two';
import { introScene } from './intro';
import { outroScene } from './outro';
import type { EsapSceneModule } from './types';
import { verseScene } from './verse';

const REGISTRY: readonly EsapSceneModule[] = Object.freeze([
  introScene,
  verseScene,
  buildOneScene,
  dropOneScene,
  breakdownScene,
  buildTwoScene,
  dropTwoScene,
  outroScene,
]);

function validateRegistry(): void {
  if (REGISTRY.length !== SECTION_IDS.length) {
    throw new Error(`ESAP registry requires exactly ${SECTION_IDS.length} scene modules`);
  }
  REGISTRY.forEach((module, index) => {
    if (module.id !== SECTION_IDS[index]) {
      throw new Error(
        `ESAP scene ${index + 1} must be "${SECTION_IDS[index]}", received "${module.id}"`,
      );
    }
  });
}

validateRegistry();

export function getSceneRegistry(): readonly EsapSceneModule[] {
  return REGISTRY;
}

export function implementedSceneCount(): number {
  return REGISTRY.filter((module) => module.status === 'implemented').length;
}

/** Record all eight modules into one Player timeline in authoritative order. */
export async function recordEsapReview(
  scene: RecordingScene,
  formula = new FormulaFactory('dark'),
): Promise<void> {
  for (const module of REGISTRY) {
    formula.setMode('dark');
    const timing = sectionTiming(module.id);
    const clock = new SectionClock(timing);
    await module.build({
      scene,
      timing,
      clock,
      formula,
      palette: formula.palette,
      rng: new SeededRng(`esap-review:${module.id}`),
    });
    await clock.finish(scene);
  }
}
