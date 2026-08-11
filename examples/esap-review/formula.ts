import { MathTex, type MathTexOptions, type Vector3Tuple } from '../../src/index.ts';
import { escapeLatexText } from './copy';
import { assertFormulaSource, type FormulaSource } from './formula-source';
import { fitInsideStage } from './layout';
import { paletteFor, type EsapPalette, type PaletteMode } from './palette';

export { assertFormulaSource, type FormulaSource } from './formula-source';

export interface FormulaOptions extends Omit<MathTexOptions, 'latex' | 'position' | 'color'> {
  readonly color?: string;
  readonly position?: Vector3Tuple;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly stageMargin?: number;
  readonly fitStage?: boolean;
}

export interface ProseFormulaOptions extends FormulaOptions {
  readonly uppercase?: boolean;
}

function scaleToConstraints(
  formula: MathTex,
  maxWidth: number | undefined,
  maxHeight: number | undefined,
): void {
  const widthScale = maxWidth === undefined ? 1 : maxWidth / formula.getWidth();
  const heightScale = maxHeight === undefined ? 1 : maxHeight / formula.getHeight();
  const scale = Math.min(1, widthScale, heightScale);
  if (scale < 1) formula.scale(scale);
}

export function assertFormulaRenderBounds(
  width: number,
  height: number,
  source: FormulaSource,
): void {
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) return;

  const printableSource = typeof source === 'string' ? source : source.join('');
  throw new Error(
    `Formula must render finite, non-zero bounds; received ${width} × ${height} for ${JSON.stringify(printableSource)}`,
  );
}

/**
 * The sole constructor for rendered formulas and video copy.
 *
 * It always waits for vector MathJax paths before it reads bounds, scales, or
 * positions the result. Scene modules should never instantiate MathTex
 * directly; this is what keeps async layout and collision checks trustworthy.
 */
export class FormulaFactory {
  private _mode: PaletteMode;

  constructor(mode: PaletteMode = 'dark') {
    this._mode = mode;
  }

  get palette(): EsapPalette {
    return paletteFor(this._mode);
  }

  setMode(mode: PaletteMode): void {
    this._mode = mode;
  }

  async math(source: FormulaSource, options: FormulaOptions = {}): Promise<MathTex> {
    assertFormulaSource(source);
    const {
      color = this.palette.ink,
      position,
      maxWidth,
      maxHeight,
      stageMargin,
      fitStage = true,
      ...mathTexOptions
    } = options;
    const latex = typeof source === 'string' ? source : [...source];
    const formula = new MathTex({
      ...mathTexOptions,
      latex,
      color,
    });

    await formula.waitForRender();
    assertFormulaRenderBounds(formula.getWidth(), formula.getHeight(), source);
    scaleToConstraints(formula, maxWidth, maxHeight);
    if (position) formula.moveTo(position);
    if (fitStage) fitInsideStage(formula, stageMargin);
    return formula;
  }

  async caption(copy: string, options: ProseFormulaOptions = {}): Promise<MathTex> {
    const { uppercase = false, ...formulaOptions } = options;
    const text = uppercase ? copy.toUpperCase() : copy;
    return this.math(String.raw`\textsf{${escapeLatexText(text)}}`, {
      color: this.palette.dim,
      fontSize: 32,
      ...formulaOptions,
    });
  }

  async label(copy: string, options: ProseFormulaOptions = {}): Promise<MathTex> {
    const { uppercase = false, ...formulaOptions } = options;
    const text = uppercase ? copy.toUpperCase() : copy;
    return this.math(String.raw`\mathbf{\textsf{${escapeLatexText(text)}}}`, {
      color: this.palette.ink,
      fontSize: 38,
      ...formulaOptions,
    });
  }

  async title(copy: string, options: ProseFormulaOptions = {}): Promise<MathTex> {
    const { uppercase = false, ...formulaOptions } = options;
    const text = uppercase ? copy.toUpperCase() : copy;
    return this.math(String.raw`\mathbf{\text{${escapeLatexText(text)}}}`, {
      color: this.palette.ink,
      fontSize: 72,
      ...formulaOptions,
    });
  }
}
