// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { GifExporter } from './GifExporter';
import { VideoExporter } from './VideoExporter';

const scene = {
  renderer: { width: 800, height: 600 },
  getWidth: () => 800,
  getHeight: () => 600,
  getCanvas: () => document.createElement('canvas'),
  getTimelineDuration: () => 1,
  timeline: { getDuration: () => 1 },
  seek: vi.fn(),
} as unknown as ConstructorParameters<typeof VideoExporter>[0] &
  ConstructorParameters<typeof GifExporter>[0];

describe('bounded export options', () => {
  // MIGRATION: every accepted frame rate is finite and strictly positive.
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects fps %s', (fps) => {
    expect(() => new VideoExporter(scene, { fps })).toThrow(RangeError);
    expect(() => new GifExporter(scene, { fps })).toThrow(RangeError);
  });
  // MIGRATION: dimensions are positive safe integers and quality is in its codec range.
  it('rejects invalid dimensions, worker counts and quality', () => {
    expect(() => new VideoExporter(scene, { width: 0 })).toThrow(RangeError);
    expect(() => new GifExporter(scene, { height: 1.5 })).toThrow(RangeError);
    expect(() => new GifExporter(scene, { workers: 0 })).toThrow(RangeError);
    expect(() => new VideoExporter(scene, { quality: 2 })).toThrow(RangeError);
    expect(() => new GifExporter(scene, { quality: Number.NaN })).toThrow(RangeError);
  });
  it('accepts fractional frame rates', () => {
    expect(() => new VideoExporter(scene, { fps: 29.97 })).not.toThrow();
    expect(() => new GifExporter(scene, { fps: 29.97 })).not.toThrow();
  });
});
