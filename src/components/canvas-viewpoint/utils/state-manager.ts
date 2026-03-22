import { signal, computed, Signal, WritableSignal } from '@angular/core';
import { Box } from '../../../inteface/boxes.interface';
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

  /**
   * Reference to the main HTML canvas element where all rendering happens.
   * Set once during component initialization (ngAfterViewInit) and used throughout
   * for getting dimensions, bounding rectangles, and rendering operations.
   */
  private _canvasElement = signal<HTMLCanvasElement | null>(null);
  readonly canvasElement = this._canvasElement.asReadonly();
  setCanvas(canvas: HTMLCanvasElement): void {
    this._canvasElement.set(canvas);
  }

  /**
   * The 2D rendering context used for all canvas drawing operations.
   * Obtained from the canvas element and cached here for performance.
   * Contains methods like fillRect(), strokeRect(), drawImage(), etc.
   */
  private _ctx = signal<CanvasRenderingContext2D | undefined>(undefined);
  readonly ctx = this._ctx.asReadonly();
  updateContext(ctx: CanvasRenderingContext2D | undefined): void {
    this._ctx.set(ctx);
  }

  /**
   * Pixel density ratio of the user's display (e.g., 2 for Retina displays, 1 for standard).
   * Used to scale canvas resolution for crisp rendering on high-DPI screens.
   * Multiply CSS pixel values by this to get actual canvas pixel coordinates.
   */
  private _devicePixelRatio = signal(1);
  readonly devicePixelRatio = this._devicePixelRatio.asReadonly();
  updateDevicePixelRatio(ratio: number): void {
    this._devicePixelRatio.set(ratio);
  }

  /**
   * Off-screen canvas containing the background image (e.g., floor plan, photo, map).
   * Pre-loaded and cached to avoid re-decoding the image on every frame.
   * Width/height represent the actual image dimensions in pixels (world coordinates).
   */
  private _bgCanvas = signal<HTMLCanvasElement | undefined>(undefined);
  readonly bgCanvas = this._bgCanvas.asReadonly();
  updateBgCanvas(bgCanvas: HTMLCanvasElement | undefined): void {
    this._bgCanvas.set(bgCanvas);
  }

  /**
   * Minimum allowed zoom level calculated based on viewport and image sizes.
   * Prevents zooming out so far that the entire image becomes smaller than the viewport.
   * Recalculated whenever the canvas or background image is resized.
   */
  private _minZoom = signal(0);
  readonly minZoom = this._minZoom.asReadonly();
  updateMinZoom(minZoom: number): void {
    this._minZoom.set(minZoom);
  }

  /**
   * Aspect ratio (width/height) of the background image.
   * Used to maintain proper proportions when resizing the canvas to fit the viewport.
   * Example: 1.5 means image is 50% wider than it is tall (e.g., 1500x1000).
   */
  private _canvasAspectRatio = signal(1.5);
  readonly canvasAspectRatio = this._canvasAspectRatio.asReadonly();
  updateCanvasAspectRatio(ratio: number): void {
    this._canvasAspectRatio.set(ratio);
  }

  /**
   * Current camera state: zoom level and world-space pan offset (x/y).
   * Updated on pan, zoom, and any operation that changes the viewport.
   */
  private _camera = signal<Camera>({ zoom: 1, x: 0, y: 0 });
  readonly camera = this._camera.asReadonly();
  updateCamera(camera: Camera): void {
    this._camera.set(camera);
  }

  // ========================================
  // READ-ONLY MODE
  // ========================================

  /**
   * When true, disables all editing interactions (create, drag, resize, rotate, delete).
   * Useful for viewing/presenting without accidentally modifying data.
   * Automatically clears selections and disables create/magic modes when enabled.
   */
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

  /**
   * Indicates whether the user is in "create mode" where clicking and dragging
   * creates new bounding boxes. When false, clicking selects existing boxes.
   * Toggled via UI button or keyboard shortcut.
   */
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

  /**
   * Tracks the current state of box creation during a drag operation.
   * Contains: isCreating (is drag in progress), startPoint (where drag began),
   * currentPoint (current mouse position). Used to render preview box during creation.
   */
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

  /**
   * Auto-incrementing ID counter for newly created boxes before they're saved.
   * Temporary IDs are like "temp-1", "temp-2" and get replaced with permanent IDs
   * after the box is committed to the history service.
   */
  private _nextTempId = signal(1);
  readonly nextTempId = this._nextTempId.asReadonly();
  getNextTempId(): number {
    const current = this.nextTempId();
    this._nextTempId.set(current + 1);
    return current;
  }
  setNextTempId(n: number): void {
    this._nextTempId.set(n);
  }

  // ========================================
  // FEATURE: MAGIC DETECTION
  // ========================================

  /**
   * When enabled, clicking on the background image attempts to automatically detect
   * and create a bounding box around a visually distinct region (e.g., a room in a floor plan).
   * Uses color similarity algorithms to find boundaries.
   */
  private _isMagicMode = signal(false);
  readonly isMagicMode = this._isMagicMode.asReadonly();
  toggleMagicMode(): void {
    this._isMagicMode.update((v) => !v);
    // Set cursor after signal updates
    const newCursor = this.isMagicMode() ? 'crosshair' : 'default';
    this.setCursor(newCursor);
  }

  /**
   * Color similarity threshold (0-255) for magic box detection.
   * Lower = stricter matching (only very similar colors), Higher = more lenient.
   * Example: 30 means pixels within 30 units in RGB space are considered "same color".
   */
  private _magicTolerance = signal(30);
  readonly magicTolerance = this._magicTolerance.asReadonly();
  updateMagicTolerance(tolerance: number): void {
    this._magicTolerance.set(tolerance);
  }

  /**
   * When true, magic detection logs detailed debugging info to the console
   * (pixel values, color differences, boundary detection steps).
   * Useful for troubleshooting why magic detection isn't working as expected.
   */
  private _debugMagicDetection = signal(false);
  readonly debugMagicDetection = this._debugMagicDetection.asReadonly();
  updateDebugMagicDetection(debug: boolean): void {
    this._debugMagicDetection.set(debug);
  }

  // ========================================
  // FEATURE: MEASUREMENT TOOL
  // ========================================

  /**
   * Complete state for the measurement tool feature.
   * Contains: isActive (is tool enabled), pointOne/pointTwo (measurement endpoints),
   * isDraggingPoint (which point is being moved), metricWidth/Height (real-world dimensions).
   * Used to calculate pixel-to-meter ratios for accurate measurements.
   */
  private _measurementState = signal<MeasurementState>(MeasurementUtils.createInitialState());
  readonly measurementState = this._measurementState.asReadonly();
  updateMeasurementState(state: MeasurementState): void {
    this._measurementState.set(state);
  }

  // ========================================
  // FEATURE: CONTEXT MENU
  // ========================================

  /**
   * State for the right-click context menu that appears during box creation.
   * Contains: visible (is menu shown), x/y (screen coordinates), available options.
   * Null when menu is closed. Used to select box type (e.g., room, hallway, furniture).
   */
  private _contextMenuState = signal<ContextMenuState | null>(null);
  readonly contextMenuState = this._contextMenuState.asReadonly();
  updateContextMenu(state: ContextMenuState | null): void {
    this._contextMenuState.set(state);
  }

  // ========================================
  // FEATURE: SELECTION & HOVER
  // ========================================

  /**
   * ID of the box currently under the mouse cursor (or null if not hovering any box).
   * Updates in real-time as mouse moves. Used to highlight boxes on hover,
   * show resize handles, and determine which box to interact with on click.
   */
  private _hoveredBoxId = signal<number | null>(null);
  readonly hoveredBoxId = this._hoveredBoxId.asReadonly();
  updateHoverState(boxId: number | null): boolean {
    if (this.hoveredBoxId() !== boxId) {
      this._hoveredBoxId.set(boxId);
      return true; // State changed
    }
    return false; // No change
  }

  /**
   * ID of the currently selected box (or null if no selection).
   * Selected box shows resize handles, rotation knob, and can be moved/edited/deleted.
   * Can be set by clicking a box, external selection from box list, or keyboard navigation.
   */
  private _selectedBoxId = signal<number | null>(null);
  readonly selectedBoxId = this._selectedBoxId.asReadonly();
  updateSelectedBox(boxId: number | null): void {
    this._selectedBoxId.set(boxId);
  }

  // ========================================
  // FEATURE: BOX INTERACTION (Rotate/Resize/Drag)
  // ========================================

  /**
   * Tracks whether the mouse button is currently pressed down.
   * Used to distinguish between hover and active interaction.
   * Set on pointerdown, cleared on pointerup.
   */
  private _isPointerDown = signal(false);
  readonly isPointerDown = this._isPointerDown.asReadonly();
  updatePointerDown(isDown: boolean): void {
    this._isPointerDown.set(isDown);
  }

  /**
   * True when actively dragging a box to move it around the canvas.
   * While true, mouse movements translate to box position changes.
   * Drag starts when clicking box body (not handles) and dragging.
   */
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

  /**
   * World coordinates where the drag operation began.
   * Used to calculate delta (how far mouse has moved) during drag.
   * Stored in world space to remain consistent across zoom/pan changes.
   */
  private _dragStartWorld = signal({ x: 0, y: 0 });
  readonly dragStartWorld = this._dragStartWorld.asReadonly();

  /**
   * Original position (world coordinates) of the box when drag started.
   * Combined with drag delta to calculate new box position.
   * Allows smooth dragging that updates the box position continuously.
   */
  private _boxStartPos = signal({ x: 0, y: 0 });
  readonly boxStartPos = this._boxStartPos.asReadonly();

  /**
   * True when actively resizing a box by dragging one of its corner handles.
   * While true, mouse movements change box dimensions while keeping opposite corner fixed.
   * Cleared when mouse button is released.
   */
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

  /**
   * Which corner handle is being dragged for resize: 'nw', 'ne', 'sw', or 'se'.
   * Determines which corner stays fixed and which direction the box grows/shrinks.
   * Null when not resizing.
   */
  private _resizeCorner = signal<ResizeCorner | null>(null);
  readonly resizeCorner = this._resizeCorner.asReadonly();

  /**
   * True when actively rotating a box by dragging the rotation knob.
   * While true, mouse movements change the box's rotation angle around its center.
   * Rotation is calculated using angle from box center to mouse position.
   */
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

  /**
   * Angle (in radians) from box center to mouse position when rotation began.
   * Used to calculate relative rotation: (current angle - start angle) + original box rotation.
   * Allows smooth rotation that updates continuously as mouse moves.
   */
  private _rotationStartAngle = signal(0);
  readonly rotationStartAngle = this._rotationStartAngle.asReadonly();

  /**
   * The box's original rotation (in radians) when rotation interaction began.
   * Combined with angle delta to calculate final rotation.
   * Preserved to allow canceling the rotation (undo).
   */
  private _boxStartRotation = signal(0);
  readonly boxStartRotation = this._boxStartRotation.asReadonly();

  /**
   * Snapshot of a box's complete state when any interaction (drag/resize/rotate) begins.
   * Contains: boxId, original x/y/w/h/rotation values.
   * Used for undo/redo history - we record what changed from this starting state.
   */
  private _interactionStartState = signal<{
    boxId: number;
    x: number;
    y: number;
    w: number;
    h: number;
    rotation: number;
  } | null>(null);
  readonly interactionStartState = this._interactionStartState.asReadonly();
  startInteraction(
    boxId: number,
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

  /**
   * The box currently stored in clipboard (via copy/cut).
   * Used for copy-paste operations. Paste creates a duplicate of this box
   * at a slightly offset position. Null when clipboard is empty.
   */
  private _clipboard = signal<Box | null>(null);
  readonly clipboard = this._clipboard.asReadonly();
  updateClipboard(box: Box | null): void {
    this._clipboard.set(box);
  }

  // ========================================
  // UI STATE
  // ========================================

  /**
   * Current CSS cursor style to display on the canvas.
   * Changes based on context: 'default', 'pointer', 'move', 'crosshair',
   * 'nw-resize', 'ne-resize', etc. Provides visual feedback for interactions.
   */
  private _currentCursor = signal('default');
  readonly currentCursor = this._currentCursor.asReadonly();
  setCursor(cursor: string): void {
    if (this.currentCursor() !== cursor) {
      this._currentCursor.set(cursor);
    }
  }

  /**
   * Last known pointer position in canvas-relative coordinates (not world coordinates).
   * Updated on every pointer move. Used for operations that need current mouse position
   * like hover detection, cursor updates, and coordinate transformations.
   */
  private _lastPointer = signal({ x: 0, y: 0 });
  readonly lastPointer = this._lastPointer.asReadonly();
  updateLastPointer(x: number, y: number): void {
    this._lastPointer.set({ x, y });
  }

  /**
   * Last mouse position in screen/viewport coordinates (not canvas or world).
   * Used for operations that need absolute screen position like positioning
   * context menus, tooltips, or calculating screen-to-world transformations.
   */
  private _lastMouseScreen = signal<{ x: number; y: number } | null>(null);
  readonly lastMouseScreen = this._lastMouseScreen.asReadonly();
  updateMouseScreenPosition(x: number, y: number): void {
    this._lastMouseScreen.set({ x, y });
  }

  /**
   * Controls visibility of box labels/nametags that display box IDs or names.
   * When false, only box outlines are shown. Useful for cleaner screenshots
   * or when labels become too cluttered at high zoom levels.
   */
  private _showNametags = signal(true);
  readonly showNametags = this._showNametags.asReadonly();
  updateShowNametags(show: boolean): void {
    this._showNametags.set(show);
  }

  /**
   * Debug visualization: when true, renders the quadtree spatial index structure
   * showing how the canvas is subdivided for efficient box queries.
   * Useful for understanding performance or debugging spatial queries.
   */
  private _debugShowQuadtree = signal(false);
  readonly debugShowQuadtree = this._debugShowQuadtree.asReadonly();
  updateDebugShowQuadtree(show: boolean): void {
    this._debugShowQuadtree.set(show);
  }

  /**
   * Background image brightness adjustment (percentage: 0-200, default 100).
   * Applied as CSS filter. Values < 100 darken, > 100 brighten.
   * Useful for improving box visibility on dark or light backgrounds.
   */
  private _brightness = signal(100);
  readonly brightness = this._brightness.asReadonly();
  updateBrightness(brightness: number): void {
    this._brightness.set(brightness);
  }

  /**
   * Background image contrast adjustment (percentage: 0-200, default 100).
   * Applied as CSS filter. Increases/decreases difference between light and dark areas.
   * Useful for making faded or washed-out images more readable.
   */
  private _contrast = signal(100);
  readonly contrast = this._contrast.asReadonly();
  updateContrast(contrast: number): void {
    this._contrast.set(contrast);
  }

  // ========================================
  // BOX DATA
  // ========================================

  /**
   * Current list of boxes visible on the canvas (synced from HistoryService).
   * Not updated during active drag/resize/rotate interactions to avoid quadtree invalidation.
   */
  private _localBoxes = signal<Box[]>([]);
  readonly localBoxes = this._localBoxes.asReadonly();
  updateLocalBoxes(boxes: Box[]): void {
    this._localBoxes.set(boxes);
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

  constructor(contextMenuState: ContextMenuState) {
    this._contextMenuState.set(contextMenuState);
  }
}
