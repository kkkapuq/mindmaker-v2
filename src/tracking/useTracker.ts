import { useRef, useState, useEffect, useCallback } from "react";
import { EyeTracker } from "./EyeTracker";
import { BlinkDetector } from "./BlinkDetector";
import { GazeMapper, type CalibrationSample } from "./GazeMapper";

export interface TrackerState {
  isLoading: boolean;
  error: string | null;
  faceDetected: boolean;
  ear: number;
  blinkCount: number;
  doubleBlink: boolean;
  irisRx: number;
  irisRy: number;
  gazeX: number;
  gazeY: number;
  gazeValid: boolean;
  fps: number;
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
  gazeX: 0,
  gazeY: 0,
  gazeValid: false,
  fps: 0,
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

  // Initialize camera + MediaPipe
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Request camera
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        // Initialize MediaPipe
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

      const landmarks = eyeTrackerRef.current.process(video, now);

      if (landmarks) {
        const blink = blinkDetectorRef.current;
        blink.update(landmarks);

        const gaze = gazeMapperRef.current;
        const { rx, ry } = gaze.extractFeatures(landmarks);

        let gazeX = 0,
          gazeY = 0,
          gazeValid = false;
        if (gaze.isCalibrated) {
          const predicted = gaze.predict(rx, ry);
          gazeX = predicted.x;
          gazeY = predicted.y;
          gazeValid = true;
        }

        setState({
          isLoading: false,
          error: null,
          faceDetected: true,
          ear: blink.ear,
          blinkCount: blink.blinkCount,
          doubleBlink: blink.doubleBlink,
          irisRx: rx,
          irisRy: ry,
          gazeX,
          gazeY,
          gazeValid,
          fps: fpsRef.current,
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

  return {
    state,
    videoRef,
    gazeMapper: gazeMapperRef.current,
    calibrate,
    resetCalibration,
  };
}
