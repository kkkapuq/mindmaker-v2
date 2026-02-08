import type { Landmarks } from "./EyeTracker";
import {
  LEFT_IRIS,
  RIGHT_IRIS,
  LEFT_EYE_INNER,
  LEFT_EYE_OUTER,
  RIGHT_EYE_INNER,
  RIGHT_EYE_OUTER,
  NOSE_TIP,
  SMOOTHING_ALPHA,
  MOVING_AVG_SIZE,
  MIN_MOVE_PX,
  CALIBRATION_OUTLIER_STD,
  RIDGE_LAMBDA,
} from "../config";

export interface GazeFeatures {
  rx: number;
  ry: number;
  hx: number; // 머리 회전 수평 (코 끝 - 얼굴 중심, 정규화)
  hy: number; // 머리 회전 수직
  nx: number; // 절대 얼굴 위치 X (카메라 정규화 좌표, 머리 이동 보상용)
  ny: number; // 절대 얼굴 위치 Y
}

export interface CalibrationSample extends GazeFeatures {
  screenX: number;
  screenY: number;
}

// --- Minimal linear algebra ---

/**
 * 확장 특징 벡터: [1, rx, ry, hx, hy, nx, ny, rx*ry, rx², ry²] (10개)
 *
 * nx, ny: 절대 얼굴 위치 → 머리 이동(translation) 보상
 * hx, hy: 얼굴 내 상대 코 위치 → 머리 회전(rotation) 보상
 * 이전 rx*hx, ry*hy 교차항을 nx, ny로 교체 (이동 보상이 더 중요)
 */
function polyFeatures(f: GazeFeatures): number[] {
  const { rx, ry, hx, hy, nx, ny } = f;
  return [1, rx, ry, hx, hy, nx, ny, rx * ry, rx * rx, ry * ry];
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

function solveLeastSquares(
  A: number[][],
  b: number[],
  lambda = 0
): number[] | null {
  const At = transpose(A);
  const AtA = matMul(At, A);
  // 릿지 회귀: 대각선에 λ 추가 → 과적합 방지 + 수치 안정성 향상
  if (lambda > 0) {
    for (let i = 0; i < AtA.length; i++) {
      AtA[i][i] += lambda;
    }
  }
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
  // 특징 정규화 파라미터 (캘리브레이션 시 저장)
  private featMean: number[] | null = null;
  private featStd: number[] | null = null;
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

  /**
   * 홍채 상대 위치 + 머리 위치를 포함한 특징 추출
   *
   * ry는 눈꼬리(inner/outer corner) 중점을 기준으로 계산.
   * 기존 눈꺼풀 상단/하단 기준은 위를 볼 때 눈꺼풀이 함께 올라가서
   * ry 변화가 거의 없었음 → 상단 추적 정확도 저하 원인.
   * 눈꼬리는 뼈 위의 고정점이라 시선 방향에 무관하게 안정적.
   */
  extractFeatures(landmarks: Landmarks): GazeFeatures {
    // Left eye iris relative position
    const lc = this.irisCenter(landmarks, LEFT_IRIS);
    const lInner = landmarks[LEFT_EYE_INNER];
    const lOuter = landmarks[LEFT_EYE_OUTER];
    const lW = Math.abs(lOuter.x - lInner.x);
    const lMidY = (lInner.y + lOuter.y) / 2; // 눈꼬리 중점 (안정적 기준선)
    const lRx = lW > 1e-6 ? (lc.x - lInner.x) / lW : 0.5;
    const lRy = lW > 1e-6 ? (lc.y - lMidY) / lW : 0; // 눈 너비로 정규화

    // Right eye iris relative position
    const rc = this.irisCenter(landmarks, RIGHT_IRIS);
    const rInner = landmarks[RIGHT_EYE_INNER];
    const rOuter = landmarks[RIGHT_EYE_OUTER];
    const rW = Math.abs(rOuter.x - rInner.x);
    const rMidY = (rInner.y + rOuter.y) / 2;
    const rRx = rW > 1e-6 ? (rc.x - rInner.x) / rW : 0.5;
    const rRy = rW > 1e-6 ? (rc.y - rMidY) / rW : 0;

    // 머리 회전: 코 끝 좌표를 눈 내측 꼬리 간 거리로 정규화
    // (기존 이마↔턱 거리는 입 벌림에 따라 불안정 → 눈 기반으로 변경)
    const nose = landmarks[NOSE_TIP];
    const eyeMidX = (lInner.x + rInner.x) / 2;
    const eyeMidY = (lInner.y + rInner.y) / 2;
    const interEyeDist = Math.hypot(rInner.x - lInner.x, rInner.y - lInner.y);

    const hx = interEyeDist > 1e-6 ? (nose.x - eyeMidX) / interEyeDist : 0;
    const hy = interEyeDist > 1e-6 ? (nose.y - eyeMidY) / interEyeDist : 0;

    return {
      rx: (lRx + rRx) / 2,
      ry: (lRy + rRy) / 2,
      hx,
      hy,
      nx: nose.x, // 절대 얼굴 위치 (카메라 정규화 좌표 0~1)
      ny: nose.y,
    };
  }

  /**
   * 특징 벡터를 정규화 (column 0 = intercept는 제외).
   * 릿지 회귀가 모든 특징에 균등하게 적용되려면 스케일 통일 필수.
   * (rx ≈ [0.2, 0.8] vs ry ≈ [-0.05, 0.05] 같은 차이가 있으면
   *  릿지가 작은 값의 계수를 과도하게 압축함)
   */
  private normalizeFeatures(rawA: number[][]): number[][] {
    const nCols = rawA[0].length;
    const n = rawA.length;
    const mean = Array(nCols).fill(0);
    const std = Array(nCols).fill(1);

    // column 0은 상수항(1)이므로 정규화하지 않음
    for (let j = 1; j < nCols; j++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += rawA[i][j];
      mean[j] = sum / n;
    }
    for (let j = 1; j < nCols; j++) {
      let sumSq = 0;
      for (let i = 0; i < n; i++) sumSq += (rawA[i][j] - mean[j]) ** 2;
      std[j] = Math.sqrt(sumSq / n);
      if (std[j] < 1e-9) std[j] = 1; // 상수 열 보호
    }

    this.featMean = mean;
    this.featStd = std;

    return rawA.map((row) =>
      row.map((v, j) => (j === 0 ? 1 : (v - mean[j]) / std[j]))
    );
  }

  private applyNormalization(feat: number[]): number[] {
    if (!this.featMean || !this.featStd) return feat;
    return feat.map((v, j) =>
      j === 0 ? 1 : (v - this.featMean![j]) / this.featStd![j]
    );
  }

  calibrate(samples: CalibrationSample[]): boolean {
    if (samples.length < 10) return false;

    const rawA = samples.map((s) => polyFeatures(s));
    const A = this.normalizeFeatures(rawA);
    const bx = samples.map((s) => s.screenX);
    const by = samples.map((s) => s.screenY);

    const cx = solveLeastSquares(A, bx, RIDGE_LAMBDA);
    const cy = solveLeastSquares(A, by, RIDGE_LAMBDA);
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
    const nxVals = removeOutliers(
      src.map((f) => f.nx),
      CALIBRATION_OUTLIER_STD
    );
    const nyVals = removeOutliers(
      src.map((f) => f.ny),
      CALIBRATION_OUTLIER_STD
    );

    return {
      rx: rxVals.reduce((a, b) => a + b, 0) / rxVals.length,
      ry: ryVals.reduce((a, b) => a + b, 0) / ryVals.length,
      hx: hxVals.reduce((a, b) => a + b, 0) / hxVals.length,
      hy: hyVals.reduce((a, b) => a + b, 0) / hyVals.length,
      nx: nxVals.reduce((a, b) => a + b, 0) / nxVals.length,
      ny: nyVals.reduce((a, b) => a + b, 0) / nyVals.length,
    };
  }

  predict(features: GazeFeatures): { x: number; y: number } {
    if (!this.coeffsX || !this.coeffsY) return { x: 0, y: 0 };

    const rawFeat = polyFeatures(features);
    const feat = this.applyNormalization(rawFeat);
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
    this.featMean = null;
    this.featStd = null;
    this.firstPrediction = true;
    this.smoothX = 0;
    this.smoothY = 0;
    this.outputX = 0;
    this.outputY = 0;
    this.bufX = [];
    this.bufY = [];
  }
}
