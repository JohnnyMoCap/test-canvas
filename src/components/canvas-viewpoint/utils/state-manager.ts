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

  private _canvasElement = signal<HTMLCanvasElement | null>(null);
  private _raf = signal(0);
  private _ctx = signal<CanvasRenderingContext2D | undefined>(undefined);
  private _devicePixelRatio = signal(1);
  private _lastFrameTime = signal(0);
  private _bgCanvas = signal<HTMLCanvasElement | undefined>(undefined);
  private _minZoom = signal(0);
  private _canvasAspectRatio = signal(1.5);

  readonly canvasElement = this._canvasElement.asReadonly();
  readonly raf = this._raf.asReadonly();
  readonly ctx = this._ctx.asReadonly();
  readonly devicePixelRatio = this._devicePixelRatio.asReadonly();
  readonly lastFrameTime = this._lastFrameTime.asReadonly();
  readonly bgCanvas = this._bgCanvas.asReadonly();
  readonly minZoom = this._minZoom.asReadonly();
  readonly canvasAspectRatio = this._canvasAspectRatio.asReadonly();

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
  private _createState = signal<CreateBoxState>({
    isCreating: false,
    startPoint: null,
    currentPoint: null,
  });
  private _nextTempId = signal(1);

  readonly isCreateMode = this._isCreateMode.asReadonly();
  readonly createState = this._createState.asReadonly();
  readonly nextTempId = this._nextTempId.asReadonly();

  // ========================================
  // FEATURE: MAGIC DETECTION
  // ========================================

  private _isMagicMode = signal(false);
  private _magicTolerance = signal(30);
  private _debugMagicDetection = signal(false);

  readonly isMagicMode = this._isMagicMode.asReadonly();
  readonly magicTolerance = this._magicTolerance.asReadonly();
  readonly debugMagicDetection = this._debugMagicDetection.asReadonly();

  // ========================================
  // FEATURE: CONTEXT MENU
  // ========================================

  private _contextMenuState = signal<ContextMenuState | null>(null);

  readonly contextMenuState = this._contextMenuState.asReadonly();

  // ========================================
  // FEATURE: SELECTION & HOVER
  // ========================================

  private _hoveredBoxId = signal<string | null>(null);
  private _selectedBoxId = signal<string | null>(null);

  readonly hoveredBoxId = this._hoveredBoxId.asReadonly();
  readonly selectedBoxId = this._selectedBoxId.asReadonly();

  // ========================================
  // FEATURE: BOX INTERACTION (Rotate/Resize/Drag)
  // ========================================

  private _isPointerDown = signal(false);
  private _isDraggingBox = signal(false);
  private _dragStartWorld = signal({ x: 0, y: 0 });
  private _boxStartPos = signal({ x: 0, y: 0 });

  private _isResizing = signal(false);
  private _resizeCorner = signal<ResizeCorner | null>(null);

  private _isRotating = signal(false);
  private _rotationStartAngle = signal(0);
  private _boxStartRotation = signal(0);

  private _interactionStartState = signal<{
    boxId: string;
    x: number;
    y: number;
    w: number;
    h: number;
    rotation: number;
  } | null>(null);

  readonly isPointerDown = this._isPointerDown.asReadonly();
  readonly isDraggingBox = this._isDraggingBox.asReadonly();
  readonly dragStartWorld = this._dragStartWorld.asReadonly();
  readonly boxStartPos = this._boxStartPos.asReadonly();
  readonly isResizing = this._isResizing.asReadonly();
  readonly resizeCorner = this._resizeCorner.asReadonly();
  readonly isRotating = this._isRotating.asReadonly();
  readonly rotationStartAngle = this._rotationStartAngle.asReadonly();
  readonly boxStartRotation = this._boxStartRotation.asReadonly();
  readonly interactionStartState = this._interactionStartState.asReadonly();

  // ========================================
  // FEATURE: CLIPBOARD
  // ========================================

  private _clipboard = signal<Box | null>(null);

  readonly clipboard = this._clipboard.asReadonly();

  // ========================================
  // UI STATE
  // ========================================

  private _currentCursor = signal('default');
  private _lastPointer = signal({ x: 0, y: 0 });
  private _lastMouseScreen = signal<{ x: number; y: number } | null>(null);
  private _showNametags = signal(true);
  private _debugShowQuadtree = signal(true);
  private _brightness = signal(100);
  private _contrast = signal(100);

  readonly currentCursor = this._currentCursor.asReadonly();
  readonly lastPointer = this._lastPointer.asReadonly();
  readonly lastMouseScreen = this._lastMouseScreen.asReadonly();
  readonly showNametags = this._showNametags.asReadonly();
  readonly debugShowQuadtree = this._debugShowQuadtree.asReadonly();
  readonly brightness = this._brightness.asReadonly();
  readonly contrast = this._contrast.asReadonly();

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
    this._contextMenuState.set(contextMenuState);
  }

  // ========================================
  // FEATURE: BOX CREATION - Methods
  // ========================================

  /**
   * Reset creation state
   */
  resetCreationState(): void {
    this._createState.set({
      isCreating: false,
      startPoint: null,
      currentPoint: null,
    });
  }

  /**
   * Toggle create mode
   */
  toggleCreateMode(): void {
    this._isCreateMode.update((v) => !v);
    if (!this.isCreateMode()) {
      this.resetCreationState();
    }
  }

  // ========================================
  // FEATURE: MAGIC DETECTION - Methods
  // ========================================

  /**
   * Toggle magic mode
   */
  toggleMagicMode(): void {
    this._isMagicMode.update((v) => !v);
    // Set cursor after signal updates
    const newCursor = this.isMagicMode() ? 'crosshair' : 'default';
    this.setCursor(newCursor);
  }

  // ========================================
  // FEATURE: BOX INTERACTION - Methods
  // ========================================

  /**
   * Reset all interaction states
   */
  resetInteractionStates(): void {
    this._isPointerDown.set(false);
    this._isDraggingBox.set(false);
    this._isResizing.set(false);
    this._isRotating.set(false);
    this._resizeCorner.set(null);
    this._interactionStartState.set(null);
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
    this._interactionStartState.set({ boxId, x, y, w, h, rotation });
  }

  // ========================================
  // UI - Methods
  // ========================================

  /**
   * Set canvas element reference (call during ngAfterViewInit)
   */
  setCanvas(canvas: HTMLCanvasElement): void {
    this._canvasElement.set(canvas);
  }

  /**
   * Update cursor (reactive updates handled by component effect)
   */
  setCursor(cursor: string): void {
    if (this.currentCursor() !== cursor) {
      this._currentCursor.set(cursor);
    }
  }

  /**
   * Track mouse screen position
   */
  updateMouseScreenPosition(x: number, y: number): void {
    this._lastMouseScreen.set({ x, y });
  }

  // ========================================
  // FEATURE: SELECTION & HOVER - Methods
  // ========================================

  /**
   * Update hover state
   */
  updateHoverState(boxId: string | null): boolean {
    if (this.hoveredBoxId() != boxId) {
      this._hoveredBoxId.set(boxId);
      return true; // State changed
    }
    return false; // No change
  }

  /**
   * Update selected box
   */
  updateSelectedBox(boxId: string | null): void {
    this._selectedBoxId.set(boxId);
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
    this._minZoom.set(minZoom);
  }

  // ========================================
  // FEATURE: BOX MANIPULATION - Methods
  // ========================================

  /**
   * Update pointer down state
   */
  updatePointerDown(isDown: boolean): void {
    this._isPointerDown.set(isDown);
  }

  /**
   * Start dragging box
   */
  startDragging(worldX: number, worldY: number, boxX: number, boxY: number): void {
    this._isDraggingBox.set(true);
    this._dragStartWorld.set({ x: worldX, y: worldY });
    this._boxStartPos.set({ x: boxX, y: boxY });
  }

  /**
   * Stop dragging box
   */
  stopDragging(): void {
    this._isDraggingBox.set(false);
  }

  /**
   * Start resizing box
   */
  startResizing(corner: ResizeCorner): void {
    this._isResizing.set(true);
    this._resizeCorner.set(corner);
  }

  /**
   * Stop resizing box
   */
  stopResizing(): void {
    this._isResizing.set(false);
    this._resizeCorner.set(null);
  }

  /**
   * Start rotating box
   */
  startRotating(startAngle: number, boxRotation: number): void {
    this._isRotating.set(true);
    this._rotationStartAngle.set(startAngle);
    this._boxStartRotation.set(boxRotation);
  }

  /**
   * Stop rotating box
   */
  stopRotating(): void {
    this._isRotating.set(false);
  }

  /**
   * Update last pointer position
   */
  updateLastPointer(x: number, y: number): void {
    this._lastPointer.set({ x, y });
  }

  // ========================================
  // FEATURE: CLIPBOARD - Methods
  // ========================================

  /**
   * Update clipboard
   */
  updateClipboard(box: Box | null): void {
    this._clipboard.set(box);
  }

  // ========================================
  // FEATURE: CONTEXT MENU - Methods
  // ========================================

  /**
   * Update context menu state
   */
  updateContextMenu(state: ContextMenuState | null): void {
    this._contextMenuState.set(state);
  }

  // ========================================
  // FEATURE: CREATION - Methods
  // ========================================

  /**
   * Update create mode
   */
  updateCreateMode(isCreateMode: boolean): void {
    this._isCreateMode.set(isCreateMode);
    if (!isCreateMode) {
      this.resetCreationState();
    }
  }

  /**
   * Update create state
   */
  updateCreateState(state: CreateBoxState): void {
    this._createState.set(state);
  }

  /**
   * Increment and get next temp ID
   */
  getNextTempId(): number {
    const current = this.nextTempId();
    this._nextTempId.set(current + 1);
    return current;
  }

  // ========================================
  // FEATURE: UI - Methods
  // ========================================

  /**
   * Update show nametags
   */
  updateShowNametags(show: boolean): void {
    this._showNametags.set(show);
  }

  /**
   * Update debug show quadtree
   */
  updateDebugShowQuadtree(show: boolean): void {
    this._debugShowQuadtree.set(show);
  }

  /**
   * Update device pixel ratio
   */
  updateDevicePixelRatio(ratio: number): void {
    this._devicePixelRatio.set(ratio);
  }

  /**
   * Update canvas context
   */
  updateContext(ctx: CanvasRenderingContext2D | undefined): void {
    this._ctx.set(ctx);
  }

  /**
   * Update background canvas
   */
  updateBgCanvas(bgCanvas: HTMLCanvasElement | undefined): void {
    this._bgCanvas.set(bgCanvas);
  }

  /**
   * Update canvas aspect ratio
   */
  updateCanvasAspectRatio(ratio: number): void {
    this._canvasAspectRatio.set(ratio);
  }

  /**
   * Update last frame time
   */
  updateLastFrameTime(time: number): void {
    this._lastFrameTime.set(time);
  }

  /**
   * Update RAF ID
   */
  updateRaf(id: number): void {
    this._raf.set(id);
  }

  /**
   * Update magic tolerance
   */
  updateMagicTolerance(tolerance: number): void {
    this._magicTolerance.set(tolerance);
  }

  /**
   * Update debug magic detection
   */
  updateDebugMagicDetection(debug: boolean): void {
    this._debugMagicDetection.set(debug);
  }

  /**
   * Update brightness
   */
  updateBrightness(brightness: number): void {
    this._brightness.set(brightness);
  }

  /**
   * Update contrast
   */
  updateContrast(contrast: number): void {
    this._contrast.set(contrast);
  }
}
