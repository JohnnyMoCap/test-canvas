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
import { CreationUtils } from './utils/creation-utils';

import { StateManager } from './utils/state-manager';
import { LifecycleManager } from './utils/lifecycle-manager';
import { PointerEventHandler } from './utils/pointer-event-handler';
import { ClipboardManager } from './utils/clipboard-manager';

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
      this.state.magicTolerance.set(value);
    }
  }
  @Input() set debugMagicInput(value: boolean) {
    if (value !== this.state.debugMagicDetection()) {
      this.state.debugMagicDetection.set(value);
    }
  }
  @Input() set brightnessInput(value: number) {
    if (value !== this.state.brightness()) {
      this.state.brightness.set(value);
    }
  }
  @Input() set contrastInput(value: number) {
    if (value !== this.state.contrast()) {
      this.state.contrast.set(value);
    }
  }
  @Output() zoomChange = new EventEmitter<number>();
  @Output() createModeChange = new EventEmitter<boolean>();
  @Output() magicModeChange = new EventEmitter<boolean>();
  @Output() resetCameraRequest = new EventEmitter<void>();

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
    this.setupResizeObserver();
    if (this.backgroundUrl) this.loadBackground(this.backgroundUrl);
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

  toggleCreateMode() {
    this.state.toggleCreateMode();
    this.updateCursor();
    if (!this.state.isCreateMode) {
      this.scheduleRender();
    }
    this.createModeChange.emit(this.state.isCreateMode());
  }

  toggleMagicMode() {
    this.state.toggleMagicMode();
    this.magicModeChange.emit(this.state.isMagicMode());
  }

  // ========================================
  // FEATURE: CONTEXT MENU
  // ========================================
  // Related: context-menu-utils.ts

  onContextMenuSelect(type: BoxType) {
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
    //TODO: change to work like our normal incrememnt stuff
    this.state.nextTempId.set(this.state.nextTempId() + 1);

    this.historyService.recordAdd(newBox);

    this.rebuildIndex();
    this.scheduleRender();
    this.closeContextMenu();
  }

  closeContextMenu() {
    this.state.contextMenuState.set(ContextMenuUtils.close());
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

  //TODOS: cursor is a bit wrong sometimes?
  //TODO: add measurment tool - add to reset tool on id change etc

  //TODO: READ AND VERIFY MAGIC WORKS AND FOLLOWS THE STRUCTURE
  //TODO: remove the stupid form crap, its there just for the tolorance

  //TODO: bug, the blue is still the fucking canvas, its not allowed. the canvas is ONLY the image.

  //TODO: bug, there may be some funky state updates going on here

  private setupEffects(): void {
    // Sync local boxes from history service (but not during active interactions)
    effect(() => {
      const boxes = this.historyService.visibleBoxes();

      // Don't overwrite local changes during drag/rotate/resize
      if (!this.state.isDraggingOrInteracting()) {
        //TODO: find a more computation friendly way to do this
        if (JSON.stringify(boxes) === JSON.stringify(this.localBoxes())) {
          return;
        }
        this.localBoxes.set([...boxes]);

        this.rebuildIndex();
      }
    });

    // Trigger render on camera or box changes
    effect(() => {
      const _ = this.camera();
      const __ = this.localBoxes();
      this.scheduleRender();
    });
  }

  private setupHotkeys(): void {
    this.hotkeyService.on('UNDO', () => this.handleUndo());
    this.hotkeyService.on('REDO', () => this.handleRedo());
    this.hotkeyService.on('COPY', () => this.handleCopy());
    this.hotkeyService.on('PASTE', () => this.handlePaste());
  }

  private initializeCanvas(): void {
    const canvas = this.canvasRef.nativeElement;
    this.state.devicePixelRatio.set(window.devicePixelRatio || 1);
    this.onResize();
    this.state.ctx.set(LifecycleManager.initializeCanvas(canvas, this.state.devicePixelRatio()));
  }

  private setupResizeObserver(): void {
    const canvas = this.canvasRef.nativeElement;
    LifecycleManager.setupResizeObserver(canvas.parentElement!, () => this.onResize());
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
    this.state.minZoom.set(result.minZoom);

    if (this.state.bgCanvas()!.width > 0 && this.state.bgCanvas()!.height > 0) {
      this.state.canvasAspectRatio.set(
        this.state.bgCanvas()!.width / this.state.bgCanvas()!.height,
      );
    }

    this.onResize();
    this.camera.set({ zoom: this.state.minZoom(), x: 0, y: 0, rotation: 0 });
    this.rebuildIndex();
    this.scheduleRender();
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
      this.state.minZoom.set(
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
  // UI & CURSOR
  // ========================================

  private updateCursor() {
    if (this.state.isCreateMode()) {
      this.state.setCursor(CreationUtils.getCreateCursor());
    } else {
      this.state.setCursor('default');
    }
  }

  // ========================================
  // FEATURE: CLIPBOARD (Copy/Paste)
  // ========================================
  // Related: clipboard-manager.ts

  private handleUndo(): void {
    this.historyService.undo();
    this.rebuildIndex();
    this.scheduleRender();
  }

  private handleRedo(): void {
    this.historyService.redo();
    this.rebuildIndex();
    this.scheduleRender();
  }

  private handleCopy(): void {
    const selected = this.state.selectedBoxId();
    if (!selected) return;
    this.state.clipboard.set(ClipboardManager.copyBox(selected, this.localBoxes()));
  }

  private handlePaste(): void {
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

    this.state.nextTempId.set(this.state.nextTempId() + 1);

    this.historyService.recordAdd(newBox);
    this.state.selectedBoxId.set(String(getBoxId(newBox)));
    this.state.setCursor('move');
    this.rebuildIndex();
    this.scheduleRender();
  }
}
