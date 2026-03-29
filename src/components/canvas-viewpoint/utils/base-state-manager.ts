import { signal } from '@angular/core';
import { Camera } from '../core/types';

/**
 * Base state for any viewport: canvas infrastructure, camera, display, and pointer tracking.
 * Extended by LabelingStateManager (labeling annotations) and SectionStateManager (future).
 */
export class BaseStateManager {
  // ========================================
  // CANVAS & RENDERING
  // ========================================

  private _canvasElement = signal<HTMLCanvasElement | null>(null);
  readonly canvasElement = this._canvasElement.asReadonly();
  setCanvas(canvas: HTMLCanvasElement): void {
    this._canvasElement.set(canvas);
  }

  private _ctx = signal<CanvasRenderingContext2D | undefined>(undefined);
  readonly ctx = this._ctx.asReadonly();
  updateContext(ctx: CanvasRenderingContext2D | undefined): void {
    this._ctx.set(ctx);
  }

  private _devicePixelRatio = signal(1);
  readonly devicePixelRatio = this._devicePixelRatio.asReadonly();
  updateDevicePixelRatio(ratio: number): void {
    this._devicePixelRatio.set(ratio);
  }

  private _bgCanvas = signal<HTMLCanvasElement | undefined>(undefined);
  readonly bgCanvas = this._bgCanvas.asReadonly();
  updateBgCanvas(bgCanvas: HTMLCanvasElement | undefined): void {
    this._bgCanvas.set(bgCanvas);
  }

  private _minZoom = signal(0);
  readonly minZoom = this._minZoom.asReadonly();
  updateMinZoom(minZoom: number): void {
    this._minZoom.set(minZoom);
  }

  private _canvasAspectRatio = signal(1.5);
  readonly canvasAspectRatio = this._canvasAspectRatio.asReadonly();
  updateCanvasAspectRatio(ratio: number): void {
    this._canvasAspectRatio.set(ratio);
  }

  private _camera = signal<Camera>({ zoom: 1, x: 0, y: 0 });
  readonly camera = this._camera.asReadonly();
  updateCamera(camera: Camera): void {
    this._camera.set(camera);
  }

  // ========================================
  // READ-ONLY MODE
  // ========================================

  private _readOnlyMode = signal(false);
  readonly readOnlyMode = this._readOnlyMode.asReadonly();
  updateReadOnlyMode(value: boolean): void {
    this._readOnlyMode.set(value);
  }

  // ========================================
  // DISPLAY
  // ========================================

  private _brightness = signal(100);
  readonly brightness = this._brightness.asReadonly();
  updateBrightness(brightness: number): void {
    this._brightness.set(brightness);
  }

  private _contrast = signal(100);
  readonly contrast = this._contrast.asReadonly();
  updateContrast(contrast: number): void {
    this._contrast.set(contrast);
  }

  // ========================================
  // UI STATE
  // ========================================

  private _currentCursor = signal('default');
  readonly currentCursor = this._currentCursor.asReadonly();
  setCursor(cursor: string): void {
    if (this.currentCursor() !== cursor) {
      this._currentCursor.set(cursor);
    }
  }
}
