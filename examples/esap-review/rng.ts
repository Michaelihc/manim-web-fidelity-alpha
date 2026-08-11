/** Stable FNV-1a hash so named seeds are reproducible across browsers. */
function hashSeed(seed: number | string): number {
  if (typeof seed === 'number') return seed >>> 0;

  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Small deterministic generator for starfields, jitter, and sampling.
 *
 * Mulberry32 is used deliberately: its entire state is one unsigned integer,
 * making a scene's random choices easy to reproduce and audit.
 */
export class SeededRng {
  private _state: number;

  constructor(seed: number | string) {
    this._state = hashSeed(seed);
  }

  next(): number {
    this._state = (this._state + 0x6d2b79f5) >>> 0;
    let value = this._state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    if (!(max >= min)) throw new RangeError('SeededRng.range requires max to be at least min');
    return min + (max - min) * this.next();
  }

  integer(minInclusive: number, maxExclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive)) {
      throw new TypeError('SeededRng.integer bounds must be integers');
    }
    if (maxExclusive <= minInclusive) {
      throw new RangeError('SeededRng.integer requires a non-empty interval');
    }
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('SeededRng.pick requires at least one item');
    return items[this.integer(0, items.length)];
  }

  fork(label: number | string): SeededRng {
    return new SeededRng(`${this._state}:${String(label)}`);
  }
}
