import { VMobject } from '../../core/VMobject';
import { Vector3Tuple } from '../../core/Mobject';
import { BLUE, DEFAULT_STROKE_WIDTH } from '../../constants';
import { ArrowTriangleFilledTip } from './ArrowTips';

/**
 * Options for creating a CurvedArrow
 */
export interface CurvedArrowOptions {
  /** Start point of the arrow. Default: [-1, 0, 0] */
  startPoint?: Vector3Tuple;
  /** End point of the arrow. Default: [1, 0, 0] */
  endPoint?: Vector3Tuple;
  /** Arc angle in radians. Default: PI/4 */
  angle?: number;
  /** Stroke color as CSS color string. Default: Manim's blue (#58C4DD) */
  color?: string;
  /** Stroke width in pixels. Default: 4 (Manim's default) */
  strokeWidth?: number;
  /** Length of the arrowhead tip. Default: 0.25 */
  tipLength?: number;
  /** Width of the arrowhead base. Default: 0.15 */
  tipWidth?: number;
  /** Number of Bezier segments for approximation. Default: 8 */
  numComponents?: number;
}

/**
 * CurvedArrow - An arrow that follows an arc path
 *
 * Creates an arrow that curves from start to end point.
 *
 * @example
 * ```typescript
 * // Create a curved arrow
 * const curvedArrow = new CurvedArrow({
 *   startPoint: [-2, 0, 0],
 *   endPoint: [2, 0, 0],
 *   angle: Math.PI / 3
 * });
 *
 * // Create an arrow curving the other way
 * const otherWay = new CurvedArrow({
 *   startPoint: [0, -1, 0],
 *   endPoint: [0, 1, 0],
 *   angle: -Math.PI / 4
 * });
 * ```
 */
export class CurvedArrow extends VMobject {
  private _startPoint: Vector3Tuple;
  private _endPoint: Vector3Tuple;
  private _angle: number;
  private _tipLength: number;
  private _tipWidth: number;
  private _numComponents: number;
  private _tip: ArrowTriangleFilledTip | null = null;

  constructor(options: CurvedArrowOptions = {}) {
    super();

    const {
      startPoint = [-1, 0, 0],
      endPoint = [1, 0, 0],
      angle = Math.PI / 4,
      color = BLUE,
      strokeWidth = DEFAULT_STROKE_WIDTH,
      tipLength = 0.25,
      tipWidth = 0.15,
      numComponents = 8,
    } = options;

    this._startPoint = [...startPoint];
    this._endPoint = [...endPoint];
    this._angle = angle;
    this._tipLength = tipLength;
    this._tipWidth = tipWidth;
    this._numComponents = numComponents;

    this.color = color;
    // The shaft is an open curve. Keeping it unfilled is essential: combining
    // it with the filled tip in one path makes the fill triangulator close the
    // entire arc with a chord, producing a giant wedge.
    this.setFillOpacity(0);
    this.setStrokeWidth(strokeWidth);

    this._generatePoints();
  }

  /**
   * Generate the curved arrow points.
   */
  private _generatePoints(): void {
    const previousTipFillOpacity = this._tip?.fillOpacity ?? 1;
    if (this._tip) {
      this.remove(this._tip);
      this._tip = null;
    }

    const points: number[][] = [];

    // Calculate arc parameters
    const start = this._startPoint;
    const end = this._endPoint;
    const midX = (start[0] + end[0]) / 2;
    const midY = (start[1] + end[1]) / 2;
    const midZ = (start[2] + end[2]) / 2;

    const chordX = end[0] - start[0];
    const chordY = end[1] - start[1];
    const halfChord = Math.sqrt(chordX * chordX + chordY * chordY) / 2;

    if (halfChord < 1e-10) {
      this.setPoints([]);
      return;
    }

    const halfAngle = Math.abs(this._angle) / 2;
    if (halfAngle < 1e-10) {
      this._generateStraightPoints(midZ, previousTipFillOpacity);
      return;
    }

    const radius = halfChord / Math.sin(halfAngle);
    const distToCenter = radius * Math.cos(halfAngle);

    const chordLength = 2 * halfChord;
    const directionSign = Math.sign(this._angle) || 1;
    const perpX = (-chordY / chordLength) * directionSign;
    const perpY = (chordX / chordLength) * directionSign;

    const centerX = midX + distToCenter * perpX;
    const centerY = midY + distToCenter * perpY;
    const startAngle = Math.atan2(start[1] - centerY, start[0] - centerX);

    // Calculate where to end the arc (before the tip)
    // We need to find the point on the arc that is tipLength away from the end
    const arcLength = Math.abs(radius * this._angle);
    const shortenedArcLength = Math.max(0, arcLength - Math.max(0, this._tipLength));
    const shortenedAngle = directionSign * (shortenedArcLength / radius);

    // Generate arc points for the shaft
    const numSegments = Math.max(
      1,
      Math.ceil((Math.abs(shortenedAngle) / (Math.PI / 2)) * (this._numComponents / 4)),
    );
    const segmentAngle = shortenedAngle / numSegments;
    const kappa = (4 / 3) * Math.tan(segmentAngle / 4);

    for (let i = 0; i < numSegments; i++) {
      const theta1 = startAngle + i * segmentAngle;
      const theta2 = startAngle + (i + 1) * segmentAngle;

      const x0 = centerX + radius * Math.cos(theta1);
      const y0 = centerY + radius * Math.sin(theta1);
      const x3 = centerX + radius * Math.cos(theta2);
      const y3 = centerY + radius * Math.sin(theta2);

      const dx1 = -Math.sin(theta1);
      const dy1 = Math.cos(theta1);
      const x1 = x0 + kappa * radius * dx1;
      const y1 = y0 + kappa * radius * dy1;

      const dx2 = -Math.sin(theta2);
      const dy2 = Math.cos(theta2);
      const x2 = x3 - kappa * radius * dx2;
      const y2 = y3 - kappa * radius * dy2;

      if (i === 0) {
        points.push([x0, y0, midZ]);
      }
      points.push([x1, y1, midZ]);
      points.push([x2, y2, midZ]);
      points.push([x3, y3, midZ]);
    }

    // Calculate tip base position (where the shaft ends)
    const tipBaseAngle = startAngle + shortenedAngle;
    const tipBaseX = centerX + radius * Math.cos(tipBaseAngle);
    const tipBaseY = centerY + radius * Math.sin(tipBaseAngle);

    this.setPoints3D(points);
    this._addTip([end[0], end[1], midZ], [tipBaseX, tipBaseY, midZ], previousTipFillOpacity);
  }

  /**
   * Degenerate zero-angle case: render a straight, tip-trimmed shaft instead
   * of letting the circle construction divide by sin(0).
   */
  private _generateStraightPoints(midZ: number, tipFillOpacity: number): void {
    const start = this._startPoint;
    const end = this._endPoint;
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.sqrt(dx * dx + dy * dy);
    const dirX = dx / length;
    const dirY = dy / length;
    const tipLength = Math.min(Math.max(0, this._tipLength), length);
    const base: Vector3Tuple = [end[0] - dirX * tipLength, end[1] - dirY * tipLength, midZ];
    const shaftStart: Vector3Tuple = [start[0], start[1], midZ];

    this.setPoints3D([
      shaftStart,
      [
        shaftStart[0] + (base[0] - shaftStart[0]) / 3,
        shaftStart[1] + (base[1] - shaftStart[1]) / 3,
        midZ,
      ],
      [
        shaftStart[0] + (2 * (base[0] - shaftStart[0])) / 3,
        shaftStart[1] + (2 * (base[1] - shaftStart[1])) / 3,
        midZ,
      ],
      base,
    ]);
    this._addTip([end[0], end[1], midZ], base, tipFillOpacity);
  }

  /**
   * Add the filled arrowhead as an independent VMobject. Its base is anchored
   * to the shaft endpoint.
   */
  private _addTip(apex: Vector3Tuple, base: Vector3Tuple, fillOpacity: number): void {
    const dx = apex[0] - base[0];
    const dy = apex[1] - base[1];
    const dz = apex[2] - base[2];
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 1e-10 || this._tipWidth <= 0) return;

    this._tip = new ArrowTriangleFilledTip({
      position: apex,
      direction: [dx, dy, dz],
      length,
      width: this._tipWidth,
      color: this.color,
      strokeWidth: 0,
      fillOpacity,
    });
    this.add(this._tip);
  }

  /**
   * A CurvedArrow is now a compound VMobject. Preserve the single-object color
   * behavior by recoloring the independently rendered tip as well.
   */
  override setColor(color: string): this {
    super.setColor(color);
    this._tip?.setColor(color);
    return this;
  }

  /**
   * Fill applies only to the closed arrowhead. The open shaft must remain
   * unfilled even when generic opacity/style helpers target the whole arrow.
   */
  override setFillOpacity(opacity: number): this {
    super.setFillOpacity(0);
    this._tip?.setFillOpacity(opacity);
    return this;
  }

  /**
   * Get the start point
   */
  getStartPoint(): Vector3Tuple {
    return [...this._startPoint];
  }

  /**
   * Set the start point
   */
  setStartPoint(point: Vector3Tuple): this {
    this._startPoint = [...point];
    this._generatePoints();
    return this;
  }

  /**
   * Get the end point
   */
  getEndPoint(): Vector3Tuple {
    return [...this._endPoint];
  }

  /**
   * Set the end point
   */
  setEndPoint(point: Vector3Tuple): this {
    this._endPoint = [...point];
    this._generatePoints();
    return this;
  }

  /**
   * Get the arc angle
   */
  getAngle(): number {
    return this._angle;
  }

  /**
   * Set the arc angle
   */
  setAngle(value: number): this {
    this._angle = value;
    this._generatePoints();
    return this;
  }

  /**
   * Get the tip length
   */
  getTipLength(): number {
    return this._tipLength;
  }

  /**
   * Get the tip width
   */
  getTipWidth(): number {
    return this._tipWidth;
  }

  /**
   * Create a copy of this CurvedArrow
   */
  override copy(): CurvedArrow {
    const clone = new CurvedArrow({
      startPoint: this._startPoint,
      endPoint: this._endPoint,
      angle: this._angle,
      tipLength: this._tipLength,
      tipWidth: this._tipWidth,
      numComponents: this._numComponents,
      color: this.color,
      strokeWidth: this.strokeWidth,
    });
    this._copyBaseAttributesInto(clone, { copyChildren: false, copyPosition: false });
    if (this._tip && clone._tip) clone._tip.setFillOpacity(this._tip.fillOpacity);
    return clone;
  }
}
