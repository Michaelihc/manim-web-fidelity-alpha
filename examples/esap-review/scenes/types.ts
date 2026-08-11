import type { RecordingScene } from '../../../src/player/RecordingScene.ts';
import { FormulaFactory } from '../formula';
import type { EsapPalette } from '../palette';
import { SeededRng } from '../rng';
import { SectionClock, type SectionId, type SectionTiming } from '../timing';

export type SceneModuleStatus = 'scaffold' | 'implemented';

export interface EsapSceneContext {
  readonly scene: RecordingScene;
  readonly timing: SectionTiming;
  readonly clock: SectionClock;
  readonly formula: FormulaFactory;
  readonly palette: EsapPalette;
  readonly rng: SeededRng;
}

export interface EsapSceneModule {
  readonly id: SectionId;
  readonly title: string;
  readonly status: SceneModuleStatus;
  build(context: EsapSceneContext): Promise<void>;
}

export function defineEsapScene(module: EsapSceneModule): EsapSceneModule {
  return Object.freeze(module);
}

/** Frame-exact placeholder used until a chapter's animation module is filled. */
export function unfilledScene(id: SectionId, title: string): EsapSceneModule {
  return defineEsapScene({
    id,
    title,
    status: 'scaffold',
    async build({ scene, clock }) {
      await clock.finish(scene);
    },
  });
}
