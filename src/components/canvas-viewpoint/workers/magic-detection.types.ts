/**
 * Shared types between the main thread and the magic-detection Web Worker.
 * Must not import any browser-specific or worker-specific APIs.
 */

export interface MagicConfig {
  /** When true, tolerance is derived from local pixel variance. When false, manualTolerance is used directly. */
  autoTune: boolean;
  /** Fixed tolerance used when autoTune=false (Manhattan RGB distance, 0–765). */
  manualTolerance: number;
  /** Offset added on top of the auto-tuned tolerance (can be negative). Ignored when autoTune=false. */
  manualAdjustment: number;

  // Auto-tune parameters (used only when autoTune=true)
  baseTolerance: number; // floor for auto-tuned result, default 20
  toleranceScaleFactor: number; // k — how aggressively local variance raises tolerance, default 1.5
  toleranceMin: number; // hard floor clamp, default 15
  toleranceMax: number; // hard ceiling clamp, default 110
  sampleRadius: number; // half-width of variance sampling window, default 7 → 15×15 px

  // BFS parameters
  connectivity: 4 | 8;
  maxFillRatio: number; // max fraction of canvas pixels before fill is rejected, default 0.15

  debug: boolean;
}

export interface MagicWorkerRequest {
  buffer: ArrayBuffer; // transferred — the full bgCanvas ImageData pixel buffer
  width: number;
  height: number;
  clickX: number; // pixel coords inside the bgCanvas, clamped to valid range
  clickY: number;
  config: MagicConfig;
}

export type MagicWorkerResult =
  | {
      success: true;
      centerX: number; // pixel coords of bbox center in bgCanvas space
      centerY: number;
      bboxWidth: number; // pixel dimensions of the bounding box
      bboxHeight: number;
      rotation: number; // radians, from PCA
      pixelCount: number;
      usedTolerance: number; // actual tolerance that was applied (useful for debug/display)
      elapsedMs: number;
    }
  | {
      success: false;
      reason: string;
    };
