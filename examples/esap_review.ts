import { Player, THREE, type Mobject } from '../src/index.ts';
import { PlayerAudioSync } from './esap-review/audio';
import { ESAP_STAGE } from './esap-review/layout';
import { DARK_PALETTE } from './esap-review/palette';
import {
  getSceneRegistry,
  implementedSceneCount,
  recordEsapReview,
} from './esap-review/scenes/registry';
import { ESAP_FPS, SECTIONS, TRACK_DURATION } from './esap-review/timing';

export type EsapReviewStatus = 'loading' | 'ready' | 'error';

export interface EsapWorldBounds {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface EsapMobjectBoundsDiagnostic {
  readonly id: string;
  readonly type: string;
  readonly zIndex: number;
  readonly bounds: EsapWorldBounds;
  readonly applicable: boolean;
  readonly insideStage: boolean;
  readonly aboveBottomSafeBand: boolean;
  readonly exemption: 'stage-cover' | 'background' | null;
  readonly bottomSafeBandOvershoot: number;
  readonly overshoot: {
    readonly left: number;
    readonly right: number;
    readonly bottom: number;
    readonly top: number;
  };
}

export interface EsapStageBoundsDiagnostics {
  readonly stage: EsapWorldBounds;
  readonly tolerance: number;
  readonly bottomSafeBand: {
    readonly pixelsAt1080p: number;
    readonly worldHeight: number;
    readonly contentBottom: number;
  };
  readonly visibleTopLevelCount: number;
  readonly applicableCount: number;
  readonly allApplicableInside: boolean;
  readonly allApplicableAboveBottomSafeBand: boolean;
  readonly errors: readonly string[];
  readonly items: readonly EsapMobjectBoundsDiagnostic[];
}

export interface EsapReviewDiagnosticHook {
  status: EsapReviewStatus;
  error: string | null;
  readonly ready: boolean;
  readonly implementedCount: number;
  readonly moduleCount: number;
  readonly expectedFrameCount: number;
  readonly timelineFrameCount: number;
  readonly timelineDuration: number;
  readonly currentTime: number;
  readonly stageBoundsDiagnostics: EsapStageBoundsDiagnostics;
  seek(time: number): number;
  /**
   * Render one frame of a fresh, monotonic 60fps export pass.
   * Calls must start at frame 0 and advance by one.
   */
  renderFrame(frameIndex: number): number;
}

declare global {
  interface Window {
    __esapReview: EsapReviewDiagnosticHook;
  }
}

const CHAPTER_COLORS = [
  DARK_PALETTE.input,
  DARK_PALETTE.output,
  DARK_PALETTE.parameter,
  DARK_PALETTE.loss,
  DARK_PALETTE.latent,
  DARK_PALETTE.parameter,
  DARK_PALETTE.valid,
  DARK_PALETTE.input,
] as const;

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required page element "${id}"`);
  return element as T;
}

const stage = requiredElement<HTMLDivElement>('stage');
const status = requiredElement<HTMLParagraphElement>('status');
const chapters = requiredElement<HTMLElement>('chapters');

const player = new Player(stage, {
  width: ESAP_STAGE.pixelWidth,
  height: ESAP_STAGE.pixelHeight,
  frameWidth: ESAP_STAGE.worldWidth,
  frameHeight: ESAP_STAGE.worldHeight,
  backgroundColor: DARK_PALETTE.background,
  targetFps: 60,
  autoHideMs: 2200,
  autoPlay: false,
  loop: false,
});
const requestedAudioUrl = new URLSearchParams(window.location.search).get('audio');
const audio = requestedAudioUrl ? new PlayerAudioSync(player, requestedAudioUrl) : null;

const EXPECTED_FRAME_COUNT = SECTIONS.reduce((total, section) => total + section.frameCount, 0);
const STAGE_TOLERANCE = 0.05;
const STAGE_COVERAGE_RATIO = 0.95;
const BOTTOM_SAFE_BAND_PX_AT_1080P = 96;
const BOTTOM_SAFE_BAND_WORLD_HEIGHT =
  (BOTTOM_SAFE_BAND_PX_AT_1080P / 1080) * ESAP_STAGE.worldHeight;
const MATERIAL_OPACITY_EPSILON = 0.005;

function materialOpacity(material: THREE.Material): number {
  const uniformOpacity = (
    material as THREE.Material & {
      uniforms?: Readonly<Record<string, { readonly value?: unknown }>>;
    }
  ).uniforms?.opacity?.value;
  return typeof uniformOpacity === 'number'
    ? Math.min(material.opacity, uniformOpacity)
    : material.opacity;
}

function isVisibleDrawable(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let ancestor: THREE.Object3D | null = object; ancestor; ancestor = ancestor.parent) {
    if (!ancestor.visible) return false;
    if (ancestor === root) break;
  }

  const material = (
    object as THREE.Object3D & {
      readonly material?: THREE.Material | readonly THREE.Material[];
    }
  ).material;
  if (!material) return false;
  const materials = Array.isArray(material) ? material : [material];
  return materials.some(
    (candidate) =>
      candidate.visible &&
      candidate.colorWrite &&
      materialOpacity(candidate) > MATERIAL_OPACITY_EPSILON,
  );
}

function hasVisibleDrawable(mobject: Mobject): boolean {
  const root = mobject.getThreeObject();
  root.updateWorldMatrix(true, true);
  let visible = false;
  root.traverse((object) => {
    if (!visible && isVisibleDrawable(object, root)) visible = true;
  });
  return visible;
}

function worldStageBounds(): EsapWorldBounds {
  const left = -ESAP_STAGE.worldWidth / 2;
  const right = ESAP_STAGE.worldWidth / 2;
  const bottom = -ESAP_STAGE.worldHeight / 2;
  const top = ESAP_STAGE.worldHeight / 2;
  return {
    left,
    right,
    bottom,
    top,
    width: ESAP_STAGE.worldWidth,
    height: ESAP_STAGE.worldHeight,
  };
}

function diagnoseMobjectBounds(
  mobject: Mobject,
  stageBounds: EsapWorldBounds,
): EsapMobjectBoundsDiagnostic {
  const raw = mobject.getBounds();
  const bounds: EsapWorldBounds = {
    left: raw.min.x,
    right: raw.max.x,
    bottom: raw.min.y,
    top: raw.max.y,
    width: raw.max.x - raw.min.x,
    height: raw.max.y - raw.min.y,
  };
  const coversStage =
    bounds.width >= stageBounds.width * STAGE_COVERAGE_RATIO &&
    bounds.height >= stageBounds.height * STAGE_COVERAGE_RATIO;
  const isBackground = mobject.zIndex < 0;
  const contentBottom = stageBounds.bottom + BOTTOM_SAFE_BAND_WORLD_HEIGHT;
  const bottomSafeBandOvershoot = Math.max(0, contentBottom - bounds.bottom);
  const overshoot = {
    left: Math.max(0, stageBounds.left - bounds.left),
    right: Math.max(0, bounds.right - stageBounds.right),
    bottom: Math.max(0, stageBounds.bottom - bounds.bottom),
    top: Math.max(0, bounds.top - stageBounds.top),
  };
  const insideStage = Object.values(overshoot).every((amount) => amount <= STAGE_TOLERANCE);
  return {
    id: mobject.id,
    type: mobject.constructor.name,
    zIndex: mobject.zIndex,
    bounds,
    // Stage-covering backdrops and impact flashes intentionally touch or
    // overscan the frame; they are neither layout content nor captions.
    applicable: !coversStage && !isBackground,
    insideStage,
    aboveBottomSafeBand: coversStage || isBackground || bottomSafeBandOvershoot <= STAGE_TOLERANCE,
    exemption: coversStage ? 'stage-cover' : isBackground ? 'background' : null,
    bottomSafeBandOvershoot,
    overshoot,
  };
}

function collectStageBoundsDiagnostics(): EsapStageBoundsDiagnostics {
  const stageBounds = worldStageBounds();
  const items: EsapMobjectBoundsDiagnostic[] = [];
  const errors: string[] = [];

  for (const mobject of player.scene.mobjects) {
    if (mobject.parent !== null || !hasVisibleDrawable(mobject)) continue;
    try {
      items.push(diagnoseMobjectBounds(mobject, stageBounds));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${mobject.constructor.name} (${mobject.id}): ${message}`);
    }
  }

  const applicable = items.filter((item) => item.applicable);
  return {
    stage: stageBounds,
    tolerance: STAGE_TOLERANCE,
    bottomSafeBand: {
      pixelsAt1080p: BOTTOM_SAFE_BAND_PX_AT_1080P,
      worldHeight: BOTTOM_SAFE_BAND_WORLD_HEIGHT,
      contentBottom: stageBounds.bottom + BOTTOM_SAFE_BAND_WORLD_HEIGHT,
    },
    visibleTopLevelCount: items.length,
    applicableCount: applicable.length,
    allApplicableInside: applicable.every((item) => item.insideStage),
    allApplicableAboveBottomSafeBand: applicable.every((item) => item.aboveBottomSafeBand),
    errors,
    items,
  };
}

let lastExportFrameIndex = -1;

const diagnostics: EsapReviewDiagnosticHook = {
  status: 'loading',
  error: null,
  get ready() {
    return this.status === 'ready';
  },
  get implementedCount() {
    return implementedSceneCount();
  },
  get moduleCount() {
    return getSceneRegistry().length;
  },
  expectedFrameCount: EXPECTED_FRAME_COUNT,
  get timelineFrameCount() {
    return Math.round(player.timeline.getDuration() * ESAP_FPS);
  },
  get timelineDuration() {
    return player.timeline.getDuration();
  },
  get currentTime() {
    return player.timeline.getCurrentTime();
  },
  get stageBoundsDiagnostics() {
    return collectStageBoundsDiagnostics();
  },
  seek(time: number) {
    if (!Number.isFinite(time)) {
      throw new TypeError('ESAP diagnostics seek requires a finite time');
    }
    // An interactive/random-access seek ends any monotonic export pass. A new
    // pass may start at frame zero afterward.
    lastExportFrameIndex = -1;
    player.seek(time);
    return player.timeline.getCurrentTime();
  },
  renderFrame(frameIndex: number) {
    if (!Number.isInteger(frameIndex)) {
      throw new TypeError('ESAP diagnostics renderFrame requires an integer frame index');
    }
    if (frameIndex < 0 || frameIndex >= EXPECTED_FRAME_COUNT) {
      throw new RangeError(
        `ESAP diagnostics frame index must be in [0, ${EXPECTED_FRAME_COUNT - 1}]`,
      );
    }
    if (frameIndex !== lastExportFrameIndex + 1) {
      throw new RangeError(
        `ESAP export frames must start at 0 and advance by one; expected ${
          lastExportFrameIndex + 1
        }, received ${frameIndex}`,
      );
    }

    player.renderExportFrame(frameIndex / ESAP_FPS, frameIndex === 0 ? 0 : 1 / ESAP_FPS);
    lastExportFrameIndex = frameIndex;
    return player.timeline.getCurrentTime();
  },
};
window.__esapReview = diagnostics;

function setStatus(message: string, state: 'loading' | 'ready' | 'error'): void {
  status.textContent = message;
  status.dataset.state = state;
}

function renderChapterRail(): void {
  const modules = getSceneRegistry();
  SECTIONS.forEach((section, index) => {
    const module = modules[index];
    const button = document.createElement('button');
    const number = document.createElement('span');
    const title = document.createElement('span');

    button.type = 'button';
    button.className = 'chapter';
    button.style.flexGrow = String(section.duration);
    button.style.setProperty('--chapter-color', CHAPTER_COLORS[index]);
    button.setAttribute('aria-label', `Seek to section ${index + 1}: ${module.title}`);
    button.addEventListener('click', () => player.seek(section.start));

    number.className = 'chapter-index';
    number.textContent = String(index + 1).padStart(2, '0');
    title.className = 'chapter-title';
    title.textContent = module.title;
    button.append(number, title);
    chapters.appendChild(button);
  });
}

async function boot(): Promise<void> {
  renderChapterRail();
  try {
    await player.sequence(recordEsapReview);
    const implemented = implementedSceneCount();
    const state =
      implemented === SECTIONS.length
        ? 'All eight sections loaded'
        : `${implemented} sections implemented · ${SECTIONS.length - implemented} frame-exact scaffolds`;
    const mediaStatus = audio
      ? `${TRACK_DURATION.toFixed(3)} seconds of user-supplied audio wired`
      : 'visual timeline ready · optional audio not supplied';
    setStatus(`${state} · ${mediaStatus}`, 'ready');
    diagnostics.status = 'ready';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Timeline could not be recorded: ${message}`, 'error');
    diagnostics.error = error instanceof Error ? (error.stack ?? message) : message;
    diagnostics.status = 'error';
  }
}

window.addEventListener(
  'beforeunload',
  () => {
    audio?.dispose();
    player.dispose();
  },
  { once: true },
);

void boot();
