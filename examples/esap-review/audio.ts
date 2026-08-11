import type { Player } from '../../src/index.ts';
import { TRACK_DURATION } from './timing';

interface PlayerMethods {
  readonly play: Player['play'];
  readonly pause: Player['pause'];
  readonly seek: Player['seek'];
  readonly nextSegment: Player['nextSegment'];
  readonly prevSegment: Player['prevSegment'];
  readonly setPlaybackRate: Player['setPlaybackRate'];
  readonly exportAs: Player['exportAs'];
}

/**
 * Keeps a native audio element synchronized with Player's recording timeline.
 *
 * Player currently owns visual transport only, so this adapter mirrors every
 * public transport operation without adding ESAP behavior to the library API.
 */
export class PlayerAudioSync {
  private readonly _player: Player;
  private readonly _audio: HTMLAudioElement;
  private readonly _url: string;
  private readonly _original: PlayerMethods;
  private _exportTrack: ReturnType<Player['scene']['addSound']> | null = null;
  private _disposed = false;

  constructor(player: Player, url: string) {
    this._player = player;
    this._url = url;
    this._audio = new Audio(url);
    this._audio.preload = 'auto';
    this._audio.loop = false;
    this._original = {
      play: player.play.bind(player),
      pause: player.pause.bind(player),
      seek: player.seek.bind(player),
      nextSegment: player.nextSegment.bind(player),
      prevSegment: player.prevSegment.bind(player),
      setPlaybackRate: player.setPlaybackRate.bind(player),
      exportAs: player.exportAs.bind(player),
    };
    this._patchTransport();
    this._audio.load();
  }

  get element(): HTMLAudioElement {
    return this._audio;
  }

  syncToTimeline(): void {
    const time = this._player.timeline.getCurrentTime();
    const maximum = Number.isFinite(this._audio.duration)
      ? Math.max(0, this._audio.duration - 0.001)
      : time;
    this._audio.currentTime = Math.min(Math.max(0, time), maximum);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._audio.pause();
    this._audio.removeAttribute('src');
    this._audio.load();
    this._player.play = this._original.play;
    this._player.pause = this._original.pause;
    this._player.seek = this._original.seek;
    this._player.nextSegment = this._original.nextSegment;
    this._player.prevSegment = this._original.prevSegment;
    this._player.setPlaybackRate = this._original.setPlaybackRate;
    this._player.exportAs = this._original.exportAs;
  }

  private _patchTransport(): void {
    this._player.play = () => {
      this._original.play();
      this.syncToTimeline();
      void this._audio.play().catch(() => undefined);
    };
    this._player.pause = () => {
      this._original.pause();
      this._audio.pause();
    };
    this._player.seek = (time) => {
      this._original.seek(time);
      this.syncToTimeline();
    };
    this._player.nextSegment = () => {
      this._original.nextSegment();
      this.syncToTimeline();
    };
    this._player.prevSegment = () => {
      this._original.prevSegment();
      this.syncToTimeline();
    };
    this._player.setPlaybackRate = (rate) => {
      this._original.setPlaybackRate(rate);
      this._audio.playbackRate = rate;
    };
    this._player.exportAs = async (format) => {
      if (format !== 'gif') {
        this._exportTrack ??= this._player.scene.addSound(this._url, {
          time: 0,
          duration: TRACK_DURATION,
        });
        await this._exportTrack;
      }
      await this._original.exportAs(format);
    };
  }
}
