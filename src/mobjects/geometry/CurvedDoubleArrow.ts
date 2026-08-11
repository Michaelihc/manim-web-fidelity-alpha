import { VMobject } from '../../core/VMobject';
import { Vector3Tuple } from '../../core/Mobject';
import { BLUE, DEFAULT_STROKE_WIDTH } from '../../constants';
import { CurvedArrowOptions } from './CurvedArrow';
import { ArrowTriangleFilledTip } from './ArrowTips';

/**
 * CurvedDoubleArrow - A double arrow that follows an arc path
 *
 * Creates a double-headed arrow that curves from start to end point.
 *
 * @example
 * ```typescript
 * // Create a curved double arrow
 * const curvedDouble = new CurvedDoubleArrow({
 *   startPoint: [-2, 0, 0],
 *   endPoint: [2, 0, 0],
 *   angle: Math.PI / 3
 * });
 * ```
 */
export class CurvedDoubleArrow extends VMobject {
  private _startPoint: Vector3Tuple;
  private _endPoint: Vector3Tuple;
  private _angle: number;
  private _tipLength: number;
  private _tipWidth: number;
  private _numComponents: number;
  private _startTip: ArrowTriangleFilledTip | null = null;
  private _endTip: ArrowTriangleFilledTip | null = null;

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
    // The arc is an open stroke. Each closed, filled tip is rendered by its own
    // child VMobject so fill triangulation can never span the shaft.
    this.setFillOpacity(0);
    this.setStrokeWidth(strokeWidth);

    this._generatePoints();
  }

  /**
   * Generate the curved double arrow points.
   */
  private _generatePoints(): void {
    const previousStartFillOpacity = this._startTip?.fillOpacity ?? 1;
    const previousEndFillOpacity = this._endTip?.fillOpacity ?? 1;
    const oldTips = [this._startTip, this._endTip].filter(
      (tip): tip is ArrowTriangleFilledTip => tip !== null,
    );
    this.remove(...oldTips);
    this._startTip = null;
    this._endTip = null;

    const points: number[][] = [];

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
      this._generateStraightPoints(midZ, previousStartFillOpacity, previousEndFillOpacity);
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

    // Calculate shortened angles for both ends. Clamp each trim to half the
    // available arc so short arrows never produce a reversed shaft.
    const arcLength = Math.abs(radius * this._angle);
    const tipArcLength = Math.min(Math.max(0, this._tipLength), arcLength / 2);
    const shortenedAngleFromStart = directionSign * (tipArcLength / radius);
    const shortenedAngleFromEnd = -directionSign * (tipArcLength / radius);

    const actualStartAngle = startAngle + shortenedAngleFromStart;
    const actualEndAngle = startAngle + this._angle + shortenedAngleFromEnd;
    const actualArcAngle = actualEndAngle - actualStartAngle;

    const startTipBaseX = centerX + radius * Math.cos(actualStartAngle);
    const startTipBaseY = centerY + radius * Math.sin(actualStartAngle);

    // Arc shaft
    const numSegments = Math.max(
      1,
      Math.ceil((Math.abs(actualArcAngle) / (Math.PI / 2)) * (this._numComponents / 4)),
    );
    const segmentAngle = actualArcAngle / numSegments;
    const kappa = (4 / 3) * Math.tan(segmentAngle / 4);

    for (let i = 0; i < numSegments; i++) {
      const theta1 = actualStartAngle + i * segmentAngle;
      const theta2 = actualStartAngle + (i + 1) * segmentAngle;

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

      if (i === 0) points.push([x0, y0, midZ]);
      points.push([x1, y1, midZ]);
      points.push([x2, y2, midZ]);
      points.push([x3, y3, midZ]);
    }

    const endTipBaseX = centerX + radius * Math.cos(actualEndAngle);
    const endTipBaseY = centerY + radius * Math.sin(actualEndAngle);

    this.setPoints3D(points);

    this._startTip = this._createTip(
      [start[0], start[1], midZ],
      [startTipBaseX, startTipBaseY, midZ],
      previousStartFillOpacity,
    );
    this._endTip = this._createTip(
      [end[0], end[1], midZ],
      [endTipBaseX, endTipBaseY, midZ],
      previousEndFillOpacity,
    );
    this._addGeneratedTips();
  }

  private _generateStraightPoints(
    midZ: number,
    startFillOpacity: number,
    endFillOpacity: number,
  ): void {
    const start = this._startPoint;
    const end = this._endPoint;
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.sqrt(dx * dx + dy * dy);
    const dirX = dx / length;
    const dirY = dy / length;
    const trim = Math.min(Math.max(0, this._tipLength), length / 2);
    const shaftStart: Vector3Tuple = [start[0] + dirX * trim, start[1] + dirY * trim, midZ];
    const shaftEnd: Vector3Tuple = [end[0] - dirX * trim, end[1] - dirY * trim, midZ];

    this.setPoints3D([
      shaftStart,
      [
        shaftStart[0] + (shaftEnd[0] - shaftStart[0]) / 3,
        shaftStart[1] + (shaftEnd[1] - shaftStart[1]) / 3,
        midZ,
      ],
      [
        shaftStart[0] + (2 * (shaftEnd[0] - shaftStart[0])) / 3,
        shaftStart[1] + (2 * (shaftEnd[1] - shaftStart[1])) / 3,
        midZ,
      ],
      shaftEnd,
    ]);

    this._startTip = this._createTip([start[0], start[1], midZ], shaftStart, startFillOpacity);
    this._endTip = this._createTip([end[0], end[1], midZ], shaftEnd, endFillOpacity);
    this._addGeneratedTips();
  }

  private _addGeneratedTips(): void {
    if (this._startTip) this.add(this._startTip);
    if (this._endTip) this.add(this._endTip);
  }

  private _createTip(
    apex: Vector3Tuple,
    base: Vector3Tuple,
    fillOpacity: number,
  ): ArrowTriangleFilledTip | null {
    const dx = apex[0] - base[0];
    const dy = apex[1] - base[1];
    const dz = apex[2] - base[2];
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 1e-10 || this._tipWidth <= 0) return null;

    return new ArrowTriangleFilledTip({
      position: apex,
      direction: [dx, dy, dz],
      length,
      width: this._tipWidth,
      color: this.color,
      strokeWidth: 0,
      fillOpacity,
    });
  }

  override setColor(color: string): this {
    super.setColor(color);
    this._startTip?.setColor(color);
    this._endTip?.setColor(color);
    return this;
  }

  override setFillOpacity(opacity: number): this {
    super.setFillOpacity(0);
    this._startTip?.setFillOpacity(opacity);
    this._endTip?.setFillOpacity(opacity);
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
   * Create a copy of this CurvedDoubleArrow
   */
  override copy(): CurvedDoubleArrow {
    const clone = new CurvedDoubleArrow({
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
    if (this._startTip && clone._startTip) {
      clone._startTip.setFillOpacity(this._startTip.fillOpacity);
    }
    if (this._endTip && clone._endTip) {
      clone._endTip.setFillOpacity(this._endTip.fillOpacity);
    }
    return clone;
  }
}
