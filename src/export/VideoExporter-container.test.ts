// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoExporter } from './VideoExporter';

describe('recorded container metadata', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // MIGRATION: every fallback export describes the actual encoded container.
  it('labels and names a MOV-to-WebM fallback as WebM', async () => {
    class Recorder {
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      readonly mimeType: string;
      constructor(_stream: MediaStream, options: MediaRecorderOptions) {
        this.mimeType = options.mimeType ?? '';
      }
      static isTypeSupported(type: string): boolean {
        return type.startsWith('video/webm');
      }
      start(): void {}
      stop(): void {
        this.ondataavailable?.({ data: new Blob(['encoded-webm']) });
        this.onstop?.();
      }
    }
    vi.stubGlobal('MediaRecorder', Recorder);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'captureStream').mockReturnValue({} as MediaStream);
    const scene = {
      getCanvas: () => canvas,
      getWidth: () => 100,
      getHeight: () => 100,
      getTimelineDuration: () => 1,
      seek: vi.fn(),
    } as unknown as ConstructorParameters<typeof VideoExporter>[0];
    const exporter = new VideoExporter(scene, { format: 'mov', includeAudio: false });
    await exporter.startRecording();
    const blob = await exporter.stopRecording();
    expect(blob.type).toBe('video/webm');
    vi.spyOn(exporter, 'exportTimeline').mockResolvedValue(blob);
    const download = vi.spyOn(VideoExporter, 'download').mockImplementation(() => {});
    await exporter.exportAndDownload();
    expect(download).toHaveBeenCalledWith(blob, 'animation.webm');
  });
});
