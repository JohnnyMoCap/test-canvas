import { signal, computed, Signal, WritableSignal } from '@angular/core';
import { Box } from '../../../intefaces/boxes.interface';
import { Camera, ResizeCorner, MeasurementState } from '../core/types';
import { CreateBoxState } from '../core/creation-state';
import { ContextMenuState } from './context-menu-utils';
import { MeasurementUtils } from './measurement-utils';

/**
 * Centralized state management for the canvas viewport component
 */

export class StateManager {
  // ========================================
  // CANVAS & RENDERING
  // ========================================

  private _canvasElement = signal<HTMLCanvasElement | null>(null);
  readonly canvasElement = this._canvasElement.asReadonly();
  setCanvas(canvas: HTMLCanvasElement): void {
    this._canvasElement.set(canvas);
  }

  private _ctx = signal<CanvasRenderingContext2D | undefined>(undefined);
  readonly ctx = this._ctx.asReadonly();
  updateContext(ctx: CanvasRenderingContext2D | undefined): void {
    this._ctx.set(ctx);
  }

  private _devicePixelRatio = signal(1);
  readonly devicePixelRatio = this._devicePixelRatio.asReadonly();
  updateDevicePixelRatio(ratio: number): void {
    this._devicePixelRatio.set(ratio);
  }

  private _raf = signal(0);
  readonly raf = this._raf.asReadonly();
  updateRaf(id: number): void {
    this._raf.set(id);
  }

  private _lastFrameTime = signal(0);
  readonly lastFrameTime = this._lastFrameTime.asReadonly();
  updateLastFrameTime(time: number): void {
    this._lastFrameTime.set(time);
  }

  private _bgCanvas = signal<HTMLCanvasElement | undefined>(undefined);
  readonly bgCanvas = this._bgCanvas.asReadonly();
  updateBgCanvas(bgCanvas: HTMLCanvasElement | undefined): void {
    this._bgCanvas.set(bgCanvas);
  }

  private _minZoom = signal(0);
  readonly minZoom = this._minZoom.asReadonly();
  updateMinZoom(minZoom: number): void {
    this._minZoom.set(minZoom);
  }

  private _canvasAspectRatio = signal(1.5);
  readonly canvasAspectRatio = this._canvasAspectRatio.asReadonly();
  updateCanvasAspectRatio(ratio: number): void {
    this._canvasAspectRatio.set(ratio);
  }

  // ========================================
  // READ-ONLY MODE
  // ========================================

  private _readOnlyMode = signal(false);
  readonly readOnlyMode = this._readOnlyMode.asReadonly();
  updateReadOnlyMode(value: boolean) {
    this._readOnlyMode.set(value);
    // Disable interactive modes when entering read-only
    if (value) {
      this._isCreateMode.set(false);
      this._isMagicMode.set(false);
      this._selectedBoxId.set(null);
      this.resetInteractionStates();
    }
  }

  // ========================================
  // FEATURE: BOX CREATION
  // ========================================

  private _isCreateMode = signal(false);
  readonly isCreateMode = this._isCreateMode.asReadonly();
  toggleCreateMode(): void {
    this._isCreateMode.update((v) => !v);
    if (!this.isCreateMode()) {
      this.resetCreationState();
    }
  }
  updateCreateMode(isCreateMode: boolean): void {
    this._isCreateMode.set(isCreateMode);
    if (!isCreateMode) {
      this.resetCreationState();
    }
  }

  private _createState = signal<CreateBoxState>({
    isCreating: false,
    startPoint: null,
    currentPoint: null,
  });
  readonly createState = this._createState.asReadonly();
  updateCreateState(state: CreateBoxState): void {
    this._createState.set(state);
  }
  resetCreationState(): void {
    this._createState.set({
      isCreating: false,
      startPoint: null,
      currentPoint: null,
    });
  }

  private _nextTempId = signal(1);
  readonly nextTempId = this._nextTempId.asReadonly();
  getNextTempId(): number {
    const current = this.nextTempId();
    this._nextTempId.set(current + 1);
    return current;
  }

  // ========================================
  // FEATURE: MAGIC DETECTION
  // ========================================

  private _isMagicMode = signal(false);
  readonly isMagicMode = this._isMagicMode.asReadonly();
  toggleMagicMode(): void {
    this._isMagicMode.update((v) => !v);
    // Set cursor after signal updates
    const newCursor = this.isMagicMode() ? 'crosshair' : 'default';
    this.setCursor(newCursor);
  }

  private _magicTolerance = signal(30);
  readonly magicTolerance = this._magicTolerance.asReadonly();
  updateMagicTolerance(tolerance: number): void {
    this._magicTolerance.set(tolerance);
  }

  private _debugMagicDetection = signal(false);
  readonly debugMagicDetection = this._debugMagicDetection.asReadonly();
  updateDebugMagicDetection(debug: boolean): void {
    this._debugMagicDetection.set(debug);
  }

  // ========================================
  // FEATURE: MEASUREMENT TOOL
  // ========================================

  private _measurementState = signal<MeasurementState>(MeasurementUtils.createInitialState());
  readonly measurementState = this._measurementState.asReadonly();
  updateMeasurementState(state: MeasurementState): void {
    this._measurementState.set(state);
  }

  // ========================================
  // FEATURE: CONTEXT MENU
  // ========================================

  private _contextMenuState = signal<ContextMenuState | null>(null);
  readonly contextMenuState = this._contextMenuState.asReadonly();
  updateContextMenu(state: ContextMenuState | null): void {
    this._contextMenuState.set(state);
  }

  // ========================================
  // FEATURE: SELECTION & HOVER
  // ========================================

  private _hoveredBoxId = signal<string | null>(null);
  readonly hoveredBoxId = this._hoveredBoxId.asReadonly();
  updateHoverState(boxId: string | null): boolean {
    if (this.hoveredBoxId() != boxId) {
      this._hoveredBoxId.set(boxId);
      return true; // State changed
    }
    return false; // No change
  }

  private _selectedBoxId = signal<string | null>(null);
  readonly selectedBoxId = this._selectedBoxId.asReadonly();
  updateSelectedBox(boxId: string | null): void {
    this._selectedBoxId.set(boxId);
  }

  // ========================================
  // FEATURE: BOX INTERACTION (Rotate/Resize/Drag)
  // ========================================

  private _isPointerDown = signal(false);
  readonly isPointerDown = this._isPointerDown.asReadonly();
  updatePointerDown(isDown: boolean): void {
    this._isPointerDown.set(isDown);
  }

  private _isDraggingBox = signal(false);
  readonly isDraggingBox = this._isDraggingBox.asReadonly();
  startDragging(worldX: number, worldY: number, boxX: number, boxY: number): void {
    this._isDraggingBox.set(true);
    this._dragStartWorld.set({ x: worldX, y: worldY });
    this._boxStartPos.set({ x: boxX, y: boxY });
  }
  stopDragging(): void {
    this._isDraggingBox.set(false);
  }

  private _dragStartWorld = signal({ x: 0, y: 0 });
  readonly dragStartWorld = this._dragStartWorld.asReadonly();

  private _boxStartPos = signal({ x: 0, y: 0 });
  readonly boxStartPos = this._boxStartPos.asReadonly();

  private _isResizing = signal(false);
  readonly isResizing = this._isResizing.asReadonly();
  startResizing(corner: ResizeCorner): void {
    this._isResizing.set(true);
    this._resizeCorner.set(corner);
  }
  stopResizing(): void {
    this._isResizing.set(false);
    this._resizeCorner.set(null);
  }

  private _resizeCorner = signal<ResizeCorner | null>(null);
  readonly resizeCorner = this._resizeCorner.asReadonly();

  private _isRotating = signal(false);
  readonly isRotating = this._isRotating.asReadonly();
  startRotating(startAngle: number, boxRotation: number): void {
    this._isRotating.set(true);
    this._rotationStartAngle.set(startAngle);
    this._boxStartRotation.set(boxRotation);
  }
  stopRotating(): void {
    this._isRotating.set(false);
  }

  private _rotationStartAngle = signal(0);
  readonly rotationStartAngle = this._rotationStartAngle.asReadonly();

  private _boxStartRotation = signal(0);
  readonly boxStartRotation = this._boxStartRotation.asReadonly();

  private _interactionStartState = signal<{
    boxId: string;
    x: number;
    y: number;
    w: number;
    h: number;
    rotation: number;
  } | null>(null);
  readonly interactionStartState = this._interactionStartState.asReadonly();
  startInteraction(
    boxId: string,
    x: number,
    y: number,
    w: number,
    h: number,
    rotation: number,
  ): void {
    this._interactionStartState.set({ boxId, x, y, w, h, rotation });
  }
  resetInteractionStates(): void {
    this._isPointerDown.set(false);
    this._isDraggingBox.set(false);
    this._isResizing.set(false);
    this._isRotating.set(false);
    this._resizeCorner.set(null);
    this._interactionStartState.set(null);
  }

  // ========================================
  // FEATURE: CLIPBOARD
  // ========================================

  private _clipboard = signal<Box | null>(null);
  readonly clipboard = this._clipboard.asReadonly();
  updateClipboard(box: Box | null): void {
    this._clipboard.set(box);
  }

  // ========================================
  // UI STATE
  // ========================================

  private _currentCursor = signal('default');
  readonly currentCursor = this._currentCursor.asReadonly();
  setCursor(cursor: string): void {
    if (this.currentCursor() !== cursor) {
      this._currentCursor.set(cursor);
    }
  }

  private _lastPointer = signal({ x: 0, y: 0 });
  readonly lastPointer = this._lastPointer.asReadonly();
  updateLastPointer(x: number, y: number): void {
    this._lastPointer.set({ x, y });
  }

  private _lastMouseScreen = signal<{ x: number; y: number } | null>(null);
  readonly lastMouseScreen = this._lastMouseScreen.asReadonly();
  updateMouseScreenPosition(x: number, y: number): void {
    this._lastMouseScreen.set({ x, y });
  }

  private _showNametags = signal(true);
  readonly showNametags = this._showNametags.asReadonly();
  updateShowNametags(show: boolean): void {
    this._showNametags.set(show);
  }

  private _debugShowQuadtree = signal(true);
  readonly debugShowQuadtree = this._debugShowQuadtree.asReadonly();
  updateDebugShowQuadtree(show: boolean): void {
    this._debugShowQuadtree.set(show);
  }

  private _brightness = signal(100);
  readonly brightness = this._brightness.asReadonly();
  updateBrightness(brightness: number): void {
    this._brightness.set(brightness);
  }

  private _contrast = signal(100);
  readonly contrast = this._contrast.asReadonly();
  updateContrast(contrast: number): void {
    this._contrast.set(contrast);
  }

  // ========================================
  // COMPUTED STATE
  // ========================================

  isAnyInteractionActive = computed(
    () => this.isRotating() || this.isResizing() || this.isDraggingBox(),
  );

  isDraggingOrInteracting = computed(
    () => this.isRotating() || this.isResizing() || this.isDraggingBox(),
  );

  // ========================================
  // CONSTRUCTOR
  // ========================================

  constructor(contextMenuState: ContextMenuState) {
    this._contextMenuState.set(contextMenuState);
  }

  // ========================================
  // CAMERA (handled by parent component)
  // ========================================

  updateCamera(camera: Camera): void {
    // Camera updates are handled by parent component signal binding
    // This method is here for discoverability and future extension
  }
}
