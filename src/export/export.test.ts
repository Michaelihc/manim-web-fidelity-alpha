// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scene } from '../core/Scene';
import { GifExporter } from './GifExporter';
import { VideoExporter, createVideoExporter } from './VideoExporter';

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

/** Minimal mock of a Scene for GifExporter / VideoExporter constructors. */
function createMockScene(overrides?: Record<string, unknown>) {
  return {
    renderer: { width: 800, height: 600 },
    getWidth: () => 800,
    getHeight: () => 600,
    getCanvas: () => document.createElement('canvas'),
    getTimelineDuration: () => 5,
    timeline: { getDuration: () => 5 },
    seek: vi.fn(),
    render: vi.fn(),
    audioManager: { tracks: [] },
    ...overrides,
  } as any;
}

/** Helper to test the static download() method shared by both exporters. */
function testDownload(
  downloadFn: (blob: Blob, filename: string) => void,
  blob: Blob,
  filename: string,
) {
  const fakeUrl = 'blob:http://localhost/fake';
  const origCreateObjectURL = URL.createObjectURL;
  const origRevokeObjectURL = URL.revokeObjectURL;

  const createObjectURLSpy = vi.fn(() => fakeUrl);
  const revokeObjectURLSpy = vi.fn();
  URL.createObjectURL = createObjectURLSpy;
  URL.revokeObjectURL = revokeObjectURLSpy;

  const clickSpy = vi.fn();
  const origCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = origCreateElement(tag);
    if (tag === 'a') {
      el.click = clickSpy;
    }
    return el;
  });

  try {
    downloadFn(blob, filename);

    expect(createObjectURLSpy).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith(fakeUrl);
  } finally {
    URL.createObjectURL = origCreateObjectURL;
    URL.revokeObjectURL = origRevokeObjectURL;
    vi.restoreAllMocks();
  }
}

// =========================================================================
// GifExporter
// =========================================================================

describe('GifExporter', () => {
  it('constructor creates with default options (fps=30, quality=10)', () => {
    const scene = createMockScene();
    const exporter = new GifExporter(scene);

    const opts = (exporter as any)._options;
    expect(opts.fps).toBe(30);
    expect(opts.quality).toBe(10);
    expect(opts.width).toBe(800);
    expect(opts.height).toBe(600);
    expect(opts.workers).toBe(4);
    expect(opts.repeat).toBe(0);
  });

  it('options can be overridden', () => {
    const scene = createMockScene();
    const exporter = new GifExporter(scene, {
      fps: 15,
      quality: 5,
      width: 400,
      height: 300,
      workers: 2,
      repeat: -1,
    });

    const opts = (exporter as any)._options;
    expect(opts.fps).toBe(15);
    expect(opts.quality).toBe(5);
    expect(opts.width).toBe(400);
    expect(opts.height).toBe(300);
    expect(opts.workers).toBe(2);
    expect(opts.repeat).toBe(-1);
  });

  it('download() creates and clicks an anchor element', () => {
    const blob = new Blob(['gif-data'], { type: 'image/gif' });
    testDownload(GifExporter.download, blob, 'test.gif');
  });
});

// =========================================================================
// VideoExporter
// =========================================================================

describe('VideoExporter', () => {
  it('constructor creates with default options (fps=60, format=webm)', () => {
    const scene = createMockScene();
    const exporter = new VideoExporter(scene);
    const opts = exporter.getOptions();

    expect(opts.fps).toBe(60);
    expect(opts.format).toBe('webm');
    expect(opts.quality).toBe(0.9);
    expect(opts.width).toBe(800);
    expect(opts.height).toBe(600);
    expect(opts.includeAudio).toBe(true);
  });

  it('isRecording() returns false initially', () => {
    const scene = createMockScene();
    const exporter = new VideoExporter(scene);
    expect(exporter.isRecording()).toBe(false);
  });

  it('uses the cumulative timeline duration when no export duration is provided', async () => {
    const scene = createMockScene({ getTimelineDuration: () => 1.25 });
    const exporter = new VideoExporter(scene, { fps: 4 });
    const blob = new Blob(['video-data'], { type: 'video/webm' });

    vi.spyOn(exporter, 'startRecording').mockResolvedValue();
    vi.spyOn(exporter, 'stopRecording').mockResolvedValue(blob);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    await expect(exporter.exportTimeline()).resolves.toBe(blob);

    // 1.25 seconds at 4 fps: the constructor's duration=0 sentinel must
    // not win over the scene timeline and produce an empty export.
    expect(scene.seek).toHaveBeenCalledTimes(5);
    expect(scene.seek).toHaveBeenNthCalledWith(1, 0);
    expect(scene.seek).toHaveBeenLastCalledWith(1);
    vi.unstubAllGlobals();
  });

  it('getOptions() returns resolved options', () => {
    const scene = createMockScene();
    const onProgress = vi.fn();
    const exporter = new VideoExporter(scene, {
      fps: 24,
      format: 'mp4',
      quality: 0.5,
      width: 1920,
      height: 1080,
      duration: 10,
      onProgress,
    });

    const opts = exporter.getOptions();
    expect(opts.fps).toBe(24);
    expect(opts.format).toBe('mp4');
    expect(opts.quality).toBe(0.5);
    expect(opts.width).toBe(1920);
    expect(opts.height).toBe(1080);
    expect(opts.duration).toBe(10);
    expect(opts.onProgress).toBe(onProgress);
  });

  it('prefers explicit H.264 over generic MP4 recording', async () => {
    const scene = createMockScene();
    let recorderOptions: MediaRecorderOptions | undefined;
    class MockMediaRecorder {
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
        recorderOptions = options;
      }
      static isTypeSupported(mimeType: string): boolean {
        return mimeType === 'video/mp4;codecs=avc1.4D402A' || mimeType === 'video/mp4';
      }
      start(): void {}
      stop(): void {}
    }
    vi.stubGlobal('MediaRecorder', MockMediaRecorder);
    vi.spyOn(HTMLCanvasElement.prototype, 'captureStream').mockReturnValue({
      getVideoTracks: () => [],
      getAudioTracks: () => [],
    } as unknown as MediaStream);

    const exporter = new VideoExporter(scene, { format: 'mp4' });
    await exporter.startRecording();

    expect(recorderOptions?.mimeType).toBe('video/mp4;codecs=avc1.4D402A');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('download() creates and clicks an anchor element', () => {
    const blob = new Blob(['video-data'], { type: 'video/webm' });
    testDownload(VideoExporter.download, blob, 'test.webm');
  });

  it('MOV fallback: logs warning when quicktime is not supported', async () => {
    const scene = createMockScene();

    const isTypeSupportedStub = vi.fn((mime: string) => {
      if (mime === 'video/quicktime') return false;
      if (mime.startsWith('video/webm')) return true;
      return false;
    });

    // Use a real class so that `new MediaRecorder(...)` works
    class MockMediaRecorder {
      start = vi.fn();
      stop = vi.fn();
      ondataavailable: any = null;
      onstop: any = null;
      static isTypeSupported = isTypeSupportedStub;
    }

    vi.stubGlobal('MediaRecorder', MockMediaRecorder);

    const mockStream = {
      getVideoTracks: () => [],
      getAudioTracks: () => [],
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'captureStream').mockReturnValue(mockStream as any);

    vi.stubGlobal(
      'MediaStream',
      class {
        constructor() {}
        getVideoTracks() {
          return [];
        }
        getAudioTracks() {
          return [];
        }
      },
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const exporter = new VideoExporter(scene, { format: 'mov' });
    await exporter.startRecording();

    expect(warnSpy).toHaveBeenCalledWith(
      '[manim-web]',
      'MOV format not supported by this browser, falling back to WebM',
    );

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('createVideoExporter factory returns a VideoExporter instance', () => {
    const scene = createMockScene();
    const exporter = createVideoExporter(scene, { fps: 24 });
    expect(exporter).toBeInstanceOf(VideoExporter);
    expect(exporter.getOptions().fps).toBe(24);
  });
});

// =========================================================================
// Scene.export() routing
// =========================================================================

describe('Scene.export()', () => {
  let gifExportTimelineSpy: ReturnType<typeof vi.spyOn>;
  let gifDownloadSpy: ReturnType<typeof vi.spyOn>;
  let videoExportTimelineSpy: ReturnType<typeof vi.spyOn>;
  let videoDownloadSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const gifBlob = new Blob(['gif'], { type: 'image/gif' });
    const videoBlob = new Blob(['video'], { type: 'video/webm' });

    gifExportTimelineSpy = vi
      .spyOn(GifExporter.prototype, 'exportTimeline')
      .mockResolvedValue(gifBlob);
    gifDownloadSpy = vi.spyOn(GifExporter, 'download').mockImplementation(() => {});
    videoExportTimelineSpy = vi
      .spyOn(VideoExporter.prototype, 'exportTimeline')
      .mockResolvedValue(videoBlob);
    videoDownloadSpy = vi.spyOn(VideoExporter, 'download').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes .gif extension to GifExporter', async () => {
    const scene = createMockScene();
    const exportFn = Scene.prototype.export.bind(scene);

    const blob = await exportFn('animation.gif');

    expect(blob).toBeInstanceOf(Blob);
    expect(gifExportTimelineSpy).toHaveBeenCalled();
    expect(gifDownloadSpy).toHaveBeenCalledWith(blob, 'animation.gif');
  });

  it('routes .webm extension to VideoExporter', async () => {
    const scene = createMockScene();
    const exportFn = Scene.prototype.export.bind(scene);

    const blob = await exportFn('scene.webm');

    expect(blob).toBeInstanceOf(Blob);
    expect(videoExportTimelineSpy).toHaveBeenCalled();
    expect(videoDownloadSpy).toHaveBeenCalledWith(blob, 'scene.webm');
  });

  it('routes .mp4 extension to VideoExporter', async () => {
    const scene = createMockScene();
    const exportFn = Scene.prototype.export.bind(scene);

    const blob = await exportFn('output.mp4');

    expect(blob).toBeInstanceOf(Blob);
    expect(videoExportTimelineSpy).toHaveBeenCalled();
    expect(videoDownloadSpy).toHaveBeenCalledWith(blob, 'output.mp4');
  });

  it('routes .mov extension to VideoExporter', async () => {
    const scene = createMockScene();
    const exportFn = Scene.prototype.export.bind(scene);

    const blob = await exportFn('video.mov');

    expect(blob).toBeInstanceOf(Blob);
    expect(videoExportTimelineSpy).toHaveBeenCalled();
    expect(videoDownloadSpy).toHaveBeenCalledWith(blob, 'video.mov');
  });

  it('throws error on unknown extension', async () => {
    const scene = createMockScene();
    const exportFn = Scene.prototype.export.bind(scene);

    await expect(exportFn('video.avi')).rejects.toThrow('Unsupported export format ".avi"');
  });
});
