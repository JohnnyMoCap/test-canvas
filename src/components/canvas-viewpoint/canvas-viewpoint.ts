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
import { Box, getBoxId } from '../../intefaces/boxes.interface';
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
import { PointerEventHandler } from './utils/pointer-event-handler';
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
  @Input() set externalHoverBoxId(value: string | number | null) {
    if (value !== null && value != this.state.selectedBoxId()) {
      this.state.updateHoverState(value === null ? null : String(value));
      this.scheduleRender();
    }
  }
  @Input() set externalSelectBoxId(
    value: string | number | null, //{ boxId: string | number; timestamp: number } | undefined,
  ) {
    if (value !== null && value != this.state.selectedBoxId()) {
      const boxId = value; //value.boxId;
      this.state.updateSelectedBox(boxId === null ? null : String(boxId));
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
  @Output() selectedBoxChange = new EventEmitter<string | number | null>();
  @Output() hoveredBoxChange = new EventEmitter<string | number | null>();

  // State management
  private state: StateManager;

  // Signals
  camera = signal<Camera>({ zoom: 1, x: 0, y: 0, rotation: 0 });
  private localBoxes = signal<Box[]>([]);
  private dirty = signal(true);

  // Caches and indexes
  private nametagMetricsCache = new Map<string, TextMetrics>();
  private quadtree?: Quadtree<Box>;

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

    this.setupEffects();
    this.setupHotkeys();
  }

  ngAfterViewInit(): void {
    this.state.setCanvas(this.canvasRef.nativeElement);
    this.initializeCanvas();
    this.setupPageResizeObserver();
    if (this.backgroundUrl) this.loadBackground(this.backgroundUrl); //TODO: change this to properly handle late additions to the page.
    this.startRenderLoop();
  }

  ngOnDestroy(): void {
    LifecycleManager.stopRenderLoop(this.state.raf());
  }

  resetCamera() {
    const defaultZoom = this.state.minZoom() > 0 ? this.state.minZoom() : 1;
    this.camera.set({ zoom: defaultZoom, x: 0, y: 0, rotation: 0 });
    this.scheduleRender();
    this.zoomChange.emit(this.camera().zoom);
  }

  /**
   * Zoom and pan camera to fit a specific box in view
   */
  zoomToBox(boxId: string | number | null | undefined): void {
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
    this.scheduleRender();
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
    this.scheduleRender();

    // Show scale bar on movement
    this.scaleBarRef?.show();
  }

  //features
  //TODO: verify measurement tool contents are good and not stupid
  //TODO: handle background changes happening some time AFTER the component is initialized (photo loading), along with changes to the component with a whole different photo, label, etc
  //TODO: cursors again: detectCornerHandle and updateCursorForHover use different logic to find corners - consolidate

  //housekeeping
  //TODO: full refactor of some flows. now that its all in place mostly make it look normal, must be hand made
  //TODO: fix types and make sure they make sense
  //TODO: READ AND VERIFY EVERYTHING
  //TODO: read documentation and create more, and write in code comments properly

  // ========================================
  // INFRASTRUCTURE: Setup & Initialization
  // ========================================

  private setupEffects(): void {
    // Sync local boxes from history service (but not during active interactions)
    effect(() => {
      if (this.state.isDraggingOrInteracting()) return;
      const boxes = this.historyService.visibleBoxes();
      //TODO: find a more computation friendly way to do this
      if (JSON.stringify(boxes) === JSON.stringify(this.localBoxes())) {
        return;
      }
      this.localBoxes.set([...boxes]);
      this.rebuildIndex();
    });

    // Trigger render on camera or box changes
    effect(() => {
      const _ = this.camera();
      const __ = this.localBoxes(); //move this to boxes effect?
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
    this.hotkeyService.on('UNDO', () => this.handleUndo());
    this.hotkeyService.on('REDO', () => this.handleRedo());
    this.hotkeyService.on('COPY', () => this.handleCopy());
    this.hotkeyService.on('PASTE', () => this.handlePaste());
    this.hotkeyService.on('DELETE', () => this.handleDelete());
    this.hotkeyService.on('ESCAPE', () => this.handleEscape());
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
    LifecycleManager.setupPageResizeObserver(canvas.parentElement!, () => this.onResize());
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

    // Get candidates from quadtree (may be stale during interactions)
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

  private async loadBackground(url: string) {
    const canvas = this.canvasRef.nativeElement;
    const result = await BackgroundUtils.loadBackground(url, canvas.width, canvas.height);

    this.state.updateBgCanvas(result.canvas);
    this.state.updateMinZoom(result.minZoom);

    if (this.state.bgCanvas()!.width > 0 && this.state.bgCanvas()!.height > 0) {
      this.state.updateCanvasAspectRatio(
        this.state.bgCanvas()!.width / this.state.bgCanvas()!.height,
      );
    }

    this.onResize();
    this.camera.set({ zoom: this.state.minZoom(), x: 0, y: 0, rotation: 0 });
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
    this.state.updateSelectedBox(String(getBoxId(newBox)));
    this.state.setCursor(CursorStyles.getHoverCursor());
    this.rebuildIndex();
    this.scheduleRender();
  }

  private handleDelete(): void {
    if (this.state.readOnlyMode()) return;
    const selected = this.state.selectedBoxId();
    if (!(typeof selected == 'number' || typeof selected == 'string')) return;
    this.historyService.recordDelete(selected);
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
