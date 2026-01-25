import { signal, computed, Signal, WritableSignal } from '@angular/core';
import { Box } from '../../../intefaces/boxes.interface';
import { Camera, ResizeCorner } from '../core/types';
import { CreateBoxState } from '../core/creation-state';
import { ContextMenuState } from './context-menu-utils';

/**
 * Centralized state management for the canvas viewport component
 */

export class StateManager {
  // Canvas state
  raf = signal(0);
  ctx = signal<CanvasRenderingContext2D | undefined>(undefined);
  devicePixelRatio = signal(1);
  lastFrameTime = signal(0);

  // Creation mode
  isCreateMode = signal(false);
  createState = signal<CreateBoxState>({
    isCreating: false,
    startPoint: null,
    currentPoint: null,
  });
  nextTempId = signal(1);

  // Context menu
  contextMenuState = signal<ContextMenuState | null>(null);

  // Interaction state
  isPointerDown = signal(false);
  lastPointer = signal({ x: 0, y: 0 });
  lastMouseScreen = signal<{ x: number; y: number } | null>(null);
  hoveredBoxId = signal<string | null>(null);
  selectedBoxId = signal<string | null>(null);
  isDraggingBox = signal(false);
  dragStartWorld = signal({ x: 0, y: 0 });
  boxStartPos = signal({ x: 0, y: 0 });
  isResizing = signal(false);
  resizeCorner = signal<ResizeCorner | null>(null);
  isRotating = signal(false);
  rotationStartAngle = signal(0);
  boxStartRotation = signal(0);
  isDraggingOrInteracting = signal(false);
  currentCursor = signal('default');

  // History tracking
  interactionStartState = signal<{
    boxId: string;
    x: number;
    y: number;
    w: number;
    h: number;
    rotation: number;
  } | null>(null);

  // Clipboard
  clipboard = signal<Box | null>(null);

  // Background
  bgCanvas = signal<HTMLCanvasElement | undefined>(undefined);
  minZoom = signal(0);
  canvasAspectRatio = signal(1.5);

  // Display options
  showNametags = signal(true);
  debugShowQuadtree = signal(true);

  // Computed/derived state
  isAnyInteractionActive = computed(
    () => this.isRotating() || this.isResizing() || this.isDraggingBox(),
  );

  constructor(contextMenuState: ContextMenuState) {
    this.contextMenuState.set(contextMenuState);
  }

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

  /**
   * Check if any interaction is active
   */
  // isAnyInteractionActive is now a computed signal

  /**
   * Update cursor
   */
  setCursor(canvas: HTMLCanvasElement, cursor: string): void {
    if (this.currentCursor() !== cursor) {
      this.currentCursor.set(cursor);
      canvas.style.cursor = cursor;
    }
  }

  /**
   * Track mouse screen position
   */
  updateMouseScreenPosition(x: number, y: number): void {
    this.lastMouseScreen.set({ x, y });
  }

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
