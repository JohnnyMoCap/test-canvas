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
import { CameraHandler } from './handlers/camera.handler';
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
import { SamMagicHandler, SAM_MODEL_OPTIONS } from './handlers/sam-magic.handler';
import type { MagicEngine, MagicEngineKind } from './handlers/magic-engine';
import { GestureRecognizerHandler, PinchDelta } from './handlers/gesture-recognizer.handler';

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
 * - **Left-click + drag / one-finger touch**: create/resize/move boxes
 *   (delegated to `PointerEventHandler`)
 * - **Middle-click + drag**: pan the camera (via `shouldBasePan` override)
 * - **Scroll wheel / two-finger pinch**: cursor- or midpoint-centred zoom
 * - **Two-finger drag**: pans the camera, simultaneously with pinch-zoom
 * - **Keyboard**: undo/redo/copy/paste/delete/escape via `HotkeyService`
 *
 * Touch is handled entirely through native Pointer Events (no parallel
 * `TouchEvent` listeners) — this avoids double-handling, since a touch fires
 * both `pointerdown`/`touchstart` for the same physical contact.
 *
 * ## Multi-touch
 * All raw multi-pointer bookkeeping (how many fingers, single vs. pinch, a
 * missed `pointerup` never leaving a gesture stuck) is owned by
 * `GestureRecognizerHandler` (`gestureRecognizer`) — a Layer 1 module below
 * `PointerEventHandler` (Layer 2) that turns raw pointer events into a small,
 * unambiguous stream of semantic callbacks (`onPrimaryDown/Move/Up`,
 * `onPinchStart/Change/End`, `onInterrupted`). This component only wires
 * those callbacks to the existing, unchanged `PointerEventHandler`/
 * `CameraHandler` calls — see `setupFeatureEffects()` for the wiring and
 * `gesture-recognizer.handler.ts` for the state machine itself.
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
  private samMagicHandler!: SamMagicHandler;
  /** Layer 1 multi-pointer/pinch state machine; constructed in `setupFeatureEffects()`. */
  private gestureRecognizer!: GestureRecognizerHandler;
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

  /** Which magic-wand implementation a click currently dispatches to. */
  magicEngine = computed(() => this.state.magicEngine());
  /** True once the SAM model has finished downloading and initialising. */
  samReady = computed(() => this.samMagicHandler.isReady());
  /** True while SAM is embedding an image or predicting a mask. */
  samProcessing = computed(() => this.samMagicHandler.isProcessing());
  /** Last SAM load/prediction error, if any, for UI display. */
  samError = computed(() => this.samMagicHandler.lastError());
  /** Which SAM checkpoint is currently (or about to be) loaded - see `SAM_MODEL_OPTIONS`. */
  samModelId = computed(() => this.samMagicHandler.modelId());
  /** The selectable SAM checkpoints, for the model-variant dropdown. */
  readonly samModelOptions = SAM_MODEL_OPTIONS;

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
    this.samMagicHandler = new SamMagicHandler(
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
    this.samMagicHandler.destroy();
    this.gestureRecognizer?.destroy();
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

    this.gestureRecognizer = new GestureRecognizerHandler(this.canvasRef.nativeElement, {
      onPrimaryDown: (e) =>
        PointerEventHandler.handlePointerDown(e, this.activeMagicEngine, this.pointerContext),
      onPrimaryMove: (e) => this.handlePrimaryMove(e),
      onPrimaryUp: (e) => {
        PointerEventHandler.handlePointerUp(e, this.pointerContext);
        this.rebuildIndex();
        this.scheduleRender();
      },
      onPinchStart: () => {},
      onPinchChange: (delta) => this.applyPinchDelta(delta),
      onPinchEnd: () => {},
      onInterrupted: () => {
        this.state.resetInteractionStates();
        this.state.resetCreationState();
        this.scheduleRender();
      },
    });

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
      this.hotkeyService.on('UNDO', () => this.undo()),
      this.hotkeyService.on('REDO', () => this.redo()),
      this.hotkeyService.on('COPY', () => this.copySelectedBox()),
      this.hotkeyService.on('PASTE', () => this.pasteClipboard()),
      this.hotkeyService.on('DELETE', () => this.deleteSelectedBox()),
      this.hotkeyService.on('ESCAPE', () => this.exitActiveMode()),
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

  /** Whichever `MagicEngine` is currently selected - see `setMagicEngine()`. */
  private get activeMagicEngine(): MagicEngine {
    return this.state.magicEngine() === 'ai-model' ? this.samMagicHandler : this.magicHandler;
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

  /** Delegates to `gestureRecognizer` — see its `onPrimaryDown`/`onPinchStart` wiring above. */
  onPointerDown(e: PointerEvent): void {
    if (!this.state.bgCanvas()) return;
    this.gestureRecognizer.handlePointerDown(e);
  }

  /** Delegates to `gestureRecognizer` — see its `onPrimaryUp`/`onPinchEnd` wiring above. */
  onPointerUp(e: PointerEvent): void {
    if (!this.state.bgCanvas()) return;
    this.gestureRecognizer.handlePointerUp(e);
  }

  /**
   * Delegates to `gestureRecognizer`, which routes cancel through the
   * identical completion path as a normal pointer-up internally — no
   * in-progress drag/resize/rotate/pinch is ever left stuck mid-interaction.
   */
  onPointerCancel(e: PointerEvent): void {
    this.gestureRecognizer.handlePointerCancel(e);
  }

  /** Delegates to `gestureRecognizer` — see its `onPrimaryMove`/`onPinchChange` wiring above. */
  onPointerMove(e: PointerEvent): void {
    if (!this.state.bgCanvas()) return;
    this.gestureRecognizer.handlePointerMove(e);
  }

  /**
   * Handles a recognized single-pointer move. If the pointer leaves the
   * canvas bounds while a box interaction or box-creation drag is active,
   * synthesises a pointer-up to cleanly end the gesture instead of letting
   * it continue tracking off-canvas. This stays a component-level concern
   * (not part of `GestureRecognizerHandler`) since it depends on Layer 3
   * box-editing state (`isDraggingOrInteracting`/`isCreateMode`).
   */
  private handlePrimaryMove(e: PointerEvent): void {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const isOutsideCanvas =
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom;

    if (isOutsideCanvas && (this.state.isDraggingOrInteracting() || this.state.isCreateMode())) {
      this.gestureRecognizer.handlePointerUp(e);
      return;
    }

    PointerEventHandler.handlePointerMove(e, this.pointerContext);
    this.scheduleRender();
    this.scaleBarRef?.show();
  }

  /**
   * Applies one pinch step: first pans by the midpoint's screen-space delta
   * (so a two-finger drag pans even without any change in finger distance),
   * then zooms anchored on the current midpoint so it stays visually fixed.
   * Reuses `CameraHandler.pan`/`zoomByRatio` — the same math as single-finger
   * pan and wheel-zoom — rather than duplicating the anchor formula.
   * `delta` is in CSS pixels (the recognizer is DPR-agnostic); DPR-scaling
   * to physical canvas pixels happens here, same as everywhere else.
   */
  private applyPinchDelta(delta: PinchDelta): void {
    const bgc = this.state.bgCanvas();
    if (!bgc) return;

    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const dpr = this.state.devicePixelRatio();

    let cam = CameraHandler.pan(
      delta.panDeltaX * dpr,
      delta.panDeltaY * dpr,
      this.state.camera(),
      canvas.width,
      canvas.height,
      bgc.width,
      bgc.height,
      this.state.minZoom(),
    );

    const mx = (delta.midpoint.x - rect.left) * dpr;
    const my = (delta.midpoint.y - rect.top) * dpr;
    const absMid = CoordinateTransform.screenToAbsolute(mx, my, canvas.width, canvas.height, cam);
    cam = CameraHandler.zoomByRatio(
      delta.distanceRatio,
      absMid.x,
      absMid.y,
      cam,
      canvas.width,
      canvas.height,
      bgc.width,
      bgc.height,
      this.state.minZoom(),
    );

    this.state.updateCamera(cam);
    this.scheduleRender();
    this.zoomChange.emit(cam.zoom);
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

  /**
   * Opens the box-type picker centred on the visible canvas area, rather
   * than at a click point. This is the touch equivalent of the desktop
   * right-click context menu (there's no "right-click point" on touch) —
   * intended to be called from a host toolbar's "Add finding" button.
   */
  openAddFindingMenu(): void {
    if (this.state.readOnlyMode()) return;
    const bgc = this.state.bgCanvas();
    if (!bgc) return;

    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const centerClientX = rect.left + rect.width / 2;
    const centerClientY = rect.top + rect.height / 2;

    const absPos = CoordinateTransform.screenToAbsolute(
      canvas.width / 2,
      canvas.height / 2,
      canvas.width,
      canvas.height,
      this.state.camera(),
    );

    this.state.updateContextMenu(
      ContextMenuUtils.open(centerClientX, centerClientY, absPos.x, absPos.y),
    );
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

  /**
   * Switches which `MagicEngine` a magic-wand click dispatches to -
   * `'classical'` (colour flood-fill, `MagicDetectionHandler`) or
   * `'ai-model'` (SAM, `SamMagicHandler`). Proactively kicks off the model
   * download/init when switching to `'ai-model'`, so that cost isn't hidden
   * behind the user's first click - see `samReady`/`samProcessing` for the
   * resulting loading state.
   */
  setMagicEngine(engine: MagicEngineKind): void {
    this.state.updateMagicEngine(engine);
    if (engine === 'ai-model') {
      this.samMagicHandler.ensureInitialized();
    }
  }

  /** Switches which SAM checkpoint is loaded - see `SAM_MODEL_OPTIONS` and `SamMagicHandler.setModelId()`. */
  setSamModelId(modelId: string): void {
    this.samMagicHandler.setModelId(modelId);
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
  undo(): void {
    if (this.state.readOnlyMode()) return;
    this.historyService.undo();
    this.rebuildIndex();
    this.scheduleRender();
  }

  /** Re-applies the most recently undone action and refreshes the canvas. */
  redo(): void {
    if (this.state.readOnlyMode()) return;
    this.historyService.redo();
    this.rebuildIndex();
    this.scheduleRender();
  }

  /** Copies the currently selected box to the internal clipboard. */
  copySelectedBox(): void {
    if (this.state.readOnlyMode()) return;
    const selected = this.state.selectedBoxId();
    if (isNullOrUndefined(selected)) return;
    this.state.updateClipboard(ClipboardManager.copyBox(selected, this.state.localBoxes()));
  }

  /** Pastes the clipboard box near the current cursor position. */
  pasteClipboard(): void {
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
  deleteSelectedBox(): void {
    if (this.state.readOnlyMode()) return;
    const selected = this.state.selectedBoxId();
    if (isNullOrUndefined(selected)) return;
    this.historyService.recordDelete(selected);
    this.evictNametagCache(selected);
    this.state.updateSelectedBox(null);
    this.rebuildIndex();
    this.scheduleRender();
  }

  exitActiveMode(): void {
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
