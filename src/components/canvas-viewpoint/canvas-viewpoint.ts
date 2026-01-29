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

import { StateManager } from './utils/state-manager';
import { LifecycleManager } from './utils/lifecycle-manager';
import { PointerEventHandler } from './utils/pointer-event-handler';
import { ClipboardManager } from './utils/clipboard-manager';
import { isNullOrUndefined } from './utils/validation-utils';

import { BoxContextMenuComponent } from './box-context-menu.component';
import { HistoryService } from '../../services/history.service';
import { HotkeyService } from '../../services/hotkey.service';

@Component({
  selector: 'app-canvas-viewport',
  templateUrl: './canvas-viewpoint.html',
  styleUrls: ['./canvas-viewpoint.css'],
  standalone: true,
  imports: [BoxContextMenuComponent],
})
export class CanvasViewportComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvasEl', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
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
  }

  //features
  //TODO: cursor is still just a little bit wrong, fix render order too
  //TODO: add measurment tool - add to reset tool on id change etc
  //TODO: handle background changes happening some time AFTER the component is initialized (photo loading), along with changes to the component with a whole different photo, label, etc

  //housekeeping
  //TODO: fix types and make sure they make sense
  //TODO: READ AND VERIFY EVERYTHING
  //TODO: read documentation and create more, and write in code comments properly

  //maybe
  //TODO: change interactions to be "do the thing" on pointer UP. plus allow to move while pointer down in stuff like magic mode

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
    );
  }

  private queryVisible(bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
    if (!this.state.bgCanvas()) return [];

    // Skip quadtree during active interactions for performance
    if (this.state.isDraggingOrInteracting()) {
      return this.localBoxes();
    }

    // Use quadtree for efficient querying
    if (this.quadtree) {
      const width = bounds.maxX - bounds.minX;
      const height = bounds.maxY - bounds.minY;
      return this.quadtree.queryRange(bounds.minX, bounds.minY, width, height) as Box[];
    }

    return this.localBoxes();
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
}
