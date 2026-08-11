import { describe, it, expect } from 'vitest';
import {
  Ellipse,
  Annulus,
  AnnularSector,
  Sector,
  ArcPolygon,
  CurvedArrow,
  CurvedDoubleArrow,
  TangentialArc,
} from './ArcShapes';
import { Arc } from './Arc';
import { BLUE } from '../../constants';
import { ArrowTriangleFilledTip } from './ArrowTips';
import { Create } from '../../animation/creation/Create';
import { linear } from '../../rate-functions';

// ---------------------------------------------------------------------------
// Ellipse
// ---------------------------------------------------------------------------
describe('Ellipse', () => {
  it('constructs with default options', () => {
    const e = new Ellipse();
    expect(e.getWidth()).toBe(2);
    expect(e.getHeight()).toBe(1);
    expect(e.getEllipseCenter()).toEqual([0, 0, 0]);
    expect(e.color).toBe(BLUE);
    expect(e.fillOpacity).toBe(0);
  });

  it('getSemiMajorAxis / getSemiMinorAxis', () => {
    const e = new Ellipse({ width: 6, height: 4 });
    expect(e.getSemiMajorAxis()).toBe(3);
    expect(e.getSemiMinorAxis()).toBe(2);
  });

  it('getArea returns PI * a * b', () => {
    const e = new Ellipse({ width: 4, height: 2 });
    expect(e.getArea()).toBeCloseTo(Math.PI * 2 * 1, 10);
  });

  it('getEccentricity is 0 for a circle', () => {
    const e = new Ellipse({ width: 2, height: 2 });
    expect(e.getEccentricity()).toBeCloseTo(0, 10);
  });

  it('getEccentricity is between 0 and 1 for non-circular', () => {
    const e = new Ellipse({ width: 4, height: 2 });
    const ecc = e.getEccentricity();
    expect(ecc).toBeGreaterThan(0);
    expect(ecc).toBeLessThan(1);
  });

  it('getEccentricity works when height > width', () => {
    const e = new Ellipse({ width: 2, height: 4 });
    const ecc = e.getEccentricity();
    expect(ecc).toBeGreaterThan(0);
    expect(ecc).toBeLessThan(1);
  });

  it('pointAtAngle returns correct positions', () => {
    const e = new Ellipse({ width: 4, height: 2 });
    const right = e.pointAtAngle(0);
    expect(right[0]).toBeCloseTo(2, 10);
    expect(right[1]).toBeCloseTo(0, 10);
    const top = e.pointAtAngle(Math.PI / 2);
    expect(top[0]).toBeCloseTo(0, 10);
    expect(top[1]).toBeCloseTo(1, 10);
  });

  it('pointAtAngle respects center offset', () => {
    const e = new Ellipse({ width: 2, height: 2, center: [3, 4, 0] });
    const pt = e.pointAtAngle(0);
    expect(pt[0]).toBeCloseTo(4, 10);
    expect(pt[1]).toBeCloseTo(4, 10);
  });

  it('setWidth / setHeight update dimensions', () => {
    const e = new Ellipse();
    e.setWidth(10);
    e.setHeight(6);
    expect(e.getWidth()).toBe(10);
    expect(e.getHeight()).toBe(6);
  });

  it('setEllipseCenter updates center', () => {
    const e = new Ellipse();
    e.setEllipseCenter([5, 5, 0]);
    expect(e.getEllipseCenter()).toEqual([5, 5, 0]);
  });

  it('generates Bezier points (4 segments = 13 points)', () => {
    const e = new Ellipse();
    expect(e.numPoints).toBe(13);
  });
});

// ---------------------------------------------------------------------------
// Annulus
// ---------------------------------------------------------------------------
describe('Annulus', () => {
  it('constructs with default options', () => {
    const a = new Annulus();
    expect(a.getInnerRadius()).toBe(0.5);
    expect(a.getOuterRadius()).toBe(1);
    expect(a.getAnnulusCenter()).toEqual([0, 0, 0]);
    expect(a.fillOpacity).toBe(0.5);
  });

  it('getArea = PI * (R^2 - r^2)', () => {
    const a = new Annulus({ innerRadius: 1, outerRadius: 3 });
    expect(a.getArea()).toBeCloseTo(Math.PI * (9 - 1), 10);
  });

  it('getThickness = outerRadius - innerRadius', () => {
    const a = new Annulus({ innerRadius: 0.5, outerRadius: 2 });
    expect(a.getThickness()).toBeCloseTo(1.5, 10);
  });

  it('setInnerRadius / setOuterRadius update radii', () => {
    const a = new Annulus();
    a.setInnerRadius(0.2);
    a.setOuterRadius(3);
    expect(a.getInnerRadius()).toBe(0.2);
    expect(a.getOuterRadius()).toBe(3);
  });

  it('setAnnulusCenter updates center', () => {
    const a = new Annulus();
    a.setAnnulusCenter([1, 2, 3]);
    expect(a.getAnnulusCenter()).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// AnnularSector
// ---------------------------------------------------------------------------
describe('AnnularSector', () => {
  it('constructs with default options', () => {
    const as = new AnnularSector();
    expect(as.getInnerRadius()).toBe(0.5);
    expect(as.getOuterRadius()).toBe(1);
    expect(as.getStartAngle()).toBe(0);
    expect(as.getAngle()).toBe(Math.PI / 2);
    // getSectorCenter() reports the construction center (annulus center), distinct
    // from the bbox getCenter() and the off-origin getCenterOfMass() centroid.
    expect(as.getSectorCenter()).toEqual([0, 0, 0]);
    expect(as.fillOpacity).toBe(0.5);
  });

  it('getArea = |angle|/2 * (R^2 - r^2)', () => {
    const as = new AnnularSector({
      innerRadius: 1,
      outerRadius: 3,
      angle: Math.PI,
    });
    const expected = (Math.PI / 2) * (9 - 1);
    expect(as.getArea()).toBeCloseTo(expected, 10);
  });

  it('setInnerRadius / setOuterRadius / setStartAngle / setAngle update', () => {
    const as = new AnnularSector();
    as.setInnerRadius(0.1);
    as.setOuterRadius(5);
    as.setStartAngle(Math.PI / 4);
    as.setAngle(Math.PI);
    expect(as.getInnerRadius()).toBe(0.1);
    expect(as.getOuterRadius()).toBe(5);
    expect(as.getStartAngle()).toBe(Math.PI / 4);
    expect(as.getAngle()).toBe(Math.PI);
  });

  it('generates non-empty points', () => {
    const as = new AnnularSector();
    expect(as.numPoints).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Sector
// ---------------------------------------------------------------------------
describe('Sector', () => {
  it('constructs with default options', () => {
    const s = new Sector();
    expect(s.getRadius()).toBe(1);
    expect(s.getStartAngle()).toBe(0);
    expect(s.getAngle()).toBe(Math.PI / 2);
    // getSectorCenter() reports the construction center (apex), distinct from the
    // bbox getCenter() and the off-origin getCenterOfMass() centroid.
    expect(s.getSectorCenter()).toEqual([0, 0, 0]);
    expect(s.fillOpacity).toBe(0.5);
  });

  it('getArea = |angle|/2 * r^2', () => {
    const s = new Sector({ radius: 2, angle: Math.PI });
    expect(s.getArea()).toBeCloseTo((Math.PI / 2) * 4, 10);
  });

  it('getArcLength = |r * angle|', () => {
    const s = new Sector({ radius: 3, angle: Math.PI / 2 });
    expect(s.getArcLength()).toBeCloseTo((3 * Math.PI) / 2, 10);
  });

  it('setRadius / setStartAngle / setAngle update', () => {
    const s = new Sector();
    s.setRadius(5);
    s.setStartAngle(Math.PI);
    s.setAngle(Math.PI / 4);
    expect(s.getRadius()).toBe(5);
    expect(s.getStartAngle()).toBe(Math.PI);
    expect(s.getAngle()).toBe(Math.PI / 4);
  });

  it('generates non-empty points', () => {
    const s = new Sector();
    expect(s.numPoints).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ArcPolygon
// ---------------------------------------------------------------------------
describe('ArcPolygon', () => {
  it('constructs with straight-line edges by default', () => {
    const ap = new ArcPolygon({
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0.5, 1, 0],
      ],
    });
    expect(ap.getVertices()).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0.5, 1, 0],
    ]);
  });

  it('stores arc configs', () => {
    const ap = new ArcPolygon({
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0.5, 1, 0],
      ],
      arcConfigs: [{ angle: Math.PI / 4 }],
    });
    const configs = ap.getArcConfigs();
    expect(configs[0].angle).toBe(Math.PI / 4);
    // Missing configs default to angle: 0
    expect(configs[1].angle).toBe(0);
    expect(configs[2].angle).toBe(0);
  });

  it('throws with fewer than 2 vertices', () => {
    expect(() => new ArcPolygon({ vertices: [[0, 0, 0]] })).toThrow();
  });

  it('generates non-empty points', () => {
    const ap = new ArcPolygon({
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0.5, 1, 0],
      ],
    });
    expect(ap.numPoints).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// CurvedArrow
// ---------------------------------------------------------------------------
describe('CurvedArrow', () => {
  it('constructs with default options', () => {
    const ca = new CurvedArrow();
    expect(ca.getStartPoint()).toEqual([-1, 0, 0]);
    expect(ca.getEndPoint()).toEqual([1, 0, 0]);
    expect(ca.getAngle()).toBe(Math.PI / 4);
    expect(ca.getTipLength()).toBe(0.25);
    expect(ca.getTipWidth()).toBe(0.15);
  });

  it('setStartPoint / setEndPoint / setAngle update', () => {
    const ca = new CurvedArrow();
    ca.setStartPoint([0, 0, 0]);
    ca.setEndPoint([3, 0, 0]);
    ca.setAngle(Math.PI / 3);
    expect(ca.getStartPoint()).toEqual([0, 0, 0]);
    expect(ca.getEndPoint()).toEqual([3, 0, 0]);
    expect(ca.getAngle()).toBe(Math.PI / 3);
  });

  it('generates non-empty points', () => {
    const ca = new CurvedArrow();
    expect(ca.numPoints).toBeGreaterThan(0);
  });

  it('renders an unfilled shaft and a separate filled tip', () => {
    const ca = new CurvedArrow({
      startPoint: [-2, 0, 0],
      endPoint: [2, 0, 0],
      angle: Math.PI / 2,
    });
    const tip = ca.children[0];

    expect(ca.fillOpacity).toBe(0);
    expect(ca.children).toHaveLength(1);
    expect(tip).toBeInstanceOf(ArrowTriangleFilledTip);
    expect(tip.fillOpacity).toBe(1);
    expect(tip.strokeWidth).toBe(0);
    expect(ca.getLocalPoints()[0]).toEqual([-2, 0, 0]);
    expect(tip.getLocalPoints()[3]).toEqual([2, 0, 0]);
    expect(ca.getLocalPoints().every(([x]) => x >= -2.001 && x <= 2.001)).toBe(true);

    // A fill mesh directly under the root would triangulate the open arc into
    // the large wedge this regression guards against. Only the tip subtree may
    // contain a fill mesh.
    const rootThree = ca.getThreeObject();
    expect(rootThree.children.some((child) => child.type === 'Mesh')).toBe(false);
    let tipMeshCount = 0;
    tip.getThreeObject().traverse((child) => {
      if (child.type === 'Mesh') tipMeshCount += 1;
    });
    expect(tipMeshCount).toBe(1);

    ca.setFillOpacity(0.4);
    expect(ca.fillOpacity).toBe(0);
    expect(tip.fillOpacity).toBeCloseTo(0.4);
  });

  it('supports Create without merging or losing shaft/tip geometry', () => {
    const ca = new CurvedArrow({
      startPoint: [-2, -0.5, 0],
      endPoint: [2, 0.5, 0],
      angle: -Math.PI / 2,
    });
    const originalShaft = ca.getLocalPoints();
    const originalTip = ca.children[0].getLocalPoints();
    const animation = new Create(ca, { lagRatio: 0, rateFunc: linear });

    animation.begin();
    animation.interpolate(0.35);
    expect(ca.fillOpacity).toBe(0);
    expect(ca.getLocalPoints()).not.toEqual(originalShaft);
    expect(ca.children[0].getLocalPoints()).not.toEqual(originalTip);

    animation.finish();
    expect(ca.getLocalPoints()).toEqual(originalShaft);
    expect(ca.children[0].getLocalPoints()).toEqual(originalTip);

    animation.reset();
    expect(ca.getLocalPoints()).toEqual(originalShaft);
    expect(ca.children[0].getLocalPoints()).toEqual(originalTip);
  });
});

// ---------------------------------------------------------------------------
// CurvedDoubleArrow
// ---------------------------------------------------------------------------
describe('CurvedDoubleArrow', () => {
  it('constructs with default options', () => {
    const cda = new CurvedDoubleArrow();
    expect(cda.getStartPoint()).toEqual([-1, 0, 0]);
    expect(cda.getEndPoint()).toEqual([1, 0, 0]);
    expect(cda.getAngle()).toBe(Math.PI / 4);
  });

  it('setStartPoint / setEndPoint / setAngle update', () => {
    const cda = new CurvedDoubleArrow();
    cda.setStartPoint([-2, 0, 0]);
    cda.setEndPoint([2, 0, 0]);
    cda.setAngle(Math.PI / 2);
    expect(cda.getStartPoint()).toEqual([-2, 0, 0]);
    expect(cda.getEndPoint()).toEqual([2, 0, 0]);
    expect(cda.getAngle()).toBe(Math.PI / 2);
  });

  it('generates non-empty points', () => {
    const cda = new CurvedDoubleArrow();
    expect(cda.numPoints).toBeGreaterThan(0);
  });

  it('keeps its open shaft separate from both filled tips', () => {
    const cda = new CurvedDoubleArrow({
      startPoint: [-2, 0, 0],
      endPoint: [2, 0, 0],
      angle: Math.PI / 2,
    });

    expect(cda.fillOpacity).toBe(0);
    expect(cda.children).toHaveLength(2);
    expect(cda.children.every((tip) => tip instanceof ArrowTriangleFilledTip)).toBe(true);
    expect(cda.children.every((tip) => tip.fillOpacity === 1 && tip.strokeWidth === 0)).toBe(true);
    expect(cda.children[0].getLocalPoints()[3]).toEqual([-2, 0, 0]);
    expect(cda.children[1].getLocalPoints()[3]).toEqual([2, 0, 0]);
    expect(cda.getLocalPoints().every(([x]) => x >= -2.001 && x <= 2.001)).toBe(true);

    const rootThree = cda.getThreeObject();
    expect(rootThree.children.some((child) => child.type === 'Mesh')).toBe(false);
    cda.setFillOpacity(0.25);
    expect(cda.fillOpacity).toBe(0);
    expect(cda.children.every((tip) => tip.fillOpacity === 0.25)).toBe(true);
  });

  it('supports Create across the shaft and both independent tips', () => {
    const cda = new CurvedDoubleArrow({
      startPoint: [-2, 0, 0],
      endPoint: [2, 0, 0],
      angle: -Math.PI / 2,
    });
    const originalShaft = cda.getLocalPoints();
    const originalTips = cda.children.map((tip) => tip.getLocalPoints());
    const animation = new Create(cda, { lagRatio: 0, rateFunc: linear });

    animation.begin();
    animation.interpolate(0.35);
    expect(cda.fillOpacity).toBe(0);
    expect(cda.getLocalPoints()).not.toEqual(originalShaft);
    expect(cda.children[0].getLocalPoints()).not.toEqual(originalTips[0]);
    expect(cda.children[1].getLocalPoints()).not.toEqual(originalTips[1]);

    animation.finish();
    expect(cda.getLocalPoints()).toEqual(originalShaft);
    expect(cda.children.map((tip) => tip.getLocalPoints())).toEqual(originalTips);
  });
});

// ---------------------------------------------------------------------------
// TangentialArc
// ---------------------------------------------------------------------------
describe('TangentialArc', () => {
  it('constructs with default options', () => {
    const ta = new TangentialArc();
    const dir = ta.getDirection();
    expect(dir[0]).toBeCloseTo(1, 10);
    expect(dir[1]).toBeCloseTo(0, 10);
    expect(dir[2]).toBeCloseTo(0, 10);
  });

  it('inherits from Arc', () => {
    const ta = new TangentialArc();
    expect(ta).toBeInstanceOf(Arc);
  });

  it('generates non-empty points', () => {
    const ta = new TangentialArc();
    expect(ta.numPoints).toBeGreaterThan(0);
  });
});
