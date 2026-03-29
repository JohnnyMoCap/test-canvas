import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  Input,
  Output,
  EventEmitter,
  signal,
  computed,
  Injector,
  inject,
} from '@angular/core';
import { Camera } from './core/types';
import { CameraUtils } from './utils/camera-utils';
import { BackgroundUtils } from './utils/background-utils';
import { RenderUtils } from './utils/render-utils';
import { CameraHandler } from './handlers/camera.handler';
import { CoordinateTransform } from './utils/coordinate-transform';
import { BaseStateManager } from './utils/base-state-manager';
import { LifecycleManager } from './utils/lifecycle-manager';

/**
 * Base viewport component — provides background image display, zoom/pan,
 * canvas sizing, DPR handling, and an extension hook for rendering overlays.
 *
 * Extend this class to build specialised viewports (e.g. LabelingViewportComponent).
 */
@Component({
  selector: 'app-base-viewport',
  templateUrl: './base-viewport.html',
  styleUrls: ['./base-viewport.css'],
  standalone: true,
  imports: [],
})
export class BaseViewportComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvasEl', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  // ── @Inputs ──────────────────────────────────────────────────────────────

  @Input() backgroundUrl?: string;

  @Input() set brightnessInput(value: number) {
    if (value !== this.state.brightness()) this.state.updateBrightness(value);
  }
  @Input() set contrastInput(value: number) {
    if (value !== this.state.contrast()) this.state.updateContrast(value);
  }
  @Input() set readOnlyMode(value: boolean) {
    if (value !== this.state.readOnlyMode()) this.state.updateReadOnlyMode(value);
  }

  // ── @Outputs ─────────────────────────────────────────────────────────────

  @Output() zoomChange = new EventEmitter<number>();

  // ── State ─────────────────────────────────────────────────────────────────

  protected state: BaseStateManager;

  // ── Signals & caches ──────────────────────────────────────────────────────

  protected dirty = signal(true);

  // ── Infra ─────────────────────────────────────────────────────────────────

  private resizeObserver?: ResizeObserver;
  private _stopRenderLoop: () => void = () => {};
  private dprQueryCleanup: (() => void) | null = null;

  // ── Computed ──────────────────────────────────────────────────────────────

  canvasFilter = computed(
    () => `brightness(${this.state.brightness()}%) contrast(${this.state.contrast()}%)`,
  );

  protected injector = inject(Injector);

  constructor(protected el: ElementRef) {
    this.state = new BaseStateManager();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngAfterViewInit(): void {
    this.state.setCanvas(this.canvasRef.nativeElement);
    this.initializeCanvas();
    this.setupPageResizeObserver();
    this.setupDprChangeDetection();
    if (this.backgroundUrl) {
      this.loadBackground(this.backgroundUrl);
    } else {
      this.loadPlaceholder();
    }
    this.startRenderLoop();
    this.setupFeatureEffects();
    this.setupFeatureHotkeys();
  }

  ngOnDestroy(): void {
    this._stopRenderLoop();
    this.resizeObserver?.disconnect();
    this.dprQueryCleanup?.();
  }

  // ── Extension hooks ───────────────────────────────────────────────────────

  /**
   * Called each frame after the background image is drawn.
   * Override to draw boxes, annotations, measurements, etc.
   */
  protected renderOverlays(
    _ctx: CanvasRenderingContext2D,
    _cam: Camera,
    _canvas: HTMLCanvasElement,
    _viewBounds: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    // Base does nothing — subclass overrides
  }

  /**
   * Called once after view init. Override to set up reactive effects
   * that depend on labeling state (box sync, cursor changes, etc.)
   */
  protected setupFeatureEffects(): void {}

  /**
   * Called once after view init. Override to register hotkeys.
   */
  protected setupFeatureHotkeys(): void {}

  // ── Pan state ─────────────────────────────────────────────────────────────

  private _isPanning = false;
  private _panStart: { x: number; y: number } | null = null;

  // ── Pointer pan ───────────────────────────────────────────────────────────

  /**
   * Returns true if this pointer event should initiate a pan.
   * Middle button always pans; subclasses may override to restrict further.
   */
  protected shouldBasePan(e: PointerEvent): boolean {
    return e.button === 0 || e.button === 1 || e.buttons === 4;
  }

  onBasePointerDown(e: PointerEvent): void {
    if (!this.shouldBasePan(e)) return;
    e.preventDefault();
    this._isPanning = true;
    this._panStart = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  onBasePointerMove(e: PointerEvent): void {
    if (!this._isPanning || !this._panStart || !this.state.bgCanvas()) return;
    const dx = (e.clientX - this._panStart.x) * this.state.devicePixelRatio();
    const dy = (e.clientY - this._panStart.y) * this.state.devicePixelRatio();
    this._panStart = { x: e.clientX, y: e.clientY };
    const canvas = this.canvasRef.nativeElement;
    const bgc = this.state.bgCanvas()!;
    const newCam = CameraHandler.pan(
      dx, dy,
      this.state.camera(),
      canvas.width, canvas.height,
      bgc.width, bgc.height,
      this.state.minZoom(),
    );
    this.state.updateCamera(newCam);
    this.scheduleRender();
  }

  onBasePointerUp(e: PointerEvent): void {
    if (!this._isPanning) return;
    this._isPanning = false;
    this._panStart = null;
  }

  // ── Wheel (zoom) ──────────────────────────────────────────────────────────

  onWheel(e: WheelEvent): void {
    if (!this.state.bgCanvas()) return;
    e.preventDefault();
    const canvas = this.canvasRef.nativeElement;
    const bgc = this.state.bgCanvas()!;
    const cam = this.state.camera();
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * this.state.devicePixelRatio();
    const my = (e.clientY - rect.top) * this.state.devicePixelRatio();
    const absPos = CoordinateTransform.screenToAbsolute(mx, my, canvas.width, canvas.height, cam);
    const newCamera = CameraHandler.zoom(
      e.deltaY,
      absPos.x,
      absPos.y,
      cam,
      canvas.width,
      canvas.height,
      bgc.width,
      bgc.height,
      this.state.minZoom(),
    );
    this.state.updateCamera(newCamera);
    this.scheduleRender();
    this.zoomChange.emit(this.state.camera().zoom);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  resetCamera(): void {
    const defaultZoom = this.state.minZoom() > 0 ? this.state.minZoom() : 1;
    this.state.updateCamera({ zoom: defaultZoom, x: 0, y: 0 });
    this.scheduleRender();
    this.zoomChange.emit(this.state.camera().zoom);
  }

  // ── Infrastructure ────────────────────────────────────────────────────────

  protected scheduleRender(): void {
    this.dirty.set(true);
  }

  protected clampCamera(cam: Camera): Camera {
    if (!this.state.bgCanvas()) return cam;
    const canvas = this.canvasRef.nativeElement;
    return CameraUtils.clampCamera(
      cam,
      canvas.width,
      canvas.height,
      this.state.bgCanvas()!.width,
      this.state.bgCanvas()!.height,
      this.state.minZoom(),
    );
  }

  protected onResize(): void {
    const canvas = this.canvasRef.nativeElement;
    const wrapper = this.el.nativeElement.parentElement as HTMLElement;
    if (!wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const dpr = this.state.devicePixelRatio();
    const containerWidth = rect.width * dpr;
    const containerHeight = rect.height * dpr;

    let w: number, h: number;
    const containerAspectRatio = containerWidth / containerHeight;
    if (containerAspectRatio > this.state.canvasAspectRatio()) {
      h = Math.max(1, Math.floor(containerHeight));
      w = Math.max(1, Math.floor(h * this.state.canvasAspectRatio()));
    } else {
      w = Math.max(1, Math.floor(containerWidth));
      h = Math.max(1, Math.floor(w / this.state.canvasAspectRatio()));
    }

    canvas.width = w;
    canvas.height = h;
    // Re-apply context state lost when canvas.width is reassigned
    const ctx = this.state.ctx();
    if (ctx) ctx.imageSmoothingEnabled = false;

    const cssW = w / dpr;
    const cssH = h / dpr;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    const host = this.el.nativeElement as HTMLElement;
    host.style.width = cssW + 'px';
    host.style.height = cssH + 'px';

    const root = host.querySelector('.viewport-root') as HTMLElement | null;
    if (root) {
      root.style.width = cssW + 'px';
      root.style.height = cssH + 'px';
    }

    if (this.state.bgCanvas()) {
      this.state.updateMinZoom(
        BackgroundUtils.recalculateMinZoom(
          w,
          h,
          this.state.bgCanvas()!.width,
          this.state.bgCanvas()!.height,
        ),
      );
      this.state.updateCamera({ zoom: this.state.minZoom(), x: 0, y: 0 });
    }
    this.scheduleRender();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private initializeCanvas(): void {
    const canvas = this.canvasRef.nativeElement;
    this.state.updateDevicePixelRatio(window.devicePixelRatio || 1);
    this.onResize();
    this.state.updateContext(
      LifecycleManager.initializeCanvas(canvas, this.state.devicePixelRatio()),
    );
  }

  private setupPageResizeObserver(): void {
    const wrapper = this.el.nativeElement.parentElement as HTMLElement;
    this.resizeObserver = LifecycleManager.setupPageResizeObserver(wrapper, () => this.onResize());
  }

  private setupDprChangeDetection(): void {
    const handleDprChange = () => {
      this.state.updateDevicePixelRatio(window.devicePixelRatio || 1);
      this.onResize();
      this.zoomChange.emit(this.state.camera().zoom);
      this.setupDprChangeDetection();
    };
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', handleDprChange);
    this.dprQueryCleanup?.();
    this.dprQueryCleanup = () => mq.removeEventListener('change', handleDprChange);
  }

  private startRenderLoop(): void {
    this._stopRenderLoop = LifecycleManager.startRenderLoop(this.dirty, () => {
      this.renderFrame();
      this.dirty.set(false);
    });
  }

  private renderFrame(): void {
    const bgc = this.state.bgCanvas();
    const ctx = this.state.ctx();
    if (!ctx || !bgc) return;

    const canvas = this.canvasRef.nativeElement;
    const cam = this.state.camera();

    // Clear + apply camera transform + draw background
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    RenderUtils.applyCameraTransform(ctx, canvas.width, canvas.height, cam);
    ctx.drawImage(bgc, -bgc.width / 2, -bgc.height / 2);

    const viewBounds = CameraUtils.getViewBoundsInAbsolute(canvas.width, canvas.height, cam);
    this.renderOverlays(ctx, cam, canvas, viewBounds);
  }

  protected async loadPlaceholder(): Promise<void> {
    const canvas = this.canvasRef.nativeElement;
    const result = await BackgroundUtils.loadPlaceholder(canvas.width, canvas.height);

    this.state.updateBgCanvas(result.canvas);
    this.state.updateMinZoom(result.minZoom);

    if (this.state.bgCanvas()!.width > 0 && this.state.bgCanvas()!.height > 0) {
      this.state.updateCanvasAspectRatio(
        this.state.bgCanvas()!.width / this.state.bgCanvas()!.height,
      );
    }

    this.onResize();
    this.state.updateCamera({ zoom: this.state.minZoom(), x: 0, y: 0 });
    this.scheduleRender();
  }

  protected async loadBackground(url: string): Promise<void> {
    const canvas = this.canvasRef.nativeElement;
    try {
      await this.loadPlaceholder();
    } catch (error) {
      console.error('Failed to load placeholder:', error);
    }

    let result = { canvas: canvas, minZoom: 1 };
    try {
      result = await BackgroundUtils.loadBackground(url, canvas.width, canvas.height);
    } catch (error) {
      console.error('Failed to load background image:', error);
    }

    this.state.updateBgCanvas(result.canvas);
    this.state.updateMinZoom(result.minZoom);

    if (this.state.bgCanvas()!.width > 0 && this.state.bgCanvas()!.height > 0) {
      this.state.updateCanvasAspectRatio(
        this.state.bgCanvas()!.width / this.state.bgCanvas()!.height,
      );
    }

    this.onResize();
    this.state.updateCamera({ zoom: this.state.minZoom(), x: 0, y: 0 });
    this.scheduleRender();
  }
}
