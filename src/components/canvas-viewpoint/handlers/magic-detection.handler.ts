import { Box } from '../../../interface/boxes.interface';
import { BoxCreationUtils } from '../utils/box-creation-utils';
import { BoxUtils } from '../utils/box-utils';
import { CoordinateTransform } from '../utils/coordinate-transform';
import { LabelingStateManager as StateManager } from '../utils/labeling-state-manager';
import { HistoryService } from '../../../services/history.service';
import type { MagicConfig, MagicWorkerResult } from '../workers/magic-detection.types';
import type { MagicEngine } from './magic-engine';

/**
 * Owns the magic-detection Web Worker and handles the full detection lifecycle.
 * Instance class (not static) because it holds long-lived Worker state.
 * The "classical" `MagicEngine` - colour flood-fill, see `SamMagicHandler`
 * (`sam-magic.handler.ts`) for the model-backed alternative.
 * Layer 3: Business Logic Handler
 */
export class MagicDetectionHandler implements MagicEngine {
  private worker: Worker | null = null;
  private busy = false;
  private activeState: StateManager | null = null;

  constructor(
    private historyService: HistoryService,
    private scheduleRender: () => void,
    private rebuildIndex: () => void,
  ) {}

  /**
   * Triggered by PointerEventHandler when a pointer-down lands in magic mode.
   * Cancels any in-progress detection, reads the bgCanvas, and dispatches to the Worker.
   */
  handlePointerDown(event: PointerEvent, canvas: HTMLCanvasElement, state: StateManager): void {
    const bgc = state.bgCanvas();
    if (!bgc) return;

    // Cancel any in-progress detection
    if (this.busy) {
      this.worker?.terminate();
      this.worker = null;
      this.busy = false;
    }

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

    const bgCtx = bgc.getContext('2d');
    if (!bgCtx) return;

    const imageData = bgCtx.getImageData(0, 0, bgc.width, bgc.height);
    // Transfer the buffer (zero-copy handoff — main thread loses access after this)
    const buffer = imageData.data.buffer;

    const config: MagicConfig = {
      autoTune: state.magicAutoTune(),
      manualTolerance: state.magicTolerance(),
      manualAdjustment: state.magicAdjustment(),
      baseTolerance: 20,
      toleranceScaleFactor: 1.5,
      toleranceMin: 15,
      toleranceMax: 110,
      sampleRadius: 7,
      connectivity: 4,
      maxFillRatio: 0.15,
      debug: state.debugMagicDetection(),
    };

    this.activeState = state;
    this.busy = true;
    this.getOrCreateWorker().postMessage(
      { buffer, width: bgc.width, height: bgc.height, clickX: pixelX, clickY: pixelY, config },
      [buffer],
    );
  }

  /**
   * Terminate the worker and release all references.
   * Call from the component's ngOnDestroy.
   */
  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    this.activeState = null;
  }

  // ---------------------------------------------------------------------------

  private getOrCreateWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/magic-detection.worker', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (e: MessageEvent<MagicWorkerResult>) => this.onWorkerResult(e.data);
      this.worker.onerror = (e: ErrorEvent) => {
        console.error('Magic detection worker error:', e.message);
        this.busy = false;
      };
    }
    return this.worker;
  }

  private onWorkerResult(result: MagicWorkerResult): void {
    this.busy = false;
    const state = this.activeState;
    if (!state) return;

    if (!result.success) {
      if (state.debugMagicDetection()) {
        console.log('[Magic] Detection failed:', result.reason);
      }
      return;
    }

    if (state.debugMagicDetection()) {
      console.log('[Magic] Detection succeeded:', {
        pixelCount: result.pixelCount,
        bbox: {
          cx: result.centerX.toFixed(1),
          cy: result.centerY.toFixed(1),
          w: result.bboxWidth,
          h: result.bboxHeight,
        },
        rotation: ((result.rotation * 180) / Math.PI).toFixed(1) + '°',
        usedTolerance: result.usedTolerance.toFixed(1),
        elapsedMs: result.elapsedMs.toFixed(2),
      });
    }

    const bgc = state.bgCanvas();
    if (!bgc) return;

    const newBox = MagicDetectionHandler.createBoxFromDetection(
      result,
      state.nextTempId(),
      bgc.width,
      bgc.height,
    );
    state.getNextTempId();
    this.historyService.recordAdd(newBox);
    this.rebuildIndex();
    this.scheduleRender();
  }

  private static createBoxFromDetection(
    result: Extract<MagicWorkerResult, { success: true }>,
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
      color: `hsl(${Math.floor((25 / 50) * 360)}, 70%, 50%)`,
      state: 'accepted',
    };
  }
}
