import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  Input,
  signal,
  effect,
  computed,
} from '@angular/core';
import { Box, getBoxId } from '../../intefaces/boxes.interface';
import { Quadtree } from './core/quadtree';
import { Camera, TextMetrics } from './core/types';
import { BoxType } from './core/creation-state';
import { CoordinateTransform } from './utils/coordinate-transform';
import { CameraUtils } from './utils/camera-utils';
import { BoxCreationUtils } from './utils/box-creation-utils';
import { ContextMenuUtils } from './utils/context-menu-utils';
import { BackgroundUtils } from './utils/background-utils';
import { FrameRenderer } from './utils/frame-renderer';
import { HoverDetectionUtils } from './utils/hover-detection-utils';
import { CreationUtils } from './utils/creation-utils';

// New utility imports
import { StateManager } from './utils/state-manager';
import { LifecycleManager } from './utils/lifecycle-manager';
import { PointerEventHandler } from './utils/pointer-event-handler';
import { BoxManipulator } from './utils/box-manipulator';
import { ClipboardManager } from './utils/clipboard-manager';
import { CursorManager } from './utils/cursor-manager';

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

  // State management
  private state: StateManager;
  private cursorManager = new CursorManager();

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
  isCreateMode = computed(() => this.state.isCreateMode());

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
    this.initializeCanvas();
    this.setupResizeObserver();
    if (this.backgroundUrl) this.loadBackground(this.backgroundUrl);
    this.rebuildIndex();
    this.startRenderLoop();
  }

  ngOnDestroy(): void {
    LifecycleManager.stopRenderLoop(this.state.raf());
  }

  // ========== PUBLIC API ==========

  resetCamera() {
    const defaultZoom = this.state.minZoom() > 0 ? this.state.minZoom() : 1;
    this.camera.set({ zoom: defaultZoom, x: 0, y: 0, rotation: 0 });
    this.scheduleRender();
  }

  toggleCreateMode() {
    this.state.toggleCreateMode();
    this.updateCursor();
    if (!this.state.isCreateMode) {
      this.scheduleRender();
    }
  }

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

  // ========== EVENT HANDLERS ==========

  onWheel(e: WheelEvent) {
    PointerEventHandler.handleWheel(
      e,
      this.canvasRef.nativeElement,
      this.camera(),
      this.state.devicePixelRatio(),
      this.state.minZoom(),
      (newCamera, worldX, worldY) => {
        this.camera.set(this.clampCamera(newCamera));
        this.detectHover(worldX, worldY);
      },
    );
  }

  onPointerDown(e: PointerEvent) {
    PointerEventHandler.handlePointerDown(
      e,
      this.canvasRef.nativeElement,
      this.state,
      this.camera(),
      this.localBoxes(),
      this.quadtree,
      this.nametagMetricsCache,
      this.state.ctx(),
      (x, y, worldX, worldY) => {
        this.state.contextMenuState.set(ContextMenuUtils.open(x, y, worldX, worldY));
      },
      (worldX, worldY) => {
        this.state.createState.set({
          isCreating: true,
          startPoint: { x: worldX, y: worldY },
          currentPoint: { x: worldX, y: worldY },
        });
        this.scheduleRender();
      },
      (boxId, isRotating, isResizing, isDragging) => {
        this.scheduleRender();
      },
      () => {
        this.scheduleRender();
      },
      (cursor) => {
        this.cursorManager.setCursor(this.canvasRef.nativeElement, cursor);
      },
    );
  }

  onPointerUp(e: PointerEvent) {
    PointerEventHandler.handlePointerUp(
      e,
      this.state,
      this.localBoxes(),
      (startX, startY, endX, endY) => {
        this.handleCreateComplete(startX, startY, endX, endY);
      },
      (boxId, startState, box, isRotating, isResizing, isDragging) => {
        this.recordInteractionHistory(startState, box, isRotating, isResizing, isDragging);
      },
      () => {
        this.rebuildIndex();
      },
    );
    this.scheduleRender();
  }

  onPointerMove(e: PointerEvent) {
    PointerEventHandler.handlePointerMove(
      e,
      this.canvasRef.nativeElement,
      this.state,
      this.camera(),
      this.localBoxes(),
      this.quadtree,
      this.nametagMetricsCache,
      this.state.ctx(),
      (worldX, worldY) => {
        this.state.createState.set({
          ...this.state.createState(),
          currentPoint: { x: worldX, y: worldY },
        });
        this.scheduleRender();
      },
      (worldX, worldY) => {
        this.handleRotation(worldX, worldY);
      },
      (worldX, worldY) => {
        this.handleResize(worldX, worldY);
      },
      (worldX, worldY) => {
        this.updateBoxPosition(this.state.selectedBoxId()!, worldX, worldY);
      },
      (dx, dy) => {
        this.handleCameraPan(dx, dy);
      },
      (worldX, worldY) => {
        this.detectHover(worldX, worldY);
      },
      (cursor) => {
        this.cursorManager.setCursor(this.canvasRef.nativeElement, cursor);
      },
    );
  }

  // ========== PRIVATE SETUP METHODS ==========

  private setupEffects(): void {
    // Sync local boxes from history service (but not during active interactions)
    effect(() => {
      const boxes = this.historyService.visibleBoxes();
      // Don't overwrite local changes during drag/rotate/resize
      if (!this.state.isDraggingOrInteracting()) {
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

  // ========== INTERACTION HANDLERS ==========

  private handleCreateComplete(startX: number, startY: number, endX: number, endY: number): void {
    const bgc = this.state.bgCanvas();
    if (!bgc) return;

    const newBox = BoxCreationUtils.createBoxFromDrag(
      startX,
      startY,
      endX,
      endY,
      bgc.width,
      bgc.height,
      BoxCreationUtils.generateTempId(this.state.nextTempId()),
    );
    this.state.nextTempId.set(this.state.nextTempId() + 1);

    if (newBox) {
      this.historyService.recordAdd(newBox);
      this.rebuildIndex();
    }
  }

  private recordInteractionHistory(
    startState: { x: number; y: number; w: number; h: number; rotation: number },
    box: Box,
    isRotating: boolean,
    isResizing: boolean,
    isDragging: boolean,
  ): void {
    if (isRotating) {
      this.historyService.recordRotate(
        this.state.interactionStartState()!.boxId,
        startState.rotation,
        box.rotation || 0,
      );
    } else if (isResizing) {
      this.historyService.recordResize(
        this.state.interactionStartState()!.boxId,
        { x: startState.x, y: startState.y, w: startState.w, h: startState.h },
        { x: box.x, y: box.y, w: box.w, h: box.h },
      );
    } else if (isDragging) {
      this.historyService.recordMove(
        this.state.interactionStartState()!.boxId,
        startState.x,
        startState.y,
        box.x,
        box.y,
      );
    }
  }

  private handleCameraPan(dx: number, dy: number): void {
    const cam = this.camera();
    const worldDelta = CoordinateTransform.screenDeltaToWorld(dx, dy, cam);
    const updatedCam = { ...cam, x: cam.x - worldDelta.x, y: cam.y - worldDelta.y };
    this.camera.set(this.clampCamera(updatedCam));
  }

  // ========== BOX MANIPULATION ==========

  private handleRotation(wx: number, wy: number) {
    const bgc = this.state.bgCanvas();
    if (!this.state.selectedBoxId || !bgc) return;

    const box = this.localBoxes().find((b) => String(getBoxId(b)) === this.state.selectedBoxId());
    if (!box) return;

    const updatedBox = BoxManipulator.rotateBox(
      box,
      wx,
      wy,
      bgc.width,
      bgc.height,
      this.state.rotationStartAngle(),
      this.state.boxStartRotation(),
    );

    this.localBoxes.set(
      this.localBoxes().map((b) =>
        String(getBoxId(b)) === this.state.selectedBoxId() ? updatedBox : b,
      ),
    );
    this.scheduleRender();
  }

  private handleResize(wx: number, wy: number) {
    const bgc = this.state.bgCanvas();
    const resizeCorner = this.state.resizeCorner();
    if (!this.state.selectedBoxId() || !resizeCorner || !bgc) return;

    const box = this.localBoxes().find((b) => String(getBoxId(b)) === this.state.selectedBoxId());
    if (!box) return;

    const updatedBox = BoxManipulator.resizeBox(box, wx, wy, bgc.width, bgc.height, resizeCorner);

    this.localBoxes.set(
      this.localBoxes().map((b) =>
        String(getBoxId(b)) === this.state.selectedBoxId() ? updatedBox : b,
      ),
    );
    this.scheduleRender();
  }

  private updateBoxPosition(boxId: string, worldX: number, worldY: number) {
    const bgc = this.state.bgCanvas();
    if (!bgc) return;

    const box = this.localBoxes().find((b) => String(getBoxId(b)) === boxId);
    if (!box) return;

    const updatedBox = BoxManipulator.moveBox(box, worldX, worldY, bgc.width, bgc.height);

    this.localBoxes.set(
      this.localBoxes().map((b) => (String(getBoxId(b)) === boxId ? updatedBox : b)),
    );
    this.scheduleRender();
  }

  // ========== DETECTION ==========

  private detectHover(wx: number, wy: number) {
    const bgc = this.state.bgCanvas();
    if (!bgc) return;
    if (this.state.isCreateMode()) {
      if (this.state.updateHoverState(null)) {
        this.scheduleRender();
      }
      return;
    }

    const foundBoxId = HoverDetectionUtils.detectHoveredBox(
      wx,
      wy,
      this.localBoxes(),
      this.quadtree,
      bgc.width,
      bgc.height,
      this.camera(),
      this.state.showNametags(),
      this.nametagMetricsCache,
      this.state.ctx(),
    );

    if (this.state.updateHoverState(foundBoxId)) {
      this.scheduleRender();
      this.cursorManager.setCursor(this.canvasRef.nativeElement, foundBoxId ? 'move' : 'default');
    }
  }

  // ========== RENDERING ==========

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

  // ========== BACKGROUND & LAYOUT ==========

  private async loadBackground(url: string) {
    const canvas = this.canvasRef.nativeElement;
    const result = await BackgroundUtils.loadBackground(url, canvas.width, canvas.height);

    this.state.bgCanvas.set(result.canvas);
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

  // ========== INDEX & CAMERA ==========

  private rebuildIndex() {
    this.quadtree = LifecycleManager.rebuildIndex(
      this.localBoxes(),
      this.state.bgCanvas(),
      this.state.showNametags(),
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

  // ========== CURSOR & UI ==========

  private updateCursor() {
    if (this.state.isCreateMode()) {
      this.cursorManager.setCursor(this.canvasRef.nativeElement, CreationUtils.getCreateCursor());
    } else {
      this.cursorManager.setCursor(this.canvasRef.nativeElement, 'default');
    }
  }

  // ========== HOTKEY HANDLERS ==========

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
    this.cursorManager.setCursor(this.canvasRef.nativeElement, 'move');
    this.rebuildIndex();
    this.scheduleRender();
  }
}
