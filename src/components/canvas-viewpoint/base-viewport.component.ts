import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  Input,
  Output,
  EventEmitter,
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
 * Base viewport component — pure image viewer with zoom/pan.
 *
 * Provides the shared canvas infrastructure for all viewport variants:
 * - Background image loading (with a placeholder while the real image loads)
 * - Scroll-to-zoom centred on the cursor
 * - Pointer-drag pan (left-click by default; override `shouldBasePan` to restrict)
 * - Device pixel ratio management and resize handling
 * - A 60 fps rAF render loop driven by a plain dirty flag (no Angular signal
 *   overhead in the hot path — see `_dirty`)
 * - Extension hooks: `renderOverlays()`, `setupFeatureEffects()`, `setupFeatureHotkeys()`
 *
 * ## Extending
 * ```ts
 * export class MyViewport extends BaseViewportComponent {
 *   protected override renderOverlays(ctx, cam, canvas, viewBounds) {
 *     // Draw your overlays — do NOT call super(); you own the full frame.
 *   }
 *   protected override setupFeatureEffects() {
 *     // Register Angular effects with { injector: this.injector }.
 *   }
 * }
 * ```
 *
 * ## Performance notes
 * - `_dirty` is a plain boolean, not an Angular signal, so `scheduleRender()`
 *   never touches Angular's reactive graph on every pointer event.
 * - `ChangeDetectionStrategy.OnPush` prevents unnecessary CD cycles when
 *   unrelated signals elsewhere in the app change.
 */
@Component({
  selector: 'app-base-viewport',
  templateUrl: './base-viewport.html',
  styleUrls: ['./base-viewport.css'],
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BaseViewportComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvasEl', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  // ── @Inputs ──────────────────────────────────────────────────────────────

  /** URL of the background image to display. When changed, reloads the image. */
  @Input() backgroundUrl?: string;

  /** CSS brightness filter (0–200, default 100). Applied via canvas CSS filter. */
  @Input() set brightnessInput(value: number) {
    if (value !== this.state.brightness()) this.state.updateBrightness(value);
  }
  /** CSS contrast filter (0–200, default 100). Applied via canvas CSS filter. */
  @Input() set contrastInput(value: number) {
    if (value !== this.state.contrast()) this.state.updateContrast(value);
  }
  /**
   * When true, disables all pan/zoom interactions (pointer + wheel).
   * Subclasses should also gate their own interactions behind this flag.
   */
  @Input() set readOnlyMode(value: boolean) {
    if (value !== this.state.readOnlyMode()) this.state.updateReadOnlyMode(value);
  }

  // ── @Outputs ─────────────────────────────────────────────────────────────

  /** Emitted whenever the camera zoom level changes (wheel, pinch, zoomToBox, resetCamera). */
  @Output() zoomChange = new EventEmitter<number>();

  // ── State ─────────────────────────────────────────────────────────────────

  /**
   * Holds all reactive state for the viewport (camera, bgCanvas, DPR, display
   * settings, etc.). Subclasses narrow this to their own state manager type
   * using `declare protected state: MyStateManager`.
   */
  protected state: BaseStateManager;

  // ── Dirty flag ────────────────────────────────────────────────────────────

  /**
   * Plain boolean dirty flag for the render loop.
   *
   * Intentionally NOT an Angular signal. Every pointer move, pan tick, and
   * render frame would otherwise push writes through Angular's reactive graph,
   * scheduling change detection at 60–120 Hz. Using a plain boolean keeps
   * `scheduleRender()` and the rAF loop entirely outside Angular.
   *
   * Set to `true` via `scheduleRender()`. Cleared to `false` by the render
   * loop after each frame is drawn.
   */
  protected _dirty = true;

  // ── Infra ─────────────────────────────────────────────────────────────────

  private resizeObserver?: ResizeObserver;
  private _stopRenderLoop: () => void = () => {};
  private dprQueryCleanup: (() => void) | null = null;

  // ── Computed ──────────────────────────────────────────────────────────────

  /**
   * CSS filter string derived from brightness and contrast signals.
   * Bound to the canvas element's `[style.filter]` in the template.
   * Angular re-evaluates this only when either signal changes.
   */
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
   * Core render hook — called once per dirty frame by the rAF loop.
   *
   * The default implementation clears the canvas and draws the background
   * image centred under the camera transform. This is sufficient for the
   * pure image-viewer use case.
   *
   * **Subclasses must override this completely** (do NOT call `super()`) to
   * draw annotations, boxes, measurements, etc. The override is responsible
   * for the full frame: clear → background → overlays.
   *
   * @param ctx         - The 2D rendering context for the main canvas.
   * @param cam         - Current camera state (zoom, x, y).
   * @param canvas      - The HTMLCanvasElement (for width/height lookups).
   * @param _viewBounds - Visible area in absolute image coordinates. Use this
   *                      to cull objects outside the viewport.
   */
  protected renderOverlays(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    canvas: HTMLCanvasElement,
    _viewBounds: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    const bgc = this.state.bgCanvas();
    if (!bgc) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    RenderUtils.applyCameraTransform(ctx, canvas.width, canvas.height, cam);
    ctx.drawImage(bgc, -bgc.width / 2, -bgc.height / 2);
  }

  /**
   * Called once from `ngAfterViewInit`. Override to register Angular `effect()`
   * calls that depend on labeling state (box sync, cursor changes, emit
   * selection, etc.).
   *
   * Because this runs outside the constructor, effects **must** be created
   * with an explicit injector:
   * ```ts
   * const opts = { injector: this.injector };
   * effect(() => { ... }, opts);
   * ```
   */
  protected setupFeatureEffects(): void {}

  /**
   * Called once from `ngAfterViewInit`. Override to register keyboard shortcuts
   * via `HotkeyService`. Store the returned unsubscribe functions and call them
   * in `ngOnDestroy`.
   */
  protected setupFeatureHotkeys(): void {}

  // ── Pan state ─────────────────────────────────────────────────────────────

  private _isPanning = false;
  private _panStart: { x: number; y: number } | null = null;

  // ── Pointer pan ───────────────────────────────────────────────────────────

  /**
   * Determines whether a pointer-down event should begin a camera pan.
   *
   * Default (base): left-click (button 0) or middle-click (button 1).
   * `CanvasViewportComponent` overrides this to allow middle-click only,
   * reserving left-click for box interactions.
   *
   * Override to customise pan activation (e.g. require a modifier key).
   */
  protected shouldBasePan(e: PointerEvent): boolean {
    return e.button === 0 || e.button === 1 || e.buttons === 4;
  }

  /**
   * Starts a camera pan if `shouldBasePan` approves. Captures the pointer
   * so pan continues even if the cursor leaves the element.
   */
  onBasePointerDown(e: PointerEvent): void {
    if (!this.shouldBasePan(e)) return;
    e.preventDefault();
    this._isPanning = true;
    this._panStart = { x: e.clientX, y: e.clientY };
    // Pointer capture ensures move/up events keep firing even outside the element
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  /** Applies incremental pan deltas to the camera while dragging. */
  onBasePointerMove(e: PointerEvent): void {
    if (!this._isPanning || !this._panStart || !this.state.bgCanvas()) return;
    // Scale CSS pixel delta to physical canvas pixels
    const dx = (e.clientX - this._panStart.x) * this.state.devicePixelRatio();
    const dy = (e.clientY - this._panStart.y) * this.state.devicePixelRatio();
    this._panStart = { x: e.clientX, y: e.clientY };
    const canvas = this.canvasRef.nativeElement;
    const bgc = this.state.bgCanvas()!;
    const newCam = CameraHandler.pan(
      dx,
      dy,
      this.state.camera(),
      canvas.width,
      canvas.height,
      bgc.width,
      bgc.height,
      this.state.minZoom(),
    );
    this.state.updateCamera(newCam);
    this.scheduleRender();
  }

  /** Ends the pan gesture. Also called on `pointercancel`. */
  onBasePointerUp(_e: PointerEvent): void {
    if (!this._isPanning) return;
    this._isPanning = false;
    this._panStart = null;
  }

  // ── Wheel (zoom) ──────────────────────────────────────────────────────────

  /**
   * Handles scroll-wheel zoom, centred on the cursor position.
   *
   * Converts the cursor's CSS-pixel position to absolute image coordinates
   * before zooming so that the point under the cursor stays fixed.
   * Overridden by `CanvasViewportComponent` to also update the scale bar.
   */
  onWheel(e: WheelEvent): void {
    if (!this.state.bgCanvas()) return;
    e.preventDefault();
    const canvas = this.canvasRef.nativeElement;
    const bgc = this.state.bgCanvas()!;
    const cam = this.state.camera();
    const rect = canvas.getBoundingClientRect();
    // Convert cursor to physical canvas pixels
    const mx = (e.clientX - rect.left) * this.state.devicePixelRatio();
    const my = (e.clientY - rect.top) * this.state.devicePixelRatio();
    // Convert to absolute image coordinates so we can zoom towards this point
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

  /** Resets the camera to the minimum zoom level with the image centred. */
  resetCamera(): void {
    const defaultZoom = this.state.minZoom() > 0 ? this.state.minZoom() : 1;
    this.state.updateCamera({ zoom: defaultZoom, x: 0, y: 0 });
    this.scheduleRender();
    this.zoomChange.emit(this.state.camera().zoom);
  }

  // ── Infrastructure ────────────────────────────────────────────────────────

  /**
   * Marks the canvas as needing a redraw on the next rAF tick.
   *
   * Zero-cost write to a plain boolean — does not interact with Angular's
   * reactive graph, so it is safe to call from every pointer event and
   * animation frame without performance impact.
   */
  protected scheduleRender(): void {
    this._dirty = true;
  }

  /**
   * Clamps `cam` so the image cannot be panned fully out of view.
   * Delegates to `CameraUtils.clampCamera` with the current canvas and image dimensions.
   */
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

  /**
   * Recalculates canvas physical/CSS dimensions to fill the parent container
   * while preserving the background image's aspect ratio.
   *
   * Called on:
   * - Initial mount (`ngAfterViewInit` → `initializeCanvas`)
   * - Container resize (`ResizeObserver`)
   * - DPR changes (screen moved to a different display)
   *
   * Also resets `minZoom` and the camera to fit the image after every resize.
   * Subclasses should call `super.onResize()` first, then update any
   * size-dependent signals (e.g. `viewportWidth` / `viewportHeight`).
   */
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

  /** Sets DPR, runs an initial resize, and obtains the 2D context. */
  private initializeCanvas(): void {
    const canvas = this.canvasRef.nativeElement;
    this.state.updateDevicePixelRatio(window.devicePixelRatio || 1);
    this.onResize();
    this.state.updateContext(
      LifecycleManager.initializeCanvas(canvas, this.state.devicePixelRatio()),
    );
  }

  /** Attaches a ResizeObserver to the parent element so the canvas reflows automatically. */
  private setupPageResizeObserver(): void {
    const wrapper = this.el.nativeElement.parentElement as HTMLElement;
    this.resizeObserver = LifecycleManager.setupPageResizeObserver(wrapper, () => this.onResize());
  }

  /**
   * Listens for DPR changes (e.g. moving the window between displays).
   *
   * Uses a `matchMedia` query for the current exact DPR so it fires only once
   * per change. After firing it re-registers itself to watch the new DPR value.
   * The previous listener is cleaned up via `dprQueryCleanup`.
   */
  private setupDprChangeDetection(): void {
    const handleDprChange = () => {
      this.state.updateDevicePixelRatio(window.devicePixelRatio || 1);
      this.onResize();
      this.zoomChange.emit(this.state.camera().zoom);
      // Re-register for the new DPR value
      this.setupDprChangeDetection();
    };
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', handleDprChange);
    this.dprQueryCleanup?.(); // Clean up the previous listener first
    this.dprQueryCleanup = () => mq.removeEventListener('change', handleDprChange);
  }

  /**
   * Starts the rAF-based render loop via `LifecycleManager`.
   *
   * The loop checks `_dirty` (a plain boolean) each frame and only invokes
   * `renderFrame()` when there is something new to draw. After rendering,
   * `_dirty` is reset to false until the next `scheduleRender()` call.
   */
  private startRenderLoop(): void {
    this._stopRenderLoop = LifecycleManager.startRenderLoop(
      () => this._dirty,
      () => {
        this.renderFrame();
        this._dirty = false;
      },
    );
  }

  /**
   * Computes the current view bounds in absolute image coordinates and
   * dispatches to `renderOverlays`. Single entry point called by the rAF
   * loop each dirty frame.
   */
  private renderFrame(): void {
    const ctx = this.state.ctx();
    if (!ctx) return;

    const canvas = this.canvasRef.nativeElement;
    const cam = this.state.camera();
    const viewBounds = CameraUtils.getViewBoundsInAbsolute(canvas.width, canvas.height, cam);
    this.renderOverlays(ctx, cam, canvas, viewBounds);
  }

  /**
   * Loads a grey placeholder canvas while the real background image is
   * fetching. Calls `onResize()` and resets the camera afterwards.
   */
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

  /**
   * Loads the background image from `url`.
   *
   * Shows the placeholder first (so the canvas is never blank), then swaps in
   * the real image once decoded. Resets `minZoom` and the camera to fit the
   * new image dimensions.
   *
   * @param url - URL of the image to load.
   */
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
