import { useState, useRef, useEffect, useCallback } from "react";
import {
  BOARD_LABELS,
  BOARD_ROWS,
  BOARD_COLS,
  DWELL_TIME_SEC,
  SELECTION_COOLDOWN_SEC,
  HIT_TEST_PADDING_PX,
} from "../config";
import type { TrackerState } from "../tracking/useTracker";

interface Props {
  trackerState: TrackerState;
  onSelect: (label: string) => void;
}

export function CommBoard({ trackerState, onSelect }: Props) {
  const buttonRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [dwellProgress, setDwellProgress] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [lastMessage, setLastMessage] = useState("");

  const dwellStartRef = useRef(0);
  const lastSelectionRef = useRef(0);

  const triggerSelect = useCallback(
    (index: number) => {
      const now = performance.now();
      if (now - lastSelectionRef.current < SELECTION_COOLDOWN_SEC * 1000) return;
      lastSelectionRef.current = now;

      const label = BOARD_LABELS[index];
      setSelectedIndex(index);
      setLastMessage(label);
      setDwellProgress(0);
      onSelect(label);

      // TTS
      const utterance = new SpeechSynthesisUtterance(label);
      utterance.lang = "ko-KR";
      utterance.rate = 0.9;
      speechSynthesis.speak(utterance);

      setTimeout(() => setSelectedIndex(null), 800);
    },
    [onSelect]
  );

  // Hit test + dwell logic
  useEffect(() => {
    if (!trackerState.gazeValid) {
      setHoveredIndex(null);
      setDwellProgress(0);
      return;
    }

    const { gazeX, gazeY } = trackerState;
    const pad = HIT_TEST_PADDING_PX;

    let hit: number | null = null;
    for (let i = 0; i < buttonRefs.current.length; i++) {
      const el = buttonRefs.current[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (
        gazeX >= rect.left - pad &&
        gazeX <= rect.right + pad &&
        gazeY >= rect.top - pad &&
        gazeY <= rect.bottom + pad
      ) {
        hit = i;
        break;
      }
    }

    if (hit !== hoveredIndex) {
      setHoveredIndex(hit);
      setDwellProgress(0);
      if (hit !== null) {
        dwellStartRef.current = performance.now();
      }
    } else if (hit !== null) {
      const elapsed = (performance.now() - dwellStartRef.current) / 1000;
      const progress = Math.min(elapsed / DWELL_TIME_SEC, 1);
      setDwellProgress(progress);

      if (progress >= 1) {
        triggerSelect(hit);
        setHoveredIndex(null);
      }
    }
  }, [trackerState, hoveredIndex, triggerSelect]);

  // Double blink instant select
  useEffect(() => {
    if (trackerState.doubleBlink && hoveredIndex !== null) {
      triggerSelect(hoveredIndex);
    }
  }, [trackerState.doubleBlink, hoveredIndex, triggerSelect]);

  return (
    <div className="comm-board">
      <div
        className="comm-grid"
        style={{
          gridTemplateRows: `repeat(${BOARD_ROWS}, 1fr)`,
          gridTemplateColumns: `repeat(${BOARD_COLS}, 1fr)`,
        }}
      >
        {BOARD_LABELS.map((label, i) => {
          let className = "comm-button";
          if (selectedIndex === i) className += " selected";
          else if (hoveredIndex === i) className += " hovered";

          return (
            <div
              key={i}
              ref={(el) => { buttonRefs.current[i] = el; }}
              className={className}
            >
              <span className="comm-button-label">{label}</span>
              {hoveredIndex === i && (
                <div className="dwell-bar">
                  <div
                    className="dwell-fill"
                    style={{ width: `${dwellProgress * 100}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {lastMessage && (
        <div className="comm-status">선택: {lastMessage}</div>
      )}
    </div>
  );
}
