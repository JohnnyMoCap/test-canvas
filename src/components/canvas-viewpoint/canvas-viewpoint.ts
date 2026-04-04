import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  Input,
  Output,
  EventEmitter,
  signal,
  effect,
  computed,
} from '@angular/core';
import { Box, getBoxId } from '../../interface/boxes.interface';
import { Quadtree } from './core/quadtree';
import { Camera, PointerHandlerContext, TextMetrics } from './core/types';
import { BoxType } from './core/creation-state';
import { CameraUtils } from './utils/camera-utils';
import { BoxCreationUtils } from './utils/box-creation-utils';
import { ContextMenuUtils } from './utils/context-menu-utils';
import { FrameRenderer } from './utils/frame-renderer';
import { CursorStyles } from './cursor/cursor-styles';
import { MeasurementHandler } from './handlers/measurement.handler';
import { CoordinateTransform } from './utils/coordinate-transform';

import { LabelingStateManager } from './utils/labeling-state-manager';
import { LifecycleManager } from './utils/lifecycle-manager';
import { PointerEventHandler } from './handlers/pointer-event-handler';
import { ClipboardManager } from './utils/clipboard-manager';
import { isNullOrUndefined } from './utils/validation-utils';
import { MagicDetectionHandler } from './handlers/magic-detection.handler';

import { BoxContextMenuComponent } from './box-context-menu.component';
import { ScaleBarComponent } from './scale-bar.component';
import { HistoryService } from '../../services/history.service';
import { HotkeyService } from '../../services/hotkey.service';
import { BaseViewportComponent } from './base-viewport.component';

/**
 * Full labeling viewport — extends `BaseViewportComponent` with box annotation,
 * magic detection, measurement, undo/redo, clipboard, and touch support.
 *
 * ## Interaction model
 * - **Left-click + drag**: create/resize/move boxes (delegated to `PointerEventHandler`)
 * - **Middle-click + drag**: pan the camera (via `shouldBasePan` override)
 * - **Scroll wheel / pinch**: cursor-centred zoom
 * - **Keyboard**: undo/redo/copy/paste/delete/escape via `HotkeyService`
 *
 * ## State
 * All reactive state lives in `LabelingStateManager` (narrows the base class
 * `BaseStateManager` via `declare protected state`).
 *
 * ## Render pipeline
 * The rAF loop calls `renderOverlays()` each dirty frame:
 *   1. Query visible boxes from the spatial quadtree
 *   2. Resolve the current mouse position in absolute image coords
 *   3. Delegate the full draw to `FrameRenderer.renderFrame`
 */
@Component({
  selector: 'app-canvas-viewport',
  templateUrl: './canvas-viewpoint.html',
  styleUrls: ['./canvas-viewpoint.css'],
  standalone: true,
  imports: [BoxContextMenuComponent, ScaleBarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CanvasViewportComponent extends BaseViewportComponent {
  @ViewChild('scaleBarRef') scaleBarRef?: ScaleBarComponent;

  // ── Override state to the narrow labeling type ───────────────────────────

  /**
   * TypeScript-only type narrowing — no runtime field is emitted.
   * Declares that `this.state` is a `LabelingStateManager` (a subtype of
   * `BaseStateManager`) so labeling-specific signals are accessible without casts.
   */
  declare protected state: LabelingStateManager;

  // ── Labeling-specific @Inputs ────────────────────────────────────────────

  @Input() set isCreateModeInput(value: boolean) {
    if (value !== this.state.isCreateMode()) {
      this.toggleCreateMode();
    }
  }
  @Input() set isMagicModeInput(value: boolean) {
    if (value !== this.state.isMagicMode()) {
      this.toggleMagicMode();
    }
  }
  @Input() set magicAutoTuneInput(value: boolean) {
    if (value !== this.state.magicAutoTune()) {
      this.state.updateMagicAutoTune(value);
    }
  }
  /** Fixed tolerance used when magicAutoTune is off (Manhattan RGB distance, 0–765). */
  @Input() set magicToleranceInput(value: number) {
    if (value !== this.state.magicTolerance()) {
      this.state.updateMagicTolerance(value);
    }
  }
  /** ±Sensitivity offset applied on top of the auto-tuned tolerance. */
  @Input() set magicAdjustmentInput(value: number) {
    if (value !== this.state.magicAdjustment()) {
      this.state.updateMagicAdjustment(value);
    }
  }
  @Input() set debugMagicInput(value: boolean) {
    if (value !== this.state.debugMagicDetection()) {
      this.state.updateDebugMagicDetection(value);
    }
  }
  @Input() set showPendingStateInput(value: boolean) {
    if (value !== this.state.showPendingState()) {
      this.state.updateShowPendingState(value);
    }
  }
  @Input() set isMeasurementModeInput(value: boolean) {
    const currentlyActive = this.state.measurementState().isActive;
    if (value !== currentlyActive) {
      this.toggleMeasurementMode();
    }
  }
  @Input() set metricWidthInput(value: number) {
    const current = this.state.measurementState().metricWidth;
    if (value !== current) {
      this.updateMetricDimensions(value, this.state.measurementState().metricHeight);
    }
  }
  @Input() set metricHeightInput(value: number) {
    const current = this.state.measurementState().metricHeight;
    if (value !== current) {
      this.updateMetricDimensions(this.state.measurementState().metricWidth, value);
    }
  }
  @Input() set externalHoverBoxId(value: number | null) {
    if (value !== null && value !== this.state.selectedBoxId()) {
      this.state.updateHoverState(value);
      this.scheduleRender();
    }
  }
  @Input() set externalSelectBoxId(value: number | null) {
    if (value === null) {
      this.state.updateSelectedBox(null);
      this.scheduleRender();
      return;
    }
    if (value !== null && value !== this.state.selectedBoxId()) {
      const boxId = value;
      this.state.updateSelectedBox(boxId);
      this.zoomToBox(boxId);
      if (this.state.readOnlyMode()) {
        this.state.updateSelectedBox(null);
      }
      this.scheduleRender();
    }
  }

  // ── Labeling-specific @Outputs ───────────────────────────────────────────

  @Output() createModeChange = new EventEmitter<boolean>();
  @Output() magicModeChange = new EventEmitter<boolean>();
  @Output() measurementModeChange = new EventEmitter<boolean>();
  @Output() selectedBoxChange = new EventEmitter<number | null>();
  @Output() hoveredBoxChange = new EventEmitter<number | null>();

  // ── Fields ────────────────────────────────────────────────────────────────

  private hotkeyUnsubs: (() => void)[] = [];
  private nametagMetricsCache = new Map<string, TextMetrics>();
  private magicHandler!: MagicDetectionHandler;
  /** Spatial index of the current box set; rebuilt after every structural change. */
  protected quadtree?: Quadtree<Box>;

  // ── Computed (labeling-specific) ──────────────────────────────────────────

  contextMenuVisible = computed(() => this.state.contextMenuState()?.visible ?? false);
  contextMenuX = computed(() => this.state.contextMenuState()?.x ?? 0);
  contextMenuY = computed(() => this.state.contextMenuState()?.y ?? 0);

  viewportWidth = signal(0);
  viewportHeight = signal(0);
  scaleBarZoom = computed(() => this.state.camera().zoom);
  scaleBarImageWidth = computed(() => this.state.bgCanvas()?.width || 0);
  scaleBarImageHeight = computed(() => this.state.bgCanvas()?.height || 0);
  scaleBarMetricWidth = computed(() => this.state.measurementState().metricWidth);
  scaleBarMetricHeight = computed(() => this.state.measurementState().metricHeight);

  // ── Constructor ───────────────────────────────────────────────────────────

  constructor(
    private historyService: HistoryService,
    private hotkeyService: HotkeyService,
    el: ElementRef,
  ) {
    super(el);
    this.state = new LabelingStateManager(ContextMenuUtils.close());
    this.magicHandler = new MagicDetectionHandler(
      this.historyService,
      () => this.scheduleRender(),
      () => this.rebuildIndex(),
    );

    //TODO: make sure to do this consistently when changing to a new photo
    // Initialize nextTempId to avoid collisions with existing box IDs
    const existingIds = this.historyService.visibleBoxes().map((b) => getBoxId(b));
    const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;
    this.state.setNextTempId(maxId + 1);
  }

  // ── Lifecycle overrides ───────────────────────────────────────────────────

  override ngOnDestroy(): void {
    super.ngOnDestroy();
    this.hotkeyUnsubs.forEach((fn) => fn());
    this.magicHandler.destroy();
  }

  // ── Resize override ────────────────────────────────────────────────────────

  protected override onResize(): void {
    super.onResize();
    const dpr = this.state.devicePixelRatio();
    this.viewportWidth.set(this.canvasRef.nativeElement.width / dpr);
    this.viewportHeight.set(this.canvasRef.nativeElement.height / dpr);
  }

  // ── Render hook ───────────────────────────────────────────────────────────

  protected override renderOverlays(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    canvas: HTMLCanvasElement,
    viewBounds: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    const bgc = this.state.bgCanvas();
    if (!bgc) return;
    const visibleBoxes = this.queryVisible(viewBounds);

    let currentMouseAbs: { x: number; y: number } | null = null;
    const lastMouse = this.state.lastMouseScreen();
    if (lastMouse) {
      const rect = canvas.getBoundingClientRect();
      const mx = (lastMouse.x - rect.left) * this.state.devicePixelRatio();
      const my = (lastMouse.y - rect.top) * this.state.devicePixelRatio();
      currentMouseAbs = CoordinateTransform.screenToAbsolute(
        mx,
        my,
        canvas.width,
        canvas.height,
        cam,
      );
    }

    FrameRenderer.renderFrame(
      ctx,
      canvas,
      cam,
      bgc,
      visibleBoxes,
      bgc.width,
      bgc.height,
      this.state.hoveredBoxId(),
      this.state.selectedBoxId(),
      this.state.showNametags(),
      this.nametagMetricsCache,
      this.state.createState(),
      this.state.debugShowQuadtree(),
      this.quadtree,
      this.state.measurementState(),
      currentMouseAbs,
      this.state.showPendingState(),
    );
  }

  // ── Setup hooks ───────────────────────────────────────────────────────────

  protected override setupFeatureEffects(): void {
    const opts = { injector: this.injector };

    // Sync local boxes from history service (but not during active interactions)
    effect(() => {
      if (this.state.isDraggingOrInteracting()) {
        return;
      }
      const boxes = this.historyService.visibleBoxes();
      const newIds = new Set(boxes.map((b) => String(getBoxId(b))));
      for (const key of this.nametagMetricsCache.keys()) {
        if (!newIds.has(key)) this.nametagMetricsCache.delete(key);
      }
      this.state.updateLocalBoxes([...boxes]);
      this.rebuildIndex();
    }, opts);

    // Trigger render on camera or box changes
    effect(() => {
      const _ = this.state.camera();
      const __ = this.state.localBoxes();
      const ___ = this.state.createState();
      this.scheduleRender();
    }, opts);

    // Reactive cursor updates
    effect(() => {
      const canvas = this.canvasRef.nativeElement;
      if (!canvas) return;
      const cursor = this.state.currentCursor();

      if (this.state.isCreateMode() || this.state.isMagicMode()) {
        canvas.style.cursor = CursorStyles.getCreateModeCursor();
        return;
      }

      canvas.style.cursor = cursor;
    }, opts);

    // Emit selection changes to parent
    effect(() => {
      this.selectedBoxChange.emit(this.state.selectedBoxId());
    }, opts);

    // Emit hover changes to parent
    effect(() => {
      this.hoveredBoxChange.emit(this.state.hoveredBoxId());
    }, opts);
  }

  protected override setupFeatureHotkeys(): void {
    this.hotkeyUnsubs.push(
      this.hotkeyService.on('UNDO', () => this.handleUndo()),
      this.hotkeyService.on('REDO', () => this.handleRedo()),
      this.hotkeyService.on('COPY', () => this.handleCopy()),
      this.hotkeyService.on('PASTE', () => this.handlePaste()),
      this.hotkeyService.on('DELETE', () => this.handleDelete()),
      this.hotkeyService.on('ESCAPE', () => this.handleEscape()),
    );
  }

  // ── Pointer overrides ─────────────────────────────────────────────────────

  /**
   * Restricts camera pan to middle-click only.
   *
   * Left-click (button 0) is reserved for box interactions handled by
   * `PointerEventHandler`. Overrides the base class default which allows
   * left-click pan.
   */
  protected override shouldBasePan(e: PointerEvent): boolean {
    // Left button is reserved for box interactions; only allow middle-click pan
    return e.button === 1 || e.buttons === 4;
  }

  /**
   * Bundles the context object passed to every `PointerEventHandler` call.
   * Computed lazily so it always reflects the latest canvas ref and state.
   */
  private get pointerContext(): PointerHandlerContext {
    return {
      canvas: this.canvasRef.nativeElement,
      state: this.state,
      quadtree: this.quadtree,
      nametagMetricsCache: this.nametagMetricsCache,
      historyService: this.historyService,
    };
  }

  /**
   * Handles scroll-wheel zoom and also briefly shows the scale bar.
   * Delegates zoom math to `PointerEventHandler.handleWheel`.
   */
  override onWheel(e: WheelEvent): void {
    if (!this.state.bgCanvas()) return;
    PointerEventHandler.handleWheel(e, this.pointerContext);
    this.scheduleRender();
    this.zoomChange.emit(this.state.camera().zoom);
    this.scaleBarRef?.show();
  }

  /** Routes pointer-down to box creation, selection, or resize via `PointerEventHandler`. */
  onPointerDown(e: PointerEvent): void {
    if (!this.state.bgCanvas()) return;
    PointerEventHandler.handlePointerDown(e, this.magicHandler, this.pointerContext);
  }

  /** Finalises the current interaction and rebuilds the spatial index. */
  onPointerUp(e: PointerEvent): void {
    if (!this.state.bgCanvas()) return;
    PointerEventHandler.handlePointerUp(e, this.pointerContext);
    this.rebuildIndex();
    this.scheduleRender();
  }

  /**
   * Handles ongoing pointer movement.
   * If the cursor leaves the canvas while an interaction is active, synthesises
   * a pointer-up to cleanly end the gesture.
   */
  onPointerMove(e: PointerEvent): void {
    if (!this.state.bgCanvas()) return;

    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const isOutsideCanvas =
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom;

    if (isOutsideCanvas && (this.state.isDraggingOrInteracting() || this.state.isCreateMode())) {
      this.onPointerUp(e);
      return;
    }

    PointerEventHandler.handlePointerMove(e, this.pointerContext);
    this.scheduleRender();
    this.scaleBarRef?.show();
  }

  /** Starts a single-finger drag or records the initial two-finger pinch distance. */
  onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    if (e.touches.length >= 2) {
      this._lastPinchDist = this.pinchDist(e.touches[0], e.touches[1]);
    } else if (e.touches.length === 1) {
      this._lastPinchDist = null;
      this.onPointerDown(this.touchToPointer(e.touches[0]));
    }
  }

  /** Dispatches two-finger moves to `handlePinchZoom` and single-finger moves to pointer logic. */
  onTouchMove(e: TouchEvent): void {
    e.preventDefault();
    if (e.touches.length >= 2) {
      this.handlePinchZoom(e.touches[0], e.touches[1]);
    } else if (e.touches.length === 1 && this._lastPinchDist === null) {
      this.onPointerMove(this.touchToPointer(e.touches[0]));
    }
  }

  /** Ends the current touch gesture and resets the pinch distance. */
  onTouchEnd(e: TouchEvent): void {
    e.preventDefault();
    this._lastPinchDist = null;
    if (e.changedTouches.length > 0) {
      this.onPointerUp(this.touchToPointer(e.changedTouches[0]));
    }
  }

  /** Distance between the two touch points at the previous pinch event; null when not pinching. */
  private _lastPinchDist: number | null = null;

  /**
   * Wraps a `Touch` point in a synthetic `PointerEvent` so the shared pointer
   * handler pipeline can process touch and mouse events uniformly.
   */
  private touchToPointer(touch: Touch): PointerEvent {
    return new PointerEvent('pointermove', {
      clientX: touch.clientX,
      clientY: touch.clientY,
      button: 0,
      buttons: 1,
      bubbles: true,
      cancelable: true,
    });
  }

  /** Euclidean distance (CSS pixels) between two touch points. */
  private pinchDist(t0: Touch, t1: Touch): number {
    const dx = t1.clientX - t0.clientX;
    const dy = t1.clientY - t0.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Applies a pinch-zoom step, keeping the midpoint between the two fingers
   * fixed in absolute image coordinates.
   *
   * Computes the zoom ratio from the change in finger distance, converts the
   * midpoint to image-space, and adjusts the camera translation so that the
   * midpoint does not appear to move.
   */
  private handlePinchZoom(t0: Touch, t1: Touch): void {
    const bgc = this.state.bgCanvas();
    if (!bgc || this._lastPinchDist === null) return;

    const newDist = this.pinchDist(t0, t1);
    const ratio = newDist / this._lastPinchDist;
    this._lastPinchDist = newDist;

    const canvas = this.canvasRef.nativeElement;
    const cam = this.state.camera();
    const newZoom = Math.max(this.state.minZoom(), Math.min(10, cam.zoom * ratio));

    const rect = canvas.getBoundingClientRect();
    const mx = ((t0.clientX + t1.clientX) / 2 - rect.left) * this.state.devicePixelRatio();
    const my = ((t0.clientY + t1.clientY) / 2 - rect.top) * this.state.devicePixelRatio();
    const absMid = CoordinateTransform.screenToAbsolute(mx, my, canvas.width, canvas.height, cam);

    const dx = absMid.x - cam.x;
    const dy = absMid.y - cam.y;
    const scale = 1 - cam.zoom / newZoom;
    const newCamera = this.clampCamera({
      ...cam,
      zoom: newZoom,
      x: cam.x + dx * scale,
      y: cam.y + dy * scale,
    });

    this.state.updateCamera(newCamera);
    this.scheduleRender();
    this.zoomChange.emit(newCamera.zoom);
  }

  /**
   * Animates the camera to frame the specified box at a comfortable zoom level.
   * No-ops if the box is not found or the background is not yet loaded.
   */
  zoomToBox(boxId: number | null | undefined): void {
    const bgc = this.state.bgCanvas();
    if (!bgc) return;
    const canvas = this.canvasRef.nativeElement;
    const newCamera = CameraUtils.zoomToBox(
      boxId,
      this.state.localBoxes(),
      canvas.width,
      canvas.height,
      bgc.width,
      bgc.height,
      this.state.minZoom(),
    );
    if (!newCamera) return;
    this.state.updateCamera(this.clampCamera(newCamera));
    this.scheduleRender();
    this.zoomChange.emit(this.state.camera().zoom);
  }

  // ── Quadtree ─────────────────────────────────────────────────────────────

  /**
   * Rebuilds the spatial quadtree from the current box list.
   * Called after every structural change: box added, deleted, resized, or
   * after history undo/redo. Also called once at startup via the box-sync effect.
   */
  protected rebuildIndex(): void {
    this.quadtree = LifecycleManager.rebuildIndex(
      this.state.localBoxes(),
      this.state.bgCanvas(),
      this.state.showNametags(),
    );
  }

  // ── Context menu ──────────────────────────────────────────────────────────

  /** Handles a box-type selection from the right-click context menu. */
  onContextMenuSelect(type: BoxType): void {
    if (this.state.readOnlyMode()) return;
    const wp = this.state.contextMenuState();
    const bgc = this.state.bgCanvas();
    if (!wp?.absPos || !bgc) return;

    const newBox = BoxCreationUtils.createBoxFromContextMenu(
      type,
      wp.absPos.x,
      wp.absPos.y,
      this.state.camera(),
      bgc.width,
      bgc.height,
      BoxCreationUtils.generateTempId(this.state.nextTempId()),
    );
    this.state.getNextTempId();

    this.historyService.recordAdd(newBox);

    this.rebuildIndex();
    this.scheduleRender();
    this.closeContextMenu();
  }

  /** Hides the context menu by resetting its state to the closed sentinel. */
  closeContextMenu(): void {
    this.state.updateContextMenu(ContextMenuUtils.close());
  }

  // ── Mode toggles ──────────────────────────────────────────────────────────

  /** Toggles box-creation mode on/off and notifies the parent. */
  toggleCreateMode(): void {
    if (this.state.readOnlyMode()) return;
    this.state.toggleCreateMode();
    if (!this.state.isCreateMode()) {
      this.scheduleRender();
    }
    this.createModeChange.emit(this.state.isCreateMode());
  }

  /** Toggles magic-wand (auto-detect) mode on/off and notifies the parent. */
  toggleMagicMode(): void {
    if (this.state.readOnlyMode()) return;
    this.state.toggleMagicMode();
    this.magicModeChange.emit(this.state.isMagicMode());
  }

  /** Toggles measurement (ruler) mode on/off and notifies the parent. */
  toggleMeasurementMode(): void {
    if (this.state.readOnlyMode()) return;
    MeasurementHandler.toggleMeasurementMode(this.state);
    this.measurementModeChange.emit(this.state.measurementState().isActive);
    this.scheduleRender();
  }

  /** Updates the real-world dimensions used by the measurement overlay (e.g. metres). */
  updateMetricDimensions(width: number, height: number): void {
    MeasurementHandler.updateMetricDimensions(width, height, this.state);
    this.scheduleRender();
  }

  // ── Clipboard & undo ──────────────────────────────────────────────────────

  /** Reverts the last recorded action and refreshes the canvas. */
  private handleUndo(): void {
    if (this.state.readOnlyMode()) return;
    this.historyService.undo();
    this.rebuildIndex();
    this.scheduleRender();
  }

  /** Re-applies the most recently undone action and refreshes the canvas. */
  private handleRedo(): void {
    if (this.state.readOnlyMode()) return;
    this.historyService.redo();
    this.rebuildIndex();
    this.scheduleRender();
  }

  /** Copies the currently selected box to the internal clipboard. */
  private handleCopy(): void {
    if (this.state.readOnlyMode()) return;
    const selected = this.state.selectedBoxId();
    if (isNullOrUndefined(selected)) return;
    this.state.updateClipboard(ClipboardManager.copyBox(selected, this.state.localBoxes()));
  }

  /** Pastes the clipboard box near the current cursor position. */
  private handlePaste(): void {
    if (this.state.readOnlyMode()) return;
    const clipboard = this.state.clipboard();
    const bgc = this.state.bgCanvas();
    if (!clipboard || !bgc) return;

    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();

    const newBox = ClipboardManager.createPastedBox(
      clipboard,
      this.state.lastMouseScreen(),
      canvas,
      rect,
      this.state.camera(),
      bgc.width,
      bgc.height,
      this.state.devicePixelRatio(),
      this.state.nextTempId(),
    );

    this.state.getNextTempId();

    this.historyService.recordAdd(newBox);
    this.state.updateSelectedBox(getBoxId(newBox));
    this.state.setCursor(CursorStyles.getHoverCursor());
    this.rebuildIndex();
    this.scheduleRender();
  }

  private evictNametagCache(boxId: number): void {
    this.nametagMetricsCache.delete(String(boxId));
  }

  /** Deletes the currently selected box and clears the selection. */
  private handleDelete(): void {
    if (this.state.readOnlyMode()) return;
    const selected = this.state.selectedBoxId();
    if (isNullOrUndefined(selected)) return;
    this.historyService.recordDelete(selected);
    this.evictNametagCache(selected);
    this.state.updateSelectedBox(null);
    this.rebuildIndex();
    this.scheduleRender();
  }

  /** Cancels the active mode (measurement → create/magic → normal) on Escape. */
  private handleEscape(): void {
    if (this.state.measurementState().isActive) {
      this.toggleMeasurementMode();
      return;
    }
    if (this.state.isCreateMode()) {
      this.state.updateCreateMode(false);
      this.createModeChange.emit(false);
    }
    if (this.state.isMagicMode()) {
      this.state.toggleMagicMode();
      this.magicModeChange.emit(false);
    }
  }

  // ── Visible box query ────────────────────────────────────────────────────

  /**
   * Returns the subset of boxes that overlap the given view bounds.
   *
   * Uses the quadtree for an O(log n) spatial query, then falls back to the
   * full box list if the index has not been built yet. The currently selected
   * box is always included (even if panned off-screen) so handles remain visible
   * during a drag that extends beyond the viewport.
   *
   * @param bounds - Visible area in absolute image coordinates.
   */
  private queryVisible(bounds: { minX: number; minY: number; maxX: number; maxY: number }): Box[] {
    if (!this.state.bgCanvas()) return [];

    const allBoxes = this.state.localBoxes();

    if (!this.quadtree) {
      return allBoxes;
    }

    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const candidates = this.quadtree.queryRange(bounds.minX, bounds.minY, width, height) as Box[];

    const visibleIds = new Set(candidates.map((box) => getBoxId(box)));

    const selectedId = this.state.selectedBoxId();
    if (selectedId && this.state.isDraggingOrInteracting()) {
      visibleIds.add(selectedId);
    }

    return allBoxes.filter((box) => visibleIds.has(getBoxId(box)));
  }
}
