import type { TrackerState } from "../tracking/useTracker";

interface Props {
  state: TrackerState;
}

export function DebugPanel({ state }: Props) {
  const rows = [
    { label: "FPS", value: state.fps.toFixed(1) },
    {
      label: "Face",
      value: state.faceDetected ? "O" : "X",
      color: state.faceDetected ? "#00ff88" : "#ff4444",
    },
    { label: "EAR", value: state.ear.toFixed(3) },
    {
      label: "Iris",
      value: `(${state.irisRx.toFixed(3)}, ${state.irisRy.toFixed(3)})`,
    },
    {
      label: "Gaze",
      value: state.gazeValid
        ? `(${state.gazeX.toFixed(0)}, ${state.gazeY.toFixed(0)})`
        : "(not calibrated)",
    },
    { label: "Blinks", value: String(state.blinkCount) },
    {
      label: "DblBlink",
      value: state.doubleBlink ? "YES!" : "no",
      color: state.doubleBlink ? "#ffff00" : undefined,
    },
  ];

  return (
    <div className="debug-panel">
      {rows.map((row) => (
        <div key={row.label} className="debug-row">
          <span className="debug-label">{row.label}:</span>
          <span className="debug-value" style={row.color ? { color: row.color } : undefined}>
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}
