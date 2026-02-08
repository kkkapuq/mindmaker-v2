import type { Landmarks } from "./EyeTracker";
import {
  LEFT_EYE,
  RIGHT_EYE,
  EAR_THRESHOLD,
  DOUBLE_BLINK_WINDOW_SEC,
  BLINK_MIN_FRAMES,
  BLINK_MAX_FRAMES,
} from "../config";

function dist(
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function computeEAR(landmarks: Landmarks, eyeIndices: number[]): number {
  const p = eyeIndices.map((i) => landmarks[i]);
  const vertical1 = dist(p[1], p[5]);
  const vertical2 = dist(p[2], p[4]);
  const horizontal = dist(p[0], p[3]);
  if (horizontal < 1e-6) return 0.3;
  return (vertical1 + vertical2) / (2.0 * horizontal);
}

export class BlinkDetector {
  ear = 0;
  blinkCount = 0;
  doubleBlink = false;

  private closedFrames = 0;
  private wasClosed = false;
  private blinkTimes: number[] = [];

  update(landmarks: Landmarks): void {
    const leftEar = computeEAR(landmarks, LEFT_EYE);
    const rightEar = computeEAR(landmarks, RIGHT_EYE);
    this.ear = (leftEar + rightEar) / 2;
    this.doubleBlink = false;

    if (this.ear < EAR_THRESHOLD) {
      this.closedFrames++;
      this.wasClosed = true;
    } else {
      if (
        this.wasClosed &&
        this.closedFrames >= BLINK_MIN_FRAMES &&
        this.closedFrames <= BLINK_MAX_FRAMES
      ) {
        this.registerBlink();
      }
      this.closedFrames = 0;
      this.wasClosed = false;
    }
  }

  private registerBlink(): void {
    const now = performance.now() / 1000;
    this.blinkCount++;
    this.blinkTimes.push(now);

    // Keep only recent blinks
    this.blinkTimes = this.blinkTimes.filter(
      (t) => now - t < DOUBLE_BLINK_WINDOW_SEC * 2
    );

    if (this.blinkTimes.length >= 2) {
      const last = this.blinkTimes[this.blinkTimes.length - 1];
      const prev = this.blinkTimes[this.blinkTimes.length - 2];
      if (last - prev <= DOUBLE_BLINK_WINDOW_SEC) {
        this.doubleBlink = true;
        this.blinkTimes = [];
      }
    }
  }

  reset(): void {
    this.closedFrames = 0;
    this.wasClosed = false;
    this.blinkTimes = [];
    this.ear = 0;
    this.blinkCount = 0;
    this.doubleBlink = false;
  }
}
