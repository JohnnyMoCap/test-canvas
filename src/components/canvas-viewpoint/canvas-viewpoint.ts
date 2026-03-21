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
  effect,
  computed,
} from '@angular/core';
import { Box, getBoxId } from '../../inteface/boxes.interface';
import { Quadtree } from './core/quadtree';
import { Camera, TextMetrics } from './core/types';
import { BoxType } from './core/creation-state';
import { CameraUtils } from './utils/camera-utils';
import { BoxCreationUtils } from './utils/box-creation-utils';
import { ContextMenuUtils } from './utils/context-menu-utils';
import { BackgroundUtils } from './utils/background-utils';
import { FrameRenderer } from './utils/frame-renderer';
import { CursorStyles } from './cursor/cursor-styles';
import { MeasurementHandler } from './handlers/measurement.handler';
import { CoordinateTransform } from './utils/coordinate-transform';

import { StateManager } from './utils/state-manager';
import { LifecycleManager } from './utils/lifecycle-manager';
import { PointerEventHandler } from './handlers/pointer-event-handler';
import { ClipboardManager } from './utils/clipboard-manager';
import { isNullOrUndefined } from './utils/validation-utils';

import { BoxContextMenuComponent } from './box-context-menu.component';
import { ScaleBarComponent } from './scale-bar.component';
import { HistoryService } from '../../services/history.service';
import { HotkeyService } from '../../services/hotkey.service';

@Component({
  selector: 'app-canvas-viewport',
  templateUrl: './canvas-viewpoint.html',
  styleUrls: ['./canvas-viewpoint.css'],
  standalone: true,
  imports: [BoxContextMenuComponent, ScaleBarComponent],
})
export class CanvasViewportComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvasEl', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('scaleBarRef') scaleBarRef?: ScaleBarComponent;
  @Input() backgroundUrl?: string;
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
  @Input() set magicToleranceInput(value: number) {
    if (value !== this.state.magicTolerance()) {
      this.state.updateMagicTolerance(value);
    }
  }
  @Input() set debugMagicInput(value: boolean) {
    if (value !== this.state.debugMagicDetection()) {
      this.state.updateDebugMagicDetection(value);
    }
  }
  @Input() set brightnessInput(value: number) {
    if (value !== this.state.brightness()) {
      this.state.updateBrightness(value);
    }
  }
  @Input() set contrastInput(value: number) {
    if (value !== this.state.contrast()) {
      this.state.updateContrast(value);
    }
  }
  @Input() set readOnlyMode(value: boolean) {
    if (value !== this.state.readOnlyMode()) {
      this.state.updateReadOnlyMode(value);
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
  @Output() zoomChange = new EventEmitter<number>();
  @Output() createModeChange = new EventEmitter<boolean>();
  @Output() magicModeChange = new EventEmitter<boolean>();
  @Output() measurementModeChange = new EventEmitter<boolean>();
  @Output() resetCameraRequest = new EventEmitter<void>();
  @Output() selectedBoxChange = new EventEmitter<number | null>();
  @Output() hoveredBoxChange = new EventEmitter<number | null>();

  // State management
  private state: StateManager;

  // Signals
  camera = signal<Camera>({ zoom: 1, x: 0, y: 0 });
  private localBoxes = signal<Box[]>([]);
  private dirty = signal(true);

  // Caches and indexes
  private nametagMetricsCache = new Map<string, TextMetrics>();
  private quadtree?: Quadtree<Box>;

  // Cleanup refs
  private resizeObserver?: ResizeObserver;
  private hotkeyUnsubs: (() => void)[] = [];
  private _lastPinchDist: number | null = null;

  contextMenuVisible = computed(() => this.state.contextMenuState()?.visible ?? false);
  contextMenuX = computed(() => this.state.contextMenuState()?.x ?? 0);
  contextMenuY = computed(() => this.state.contextMenuState()?.y ?? 0);
  canvasFilter = computed(
    () => `brightness(${this.state.brightness()}%) contrast(${this.state.contrast()}%)`,
  );

  // Scale bar computed properties
  viewportWidth = signal(0);
  viewportHeight = signal(0);
  scaleBarZoom = computed(() => this.camera().zoom);
  scaleBarImageWidth = computed(() => this.state.bgCanvas()?.width || 0);
  scaleBarImageHeight = computed(() => this.state.bgCanvas()?.height || 0);
  scaleBarMetricWidth = computed(() => this.state.measurementState().metricWidth);
  scaleBarMetricHeight = computed(() => this.state.measurementState().metricHeight);

  constructor(
    private historyService: HistoryService,
    private hotkeyService: HotkeyService,
  ) {
    // Initialize state manager
    this.state = new StateManager(ContextMenuUtils.close());

    //TODO: make sure to do this consistantly when changing to new photo
    // Initialize nextTempId to avoid collisions with existing box IDs
    const existingIds = this.historyService.visibleBoxes().map((b) => getBoxId(b));
    const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;
    this.state.setNextTempId(maxId + 1);

    this.setupEffects();
    this.setupHotkeys();
  }

  ngAfterViewInit(): void {
    this.state.setCanvas(this.canvasRef.nativeElement);
    this.initializeCanvas();
    this.setupPageResizeObserver();
    if (this.backgroundUrl) {
      this.loadBackground(this.backgroundUrl);
    } else {
      // Load placeholder if no background URL is provided
      this.loadPlaceholder();
    }
    this.startRenderLoop();
  }

  ngOnDestroy(): void {
    LifecycleManager.stopRenderLoop(this.state.raf());
    this.resizeObserver?.disconnect();
    this.hotkeyUnsubs.forEach((fn) => fn());
  }

  //TODO: not used atm, is it used in prod? check.
  resetCamera() {
    const defaultZoom = this.state.minZoom() > 0 ? this.state.minZoom() : 1;
    this.camera.set({ zoom: defaultZoom, x: 0, y: 0 });
    this.scheduleRender();
    this.zoomChange.emit(this.camera().zoom);
  }

  /**
   * Zoom and pan camera to fit a specific box in view
   */
  zoomToBox(boxId: number | null | undefined): void {
    const bgc = this.state.bgCanvas();
    if (!bgc) return;

    const canvas = this.canvasRef.nativeElement;
    const newCamera = CameraUtils.zoomToBox(
      boxId,
      this.localBoxes(),
      canvas.width,
      canvas.height,
      bgc.width,
      bgc.height,
      this.state.minZoom(),
    );

    if (!newCamera) return;

    // Clamp camera to ensure we don't go out of bounds
    this.camera.set(this.clampCamera(newCamera));
    this.scheduleRender();
    this.zoomChange.emit(this.camera().zoom);
  }

  toggleCreateMode() {
    if (this.state.readOnlyMode()) return;
    this.state.toggleCreateMode();
    if (!this.state.isCreateMode()) {
      this.scheduleRender();
    }
    this.createModeChange.emit(this.state.isCreateMode());
  }

  toggleMagicMode() {
    if (this.state.readOnlyMode()) return;
    this.state.toggleMagicMode();
    this.magicModeChange.emit(this.state.isMagicMode());
  }

  toggleMeasurementMode() {
    if (this.state.readOnlyMode()) return;
    MeasurementHandler.toggleMeasurementMode(this.state);
    this.measurementModeChange.emit(this.state.measurementState().isActive);
    this.scheduleRender();
  }

  updateMetricDimensions(width: number, height: number) {
    MeasurementHandler.updateMetricDimensions(width, height, this.state);
    this.scheduleRender();
  }

  // ========================================
  // FEATURE: CONTEXT MENU
  // ========================================
  // Related: context-menu-utils.ts

  onContextMenuSelect(type: BoxType) {
    if (this.state.readOnlyMode()) return;
    const wp = this.state.contextMenuState();
    const bgc = this.state.bgCanvas();
    if (!wp?.worldPos || !bgc) return;

    const newBox = BoxCreationUtils.createBoxFromContextMenu(
      type,
      wp.worldPos.x,
      wp.worldPos.y,
      this.camera(),
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

  closeContextMenu() {
    this.state.updateContextMenu(ContextMenuUtils.close());
  }

  // ========================================
  // INFRASTRUCTURE: Event Routing
  // ========================================

  onWheel(e: WheelEvent) {
    const canvas = this.canvasRef.nativeElement;
    const bgc = this.state.bgCanvas();
    if (!bgc) return;

    PointerEventHandler.handleWheel(
      e,
      canvas,
      canvas.width,
      canvas.height,
      bgc.width,
      bgc.height,
      this.camera(),
      this.state,
      (newCamera) => {
        this.camera.set(newCamera);
        this.scheduleRender();
        this.zoomChange.emit(newCamera.zoom);
      },
    );

    // Show scale bar on zoom
    this.scaleBarRef?.show();
  }

  onPointerDown(e: PointerEvent) {
    const canvas = this.canvasRef.nativeElement;
    const bgc = this.state.bgCanvas();
    if (!bgc) return;

    PointerEventHandler.handlePointerDown(
      e,
      canvas,
      canvas.width,
      canvas.height,
      bgc.width,
      bgc.height,
      this.camera(),
      this.localBoxes(),
      this.state,
      this.quadtree,
      this.nametagMetricsCache,
      this.state.ctx(),
      this.historyService,
    );
    //this.scheduleRender();
  }

  onPointerUp(e: PointerEvent) {
    const canvas = this.canvasRef.nativeElement;
    const bgc = this.state.bgCanvas();

    if (!bgc) return;

    PointerEventHandler.handlePointerUp(
      e,
      canvas,
      canvas.width,
      canvas.height,
      bgc.width,
      bgc.height,
      this.camera(),
      this.localBoxes(),
      this.state,
      this.historyService,
      (boxes) => {
        this.localBoxes.set(boxes);
        this.scheduleRender();
      },
      () => {
        this.rebuildIndex();
      },
    );
    this.scheduleRender();
  }

  onPointerMove(e: PointerEvent) {
    const canvas = this.canvasRef.nativeElement;
    const bgc = this.state.bgCanvas();
    if (!bgc) return;

    // Check if pointer is outside canvas bounds
    const rect = canvas.getBoundingClientRect();
    const isOutsideCanvas =
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom;

    // If outside canvas during any interaction, treat as pointer up
    if (isOutsideCanvas && (this.state.isDraggingOrInteracting() || this.state.isCreateMode())) {
      this.onPointerUp(e);
      return;
    }

    PointerEventHandler.handlePointerMove(
      e,
      canvas,
      canvas.width,
      canvas.height,
      bgc.width,
      bgc.height,
      this.camera(),
      this.localBoxes(),
      this.state,
      this.quadtree,
      this.nametagMetricsCache,
      this.state.ctx(),
      (boxes) => {
        this.localBoxes.set(boxes);
        this.scheduleRender();
      },
      (newCamera) => {
        this.camera.set(newCamera);
        this.scheduleRender();
      },
    );

    // Show scale bar on movement
    this.scaleBarRef?.show();
  }

  // ========================================
  // FEATURE: TOUCH INTERACTION
  // ========================================

  onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    if (e.touches.length >= 2) {
      this._lastPinchDist = this.pinchDist(e.touches[0], e.touches[1]);
    } else if (e.touches.length === 1) {
      this._lastPinchDist = null;
      this.onPointerDown(this.touchToPointer(e.touches[0]));
    }
  }

  onTouchMove(e: TouchEvent): void {
    e.preventDefault();
    if (e.touches.length >= 2) {
      this.handlePinchZoom(e.touches[0], e.touches[1]);
    } else if (e.touches.length === 1 && this._lastPinchDist === null) {
      this.onPointerMove(this.touchToPointer(e.touches[0]));
    }
  }

  onTouchEnd(e: TouchEvent): void {
    e.preventDefault();
    this._lastPinchDist = null;
    if (e.changedTouches.length > 0) {
      this.onPointerUp(this.touchToPointer(e.changedTouches[0]));
    }
  }

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

  private pinchDist(t0: Touch, t1: Touch): number {
    const dx = t1.clientX - t0.clientX;
    const dy = t1.clientY - t0.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private handlePinchZoom(t0: Touch, t1: Touch): void {
    const bgc = this.state.bgCanvas();
    if (!bgc || this._lastPinchDist === null) return;

    const newDist = this.pinchDist(t0, t1);
    const ratio = newDist / this._lastPinchDist;
    this._lastPinchDist = newDist;

    const canvas = this.canvasRef.nativeElement;
    const cam = this.camera();
    const newZoom = Math.max(this.state.minZoom(), Math.min(10, cam.zoom * ratio));

    const rect = canvas.getBoundingClientRect();
    const mx = ((t0.clientX + t1.clientX) / 2 - rect.left) * this.state.devicePixelRatio();
    const my = ((t0.clientY + t1.clientY) / 2 - rect.top) * this.state.devicePixelRatio();
    const worldMid = CoordinateTransform.screenToWorld(mx, my, canvas.width, canvas.height, cam);

    const dx = worldMid.x - cam.x;
    const dy = worldMid.y - cam.y;
    const scale = 1 - cam.zoom / newZoom;
    const newCamera = this.clampCamera({
      ...cam,
      zoom: newZoom,
      x: cam.x + dx * scale,
      y: cam.y + dy * scale,
    });

    this.camera.set(newCamera);
    this.scheduleRender();
    this.zoomChange.emit(newCamera.zoom);
    this.scaleBarRef?.show();
  }

  //features
  //TODO: fix the stupid canvas sizing and extra space issues
  //TOOD: fuckin measurment scale position fuckin fuck fucking measurement bar
  //TODO: Proparly handle a whole different photo being loaded, I think it works now but think is for chumps
  //TODO: dont forget to add low opacity for PENDING state
  //TODO: filters in history.service visibleBoxes()
  //TODO: mobile interaction
  //TODO: decide on both pointer flow strategy and cursor handling strategy
  //TODO: lasso tool - full select for area - rectangle select
  //TODO: change world to absolute
  //TODO: fix interacting from fully zoomed out, cant detect image text I think?
  //TODO: in color on hover when selected doesnt work sometimes?

  //the future:
  //split component into base and add more extensions for results and coverage and crap
  //full debug mode? for performance as well?
  // Google Analytics
  // show projections
  // proper handling with our types

  //testing:
  // double check other browsers
  // double check different screen sizes

  // ========================================
  // INFRASTRUCTURE: Setup & Initialization
  // ========================================

  private setupEffects(): void {
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
      this.localBoxes.set([...boxes]);
      this.rebuildIndex();
    });

    // Trigger render on camera or box changes
    effect(() => {
      const _ = this.camera();
      const __ = this.localBoxes();
      const ___ = this.state.createState();
      this.scheduleRender();
    });

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
    });

    // Emit selection changes to parent
    effect(() => {
      const selectedBoxId = this.state.selectedBoxId();
      this.selectedBoxChange.emit(selectedBoxId);
    });

    // Emit hover changes to parent
    effect(() => {
      const hoveredBoxId = this.state.hoveredBoxId();
      this.hoveredBoxChange.emit(hoveredBoxId);
    });
  }

  private setupHotkeys(): void {
    this.hotkeyUnsubs.push(
      this.hotkeyService.on('UNDO', () => this.handleUndo()),
      this.hotkeyService.on('REDO', () => this.handleRedo()),
      this.hotkeyService.on('COPY', () => this.handleCopy()),
      this.hotkeyService.on('PASTE', () => this.handlePaste()),
      this.hotkeyService.on('DELETE', () => this.handleDelete()),
      this.hotkeyService.on('ESCAPE', () => this.handleEscape()),
    );
  }

  private initializeCanvas(): void {
    const canvas = this.canvasRef.nativeElement;
    this.state.updateDevicePixelRatio(window.devicePixelRatio || 1);
    this.onResize();
    this.state.updateContext(
      LifecycleManager.initializeCanvas(canvas, this.state.devicePixelRatio()),
    );
  }

  private setupPageResizeObserver(): void {
    const canvas = this.canvasRef.nativeElement;
    this.resizeObserver = LifecycleManager.setupPageResizeObserver(canvas.parentElement!, () =>
      this.onResize(),
    );
  }

  private startRenderLoop(): void {
    LifecycleManager.startRenderLoop(
      { value: this.state.raf() },
      { value: this.state.lastFrameTime() },
      this.dirty,
      () => {
        this.renderFrame();
        this.dirty.set(false);
      },
    );
  }

  // ========================================
  // FEATURE: RENDERING
  // ========================================
  // Related: frame-renderer.ts, render-utils.ts

  private scheduleRender() {
    this.dirty.set(true);
  }

  private renderFrame() {
    const bgc = this.state.bgCanvas();
    const ctx = this.state.ctx();
    if (!ctx || !bgc) return;

    const canvas = this.canvasRef.nativeElement;
    const cam = this.camera();
    const viewBounds = CameraUtils.getViewBoundsInWorld(canvas.width, canvas.height, cam);
    const visibleBoxes = this.queryVisible(viewBounds);

    // Get current mouse position in world coordinates
    let currentMouseWorld: { x: number; y: number } | null = null;
    const lastMouse = this.state.lastMouseScreen();
    if (lastMouse) {
      const rect = canvas.getBoundingClientRect();
      const mx = (lastMouse.x - rect.left) * this.state.devicePixelRatio();
      const my = (lastMouse.y - rect.top) * this.state.devicePixelRatio();
      currentMouseWorld = CoordinateTransform.screenToWorld(
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
      currentMouseWorld,
    );
  }

  private queryVisible(bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
    if (!this.state.bgCanvas()) return [];

    const allBoxes = this.localBoxes();

    // If no quadtree, return all boxes in z-order
    if (!this.quadtree) {
      return allBoxes;
    }

    // Get candidates from quadtree (will be stale during interactions)
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const candidates = this.quadtree.queryRange(bounds.minX, bounds.minY, width, height) as Box[];

    // Create a Set of visible box IDs for O(1) lookup
    const visibleIds = new Set(candidates.map((box) => getBoxId(box)));

    // During interactions, ensure the selected box is included
    // (it might have moved out of its quadtree cell)
    const selectedId = this.state.selectedBoxId();
    if (selectedId && this.state.isDraggingOrInteracting()) {
      visibleIds.add(selectedId);
    }

    // Filter allBoxes to only include visible ones, preserving z-order
    return allBoxes.filter((box) => visibleIds.has(getBoxId(box)));
  }

  // ========================================
  // INFRASTRUCTURE: Background & Layout
  // ========================================

  private async loadPlaceholder() {
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
    this.camera.set({ zoom: this.state.minZoom(), x: 0, y: 0 });
    this.scheduleRender();
  }

  private async loadBackground(url: string) {
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
    this.camera.set({ zoom: this.state.minZoom(), x: 0, y: 0 });
    this.rebuildIndex();
    this.scheduleRender();
  }

  private clampCamera(cam: Camera): Camera {
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

  private onResize() {
    const canvas = this.canvasRef.nativeElement;
    const container = canvas.parentElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const containerWidth = rect.width * this.state.devicePixelRatio();
    const containerHeight = rect.height * this.state.devicePixelRatio();

    // Update viewport dimensions for scale bar
    this.viewportWidth.set(rect.width);
    this.viewportHeight.set(rect.height);

    // Calculate canvas size maintaining aspect ratio
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

    if (this.state.bgCanvas()) {
      this.state.updateMinZoom(
        BackgroundUtils.recalculateMinZoom(
          w,
          h,
          this.state.bgCanvas()!.width,
          this.state.bgCanvas()!.height,
        ),
      );
      this.camera.set(
        this.clampCamera({
          ...this.camera(),
          zoom: Math.max(this.camera().zoom, this.state.minZoom()),
        }),
      );
    }
    this.scheduleRender();
  }

  private rebuildIndex() {
    this.quadtree = LifecycleManager.rebuildIndex(
      this.localBoxes(),
      this.state.bgCanvas(),
      this.state.showNametags(),
    );
  }

  // ========================================
  // FEATURE: CLIPBOARD (Copy/Paste)
  // ========================================
  // Related: clipboard-manager.ts

  private handleUndo(): void {
    if (this.state.readOnlyMode()) return;
    this.historyService.undo();
    this.rebuildIndex();
    this.scheduleRender();
  }

  private handleRedo(): void {
    if (this.state.readOnlyMode()) return;
    this.historyService.redo();
    this.rebuildIndex();
    this.scheduleRender();
  }

  private handleCopy(): void {
    if (this.state.readOnlyMode()) return;
    const selected = this.state.selectedBoxId();
    if (isNullOrUndefined(selected)) return;
    this.state.updateClipboard(ClipboardManager.copyBox(selected, this.localBoxes()));
  }

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
      this.camera(),
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

  private handleEscape(): void {
    // Exit measurement mode
    if (this.state.measurementState().isActive) {
      this.toggleMeasurementMode();
      return;
    }

    // Exit create mode
    if (this.state.isCreateMode()) {
      this.state.updateCreateMode(false);
      this.createModeChange.emit(false);
    }

    // Exit magic mode
    if (this.state.isMagicMode()) {
      this.state.toggleMagicMode();
      this.magicModeChange.emit(false);
    }
  }
}
