import type { Animation } from '../../src/index.ts';
import rawBeatmap from './assets/data/beatmap.json';

export const ESAP_FPS = 60;

export const SECTION_IDS = [
  'intro',
  'verse',
  'build-1',
  'drop-1',
  'breakdown',
  'build-2',
  'drop-2',
  'outro',
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

interface RawSection {
  readonly start: number;
  readonly end: number;
  readonly duration: number;
  readonly section: string;
  readonly role: string;
}

interface BeatmapShape {
  readonly tempo_bpm: number;
  readonly beat_period: number;
  readonly bar_period: number;
  readonly trim: { readonly duration: number };
  readonly beats: readonly number[];
  readonly downbeats: readonly number[];
  readonly drops: readonly { readonly section: string; readonly time: number }[];
  readonly cutouts: readonly { readonly time: number }[];
  readonly sections: readonly RawSection[];
}

const BEATMAP = rawBeatmap as BeatmapShape;

export interface SectionTiming {
  readonly id: SectionId;
  readonly sourceName: string;
  readonly role: string;
  readonly start: number;
  readonly end: number;
  readonly duration: number;
  readonly frameCount: number;
  readonly frameDuration: number;
}

const SOURCE_SECTION_NAMES: Readonly<Record<SectionId, string>> = {
  intro: 'intro',
  verse: 'verse',
  'build-1': 'build 1',
  'drop-1': 'drop 1',
  breakdown: 'breakdown',
  'build-2': 'build 2',
  'drop-2': 'drop 2',
  outro: 'outro',
};

export const TRACK_DURATION = BEATMAP.trim.duration;
export const BPM = BEATMAP.tempo_bpm;
export const BEAT_DURATION = BEATMAP.beat_period;
export const BAR_DURATION = BEATMAP.bar_period;
export const BEATS = Object.freeze([...BEATMAP.beats]);
export const DOWNBEATS = Object.freeze([...BEATMAP.downbeats]);
export const DROPS = Object.freeze(
  Object.fromEntries(BEATMAP.drops.map((drop) => [drop.section, drop.time])),
) as Readonly<Record<string, number>>;
export const CUTOUTS = Object.freeze(BEATMAP.cutouts.map((cutout) => cutout.time));

export function secondsToFrames(seconds: number, fps = ESAP_FPS): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError('secondsToFrames requires a finite non-negative time');
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError('secondsToFrames requires a positive frame rate');
  }
  return Math.round(seconds * fps);
}

export function framesToSeconds(frames: number, fps = ESAP_FPS): number {
  if (!Number.isInteger(frames) || frames < 0) {
    throw new RangeError('framesToSeconds requires a non-negative integer frame count');
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError('framesToSeconds requires a positive frame rate');
  }
  return frames / fps;
}

export function quantizeDuration(seconds: number, fps = ESAP_FPS): number {
  if (seconds <= 0) return 0;
  return framesToSeconds(Math.max(1, secondsToFrames(seconds, fps)), fps);
}

/**
 * Place an absolute track cue on a section's independently rendered frame grid.
 *
 * Sections are rounded to whole frame spans before assembly, so quantizing the
 * absolute track time would accumulate the preceding sections' rounding error.
 */
export function frameAlignedSectionCue(section: SectionTiming, absoluteTrackTime: number): number {
  if (
    !Number.isFinite(absoluteTrackTime) ||
    absoluteTrackTime < section.start ||
    absoluteTrackTime > section.end
  ) {
    throw new RangeError('frameAlignedSectionCue requires a cue inside the section');
  }
  return section.start + quantizeDuration(absoluteTrackTime - section.start);
}

function resolveSections(): readonly SectionTiming[] {
  if (BEATMAP.sections.length !== SECTION_IDS.length) {
    throw new Error(`Expected ${SECTION_IDS.length} ESAP sections`);
  }

  return SECTION_IDS.map((id, index) => {
    const sourceName = SOURCE_SECTION_NAMES[id];
    const source = BEATMAP.sections.find((section) => section.section === sourceName);
    if (!source) throw new Error(`Missing beatmap section "${sourceName}"`);
    if (index > 0 && source.start !== BEATMAP.sections[index - 1].end) {
      throw new Error(`Beatmap section "${sourceName}" does not meet its predecessor`);
    }
    const frameCount = secondsToFrames(source.end - source.start);
    return Object.freeze({
      id,
      sourceName,
      role: source.role,
      start: source.start,
      end: source.end,
      duration: source.end - source.start,
      frameCount,
      frameDuration: framesToSeconds(frameCount),
    });
  });
}

export const SECTIONS = Object.freeze(resolveSections());

const SECTION_BY_ID = new Map(SECTIONS.map((section) => [section.id, section]));

export function sectionTiming(id: SectionId): SectionTiming {
  const section = SECTION_BY_ID.get(id);
  if (!section) throw new Error(`Unknown ESAP section "${id}"`);
  return section;
}

export function sectionAt(trackTime: number): SectionTiming {
  if (!Number.isFinite(trackTime) || trackTime < 0 || trackTime > TRACK_DURATION) {
    throw new RangeError('sectionAt requires a time inside the ESAP track');
  }
  return (
    SECTIONS.find((section) => trackTime >= section.start && trackTime < section.end) ??
    SECTIONS[SECTIONS.length - 1]
  );
}

/** Start time of a one-indexed musical bar. */
export function bar(barNumber: number): number {
  if (!Number.isInteger(barNumber) || barNumber < 1 || barNumber > DOWNBEATS.length) {
    throw new RangeError(`bar requires an integer from 1 through ${DOWNBEATS.length}`);
  }
  return DOWNBEATS[barNumber - 1];
}

export function beatsIn(start: number, end: number): readonly number[] {
  if (end < start) throw new RangeError('beatsIn requires end to be at least start');
  return BEATS.filter((beat) => beat >= start - 1e-6 && beat < end - 1e-6);
}

export function barBeats(barNumber: number): readonly number[] {
  const start = bar(barNumber);
  const end = barNumber < DOWNBEATS.length ? DOWNBEATS[barNumber] : TRACK_DURATION;
  return beatsIn(start, end);
}

export interface ClockScene {
  play(...animations: Animation[]): Promise<void>;
  wait(duration?: number): Promise<void>;
}

/**
 * Frame-aware clock for one section.
 *
 * Section modules express musical cues in absolute track time. This class
 * converts those cues to waits on the recording timeline while retaining the
 * reference renderer's per-section frame count.
 */
export class SectionClock {
  readonly section: SectionTiming;
  private _elapsed = 0;

  constructor(section: SectionTiming | SectionId) {
    this.section = typeof section === 'string' ? sectionTiming(section) : section;
  }

  get elapsed(): number {
    return this._elapsed;
  }

  get now(): number {
    return this.section.start + this._elapsed;
  }

  get remaining(): number {
    const remaining = this.section.frameDuration - this._elapsed;
    return remaining <= 1 / (ESAP_FPS * 1000) ? 0 : remaining;
  }

  async play(scene: ClockScene, ...animations: Animation[]): Promise<void> {
    if (animations.length === 0) return;
    const duration = Math.max(...animations.map((animation) => animation.duration));
    this._assertFits(duration, 'animation');
    await scene.play(...animations);
    this._elapsed += duration;
  }

  async hold(scene: ClockScene, seconds: number): Promise<number> {
    const duration = quantizeDuration(seconds);
    return this.holdExact(scene, duration);
  }

  /**
   * Hold for an exact duration without frame rounding.
   *
   * Scene modules should normally use `hold()`. This variant is for a final
   * pre-cleanup residue such as `remaining - oneFrame`, where rounding the hold
   * and then playing the cleanup frame could cross the section boundary.
   */
  async holdExact(scene: ClockScene, seconds: number): Promise<number> {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new RangeError('SectionClock exact wait must be finite and non-negative');
    }
    if (seconds === 0) return 0;
    this._assertFits(seconds, 'wait');
    await scene.wait(seconds);
    this._elapsed += seconds;
    return seconds;
  }

  async waitUntil(scene: ClockScene, absoluteTrackTime: number): Promise<number> {
    if (absoluteTrackTime < this.section.start - 1e-6) {
      throw new RangeError('A section cannot wait for a cue before its start');
    }
    return this.hold(scene, absoluteTrackTime - this.now);
  }

  async hit(
    scene: ClockScene,
    absoluteTrackTime: number,
    ...animations: Animation[]
  ): Promise<void> {
    await this.waitUntil(scene, absoluteTrackTime);
    await this.play(scene, ...animations);
  }

  async finish(scene: ClockScene): Promise<void> {
    const duration = this.remaining;
    if (duration === 0) return;
    // The preceding animation graph can end between output-frame boundaries
    // (for example, a LaggedStart's computed overlap). Preserve that graph,
    // then use its exact fractional residue to land on the authoritative
    // section boundary instead of rounding up by a whole frame.
    await this.holdExact(scene, duration);
  }

  private _assertFits(duration: number, kind: 'animation' | 'wait'): void {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new RangeError(`SectionClock ${kind} duration must be finite and non-negative`);
    }
    const nextElapsed = this._elapsed + duration;
    const frameEpsilon = 1 / (ESAP_FPS * 1000);
    if (nextElapsed > this.section.frameDuration + frameEpsilon) {
      throw new RangeError(
        `${this.section.id} ${kind} would end at ${nextElapsed.toFixed(6)}s, ` +
          `past its ${this.section.frameDuration.toFixed(6)}s frame span`,
      );
    }
  }
}
