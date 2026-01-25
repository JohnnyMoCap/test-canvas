import { signal, computed, Signal, WritableSignal } from '@angular/core';
import { Box } from '../../../intefaces/boxes.interface';
import { Camera, ResizeCorner } from '../core/types';
import { CreateBoxState } from '../core/creation-state';
import { ContextMenuState } from './context-menu-utils';

/**
 * Centralized state management for the canvas viewport component
 */

export class StateManager {
  // ========================================
  // CANVAS & RENDERING
  // ========================================

  private canvasElement = signal<HTMLCanvasElement | null>(null);
  raf = signal(0);
  ctx = signal<CanvasRenderingContext2D | undefined>(undefined);
  devicePixelRatio = signal(1);
  lastFrameTime = signal(0);
  bgCanvas = signal<HTMLCanvasElement | undefined>(undefined);
  minZoom = signal(0);
  canvasAspectRatio = signal(1.5);

  // ========================================
  // FEATURE: BOX CREATION
  // ========================================

  isCreateMode = signal(false);
  createState = signal<CreateBoxState>({
    isCreating: false,
    startPoint: null,
    currentPoint: null,
  });
  nextTempId = signal(1);

  // ========================================
  // FEATURE: CONTEXT MENU
  // ========================================

  contextMenuState = signal<ContextMenuState | null>(null);

  // ========================================
  // FEATURE: SELECTION & HOVER
  // ========================================

  hoveredBoxId = signal<string | null>(null);
  selectedBoxId = signal<string | null>(null);

  // ========================================
  // FEATURE: BOX INTERACTION (Rotate/Resize/Drag)
  // ========================================

  isPointerDown = signal(false);
  isDraggingBox = signal(false);
  dragStartWorld = signal({ x: 0, y: 0 });
  boxStartPos = signal({ x: 0, y: 0 });

  isResizing = signal(false);
  resizeCorner = signal<ResizeCorner | null>(null);

  isRotating = signal(false);
  rotationStartAngle = signal(0);
  boxStartRotation = signal(0);

  interactionStartState = signal<{
    boxId: string;
    x: number;
    y: number;
    w: number;
    h: number;
    rotation: number;
  } | null>(null);

  // ========================================
  // FEATURE: CLIPBOARD
  // ========================================

  clipboard = signal<Box | null>(null);

  // ========================================
  // UI STATE
  // ========================================

  currentCursor = signal('default');
  lastPointer = signal({ x: 0, y: 0 });
  lastMouseScreen = signal<{ x: number; y: number } | null>(null);
  showNametags = signal(true);
  debugShowQuadtree = signal(true);

  // ========================================
  // COMPUTED STATE
  // ========================================

  isAnyInteractionActive = computed(
    () => this.isRotating() || this.isResizing() || this.isDraggingBox(),
  );

  isDraggingOrInteracting = computed(
    () => this.isRotating() || this.isResizing() || this.isDraggingBox(),
  );

  constructor(contextMenuState: ContextMenuState) {
    this.contextMenuState.set(contextMenuState);
  }

  // ========================================
  // FEATURE: BOX CREATION - Methods
  // ========================================

  /**
   * Reset creation state
   */
  resetCreationState(): void {
    this.createState.set({
      isCreating: false,
      startPoint: null,
      currentPoint: null,
    });
  }

  /**
   * Toggle create mode
   */
  toggleCreateMode(): void {
    this.isCreateMode.update((v) => !v);
    if (!this.isCreateMode()) {
      this.resetCreationState();
    }
  }

  // ========================================
  // FEATURE: BOX INTERACTION - Methods
  // ========================================

  /**
   * Reset all interaction states
   */
  resetInteractionStates(): void {
    this.isPointerDown.set(false);
    this.isDraggingBox.set(false);
    this.isResizing.set(false);
    this.isRotating.set(false);
    this.resizeCorner.set(null);
    this.interactionStartState.set(null);
  }

  /**
   * Start interaction tracking
   */
  startInteraction(
    boxId: string,
    x: number,
    y: number,
    w: number,
    h: number,
    rotation: number,
  ): void {
    this.interactionStartState.set({ boxId, x, y, w, h, rotation });
  }

  // ========================================
  // UI - Methods
  // ========================================

  /**
   * Set canvas element reference (call during ngAfterViewInit)
   */
  setCanvas(canvas: HTMLCanvasElement): void {
    this.canvasElement.set(canvas);
  }

  /**
   * Update cursor (now works without passing canvas every time)
   */
  setCursor(cursor: string): void {
    if (this.currentCursor() !== cursor) {
      this.currentCursor.set(cursor);
      const canvas = this.canvasElement();
      if (canvas) {
        canvas.style.cursor = cursor;
      }
    }
  }

  /**
   * Track mouse screen position
   */
  updateMouseScreenPosition(x: number, y: number): void {
    this.lastMouseScreen.set({ x, y });
  }

  // ========================================
  // FEATURE: SELECTION & HOVER - Methods
  // ========================================

  /**
   * Update hover state
   */
  updateHoverState(boxId: string | null): boolean {
    if (this.hoveredBoxId() !== boxId) {
      this.hoveredBoxId.set(boxId);
      return true; // State changed
    }
    return false; // No change
  }

  /**
   * Update selected box
   */
  updateSelectedBox(boxId: string | null): void {
    this.selectedBoxId.set(boxId);
  }

  // ========================================
  // FEATURE: CAMERA - Methods
  // ========================================

  /**
   * Update camera state
   */
  updateCamera(camera: Camera): void {
    // Camera updates are handled by parent component signal binding
    // This method is here for discoverability and future extension
  }

  /**
   * Update minimum zoom
   */
  updateMinZoom(minZoom: number): void {
    this.minZoom.set(minZoom);
  }

  // ========================================
  // FEATURE: BOX MANIPULATION - Methods
  // ========================================

  /**
   * Update pointer down state
   */
  updatePointerDown(isDown: boolean): void {
    this.isPointerDown.set(isDown);
  }

  /**
   * Start dragging box
   */
  startDragging(worldX: number, worldY: number, boxX: number, boxY: number): void {
    this.isDraggingBox.set(true);
    this.dragStartWorld.set({ x: worldX, y: worldY });
    this.boxStartPos.set({ x: boxX, y: boxY });
  }

  /**
   * Stop dragging box
   */
  stopDragging(): void {
    this.isDraggingBox.set(false);
  }

  /**
   * Start resizing box
   */
  startResizing(corner: ResizeCorner): void {
    this.isResizing.set(true);
    this.resizeCorner.set(corner);
  }

  /**
   * Stop resizing box
   */
  stopResizing(): void {
    this.isResizing.set(false);
    this.resizeCorner.set(null);
  }

  /**
   * Start rotating box
   */
  startRotating(startAngle: number, boxRotation: number): void {
    this.isRotating.set(true);
    this.rotationStartAngle.set(startAngle);
    this.boxStartRotation.set(boxRotation);
  }

  /**
   * Stop rotating box
   */
  stopRotating(): void {
    this.isRotating.set(false);
  }

  /**
   * Update last pointer position
   */
  updateLastPointer(x: number, y: number): void {
    this.lastPointer.set({ x, y });
  }

  // ========================================
  // FEATURE: CLIPBOARD - Methods
  // ========================================

  /**
   * Update clipboard
   */
  updateClipboard(box: Box | null): void {
    this.clipboard.set(box);
  }

  // ========================================
  // FEATURE: CONTEXT MENU - Methods
  // ========================================

  /**
   * Update context menu state
   */
  updateContextMenu(state: ContextMenuState | null): void {
    this.contextMenuState.set(state);
  }

  // ========================================
  // FEATURE: CREATION - Methods
  // ========================================

  /**
   * Update create mode
   */
  updateCreateMode(isCreateMode: boolean): void {
    this.isCreateMode.set(isCreateMode);
    if (!isCreateMode) {
      this.resetCreationState();
    }
  }

  /**
   * Update create state
   */
  updateCreateState(state: CreateBoxState): void {
    this.createState.set(state);
  }

  /**
   * Increment and get next temp ID
   */
  getNextTempId(): number {
    const current = this.nextTempId();
    this.nextTempId.set(current + 1);
    return current;
  }

  // ========================================
  // FEATURE: UI - Methods
  // ========================================

  /**
   * Update show nametags
   */
  updateShowNametags(show: boolean): void {
    this.showNametags.set(show);
  }

  /**
   * Update debug show quadtree
   */
  updateDebugShowQuadtree(show: boolean): void {
    this.debugShowQuadtree.set(show);
  }

  /**
   * Update device pixel ratio
   */
  updateDevicePixelRatio(ratio: number): void {
    this.devicePixelRatio.set(ratio);
  }

  /**
   * Update canvas context
   */
  updateContext(ctx: CanvasRenderingContext2D | undefined): void {
    this.ctx.set(ctx);
  }

  /**
   * Update background canvas
   */
  updateBgCanvas(bgCanvas: HTMLCanvasElement | undefined): void {
    this.bgCanvas.set(bgCanvas);
  }

  /**
   * Update canvas aspect ratio
   */
  updateCanvasAspectRatio(ratio: number): void {
    this.canvasAspectRatio.set(ratio);
  }

  /**
   * Update last frame time
   */
  updateLastFrameTime(time: number): void {
    this.lastFrameTime.set(time);
  }

  /**
   * Update RAF ID
   */
  updateRaf(id: number): void {
    this.raf.set(id);
  }
}
