import { useRef, useState, useEffect, useCallback } from "react";
import { EyeTracker } from "./EyeTracker";
import { BlinkDetector } from "./BlinkDetector";
import { GazeMapper, type CalibrationSample } from "./GazeMapper";
import {
  GAZE_FREEZE_EAR,
  GAZE_RECOVERY_FRAMES,
  EYE_CLOSE_SELECT_SEC,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
} from "../config";

import type { GazeFeatures } from "./GazeMapper";

export interface TrackerState {
  isLoading: boolean;
  error: string | null;
  faceDetected: boolean;
  ear: number;
  blinkCount: number;
  doubleBlink: boolean;
  irisRx: number;
  irisRy: number;
  headX: number;
  headY: number;
  noseX: number;
  noseY: number;
  eyeLidOpen: number; // 눈꺼풀 열림 높이 (ey)
  gazeX: number;
  gazeY: number;
  gazeValid: boolean;
  fps: number;
  eyesClosed: boolean; // 눈 감고 있는지
  eyeClosedSec: number; // 눈 감은 지속 시간(초)
  eyeCloseSelect: boolean; // 2초 이상 감아서 선택 트리거
}

const INITIAL_STATE: TrackerState = {
  isLoading: true,
  error: null,
  faceDetected: false,
  ear: 0,
  blinkCount: 0,
  doubleBlink: false,
  irisRx: 0,
  irisRy: 0,
  headX: 0,
  headY: 0,
  noseX: 0,
  noseY: 0,
  eyeLidOpen: 0,
  gazeX: 0,
  gazeY: 0,
  gazeValid: false,
  fps: 0,
  eyesClosed: false,
  eyeClosedSec: 0,
  eyeCloseSelect: false,
};

export function useTracker() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<TrackerState>(INITIAL_STATE);

  const eyeTrackerRef = useRef<EyeTracker>(new EyeTracker());
  const blinkDetectorRef = useRef<BlinkDetector>(new BlinkDetector());
  const gazeMapperRef = useRef<GazeMapper>(new GazeMapper());
  const runningRef = useRef(false);
  const prevTimeRef = useRef(0);
  const fpsRef = useRef(0);
  const lastGazeRef = useRef({ x: 0, y: 0 });

  // Gaze freeze state
  const recoveryCountRef = useRef(0); // 눈 뜬 후 남은 안정화 프레임
  const wasFrozenRef = useRef(false); // 직전 프레임이 freeze 상태였는지

  // 눈 감은 시간 추적
  const eyeClosedStartRef = useRef(0); // 눈 감기 시작한 timestamp (0 = 안 감음)
  const eyeCloseSelectFiredRef = useRef(false); // 이미 선택 발동했는지

  // Zoom state
  const zoomLevelRef = useRef(1.0);
  const [zoomLevel, setZoomLevelState] = useState(1.0);
  const zoomCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const zoomCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: "user" },
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        // 줌용 오프스크린 캔버스 초기화
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        zoomCanvasRef.current = canvas;
        zoomCtxRef.current = canvas.getContext("2d");

        await eyeTrackerRef.current.init();
        if (cancelled) return;

        setState((s) => ({ ...s, isLoading: false }));
        runningRef.current = true;
        prevTimeRef.current = performance.now();
        requestAnimationFrame(processFrame);
      } catch (err) {
        if (!cancelled) {
          const msg =
            err instanceof Error ? err.message : "카메라를 열 수 없습니다";
          setState((s) => ({ ...s, isLoading: false, error: msg }));
        }
      }
    }

    function processFrame() {
      if (!runningRef.current) return;

      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        requestAnimationFrame(processFrame);
        return;
      }

      const now = performance.now();
      const dt = now - prevTimeRef.current;
      if (dt > 0) {
        fpsRef.current = 0.9 * fpsRef.current + 0.1 * (1000 / dt);
      }
      prevTimeRef.current = now;

      // --- 줌 처리: 중앙 크롭 → 캔버스 스케일 ---
      const zoom = zoomLevelRef.current;
      let input: HTMLVideoElement | HTMLCanvasElement = video;

      if (zoom > 1 && zoomCanvasRef.current && zoomCtxRef.current) {
        const canvas = zoomCanvasRef.current;
        const ctx = zoomCtxRef.current;
        const vw = video.videoWidth;
        const vh = video.videoHeight;

        // 크롭 영역 (중앙 기준)
        const cropW = vw / zoom;
        const cropH = vh / zoom;
        const cropX = (vw - cropW) / 2;
        const cropY = (vh - cropH) / 2;

        // 크롭한 영역을 캔버스 전체에 그려서 확대 효과
        ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
        input = canvas;
      }

      const landmarks = eyeTrackerRef.current.process(input, now);

      if (landmarks) {
        const blink = blinkDetectorRef.current;
        blink.update(landmarks);

        const gaze = gazeMapperRef.current;

        // --- 눈 감음 판정 (GAZE_FREEZE_EAR: 0.26) ---
        const eyesClosed = blink.ear < GAZE_FREEZE_EAR;

        // --- 눈 감은 지속시간 추적 ---
        let eyeClosedSec = 0;
        let eyeCloseSelect = false;

        if (eyesClosed) {
          if (eyeClosedStartRef.current === 0) {
            eyeClosedStartRef.current = now;
            eyeCloseSelectFiredRef.current = false;
          }
          eyeClosedSec = (now - eyeClosedStartRef.current) / 1000;

          if (
            eyeClosedSec >= EYE_CLOSE_SELECT_SEC &&
            !eyeCloseSelectFiredRef.current
          ) {
            eyeCloseSelect = true;
            eyeCloseSelectFiredRef.current = true;
          }
        } else {
          eyeClosedStartRef.current = 0;
        }

        // --- 시선 업데이트 판정 ---
        let shouldFreeze = eyesClosed;

        if (!eyesClosed && recoveryCountRef.current > 0) {
          // 눈 뜬 직후 안정화 대기
          shouldFreeze = true;
          recoveryCountRef.current--;
        } else if (eyesClosed) {
          // 눈 감으면 recovery 카운터 리셋
          recoveryCountRef.current = GAZE_RECOVERY_FRAMES;
        }

        // 항상 특징 추출 (캘리브레이션 중에도 정확한 값 필요)
        // 시선 예측(화면좌표 매핑)만 freeze 적용
        const features = gaze.extractFeatures(landmarks);
        let gazeX = lastGazeRef.current.x,
          gazeY = lastGazeRef.current.y,
          gazeValid = gaze.isCalibrated;

        if (!shouldFreeze && gaze.isCalibrated) {
          // freeze → active 전환: 스무딩 버퍼 리셋 (stale 데이터 제거)
          if (wasFrozenRef.current) {
            gaze.resetSmoothing();
            wasFrozenRef.current = false;
          }
          const predicted = gaze.predict(features);
          gazeX = predicted.x;
          gazeY = predicted.y;
          lastGazeRef.current = { x: gazeX, y: gazeY };
          gazeValid = true;
        }
        if (shouldFreeze) {
          wasFrozenRef.current = true;
        }

        setState({
          isLoading: false,
          error: null,
          faceDetected: true,
          ear: blink.ear,
          blinkCount: blink.blinkCount,
          doubleBlink: blink.doubleBlink,
          irisRx: features.rx,
          irisRy: features.ry,
          headX: features.hx,
          headY: features.hy,
          noseX: features.nx,
          noseY: features.ny,
          eyeLidOpen: features.ey,
          gazeX,
          gazeY,
          gazeValid,
          fps: fpsRef.current,
          eyesClosed,
          eyeClosedSec,
          eyeCloseSelect,
        });
      } else {
        setState((s) => ({
          ...s,
          faceDetected: false,
          fps: fpsRef.current,
        }));
      }

      requestAnimationFrame(processFrame);
    }

    init();

    return () => {
      cancelled = true;
      runningRef.current = false;
      eyeTrackerRef.current.close();
      const video = videoRef.current;
      if (video?.srcObject) {
        (video.srcObject as MediaStream)
          .getTracks()
          .forEach((t) => t.stop());
      }
    };
  }, []);

  const calibrate = useCallback((samples: CalibrationSample[]): boolean => {
    return gazeMapperRef.current.calibrate(samples);
  }, []);

  const resetCalibration = useCallback(() => {
    gazeMapperRef.current.reset();
  }, []);

  const zoomIn = useCallback(() => {
    const next = Math.min(ZOOM_MAX, +(zoomLevelRef.current + ZOOM_STEP).toFixed(2));
    zoomLevelRef.current = next;
    setZoomLevelState(next);
  }, []);

  const zoomOut = useCallback(() => {
    const next = Math.max(ZOOM_MIN, +(zoomLevelRef.current - ZOOM_STEP).toFixed(2));
    zoomLevelRef.current = next;
    setZoomLevelState(next);
  }, []);

  return {
    state,
    videoRef,
    gazeMapper: gazeMapperRef.current,
    calibrate,
    resetCalibration,
    zoomLevel,
    zoomIn,
    zoomOut,
  };
}
