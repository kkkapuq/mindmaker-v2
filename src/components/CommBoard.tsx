import { useState, useRef, useEffect, useCallback } from "react";
import {
  BOARD_CATEGORIES,
  SELECTION_COOLDOWN_SEC,
  HIT_TEST_PADDING_PX,
  HYSTERESIS_EXTRA_PX,
  SELECT_FREEZE_MS,
  EYE_CLOSE_SELECT_SEC,
} from "../config";
import type { TrackerState } from "../tracking/useTracker";

interface Props {
  trackerState: TrackerState;
  onSelect: (label: string) => void;
}

// --- Web Audio helpers (no external files) ---
const audioCtx = new AudioContext();

function playHoverTick() {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = 800;
  gain.gain.value = 0.08;
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.05);
}

function playSelectChime() {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
  osc.frequency.linearRampToValueAtTime(1600, audioCtx.currentTime + 0.25);
  gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.25);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.25);
}

export function CommBoard({ trackerState, onSelect }: Props) {
  const buttonRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [lastMessage, setLastMessage] = useState("");
  const [currentCategory, setCurrentCategory] = useState<number | null>(null);

  const lastSelectionRef = useRef(0);
  const selectFreezeUntilRef = useRef(0);

  const triggerSelect = useCallback(
    (index: number) => {
      const now = performance.now();
      if (now - lastSelectionRef.current < SELECTION_COOLDOWN_SEC * 1000) return;
      lastSelectionRef.current = now;
      selectFreezeUntilRef.current = now + SELECT_FREEZE_MS;

      if (currentCategory === null) {
        // 메인 화면: 카테고리 선택 → 하위 화면으로 이동
        playSelectChime();
        setCurrentCategory(index);
        setHoveredIndex(null);
        setSelectedIndex(null);
        buttonRefs.current = [];
      } else {
        if (index === 0) {
          // 뒤로가기
          playSelectChime();
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

          playSelectChime();

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

  // 호버 진입 시 틱 사운드
  useEffect(() => {
    if (hoveredIndex !== null) {
      playHoverTick();
    }
  }, [hoveredIndex]);

  // Hit test — 히스테리시스 적용 시선 히트 테스트
  useEffect(() => {
    // 선택 프리즈 중이면 호버 감지 중단
    if (performance.now() < selectFreezeUntilRef.current) return;

    if (!trackerState.gazeValid) {
      setHoveredIndex(null);
      return;
    }

    const { gazeX, gazeY } = trackerState;
    const enterPad = HIT_TEST_PADDING_PX;
    const exitPad = HIT_TEST_PADDING_PX + HYSTERESIS_EXTRA_PX;

    setHoveredIndex((prev) => {
      // 현재 호버된 버튼이 있으면 exit zone으로 체크
      if (prev !== null) {
        const el = buttonRefs.current[prev];
        if (el) {
          const rect = el.getBoundingClientRect();
          if (
            gazeX >= rect.left - exitPad &&
            gazeX <= rect.right + exitPad &&
            gazeY >= rect.top - exitPad &&
            gazeY <= rect.bottom + exitPad
          ) {
            return prev; // 아직 exit zone 안 → 유지
          }
        }
      }

      // 새 버튼 진입 체크 (enter zone)
      for (let i = 0; i < buttonRefs.current.length; i++) {
        const el = buttonRefs.current[i];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (
          gazeX >= rect.left - enterPad &&
          gazeX <= rect.right + enterPad &&
          gazeY >= rect.top - enterPad &&
          gazeY <= rect.bottom + enterPad
        ) {
          return i;
        }
      }

      return null;
    });
  }, [trackerState]);

  // 눈 감아서 선택
  useEffect(() => {
    if (trackerState.eyeCloseSelect && hoveredIndex !== null) {
      triggerSelect(hoveredIndex);
    }
  }, [trackerState.eyeCloseSelect, hoveredIndex, triggerSelect]);

  // 현재 호버 중인 라벨 계산
  const getHoveredLabel = (): string | null => {
    if (hoveredIndex === null) return null;
    if (currentCategory === null) {
      return BOARD_CATEGORIES[hoveredIndex]?.name ?? null;
    }
    if (hoveredIndex === 0) return "← 뒤로";
    const cat = BOARD_CATEGORIES[currentCategory];
    return cat.items[hoveredIndex - 1] ?? null;
  };

  const hoveredLabel = getHoveredLabel();

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

        {hoveredLabel && (
          <div className="gaze-target-label">{hoveredLabel}</div>
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

      {hoveredLabel && (
        <div className="gaze-target-label">{hoveredLabel}</div>
      )}

      {lastMessage && (
        <div className="comm-status">선택: {lastMessage}</div>
      )}
    </div>
  );
}
