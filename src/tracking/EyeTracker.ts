import {
  FaceLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { MEDIAPIPE_WASM_CDN, FACE_LANDMARKER_MODEL } from "../config";

export type Landmarks = NormalizedLandmark[];

export class EyeTracker {
  private landmarker: FaceLandmarker | null = null;

  async init(): Promise<void> {
    const filesetResolver = await FilesetResolver.forVisionTasks(
      MEDIAPIPE_WASM_CDN
    );
    this.landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  process(source: HTMLVideoElement | HTMLCanvasElement, timestampMs: number): Landmarks | null {
    if (!this.landmarker) return null;
    const result = this.landmarker.detectForVideo(source, timestampMs);
    if (result.faceLandmarks.length > 0) {
      return result.faceLandmarks[0];
    }
    return null;
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
