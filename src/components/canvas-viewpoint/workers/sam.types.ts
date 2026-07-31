// ─────────────────────────────────────────────────────────────────────────────
// sam.types.ts
//
// Shared data shapes used by BOTH sides of the Worker boundary:
//   - The main thread (SamMagicHandler) sends a SamWorkerRequest.
//   - The Worker sends back a SamWorkerResponse.
//
// Mirrors magic-detection.types.ts's shape/role - this is the model-backed
// alternative to that same click-to-box tool, not a different feature.
// ─────────────────────────────────────────────────────────────────────────────

export type SamWorkerRequest =
  | {
      type: 'INIT';
      /** Which SAM checkpoint to load - see `SAM_MODEL_OPTIONS` in `sam-magic.handler.ts`. */
      modelId: string;
    }
  | {
      type: 'SET_IMAGE';
      /** Full background-image RGBA pixel data. TRANSFERRED (not copied), same as Magic Wand's request. */
      buffer: ArrayBuffer;
      width: number;
      height: number;
      requestId: number;
    }
  | {
      type: 'PREDICT_CLICK';
      /** Click position in background-image pixel coordinates (top-left origin). */
      x: number;
      y: number;
      requestId: number;
      /** When true, the Worker logs every candidate mask's IoU score and pixel area to the console, not just the one it picked. */
      debug: boolean;
    };

export type SamWorkerResponse =
  | { type: 'READY' }
  | { type: 'IMAGE_PROCESSED'; requestId: number }
  | {
      type: 'MASK_RESULT';
      requestId: number;
      /** Bounding box of the predicted mask, in background-image pixel coordinates (top-left origin). */
      centerX: number;
      centerY: number;
      bboxWidth: number;
      bboxHeight: number;
      /** Best-fit rotation of the masked region (radians), via PCA on its pixels. */
      rotation: number;
      pixelCount: number;
      /** SAM's own predicted IoU score (0-1) for this mask. */
      confidence: number;
    }
  | { type: 'NO_MASK'; requestId: number }
  | { type: 'ERROR'; requestId: number; message: string };
