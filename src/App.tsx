import { useState, useCallback } from "react";
import { useTracker } from "./tracking/useTracker";
import { CalibrationScreen } from "./components/CalibrationScreen";
import { CommBoard } from "./components/CommBoard";
import { GazeOverlay } from "./components/GazeOverlay";
import { DebugPanel } from "./components/DebugPanel";
import type { CalibrationSample } from "./tracking/GazeMapper";

type Screen = "loading" | "calibrating" | "communicating";

export function App() {
  const { state, videoRef, calibrate, resetCalibration, zoomLevel, zoomIn, zoomOut } = useTracker();
  const [screen, setScreen] = useState<Screen>("loading");
  const [debug, setDebug] = useState(false);

  // When loading finishes, go to calibration
  if (screen === "loading" && !state.isLoading && !state.error) {
    setScreen("calibrating");
  }

  const handleCalibrationComplete = useCallback(
    (samples: CalibrationSample[]) => {
      const ok = calibrate(samples);
      if (ok) {
        setScreen("communicating");
      } else {
        alert("캘리브레이션 실패. R 키를 눌러 재시도해 주세요.");
        setScreen("communicating");
      }
    },
    [calibrate]
  );

  const handleRecalibrate = useCallback(() => {
    resetCalibration();
    setScreen("calibrating");
  }, [resetCalibration]);

  const handleSelect = useCallback((label: string) => {
    console.log("[선택]", label);
  }, []);

  // Keyboard shortcuts
  useState(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "KeyR" && screen !== "calibrating") {
        handleRecalibrate();
      }
      if (e.code === "KeyD" && e.ctrlKey) {
        e.preventDefault();
        setDebug((d) => !d);
      }
      if (e.code === "KeyQ") {
        window.close();
      }
      // 줌 조절: +/- 키
      if (e.code === "Equal" || e.code === "NumpadAdd") {
        e.preventDefault();
        zoomIn();
      }
      if (e.code === "Minus" || e.code === "NumpadSubtract") {
        e.preventDefault();
        zoomOut();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="app">
      {/* Camera preview */}
      <video
        ref={videoRef}
        className="camera-preview"
        playsInline
        muted
      />

      {/* Zoom indicator */}
      <div className="zoom-indicator">
        x{zoomLevel.toFixed(1)} <span className="zoom-hint">+/-</span>
      </div>

      {/* Loading */}
      {state.isLoading && (
        <div className="center-message">
          <div className="spinner" />
          <p>카메라 및 모델 로딩 중...</p>
        </div>
      )}

      {/* Error */}
      {state.error && (
        <div className="center-message error">
          <p>카메라 오류</p>
          <p className="error-detail">{state.error}</p>
          <p className="error-hint">카메라가 연결되어 있는지 확인해 주세요</p>
        </div>
      )}

      {/* Calibration */}
      {screen === "calibrating" && !state.isLoading && !state.error && (
        <CalibrationScreen
          trackerState={state}
          onComplete={handleCalibrationComplete}
        />
      )}

      {/* Communication Board */}
      {screen === "communicating" && (
        <CommBoard trackerState={state} onSelect={handleSelect} />
      )}

      {/* Gaze Overlay */}
      <GazeOverlay
        x={state.gazeX}
        y={state.gazeY}
        visible={state.gazeValid && screen === "communicating"}
      />

      {/* Face Warning */}
      {!state.isLoading &&
        !state.error &&
        !state.faceDetected && (
          <div className="face-warning">얼굴이 감지되지 않습니다</div>
        )}

      {/* Debug Panel */}
      {debug && <DebugPanel state={state} />}
    </div>
  );
}
