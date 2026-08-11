const FORBIDDEN_VISIBLE_GLYPHS = [
  { glyph: '/', replacement: String.raw`\frac{numerator}{denominator}` },
  { glyph: '÷', replacement: String.raw`\frac{numerator}{denominator}` },
] as const;

export interface CopyLintIssue {
  readonly index: number;
  readonly glyph: string;
  readonly replacement: string;
}

/**
 * Finds glyphs that would render division as a slash or division sign.
 *
 * LaTeX command backslashes are intentionally accepted. For example,
 * `\frac{x}{y}` is valid because its visible output is a built-up fraction.
 */
export function lintVisibleCopy(value: string): CopyLintIssue[] {
  const issues: CopyLintIssue[] = [];
  for (const rule of FORBIDDEN_VISIBLE_GLYPHS) {
    let index = value.indexOf(rule.glyph);
    while (index !== -1) {
      issues.push({ index, glyph: rule.glyph, replacement: rule.replacement });
      index = value.indexOf(rule.glyph, index + rule.glyph.length);
    }
  }
  return issues.sort((left, right) => left.index - right.index);
}

export function assertVisibleCopy(value: string, source = 'visible copy'): string {
  const issues = lintVisibleCopy(value);
  if (issues.length === 0) return value;

  const details = issues
    .map((issue) => `"${issue.glyph}" at ${issue.index}; use ${issue.replacement}`)
    .join(', ');
  throw new Error(`${source} contains a forbidden visible division glyph: ${details}`);
}

export function assertVisibleCopyRecord(
  values: Readonly<Record<string, string>>,
  source = 'copy record',
): void {
  for (const [key, value] of Object.entries(values)) {
    assertVisibleCopy(value, `${source}.${key}`);
  }
}

/** Escape plain prose for use inside a MathJax `\text{...}` command. */
export function escapeLatexText(value: string): string {
  assertVisibleCopy(value);
  return value
    .split('\\')
    .join(String.raw`\textbackslash{}`)
    .split('{')
    .join(String.raw`\{`)
    .split('}')
    .join(String.raw`\}`)
    .split('$')
    .join(String.raw`\$`)
    .split('&')
    .join(String.raw`\&`)
    .split('%')
    .join(String.raw`\%`)
    .split('#')
    .join(String.raw`\#`)
    .split('_')
    .join(String.raw`\_`)
    .split('^')
    .join(String.raw`\textasciicircum{}`)
    .split('~')
    .join(String.raw`\textasciitilde{}`);
}
