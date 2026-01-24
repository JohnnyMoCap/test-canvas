import { Signal, WritableSignal } from '@angular/core';
import { Box } from '../../../intefaces/boxes.interface';
import { Camera, ResizeCorner } from '../core/types';
import { CreateBoxState } from '../core/creation-state';
import { ContextMenuState } from './context-menu-utils';

/**
 * Centralized state management for the canvas viewport component
 */
export class StateManager {
  // Canvas state
  public raf = 0;
  public ctx?: CanvasRenderingContext2D;
  public devicePixelRatio = 1;
  public lastFrameTime = 0;

  // Creation mode
  public isCreateMode = false;
  public createState: CreateBoxState = {
    isCreating: false,
    startPoint: null,
    currentPoint: null,
  };
  public nextTempId = 1;

  // Context menu
  public contextMenuState: ContextMenuState;

  // Interaction state
  public isPointerDown = false;
  public lastPointer = { x: 0, y: 0 };
  public lastMouseScreen: { x: number; y: number } | null = null;
  public hoveredBoxId: string | null = null;
  public selectedBoxId: string | null = null;
  public isDraggingBox = false;
  public dragStartWorld = { x: 0, y: 0 };
  public boxStartPos = { x: 0, y: 0 };
  public isResizing = false;
  public resizeCorner: ResizeCorner | null = null;
  public isRotating = false;
  public rotationStartAngle = 0;
  public boxStartRotation = 0;
  public isDraggingOrInteracting = false;
  public currentCursor = 'default';

  // History tracking
  public interactionStartState: {
    boxId: string;
    x: number;
    y: number;
    w: number;
    h: number;
    rotation: number;
  } | null = null;

  // Clipboard
  public clipboard: Box | null = null;

  // Background
  public bgCanvas?: HTMLCanvasElement;
  public minZoom = 0;
  public canvasAspectRatio = 1.5;

  // Display options
  public showNametags = true;
  public debugShowQuadtree = true;

  constructor(contextMenuState: ContextMenuState) {
    this.contextMenuState = contextMenuState;
  }

  /**
   * Reset creation state
   */
  resetCreationState(): void {
    this.createState = {
      isCreating: false,
      startPoint: null,
      currentPoint: null,
    };
  }

  /**
   * Toggle create mode
   */
  toggleCreateMode(): void {
    this.isCreateMode = !this.isCreateMode;
    if (!this.isCreateMode) {
      this.resetCreationState();
    }
  }

  /**
   * Reset all interaction states
   */
  resetInteractionStates(): void {
    this.isPointerDown = false;
    this.isDraggingBox = false;
    this.isResizing = false;
    this.isRotating = false;
    this.resizeCorner = null;
    this.interactionStartState = null;
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
    this.interactionStartState = { boxId, x, y, w, h, rotation };
  }

  /**
   * Check if any interaction is active
   */
  isAnyInteractionActive(): boolean {
    return this.isRotating || this.isResizing || this.isDraggingBox;
  }

  /**
   * Update cursor
   */
  setCursor(canvas: HTMLCanvasElement, cursor: string): void {
    if (this.currentCursor !== cursor) {
      this.currentCursor = cursor;
      canvas.style.cursor = cursor;
    }
  }

  /**
   * Track mouse screen position
   */
  updateMouseScreenPosition(x: number, y: number): void {
    this.lastMouseScreen = { x, y };
  }

  /**
   * Update hover state
   */
  updateHoverState(boxId: string | null): boolean {
    if (this.hoveredBoxId !== boxId) {
      this.hoveredBoxId = boxId;
      return true; // State changed
    }
    return false; // No change
  }
}
