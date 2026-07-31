import { signal, computed } from '@angular/core';
import { Box } from '../../../interface/boxes.interface';
import { ResizeCorner, MeasurementState } from '../core/types';
import { CreateBoxState } from '../core/creation-state';
import { ContextMenuState } from './context-menu-utils';
import { MeasurementUtils } from './measurement-utils';
import { BaseStateManager } from './base-state-manager';
import { MagicEngineKind } from '../handlers/magic-engine';

/**
 * Full state for the labeling viewport.
 * Extends BaseStateManager with annotation, magic detection, measurement,
 * context-menu, selection, drag/resize/rotate, clipboard, and display flags.
 */
export class LabelingStateManager extends BaseStateManager {
  // ========================================
  // POINTER & BOX DATA
  // ========================================

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

  private _isPointerDown = signal(false);
  readonly isPointerDown = this._isPointerDown.asReadonly();
  updatePointerDown(isDown: boolean): void {
    this._isPointerDown.set(isDown);
  }

  private _localBoxes = signal<Box[]>([]);
  readonly localBoxes = this._localBoxes.asReadonly();
  updateLocalBoxes(boxes: Box[]): void {
    this._localBoxes.set(boxes);
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
  setNextTempId(n: number): void {
    this._nextTempId.set(n);
  }

  // ========================================
  // FEATURE: MAGIC DETECTION
  // ========================================

  private _isMagicMode = signal(false);
  readonly isMagicMode = this._isMagicMode.asReadonly();
  toggleMagicMode(): void {
    this._isMagicMode.update((v) => !v);
    const newCursor = this.isMagicMode() ? 'crosshair' : 'default';
    this.setCursor(newCursor);
  }

  private _magicAutoTune = signal(true);
  readonly magicAutoTune = this._magicAutoTune.asReadonly();
  updateMagicAutoTune(autoTune: boolean): void {
    this._magicAutoTune.set(autoTune);
  }

  private _magicTolerance = signal(30);
  readonly magicTolerance = this._magicTolerance.asReadonly();
  updateMagicTolerance(tolerance: number): void {
    this._magicTolerance.set(tolerance);
  }

  private _magicAdjustment = signal(0);
  readonly magicAdjustment = this._magicAdjustment.asReadonly();
  updateMagicAdjustment(adjustment: number): void {
    this._magicAdjustment.set(adjustment);
  }

  private _debugMagicDetection = signal(false);
  readonly debugMagicDetection = this._debugMagicDetection.asReadonly();
  updateDebugMagicDetection(debug: boolean): void {
    this._debugMagicDetection.set(debug);
  }

  /** Which magic-wand implementation a click dispatches to - see `handlers/magic-engine.ts`. */
  private _magicEngine = signal<MagicEngineKind>('classical');
  readonly magicEngine = this._magicEngine.asReadonly();
  updateMagicEngine(engine: MagicEngineKind): void {
    this._magicEngine.set(engine);
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

  private _hoveredBoxId = signal<number | null>(null);
  readonly hoveredBoxId = this._hoveredBoxId.asReadonly();
  updateHoverState(boxId: number | null): boolean {
    if (this.hoveredBoxId() !== boxId) {
      this._hoveredBoxId.set(boxId);
      return true;
    }
    return false;
  }

  private _selectedBoxId = signal<number | null>(null);
  readonly selectedBoxId = this._selectedBoxId.asReadonly();
  updateSelectedBox(boxId: number | null): void {
    this._selectedBoxId.set(boxId);
  }

  // ========================================
  // FEATURE: BOX INTERACTION (Rotate/Resize/Drag)
  // ========================================

  private _isDraggingBox = signal(false);
  readonly isDraggingBox = this._isDraggingBox.asReadonly();
  startDragging(absX: number, absY: number, boxX: number, boxY: number): void {
    this._isDraggingBox.set(true);
    this._dragStartAbsolute.set({ x: absX, y: absY });
    this._boxStartPos.set({ x: boxX, y: boxY });
  }
  stopDragging(): void {
    this._isDraggingBox.set(false);
  }

  private _dragStartAbsolute = signal({ x: 0, y: 0 });
  readonly dragStartAbsolute = this._dragStartAbsolute.asReadonly();

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

  override updateReadOnlyMode(value: boolean): void {
    super.updateReadOnlyMode(value);
    if (value) {
      this.resetInteractionStates();
      this._isCreateMode.set(false);
      this._isMagicMode.set(false);
      this._selectedBoxId.set(null);
    }
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
  // UI STATE (labeling-specific)
  // ========================================

  private _showNametags = signal(true);
  readonly showNametags = this._showNametags.asReadonly();
  updateShowNametags(show: boolean): void {
    this._showNametags.set(show);
  }

  private _showPendingState = signal(true);
  readonly showPendingState = this._showPendingState.asReadonly();
  updateShowPendingState(value: boolean): void {
    this._showPendingState.set(value);
  }

  private _debugShowQuadtree = signal(false);
  readonly debugShowQuadtree = this._debugShowQuadtree.asReadonly();
  updateDebugShowQuadtree(show: boolean): void {
    this._debugShowQuadtree.set(show);
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
    super();
    this._contextMenuState.set(contextMenuState);
  }
}
