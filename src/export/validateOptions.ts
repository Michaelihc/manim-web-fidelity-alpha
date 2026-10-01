/** Reject options that would create empty or unbounded capture loops. */
export function validateCaptureOptions(options: {
  fps: number;
  width: number;
  height: number;
}): void {
  if (!Number.isFinite(options.fps) || options.fps <= 0) {
    throw new RangeError('Export fps must be finite and greater than zero');
  }
  for (const key of ['width', 'height'] as const) {
    if (!Number.isSafeInteger(options[key]) || options[key] <= 0) {
      throw new RangeError(`Export ${key} must be a positive safe integer`);
    }
  }
}

export function validateQuality(quality: number, min: number, max: number): void {
  if (!Number.isFinite(quality) || quality < min || quality > max) {
    throw new RangeError(`Export quality must be between ${min} and ${max}`);
  }
}
