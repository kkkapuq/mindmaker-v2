interface Props {
  x: number;
  y: number;
  visible: boolean;
}

export function GazeOverlay({ x, y, visible }: Props) {
  if (!visible) return null;

  return (
    <div
      className="gaze-dot"
      style={{
        transform: `translate(${x - 14}px, ${y - 14}px)`,
      }}
    >
      <div className="gaze-dot-inner" />
    </div>
  );
}
