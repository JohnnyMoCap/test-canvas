import { signal } from '@angular/core';
import { Box } from '../../../interface/boxes.interface';
import { BoxCreationUtils } from '../utils/box-creation-utils';
import { BoxUtils } from '../utils/box-utils';
import { CoordinateTransform } from '../utils/coordinate-transform';
import { LabelingStateManager as StateManager } from '../utils/labeling-state-manager';
import { HistoryService } from '../../../services/history.service';
import type { SamWorkerRequest, SamWorkerResponse } from '../workers/sam.types';
import type { MagicEngine } from './magic-engine';

/**
 * Selectable SAM checkpoints - both are SlimSAM (a pruned distillation of
 * Meta's Segment Anything, small enough to run client-side), differing only
 * in how much of the original model was kept. More retained weights =
 * better mask quality (particularly for the small/subtle local features
 * this tool is aimed at) at the cost of a larger download. Exposed as a
 * choice rather than picking one, since there was no way to A/B them
 * against real photos in this environment - see `MIN_CONFIDENT_IOU` in
 * `sam.worker.ts` for the other lever on "does it pick the small local
 * feature or the whole panel."
 */
export const SAM_MODEL_OPTIONS: { id: string; label: string }[] = [
  { id: 'Xenova/slimsam-77-uniform', label: 'SlimSAM 77% (more accurate, larger download)' },
  { id: 'Xenova/slimsam-50-uniform', label: 'SlimSAM 50% (smaller, faster)' },
];
const DEFAULT_SAM_MODEL_ID = SAM_MODEL_OPTIONS[0].id;

/**
 * Model-backed alternative to `MagicDetectionHandler`'s colour flood-fill:
 * runs SlimSAM (via `@huggingface/transformers`) in a Worker to segment
 * whatever the user clicks on, using real learned object features instead
 * of local colour similarity. Same click-to-box role as `MagicDetectionHandler`
 * - the two are interchangeable `MagicEngine`s, picked via
 * `LabelingStateManager.magicEngine`.
 *
 * The model is downloaded and initialised lazily (first call to
 * `ensureInitialized()` or `handlePointerDown()`), not eagerly at
 * construction - it's tens of MB and most sessions may never use it.
 *
 * SAM's own cost split: encoding an image is relatively expensive, decoding
 * a point against an already-encoded image is cheap. `embeddedFor` caches
 * which `bgCanvas` the Worker currently holds embeddings for, so repeated
 * clicks on the same photo only pay the encoder cost once.
 * Layer 3: Business Logic Handler
 */
export class SamMagicHandler implements MagicEngine {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private activeState: StateManager | null = null;
  private embeddedFor: HTMLCanvasElement | null = null;
  /** A click that arrived before its image finished embedding - replayed once IMAGE_PROCESSED comes back. */
  private pendingClick: { x: number; y: number } | null = null;

  /** True once the model has finished downloading and initialising. */
  readonly isReady = signal(false);
  /** True while an image embedding or a mask prediction is in flight. */
  readonly isProcessing = signal(false);
  /** Set when the model fails to load or a prediction errors, for UI display; cleared on the next successful request. */
  readonly lastError = signal<string | null>(null);
  /** Which SAM checkpoint is currently (or about to be) loaded - see `SAM_MODEL_OPTIONS`. */
  readonly modelId = signal(DEFAULT_SAM_MODEL_ID);

  constructor(
    private historyService: HistoryService,
    private scheduleRender: () => void,
    private rebuildIndex: () => void,
  ) {}

  /**
   * Starts downloading/initialising the model if it hasn't been already.
   * Call this proactively when the user switches to this engine, so the
   * (multi-second, first-time-only) load cost isn't hidden behind their
   * first click.
   */
  ensureInitialized(): void {
    this.getOrCreateWorker();
  }

  /**
   * Switches which SAM checkpoint is used (see `SAM_MODEL_OPTIONS`). A
   * different checkpoint needs a fresh Worker (new weights, new embeddings
   * for whatever image is currently loaded) - simplest and least
   * error-prone is to tear down and re-init rather than try to hot-swap
   * model state inside a live Worker.
   */
  setModelId(modelId: string): void {
    if (modelId === this.modelId()) return;
    this.modelId.set(modelId);
    this.destroy();
    this.ensureInitialized();
  }

  /** Triggered by `PointerEventHandler` when a pointer-down lands in magic mode with this engine active. */
  handlePointerDown(event: PointerEvent, canvas: HTMLCanvasElement, state: StateManager): void {
    if (this.isProcessing()) return; // one prediction in flight at a time
    const bgc = state.bgCanvas();
    if (!bgc) return;

    const worker = this.getOrCreateWorker();
    if (!this.isReady()) return; // still downloading/initialising - isReady drives the UI's loading state

    const rect = canvas.getBoundingClientRect();
    const dpr = state.devicePixelRatio();
    const screenX = (event.clientX - rect.left) * dpr;
    const screenY = (event.clientY - rect.top) * dpr;
    const absPos = CoordinateTransform.screenToAbsolute(
      screenX,
      screenY,
      canvas.width,
      canvas.height,
      state.camera(),
    );
    const pixelX = Math.max(0, Math.min(bgc.width - 1, Math.floor(absPos.x + bgc.width / 2)));
    const pixelY = Math.max(0, Math.min(bgc.height - 1, Math.floor(absPos.y + bgc.height / 2)));

    this.activeState = state;
    this.isProcessing.set(true);
    this.lastError.set(null);

    if (this.embeddedFor !== bgc) {
      this.embeddedFor = bgc;
      this.pendingClick = { x: pixelX, y: pixelY };

      const bgCtx = bgc.getContext('2d');
      if (!bgCtx) {
        this.isProcessing.set(false);
        return;
      }
      const imageData = bgCtx.getImageData(0, 0, bgc.width, bgc.height);
      const buffer = imageData.data.buffer;
      const request: SamWorkerRequest = {
        type: 'SET_IMAGE',
        buffer,
        width: bgc.width,
        height: bgc.height,
        requestId: this.nextRequestId++,
      };
      worker.postMessage(request, [buffer]);
      return;
    }

    this.predictClick(worker, pixelX, pixelY, state.debugMagicDetection());
  }

  /**
   * Terminate the worker and release all references.
   * Call from the component's ngOnDestroy.
   */
  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
    this.isReady.set(false);
    this.isProcessing.set(false);
    this.activeState = null;
    this.embeddedFor = null;
    this.pendingClick = null;
  }

  // ---------------------------------------------------------------------------

  private predictClick(worker: Worker, x: number, y: number, debug: boolean): void {
    const request: SamWorkerRequest = { type: 'PREDICT_CLICK', x, y, requestId: this.nextRequestId++, debug };
    worker.postMessage(request);
  }

  private getOrCreateWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/sam.worker', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<SamWorkerResponse>) => this.onWorkerMessage(e.data);
      this.worker.onerror = (e: ErrorEvent) => {
        console.error('SAM worker error:', e.message);
        this.lastError.set(e.message);
        this.isProcessing.set(false);
      };
      const initRequest: SamWorkerRequest = { type: 'INIT', modelId: this.modelId() };
      this.worker.postMessage(initRequest);
    }
    return this.worker;
  }

  private onWorkerMessage(message: SamWorkerResponse): void {
    switch (message.type) {
      case 'READY':
        this.isReady.set(true);
        return;

      case 'IMAGE_PROCESSED': {
        const click = this.pendingClick;
        this.pendingClick = null;
        if (click && this.worker) {
          this.predictClick(this.worker, click.x, click.y, this.activeState?.debugMagicDetection() ?? false);
        } else {
          this.isProcessing.set(false);
        }
        return;
      }

      case 'MASK_RESULT': {
        this.isProcessing.set(false);
        const state = this.activeState;
        const bgc = state?.bgCanvas();
        if (!state || !bgc) return;

        const newBox = SamMagicHandler.createBoxFromMask(message, state.nextTempId(), bgc.width, bgc.height);
        state.getNextTempId();
        this.historyService.recordAdd(newBox);
        this.rebuildIndex();
        this.scheduleRender();
        return;
      }

      case 'NO_MASK':
        this.isProcessing.set(false);
        return;

      case 'ERROR':
        this.isProcessing.set(false);
        this.lastError.set(message.message);
        console.error('SAM worker error:', message.message);
        return;
    }
  }

  private static createBoxFromMask(
    result: Extract<SamWorkerResponse, { type: 'MASK_RESULT' }>,
    tempId: number,
    bgWidth: number,
    bgHeight: number,
  ): Box {
    const absX = result.centerX - bgWidth / 2;
    const absY = result.centerY - bgHeight / 2;
    const normalizedPos = BoxUtils.absoluteToNormalized(absX, absY, bgWidth, bgHeight);
    const normalizedDims = BoxUtils.absoluteDimensionsToNormalized(
      result.bboxWidth,
      result.bboxHeight,
      bgWidth,
      bgHeight,
    );
    return {
      tempId: BoxCreationUtils.generateTempId(tempId),
      x: normalizedPos.x,
      y: normalizedPos.y,
      w: normalizedDims.w,
      h: normalizedDims.h,
      rotation: result.rotation,
      // Distinct hue from the classical engine's boxes so it's visually obvious which engine produced a given box.
      color: 'hsl(280, 70%, 50%)',
      state: 'accepted',
    };
  }
}
