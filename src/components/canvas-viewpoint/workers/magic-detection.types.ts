// ─────────────────────────────────────────────────────────────────────────────
// magic-detection.types.ts
//
// Shared data shapes used by BOTH sides of the Worker boundary:
//   - The main thread (MagicDetectionHandler) sends a MagicWorkerRequest.
//   - The Worker sends back a MagicWorkerResult.
//
// This file must NOT import anything that is browser-specific or worker-specific,
// because it is loaded in both environments.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All the settings that control how the flood-fill behaves.
 * Sent from the main thread to the Worker with every detection request.
 */
export interface MagicConfig {
  // ── Tolerance mode ────────────────────────────────────────────────────────
  //
  // "Tolerance" is how different a neighbouring pixel's colour can be before
  // the fill stops expanding. Think of it as colour sensitivity:
  //   low  = tight fill, stops at fine colour boundaries
  //   high = loose fill, expands over gradients and noisy textures
  //
  // There are two modes:
  //   autoTune = true  → the Worker measures colour variation around the click
  //                      and picks a tolerance automatically, then adds
  //                      manualAdjustment on top as a fine-tune.
  //   autoTune = false → manualTolerance is used directly, unchanged.

  /** true = auto-compute tolerance from local pixel variance; false = use manualTolerance as-is. */
  autoTune: boolean;

  /** Tolerance value used when autoTune is false. Manhattan RGB distance, range 0–765. */
  manualTolerance: number;

  /**
   * ±Offset added to the auto-computed tolerance.
   * Positive = more lenient (larger fill). Negative = stricter (smaller fill).
   * Has no effect when autoTune is false.
   */
  manualAdjustment: number;

  // ── Auto-tune knobs (only used when autoTune = true) ─────────────────────

  /** Starting tolerance before local variance is added. Default: 20. */
  baseTolerance: number;

  /**
   * How aggressively local colour variation raises the tolerance.
   * Higher = noisier textures get a bigger tolerance boost. Default: 1.5.
   */
  toleranceScaleFactor: number;

  /** Hard minimum — the final tolerance will never go below this. Default: 15. */
  toleranceMin: number;

  /** Hard maximum — the final tolerance will never go above this. Default: 110. */
  toleranceMax: number;

  /**
   * Half-width of the square sampling window used to measure local colour variance.
   * A value of 7 means a 15×15 pixel area is sampled. Default: 7.
   */
  sampleRadius: number;

  // ── Flood-fill behaviour ──────────────────────────────────────────────────

  /**
   * 4 = only expand to the 4 cardinal neighbours (cleaner, sharper edges).
   * 8 = also expand diagonally (smoother coverage of diagonal features).
   */
  connectivity: 4 | 8;

  /**
   * Safety limit: if the filled region exceeds this fraction of the total image,
   * the detection is aborted (the fill has probably leaked past the object).
   * Default: 0.15 (= 15 % of the image).
   */
  maxFillRatio: number;

  /** When true, the Worker logs detailed timing and result information to the console. */
  debug: boolean;
}

/**
 * The message the main thread sends to the Worker to start a detection.
 */
export interface MagicWorkerRequest {
  /**
   * The full background-image pixel data as a raw ArrayBuffer.
   * This is TRANSFERRED (not copied) — the main thread loses access to it
   * once it is sent, and the Worker receives it instantly with no memory overhead.
   * Format: flat [R, G, B, A, R, G, B, A, ...], one byte per channel, 0–255.
   */
  buffer: ArrayBuffer;

  /** Width of the background image in pixels. */
  width: number;

  /** Height of the background image in pixels. */
  height: number;

  /**
   * X coordinate of the clicked pixel within the background image.
   * Origin is top-left, already clamped to [0, width−1].
   */
  clickX: number;

  /**
   * Y coordinate of the clicked pixel within the background image.
   * Origin is top-left, already clamped to [0, height−1].
   */
  clickY: number;

  /** Detection settings — see MagicConfig above. */
  config: MagicConfig;
}

/**
 * The message the Worker sends back to the main thread.
 * Union type: either a successful result with geometry, or a failure with a reason.
 */
export type MagicWorkerResult =
  | {
      success: true;

      /**
       * Horizontal centre of the detected region's bounding box,
       * in background-image pixel coordinates (top-left origin).
       */
      centerX: number;

      /**
       * Vertical centre of the detected region's bounding box,
       * in background-image pixel coordinates (top-left origin).
       */
      centerY: number;

      /** Width of the bounding box in background-image pixels. */
      bboxWidth: number;

      /** Height of the bounding box in background-image pixels. */
      bboxHeight: number;

      /**
       * Best-fit rotation angle of the region, in radians.
       * Computed via PCA — points along the region's longest axis.
       */
      rotation: number;

      /** Number of pixels that were accepted by the flood-fill. */
      pixelCount: number;

      /**
       * The tolerance value that was actually used for this detection.
       * Useful for debug display or to seed a manual adjustment slider.
       */
      usedTolerance: number;

      /** How long the Worker spent computing the result, in milliseconds. */
      elapsedMs: number;
    }
  | {
      success: false;

      /** Human-readable explanation of why detection failed. */
      reason: string;
    };
