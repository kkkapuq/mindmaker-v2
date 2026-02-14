# MindMaker v2

ALS 환자용 시선 추적 의사소통 보드 (Electron + Vite + React + TypeScript)

## 프로젝트 구조
- `src/tracking/` — 시선 추적 코어 (EyeTracker, BlinkDetector, GazeMapper, useTracker)
- `src/components/` — UI (CommBoard 카테고리 계층, CalibrationScreen 5x5, DebugPanel)
- `src/config.ts` — 모든 튜닝 파라미터 중앙 관리
- `electron/main.ts` — Electron 메인 프로세스

## 핵심 설계
- GazeFeatures: rx, ry, hx, hy, nx, ny, ey → polyFeatures 11개로 릿지 회귀
- ey(눈꺼풀 열림): 위쪽 시선 보상용 — 홍채만으로 위쪽 추적 불충분
- hx/hy: 눈 내측 꼬리 간 거리로 정규화 (환자가 입을 항상 벌리고 있어 chin 기반 불가)
- 릿지 회귀 절편(i=0)은 페널티 제외 필수
- GAZE_SENSITIVITY: 예측 범위 스케일링 (화면 중심 기준)
- 캘리브레이션 이상치 자동 제거 (residual > 2.5*median → 제거 후 재피팅)

## 환자 특성
- 항상 입을 벌리고 있음
- 눈 감기로 선택 (EYE_CLOSE_SELECT_SEC)
- 보호자가 Space로 캘리브레이션 진행

## 빌드
- `npm run dev` — Vite + Electron 개발 모드
- `npx tsc --noEmit` — 타입 체크
