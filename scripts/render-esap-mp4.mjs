import { spawn } from 'node:child_process';
import { access, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { chromium } from '@playwright/test';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const pageUrl = process.env.ESAP_RENDER_URL ?? 'http://127.0.0.1:5173/examples/esap_review.html';
const cliArguments = process.argv.slice(2);
const muxOnly = cliArguments.includes('--mux-only');
const outputArgument = cliArguments.find((argument) => !argument.startsWith('--'));
const outputPath = path.resolve(
  repositoryRoot,
  outputArgument ?? 'renders/esap-review-web-port.mp4',
);
const rawPath = outputPath.replace(/\.mp4$/i, '.video.h264');
const audioPath = path.join(
  repositoryRoot,
  'examples',
  'esap-review',
  'assets',
  'audio',
  'full_explainer_bg.wav',
);
const expectedFrames = 12_201;
const fps = 60;
const expectedDuration = expectedFrames / fps;
const outputWidth = 1920;
const outputHeight = 1080;

if (!outputPath.toLowerCase().endsWith('.mp4')) {
  throw new Error(`Output must end in .mp4: ${outputPath}`);
}

async function ensureServerIsReady() {
  const response = await globalThis.fetch(pageUrl);
  if (!response.ok) {
    throw new Error(`ESAP page returned HTTP ${response.status}: ${pageUrl}`);
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`,
        ),
      );
    });
  });
}

async function probeJson(filePath) {
  let stdout = '';
  await new Promise((resolve, reject) => {
    const child = spawn(
      'ffprobe',
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath],
      {
        cwd: repositoryRoot,
        stdio: ['ignore', 'pipe', 'inherit'],
        windowsHide: true,
      },
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffprobe failed with exit code ${code}`));
    });
  });
  return JSON.parse(stdout);
}

async function captureRawH264() {
  const browser = await chromium.launch({
    channel: process.env.ESAP_BROWSER_CHANNEL ?? 'chrome',
    headless: true,
    args: [
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });

  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(0);

  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (
      message.type() === 'error' &&
      !text.startsWith('Failed to load resource: the server responded with a status of 404')
    ) {
      browserErrors.push(text);
    }
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const responseUrl = new URL(response.url());
    if (response.status() === 404 && responseUrl.pathname === '/favicon.ico') return;
    browserErrors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  await page.exposeFunction('__reportEsapEncodeProgress', (percent) => {
    globalThis.console.log(`Encoding... ${percent}%`);
  });

  try {
    globalThis.console.log(`Loading ${pageUrl}`);
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(
      () =>
        globalThis.__esapReview?.status === 'ready' || globalThis.__esapReview?.status === 'error',
      undefined,
      { timeout: 600_000 },
    );

    const diagnostics = await page.evaluate(() => ({
      status: globalThis.__esapReview.status,
      error: globalThis.__esapReview.error,
      frames: globalThis.__esapReview.timelineFrameCount,
      duration: globalThis.__esapReview.timelineDuration,
      videoEncoderSupported: 'VideoEncoder' in globalThis,
    }));
    if (diagnostics.status !== 'ready') {
      throw new Error(diagnostics.error ?? 'ESAP page failed to initialize');
    }
    if (diagnostics.frames !== expectedFrames) {
      throw new Error(`Expected ${expectedFrames} timeline frames, received ${diagnostics.frames}`);
    }
    if (!diagnostics.videoEncoderSupported) {
      throw new Error('Chrome does not support the WebCodecs VideoEncoder API');
    }
    globalThis.console.log(
      `Timeline ready: ${diagnostics.frames} frames, ${diagnostics.duration.toFixed(3)} seconds`,
    );

    const downloadPromise = page.waitForEvent('download', { timeout: 1_800_000 });
    const encodeStatsPromise = page.evaluate(
      async ({ expectedFrames, fps, outputWidth, outputHeight }) => {
        const sourceCanvas = document.querySelector('#stage canvas');
        if (!(sourceCanvas instanceof HTMLCanvasElement)) {
          throw new Error('ESAP canvas was not found');
        }

        const outputCanvas = new OffscreenCanvas(outputWidth, outputHeight);
        const outputContext = outputCanvas.getContext('2d', { alpha: false });
        if (!outputContext) {
          throw new Error('Could not create the export canvas context');
        }
        outputContext.imageSmoothingEnabled = true;
        outputContext.imageSmoothingQuality = 'high';

        const config = {
          codec: 'avc1.64002A',
          width: outputWidth,
          height: outputHeight,
          bitrate: 12_000_000,
          framerate: fps,
          hardwareAcceleration: 'prefer-hardware',
          latencyMode: 'realtime',
          avc: { format: 'annexb' },
        };
        const support = await VideoEncoder.isConfigSupported(config);
        if (!support.supported) {
          throw new Error(`Hardware H.264 encoder is unavailable: ${JSON.stringify(config)}`);
        }

        const chunks = [];
        let encodedBytes = 0;
        let encoderError = null;
        const encoder = new VideoEncoder({
          output(chunk) {
            const bytes = new Uint8Array(chunk.byteLength);
            chunk.copyTo(bytes);
            chunks.push(bytes);
            encodedBytes += bytes.byteLength;
          },
          error(error) {
            encoderError = error;
          },
        });
        encoder.configure(config);

        const started = performance.now();
        let reportedPercent = -1;
        for (let frameIndex = 0; frameIndex < expectedFrames; frameIndex++) {
          globalThis.__esapReview.renderFrame(frameIndex);
          outputContext.drawImage(sourceCanvas, 0, 0, outputWidth, outputHeight);

          const timestamp = Math.round((frameIndex * 1_000_000) / fps);
          const duration = Math.round(1_000_000 / fps);
          const videoFrame = new VideoFrame(outputCanvas, { timestamp, duration });
          encoder.encode(videoFrame, { keyFrame: frameIndex % (fps * 2) === 0 });
          videoFrame.close();

          while (encoder.encodeQueueSize > 8) {
            await new Promise((resolve) =>
              encoder.addEventListener('dequeue', resolve, { once: true }),
            );
          }

          const percent = Math.floor(((frameIndex + 1) / expectedFrames) * 100);
          if (percent !== reportedPercent) {
            reportedPercent = percent;
            await globalThis.__reportEsapEncodeProgress(percent);
          }
        }

        await encoder.flush();
        encoder.close();
        if (encoderError) throw encoderError;

        const blob = new Blob(chunks, { type: 'video/h264' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'esap-review-web-port.video.h264';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        globalThis.setTimeout(() => URL.revokeObjectURL(url), 60_000);

        return {
          encodedFrames: chunks.length,
          encodedBytes,
          elapsedMs: performance.now() - started,
          sourceWidth: sourceCanvas.width,
          sourceHeight: sourceCanvas.height,
        };
      },
      { expectedFrames, fps, outputWidth, outputHeight },
    );

    const [download, encodeStats] = await Promise.all([downloadPromise, encodeStatsPromise]);
    await download.saveAs(rawPath);
    if (encodeStats.encodedFrames !== expectedFrames) {
      throw new Error(
        `Expected ${expectedFrames} encoded frames, received ${encodeStats.encodedFrames}`,
      );
    }
    globalThis.console.log(
      `Encoded ${encodeStats.encodedFrames} frames in ${(encodeStats.elapsedMs / 1000).toFixed(2)}s ` +
        `(${((encodeStats.encodedFrames * 1000) / encodeStats.elapsedMs).toFixed(1)} fps, ` +
        `${encodeStats.encodedBytes.toLocaleString()} bytes, ` +
        `${encodeStats.sourceWidth}x${encodeStats.sourceHeight} → ${outputWidth}x${outputHeight})`,
    );

    if (browserErrors.length > 0) {
      throw new Error(`Browser errors during export:\n${browserErrors.join('\n')}`);
    }
  } finally {
    await browser.close();
  }
}

async function muxMp4() {
  globalThis.console.log(
    `Muxing ${expectedFrames} H.264 frames at ${fps} fps with the pristine soundtrack`,
  );

  await run('ffmpeg', [
    '-y',
    '-f',
    'h264',
    '-i',
    rawPath,
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    // Annex-B does not retain the WebCodecs chunk timestamps. Assign every
    // access unit an explicit 60 fps PTS/DTS before stream-copying it into
    // MP4; relying on generated timestamps corrupts predictive frames.
    '-bsf:v',
    `setts=pts=N/(${fps}*TB):dts=N/(${fps}*TB):duration=1/(${fps}*TB)`,
    '-c:a',
    'aac',
    '-b:a',
    '256k',
    '-af',
    `apad,atrim=duration=${expectedDuration}`,
    '-t',
    String(expectedDuration),
    '-movflags',
    '+faststart',
    outputPath,
  ]);
}

async function verifyOutput() {
  const probe = await probeJson(outputPath);
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  const duration = Number(probe.format.duration);
  const outputStat = await stat(outputPath);

  const errors = [];
  if (video?.codec_name !== 'h264') errors.push(`video codec is ${video?.codec_name ?? 'missing'}`);
  if (video?.width !== outputWidth || video?.height !== outputHeight) {
    errors.push(`video dimensions are ${video?.width ?? '?'}x${video?.height ?? '?'}`);
  }
  if (video?.avg_frame_rate !== '60/1') {
    errors.push(`average frame rate is ${video?.avg_frame_rate ?? 'missing'}`);
  }
  if (audio?.codec_name !== 'aac') errors.push(`audio codec is ${audio?.codec_name ?? 'missing'}`);
  if (Number(video?.nb_frames) !== expectedFrames) {
    errors.push(`video frame count is ${video?.nb_frames ?? 'missing'}`);
  }
  if (!Number.isFinite(duration) || Math.abs(duration - expectedDuration) > 0.05) {
    errors.push(`container duration is ${probe.format.duration ?? 'missing'}`);
  }
  if (errors.length > 0) {
    throw new Error(`Rendered MP4 failed verification:\n- ${errors.join('\n- ')}`);
  }

  globalThis.console.log(`Rendered ${outputPath}`);
  globalThis.console.log(
    `${outputStat.size.toLocaleString()} bytes · ${video.width}x${video.height} · ` +
      `${video.avg_frame_rate} fps · ${duration.toFixed(3)} seconds · H.264 + AAC`,
  );
}

await mkdir(path.dirname(outputPath), { recursive: true });
await access(audioPath);
if (muxOnly) {
  await access(rawPath);
} else {
  await ensureServerIsReady();
  await captureRawH264();
}
await muxMp4();
await verifyOutput();
