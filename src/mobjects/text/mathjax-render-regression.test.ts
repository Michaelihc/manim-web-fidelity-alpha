// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest';
import { VMobject } from '../../core/VMobject';
import { renderLatexToSVG } from './MathJaxRenderer';

function getRawHeightFromVmobjectGroup(group: { children: unknown[] }): number {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const child of group.children) {
    if (!(child instanceof VMobject)) continue;
    for (const p of child.getLocalPoints()) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }

  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    throw new Error('No VMobject points found in MathJax render result');
  }

  return maxY - minY;
}

function expectFiniteGeometry(result: Awaited<ReturnType<typeof renderLatexToSVG>>): void {
  const points = result.vmobjectGroup.getAllPoints();
  expect(points.length).toBeGreaterThan(0);
  expect(points.flat().every(Number.isFinite)).toBe(true);

  const bounds = result.vmobjectGroup.getBounds();
  expect(
    [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].every(
      Number.isFinite,
    ),
  ).toBe(true);
}

describe('MathJaxRenderer regression (real MathJax)', () => {
  it('awaits MathJax 4 asynchronous font and package loading', async () => {
    const result = await renderLatexToSVG(String.raw`\mathbf{\textsf{MACHINE LEARNING}}`);

    expect(result.vmobjectGroup.children.length).toBeGreaterThan(0);
    expect(result.svgString).toContain('<svg');
    expectFiniteGeometry(result);
  });

  it('renders representative ESAP formulas with TeX font variants and delimiters', async () => {
    const corpus = [
      String.raw`\frac{\partial L}{\partial h}=v\,(p-y)`,
      String.raw`\frac{\partial L}{\partial a}=v\,(p-y)\,\mathbf{1}[a>0]`,
      String.raw`(p-y)\,h`,
      String.raw`p-y`,
      String.raw`\mathcal L=\mathbb E_q[\log p_\theta(x\mid z)]-D_{\mathrm{KL}}\!\left(q_\phi(z\mid x)\,\middle\|\,p(z)\right)`,
      String.raw`A=\operatorname{softmax}_{\mathrm{row}}\!\left(\frac{QK^\top}{\sqrt{d_k}}\right),\qquad Z=AV`,
    ];

    const results = [];
    for (const formula of corpus) {
      results.push(await renderLatexToSVG(formula));
    }

    expect(results.every((result) => result.vmobjectGroup.children.length > 0)).toBe(true);
    expect(results.every((result) => result.svgString.includes('<svg'))).toBe(true);
    results.forEach(expectFiniteGeometry);
  });

  it('renders a stretched underbrace as a thin horizontal glyph', async () => {
    const result = await renderLatexToSVG(
      String.raw`\underbrace{\mathbb E_{q_\phi(z\mid x)}[\log p_\theta(x\mid z)]}_{\text{reconstruction}}`,
    );
    const paths = result.vmobjectGroup.children
      .filter((child): child is VMobject => child instanceof VMobject)
      .map((child) => {
        const points = child.getLocalPoints();
        const xs = points.map((point) => point[0]);
        const ys = points.map((point) => point[1]);
        return {
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        };
      });
    const widestPath = paths.reduce((widest, path) => (path.width > widest.width ? path : widest));

    // MathJax stretches its underbrace extender only along X. Treating
    // scale(x,y) as uniform makes this path a tall filled slab.
    expect(result.svgString).toMatch(/transform="scale\(\d+(?:\.\d+)?,1\)"/);
    expect(widestPath.width).toBeGreaterThan(5000);
    expect(widestPath.height).toBeLessThan(200);
    expect(widestPath.width / widestPath.height).toBeGreaterThan(40);
  });

  it('renders x at about 453 raw MathJax units', async () => {
    const result = await renderLatexToSVG('x');
    const rawHeight = getRawHeightFromVmobjectGroup(result.vmobjectGroup);
    const yCoordinates = result.vmobjectGroup
      .getAllPoints()
      .map((point) => point[1])
      .filter(Number.isFinite);

    // MathJax path coordinates are in internal font units (about 1000 per em),
    // not CSS pixels. Lowercase x has x-height around 0.45em -> ~450 units.
    expect(rawHeight).toBeGreaterThan(440);
    expect(rawHeight).toBeLessThan(470);
    // MathJax's outer scale(1,-1) maps font coordinates to SVG Y-down. The
    // converter must flip SVG Y once more so the glyph remains upright in
    // Manim's Y-up coordinates.
    expect(Math.min(...yCoordinates)).toBeGreaterThan(-20);
    expect(Math.max(...yCoordinates)).toBeGreaterThan(440);
  });
});
