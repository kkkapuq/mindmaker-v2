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
  NOSE_TIP,
  FOREHEAD,
  CHIN,
  SMOOTHING_ALPHA,
  MOVING_AVG_SIZE,
  MIN_MOVE_PX,
  CALIBRATION_OUTLIER_STD,
} from "../config";

export interface GazeFeatures {
  rx: number;
  ry: number;
  hx: number; // 머리 수평 위치 (코 끝 기준)
  hy: number; // 머리 수직 위치 (코 끝 기준)
}

export interface CalibrationSample extends GazeFeatures {
  screenX: number;
  screenY: number;
}

// --- Minimal linear algebra ---

/** 확장 특징 벡터: [1, rx, ry, hx, hy, rx*ry, rx*hx, ry*hy, rx², ry²] (10개) */
function polyFeatures(f: GazeFeatures): number[] {
  const { rx, ry, hx, hy } = f;
  return [1, rx, ry, hx, hy, rx * ry, rx * hx, ry * hy, rx * rx, ry * ry];
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

function solveLeastSquares(A: number[][], b: number[]): number[] | null {
  const At = transpose(A);
  const AtA = matMul(At, A);
  const Atb = matVecMul(At, b);
  return gaussianSolve(AtA, Atb);
}

// --- Outlier rejection ---

function removeOutliers(values: number[], stdMultiplier: number): number[] {
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

  /** 홍채 상대 위치 + 머리 위치를 포함한 특징 추출 */
  extractFeatures(landmarks: Landmarks): GazeFeatures {
    // Left eye iris relative position
    const lc = this.irisCenter(landmarks, LEFT_IRIS);
    const lInnerX = landmarks[LEFT_EYE_INNER].x;
    const lOuterX = landmarks[LEFT_EYE_OUTER].x;
    const lTopY = landmarks[LEFT_EYE_TOP].y;
    const lBotY = landmarks[LEFT_EYE_BOTTOM].y;
    const lW = Math.abs(lOuterX - lInnerX);
    const lH = Math.abs(lBotY - lTopY);
    const lRx = lW > 1e-6 ? (lc.x - lInnerX) / lW : 0.5;
    const lRy = lH > 1e-6 ? (lc.y - lTopY) / lH : 0.5;

    // Right eye iris relative position
    const rc = this.irisCenter(landmarks, RIGHT_IRIS);
    const rInnerX = landmarks[RIGHT_EYE_INNER].x;
    const rOuterX = landmarks[RIGHT_EYE_OUTER].x;
    const rTopY = landmarks[RIGHT_EYE_TOP].y;
    const rBotY = landmarks[RIGHT_EYE_BOTTOM].y;
    const rW = Math.abs(rOuterX - rInnerX);
    const rH = Math.abs(rBotY - rTopY);
    const rRx = rW > 1e-6 ? (rc.x - rInnerX) / rW : 0.5;
    const rRy = rH > 1e-6 ? (rc.y - rTopY) / rH : 0.5;

    // 머리 위치: 코 끝 좌표를 이마↔턱 거리로 정규화
    const nose = landmarks[NOSE_TIP];
    const forehead = landmarks[FOREHEAD];
    const chin = landmarks[CHIN];
    const faceH = Math.abs(chin.y - forehead.y);
    const faceCenterX = (forehead.x + chin.x) / 2;
    const faceCenterY = (forehead.y + chin.y) / 2;

    const hx = faceH > 1e-6 ? (nose.x - faceCenterX) / faceH : 0;
    const hy = faceH > 1e-6 ? (nose.y - faceCenterY) / faceH : 0;

    return {
      rx: (lRx + rRx) / 2,
      ry: (lRy + rRy) / 2,
      hx,
      hy,
    };
  }

  calibrate(samples: CalibrationSample[]): boolean {
    if (samples.length < 10) return false; // 10개 계수에 최소 10개 샘플 필요

    const A = samples.map((s) => polyFeatures(s));
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

  /** 캘리브레이션 프레임 정제: settle 기간 제거 + 이상치 제거 */
  static cleanFrames(
    frames: GazeFeatures[],
    settleFrames: number
  ): GazeFeatures {
    const settled = frames.slice(settleFrames);
    const src = settled.length > 0 ? settled : frames;

    const rxVals = removeOutliers(
      src.map((f) => f.rx),
      CALIBRATION_OUTLIER_STD
    );
    const ryVals = removeOutliers(
      src.map((f) => f.ry),
      CALIBRATION_OUTLIER_STD
    );
    const hxVals = removeOutliers(
      src.map((f) => f.hx),
      CALIBRATION_OUTLIER_STD
    );
    const hyVals = removeOutliers(
      src.map((f) => f.hy),
      CALIBRATION_OUTLIER_STD
    );

    return {
      rx: rxVals.reduce((a, b) => a + b, 0) / rxVals.length,
      ry: ryVals.reduce((a, b) => a + b, 0) / ryVals.length,
      hx: hxVals.reduce((a, b) => a + b, 0) / hxVals.length,
      hy: hyVals.reduce((a, b) => a + b, 0) / hyVals.length,
    };
  }

  predict(features: GazeFeatures): { x: number; y: number } {
    if (!this.coeffsX || !this.coeffsY) return { x: 0, y: 0 };

    const feat = polyFeatures(features);
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

    // Stage 3: Minimum movement threshold
    const dx = avgX - this.outputX;
    const dy = avgY - this.outputY;
    if (Math.hypot(dx, dy) > MIN_MOVE_PX) {
      this.outputX = avgX;
      this.outputY = avgY;
    }

    // Stage 4: Clamp to screen
    return {
      x: Math.max(0, Math.min(window.innerWidth, this.outputX)),
      y: Math.max(0, Math.min(window.innerHeight, this.outputY)),
    };
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
