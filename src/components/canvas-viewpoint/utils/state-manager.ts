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
  
  isDraggingOrInteracting = signal(false);
  
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
}
