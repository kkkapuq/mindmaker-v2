import { useState, useEffect, useCallback, useRef } from "react";
import { FRAMES_PER_POINT, CALIBRATION_SETTLE_FRAMES, CALIBRATION_GRID_ROWS, CALIBRATION_GRID_COLS } from "../config";
import type { TrackerState } from "../tracking/useTracker";
import { GazeMapper, type CalibrationSample, type GazeFeatures } from "../tracking/GazeMapper";

interface Props {
  trackerState: TrackerState;
  onComplete: (samples: CalibrationSample[]) => void;
}

const MARGIN = 0.1; // 10% from edges

function generatePoints(): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const w = window.innerWidth;
  const h = window.innerHeight;
  const mx = w * MARGIN;
  const my = h * MARGIN;

  for (let r = 0; r < CALIBRATION_GRID_ROWS; r++) {
    for (let c = 0; c < CALIBRATION_GRID_COLS; c++) {
      points.push({
        x: mx + (c * (w - 2 * mx)) / (CALIBRATION_GRID_COLS - 1),
        y: my + (r * (h - 2 * my)) / (CALIBRATION_GRID_ROWS - 1),
      });
    }
  }
  return points;
}

export function CalibrationScreen({ trackerState, onComplete }: Props) {
  const [points] = useState(generatePoints);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [collecting, setCollecting] = useState(false);
  const frameBufferRef = useRef<GazeFeatures[]>([]);
  const samplesRef = useRef<CalibrationSample[]>([]);
  const doneRef = useRef(false);

  // Collect frames while in collecting mode
  useEffect(() => {
    // 눈 감은 프레임은 건너뜀 (홍채 랜드마크가 부정확하므로)
    if (!collecting || !trackerState.faceDetected || trackerState.eyesClosed) return;

    frameBufferRef.current.push({
      rx: trackerState.irisRx,
      ry: trackerState.irisRy,
      hx: trackerState.headX,
      hy: trackerState.headY,
    });

    if (frameBufferRef.current.length >= FRAMES_PER_POINT) {
      // Clean frames: drop settle period + remove outliers
      const cleaned = GazeMapper.cleanFrames(
        frameBufferRef.current,
        CALIBRATION_SETTLE_FRAMES
      );

      samplesRef.current.push({
        ...cleaned,
        screenX: points[currentIndex].x,
        screenY: points[currentIndex].y,
      });

      frameBufferRef.current = [];
      setCollecting(false);

      const nextIndex = currentIndex + 1;
      if (nextIndex >= points.length) {
        doneRef.current = true;
        onComplete(samplesRef.current);
      } else {
        setCurrentIndex(nextIndex);
      }
    }
  }, [collecting, trackerState, currentIndex, points, onComplete]);

  // Space key handler
  const handleSpace = useCallback(
    (e: KeyboardEvent) => {
      if (e.code !== "Space" || collecting || doneRef.current) return;
      e.preventDefault();
      frameBufferRef.current = [];
      setCollecting(true);
    },
    [collecting]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleSpace);
    return () => window.removeEventListener("keydown", handleSpace);
  }, [handleSpace]);

  if (doneRef.current) {
    return (
      <div className="calibration-screen">
        <p className="calibration-instruction">캘리브레이션 완료!</p>
      </div>
    );
  }

  const point = points[currentIndex];

  return (
    <div className="calibration-screen">
      {/* Calibration dot */}
      <div
        className={`calibration-dot ${collecting ? "collecting" : ""}`}
        style={{ left: point.x, top: point.y }}
      >
        <div className="calibration-dot-inner" />
      </div>

      {/* Instructions */}
      <p className="calibration-instruction">
        {collecting
          ? "수집 중... 환자는 점을 계속 바라봐 주세요"
          : "보호자: 환자가 점을 바라보면 Space를 누르세요"}
      </p>
      <p className="calibration-progress">
        포인트 {currentIndex + 1} / {points.length}
      </p>
    </div>
  );
}
