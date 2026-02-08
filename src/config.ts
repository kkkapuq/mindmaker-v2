// MediaPipe Face Landmarker indices
export const LEFT_EYE = [362, 385, 387, 263, 373, 380];
export const RIGHT_EYE = [33, 160, 158, 133, 153, 144];

export const LEFT_IRIS = [474, 475, 476, 477];
export const RIGHT_IRIS = [469, 470, 471, 472];

export const LEFT_EYE_INNER = 362;
export const LEFT_EYE_OUTER = 263;
export const RIGHT_EYE_INNER = 133;
export const RIGHT_EYE_OUTER = 33;

export const LEFT_EYE_TOP = 386;
export const LEFT_EYE_BOTTOM = 374;
export const RIGHT_EYE_TOP = 159;
export const RIGHT_EYE_BOTTOM = 145;

// Head pose landmarks
export const NOSE_TIP = 4;
export const FOREHEAD = 10;
export const CHIN = 152;

// Blink detection
export const EAR_THRESHOLD = 0.21;
export const DOUBLE_BLINK_WINDOW_SEC = 0.5;
export const BLINK_MIN_FRAMES = 1;
export const BLINK_MAX_FRAMES = 5;

// Gaze freeze (눈 감을 때 포인터 고정)
export const GAZE_FREEZE_EAR = 0.26; // 이 이하면 시선 업데이트 중단 (EAR_THRESHOLD보다 높게)
export const GAZE_RECOVERY_FRAMES = 8; // 눈 뜬 후 안정화 대기 프레임 수

// 눈 감아서 선택
export const EYE_CLOSE_SELECT_SEC = 2.0; // 이 시간 이상 눈 감으면 선택

// Calibration
export const CALIBRATION_POINTS = 25; // 5x5 그리드
export const CALIBRATION_GRID_ROWS = 5;
export const CALIBRATION_GRID_COLS = 5;
export const FRAMES_PER_POINT = 30;
export const CALIBRATION_SETTLE_FRAMES = 5; // 처음 N프레임 버림 (안정화 대기)
export const CALIBRATION_OUTLIER_STD = 1.5; // 이상치 제거 기준 (표준편차 배수)
export const RIDGE_LAMBDA = 1.0; // 릿지 회귀 정규화 계수 (과적합 방지)

// Gaze smoothing
export const SMOOTHING_ALPHA = 0.05; // 낮을수록 부드러움 (이전: 0.12)
export const MOVING_AVG_SIZE = 15; // 이동 평균 버퍼 크기 (이전: 8)
export const MIN_MOVE_PX = 40; // 이 픽셀 이하 움직임은 무시 (이전: 15)

// Dwell selection
export const DWELL_TIME_SEC = 1.5;
export const SELECTION_COOLDOWN_SEC = 1.5;
export const HIT_TEST_PADDING_PX = 20;

// UI
export interface BoardCategory {
  name: string;
  items: string[];
  emergency?: boolean;
}

export const BOARD_CATEGORIES: BoardCategory[] = [
  {
    name: "인사 및 안부",
    items: ["어서와", "안녕", "잘지냈어?", "밥 먹었어?", "보고싶었어", "잘 자", "좋은 하루 보내"],
  },
  {
    name: "의사소통",
    items: ["고마워", "미안해", "뭐하고왔어?", "배고파", "목말라", "좋아", "싫어"],
  },
  {
    name: "기타",
    items: ["경탁이", "미라", "미승이", "영승이", "소향이", "근탁이"],
  },
  {
    name: "긴급",
    items: ["아파", "간호사 불러줘", "화장실 가고 싶어", "약 먹을 시간이야", "숨이 답답해", "어지러워", "도와줘"],
    emergency: true,
  },
];

// MediaPipe model
export const MEDIAPIPE_WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
export const FACE_LANDMARKER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
