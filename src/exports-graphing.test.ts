import { describe, it, expect } from 'vitest';
import * as mod from './index';

describe('Issue #131: Missing graphing exports from main index', () => {
  it('should export VectorField from main index', () => {
    expect(mod.VectorField).toBeDefined();
  });

  it('should export ArrowVectorField from main index', () => {
    expect(mod.ArrowVectorField).toBeDefined();
  });

  it('should export StreamLines from main index', () => {
    expect(mod.StreamLines).toBeDefined();
  });

  it('should export ComplexPlane from main index', () => {
    expect(mod.ComplexPlane).toBeDefined();
  });

  it('should export PolarPlane from main index', () => {
    expect(mod.PolarPlane).toBeDefined();
  });

  it('should export UnitInterval from main index', () => {
    expect(mod.UnitInterval).toBeDefined();
  });

  it('should export BarChart from main index', () => {
    expect(mod.BarChart).toBeDefined();
  });
});
