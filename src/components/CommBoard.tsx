import { useState, useRef, useEffect, useCallback } from "react";
import {
  BOARD_CATEGORIES,
  SELECTION_COOLDOWN_SEC,
  HIT_TEST_PADDING_PX,
  EYE_CLOSE_SELECT_SEC,
} from "../config";
import type { TrackerState } from "../tracking/useTracker";

interface Props {
  trackerState: TrackerState;
  onSelect: (label: string) => void;
}

export function CommBoard({ trackerState, onSelect }: Props) {
  const buttonRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [lastMessage, setLastMessage] = useState("");
  const [currentCategory, setCurrentCategory] = useState<number | null>(null);

  const lastSelectionRef = useRef(0);

  const triggerSelect = useCallback(
    (index: number) => {
      const now = performance.now();
      if (now - lastSelectionRef.current < SELECTION_COOLDOWN_SEC * 1000) return;
      lastSelectionRef.current = now;

      if (currentCategory === null) {
        // 메인 화면: 카테고리 선택 → 하위 화면으로 이동
        setCurrentCategory(index);
        setHoveredIndex(null);
        setSelectedIndex(null);
        buttonRefs.current = [];
      } else {
        if (index === 0) {
          // 뒤로가기
          setCurrentCategory(null);
          setHoveredIndex(null);
          setSelectedIndex(null);
          buttonRefs.current = [];
        } else {
          // 항목 선택 → TTS 발화
          const cat = BOARD_CATEGORIES[currentCategory];
          const label = cat.items[index - 1];
          setSelectedIndex(index);
          setLastMessage(label);
          onSelect(label);

          const utterance = new SpeechSynthesisUtterance(label);
          utterance.lang = "ko-KR";
          utterance.rate = 0.9;
          speechSynthesis.speak(utterance);

          setTimeout(() => setSelectedIndex(null), 800);
        }
      }
    },
    [onSelect, currentCategory]
  );

  // Hit test — 시선이 어떤 버튼 위에 있는지 하이라이트만
  useEffect(() => {
    if (!trackerState.gazeValid) {
      setHoveredIndex(null);
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

    setHoveredIndex(hit);
  }, [trackerState]);

  // 눈 2초 이상 감으면 선택
  useEffect(() => {
    if (trackerState.eyeCloseSelect && hoveredIndex !== null) {
      triggerSelect(hoveredIndex);
    }
  }, [trackerState.eyeCloseSelect, hoveredIndex, triggerSelect]);

  // 메인 화면: 2x2 카테고리 그리드
  if (currentCategory === null) {
    return (
      <div className="comm-board">
        <div
          className="comm-grid"
          style={{
            gridTemplateRows: "repeat(2, 1fr)",
            gridTemplateColumns: "repeat(2, 1fr)",
          }}
        >
          {BOARD_CATEGORIES.map((cat, i) => {
            let className = "comm-button category-btn";
            if (cat.emergency) className += " emergency";
            if (selectedIndex === i) className += " selected";
            else if (hoveredIndex === i) className += " hovered";

            return (
              <div
                key={i}
                ref={(el) => { buttonRefs.current[i] = el; }}
                className={className}
              >
                <span className="comm-button-label">{cat.name}</span>
              </div>
            );
          })}
        </div>

        {trackerState.eyesClosed && hoveredIndex !== null && (
          <div className="eye-close-indicator">
            <div
              className="eye-close-fill"
              style={{
                width: `${Math.min(trackerState.eyeClosedSec / EYE_CLOSE_SELECT_SEC, 1) * 100}%`,
              }}
            />
            <span className="eye-close-text">
              눈 감는 중... {trackerState.eyeClosedSec.toFixed(1)}s
            </span>
          </div>
        )}

        {lastMessage && (
          <div className="comm-status">선택: {lastMessage}</div>
        )}
      </div>
    );
  }

  // 하위 화면: [← 뒤로] + 항목들
  const cat = BOARD_CATEGORIES[currentCategory];
  const buttons = ["← 뒤로", ...cat.items];
  const cols = Math.ceil(buttons.length / 2);

  return (
    <div className="comm-board">
      <div className="comm-category-title">{cat.name}</div>
      <div
        className="comm-grid"
        style={{
          gridTemplateRows: "repeat(2, 1fr)",
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
        }}
      >
        {buttons.map((label, i) => {
          let className = "comm-button";
          if (i === 0) className += " back-btn";
          if (selectedIndex === i) className += " selected";
          else if (hoveredIndex === i) className += " hovered";

          return (
            <div
              key={i}
              ref={(el) => { buttonRefs.current[i] = el; }}
              className={className}
            >
              <span className="comm-button-label">{label}</span>
            </div>
          );
        })}
      </div>

      {trackerState.eyesClosed && hoveredIndex !== null && (
        <div className="eye-close-indicator">
          <div
            className="eye-close-fill"
            style={{
              width: `${Math.min(trackerState.eyeClosedSec / EYE_CLOSE_SELECT_SEC, 1) * 100}%`,
            }}
          />
          <span className="eye-close-text">
            눈 감는 중... {trackerState.eyeClosedSec.toFixed(1)}s
          </span>
        </div>
      )}

      {lastMessage && (
        <div className="comm-status">선택: {lastMessage}</div>
      )}
    </div>
  );
}
