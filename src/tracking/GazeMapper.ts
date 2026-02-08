import type { Landmarks } from "./EyeTracker";
import {
  LEFT_IRIS,
  RIGHT_IRIS,
  LEFT_EYE_INNER,
  LEFT_EYE_OUTER,
  RIGHT_EYE_INNER,
  RIGHT_EYE_OUTER,
  LEFT_EYE_TOP,
  LEFT_EYE_BOTTOM,
  RIGHT_EYE_TOP,
  RIGHT_EYE_BOTTOM,
  SMOOTHING_ALPHA,
  MOVING_AVG_SIZE,
  MIN_MOVE_PX,
  CALIBRATION_OUTLIER_STD,
} from "../config";

export interface CalibrationSample {
  rx: number;
  ry: number;
  screenX: number;
  screenY: number;
}

// --- Minimal linear algebra for 6-coefficient least squares ---

function polyFeatures(rx: number, ry: number): number[] {
  return [1, rx, ry, rx * ry, rx * rx, ry * ry];
}

function transpose(A: number[][]): number[][] {
  const rows = A.length;
  const cols = A[0].length;
  const result: number[][] = Array.from({ length: cols }, () =>
    Array(rows).fill(0)
  );
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      result[j][i] = A[i][j];
    }
  }
  return result;
}

function matMul(A: number[][], B: number[][]): number[][] {
  const m = A.length;
  const n = B[0].length;
  const p = B.length;
  const result: number[][] = Array.from({ length: m }, () =>
    Array(n).fill(0)
  );
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < p; k++) {
        result[i][j] += A[i][k] * B[k][j];
      }
    }
  }
  return result;
}

function matVecMul(A: number[][], v: number[]): number[] {
  return A.map((row) => row.reduce((sum, a, j) => sum + a * v[j], 0));
}

function gaussianSolve(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const aug = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
        maxRow = row;
      }
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    if (Math.abs(aug[col][col]) < 1e-12) return null;

    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Back substitution
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n];
    for (let j = i + 1; j < n; j++) {
      x[i] -= aug[i][j] * x[j];
    }
    x[i] /= aug[i][i];
  }
  return x;
}

function solveLeastSquares(
  A: number[][],
  b: number[]
): number[] | null {
  const At = transpose(A);
  const AtA = matMul(At, A);
  const Atb = matVecMul(At, b);
  return gaussianSolve(AtA, Atb);
}

// --- GazeMapper ---

// --- Outlier rejection for calibration ---

function removeOutliers(
  values: number[],
  stdMultiplier: number
): number[] {
  if (values.length < 3) return values;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const std = Math.sqrt(
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  );
  if (std < 1e-9) return values;
  return values.filter((v) => Math.abs(v - mean) <= stdMultiplier * std);
}

// --- GazeMapper ---

export class GazeMapper {
  private coeffsX: number[] | null = null;
  private coeffsY: number[] | null = null;
  private smoothX = 0;
  private smoothY = 0;
  private outputX = 0;
  private outputY = 0;
  private firstPrediction = true;

  // Moving average buffer
  private bufX: number[] = [];
  private bufY: number[] = [];

  get isCalibrated(): boolean {
    return this.coeffsX !== null;
  }

  private irisCenter(
    landmarks: Landmarks,
    indices: number[]
  ): { x: number; y: number } {
    let sx = 0,
      sy = 0;
    for (const i of indices) {
      sx += landmarks[i].x;
      sy += landmarks[i].y;
    }
    return { x: sx / indices.length, y: sy / indices.length };
  }

  extractFeatures(landmarks: Landmarks): { rx: number; ry: number } {
    // Left eye
    const lc = this.irisCenter(landmarks, LEFT_IRIS);
    const lInnerX = landmarks[LEFT_EYE_INNER].x;
    const lOuterX = landmarks[LEFT_EYE_OUTER].x;
    const lTopY = landmarks[LEFT_EYE_TOP].y;
    const lBotY = landmarks[LEFT_EYE_BOTTOM].y;
    const lW = Math.abs(lOuterX - lInnerX);
    const lH = Math.abs(lBotY - lTopY);
    const lRx = lW > 1e-6 ? (lc.x - lInnerX) / lW : 0.5;
    const lRy = lH > 1e-6 ? (lc.y - lTopY) / lH : 0.5;

    // Right eye
    const rc = this.irisCenter(landmarks, RIGHT_IRIS);
    const rInnerX = landmarks[RIGHT_EYE_INNER].x;
    const rOuterX = landmarks[RIGHT_EYE_OUTER].x;
    const rTopY = landmarks[RIGHT_EYE_TOP].y;
    const rBotY = landmarks[RIGHT_EYE_BOTTOM].y;
    const rW = Math.abs(rOuterX - rInnerX);
    const rH = Math.abs(rBotY - rTopY);
    const rRx = rW > 1e-6 ? (rc.x - rInnerX) / rW : 0.5;
    const rRy = rH > 1e-6 ? (rc.y - rTopY) / rH : 0.5;

    return { rx: (lRx + rRx) / 2, ry: (lRy + rRy) / 2 };
  }

  calibrate(samples: CalibrationSample[]): boolean {
    if (samples.length < 6) return false;

    const A = samples.map((s) => polyFeatures(s.rx, s.ry));
    const bx = samples.map((s) => s.screenX);
    const by = samples.map((s) => s.screenY);

    const cx = solveLeastSquares(A, bx);
    const cy = solveLeastSquares(A, by);
    if (!cx || !cy) return false;

    this.coeffsX = cx;
    this.coeffsY = cy;
    this.firstPrediction = true;
    this.bufX = [];
    this.bufY = [];
    return true;
  }

  /** Clean calibration frames: drop settle period + remove outliers */
  static cleanFrames(
    frames: { rx: number; ry: number }[],
    settleFrames: number
  ): { rx: number; ry: number } {
    // Drop initial settle frames
    const settled = frames.slice(settleFrames);
    if (settled.length === 0) {
      // Fallback: use all frames
      const allRx = frames.map((f) => f.rx);
      const allRy = frames.map((f) => f.ry);
      return {
        rx: allRx.reduce((a, b) => a + b, 0) / allRx.length,
        ry: allRy.reduce((a, b) => a + b, 0) / allRy.length,
      };
    }

    // Remove outliers
    const rxVals = removeOutliers(
      settled.map((f) => f.rx),
      CALIBRATION_OUTLIER_STD
    );
    const ryVals = removeOutliers(
      settled.map((f) => f.ry),
      CALIBRATION_OUTLIER_STD
    );

    return {
      rx: rxVals.reduce((a, b) => a + b, 0) / rxVals.length,
      ry: ryVals.reduce((a, b) => a + b, 0) / ryVals.length,
    };
  }

  predict(rx: number, ry: number): { x: number; y: number } {
    if (!this.coeffsX || !this.coeffsY) return { x: 0, y: 0 };

    const feat = polyFeatures(rx, ry);
    const rawX = feat.reduce((s, f, i) => s + f * this.coeffsX![i], 0);
    const rawY = feat.reduce((s, f, i) => s + f * this.coeffsY![i], 0);

    // Stage 1: Exponential moving average
    if (this.firstPrediction) {
      this.smoothX = rawX;
      this.smoothY = rawY;
      this.outputX = rawX;
      this.outputY = rawY;
      this.firstPrediction = false;
    } else {
      this.smoothX =
        SMOOTHING_ALPHA * rawX + (1 - SMOOTHING_ALPHA) * this.smoothX;
      this.smoothY =
        SMOOTHING_ALPHA * rawY + (1 - SMOOTHING_ALPHA) * this.smoothY;
    }

    // Stage 2: Moving average buffer
    this.bufX.push(this.smoothX);
    this.bufY.push(this.smoothY);
    if (this.bufX.length > MOVING_AVG_SIZE) this.bufX.shift();
    if (this.bufY.length > MOVING_AVG_SIZE) this.bufY.shift();

    const avgX = this.bufX.reduce((a, b) => a + b, 0) / this.bufX.length;
    const avgY = this.bufY.reduce((a, b) => a + b, 0) / this.bufY.length;

    // Stage 3: Minimum movement threshold (dead zone)
    const dx = avgX - this.outputX;
    const dy = avgY - this.outputY;
    const dist = Math.hypot(dx, dy);

    if (dist > MIN_MOVE_PX) {
      this.outputX = avgX;
      this.outputY = avgY;
    }

    // Stage 4: Clamp to screen bounds
    const clampedX = Math.max(0, Math.min(window.innerWidth, this.outputX));
    const clampedY = Math.max(0, Math.min(window.innerHeight, this.outputY));

    return { x: clampedX, y: clampedY };
  }

  reset(): void {
    this.coeffsX = null;
    this.coeffsY = null;
    this.firstPrediction = true;
    this.smoothX = 0;
    this.smoothY = 0;
    this.outputX = 0;
    this.outputY = 0;
    this.bufX = [];
    this.bufY = [];
  }
}
