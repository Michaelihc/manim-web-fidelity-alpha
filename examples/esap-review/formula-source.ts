import { assertVisibleCopy } from './copy';

export type FormulaSource = string | readonly string[];

export function assertFormulaSource(source: FormulaSource, label = 'formula'): FormulaSource {
  const parts = typeof source === 'string' ? [source] : source;
  for (let index = 0; index < parts.length; index += 1) {
    assertVisibleCopy(parts[index], `${label}[${index}]`);
  }
  return source;
}
