import { Box, getBoxId } from '../../../intefaces/boxes.interface';
import { Quadtree } from '../core/quadtree';
import { Camera, TextMetrics } from '../core/types';
import { CoordinateTransform } from '../utils/coordinate-transform';
import { BoxUtils } from '../utils/box-utils';
import { StateManager } from './state-manager';
import { HistoryService } from '../../../services/history.service';
import { HoverHandler } from '../handlers/hover.handler';
import { BoxManipulationHandler } from '../handlers/box-manipulation.handler';
import { BoxCreationHandler } from '../handlers/box-creation.handler';
import { CameraHandler } from '../handlers/camera.handler';
import { ContextMenuHandler } from '../handlers/context-menu.handler';
import { MagicDetectionHandler } from '../handlers/magic-detection.handler';
import { isNullOrUndefined } from './validation-utils';

/**
 * Routes pointer events to appropriate handlers based on state
 * Layer 2: Event Router
 */
export class PointerEventHandler {
  /**
   * Handle pointer down event
   * Routes to handlers based on priority: magic detection > context menu > creation > interaction > selection > camera
   */
  static handlePointerDown(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    canvasWidth: number,
    canvasHeight: number,
    imageWidth: number,
    imageHeight: number,
    camera: Camera,
    boxes: Box[],
    state: StateManager,
    quadtree: Quadtree<Box> | undefined,
    nametagMetricsCache: Map<string, TextMetrics>,
    ctx: CanvasRenderingContext2D | undefined,
    historyService: HistoryService,
  ): void {
    const rect = canvas.getBoundingClientRect();
    const mx = (event.clientX - rect.left) * state.devicePixelRatio();
    const my = (event.clientY - rect.top) * state.devicePixelRatio();
    const worldPos = CoordinateTransform.screenToWorld(mx, my, canvasWidth, canvasHeight, camera);
    // Check if CTRL/CMD is pressed - if so, skip all box interactions and go straight to camera pan;
    const shouldSkipInteractions = event.ctrlKey || event.metaKey || state.readOnlyMode();

    if(shouldSkipInteractions) {
      this.handleCameraPanStart(event, state);
      return;
    }



    // PRIORITY 0: Magic Detection Mode (blocked in read-only and when CTRL pressed)
    if (
      this.handleMagicDetection(
        event,
        canvas,
        worldPos,
        imageWidth,
        imageHeight,
        camera,
        state,
        historyService,
      )
    ) {
      return;
    }

    // PRIORITY 1: Context Menu (blocked in read-only and when CTRL pressed)
    if (this.handleContextMenu(event, worldPos, state))
      return;

    // PRIORITY 2: Box Creation (blocked in read-only and when CTRL pressed)
    if (
      this.handleCreateMode(event, worldPos, canvas, state)
    )
      return;

    // PRIORITY 3-5: Box Interaction (Rotation, Resize, Drag) for selected box (blocked in read-only and when CTRL pressed)
    if (
      this.handleSelectedBoxInteraction(
        event,
        worldPos,
        canvas,
        imageWidth,
        imageHeight,
        camera,
        boxes,
        state,
      )
    )
      return;

    // PRIORITY 6: Selection (clicking on unselected box) (blocked in read-only and when CTRL pressed)
    if (
      this.handleBoxSelection(
        worldPos,
        boxes,
        quadtree,
        imageWidth,
        imageHeight,
        camera,
        state,
        nametagMetricsCache,
        ctx,
      )
    )
      return;

    // PRIORITY 7: Camera Pan
    this.handleCameraPanStart(event, state);
    return;
  }

  private static handleMagicDetection(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    worldPos: { x: number; y: number },
    imageWidth: number,
    imageHeight: number,
    camera: Camera,
    state: StateManager,
    historyService: HistoryService,
  ): boolean {
    if (!state.isMagicMode()) return false;

    const bgCanvas = state.bgCanvas();
    if (!bgCanvas) return false;

    const newBox = MagicDetectionHandler.detectAndCreateBox(
      event,
      canvas,
      bgCanvas,
      camera,
      state.devicePixelRatio(),
      state.magicTolerance(),
      state.nextTempId(),
      historyService,
      state.debugMagicDetection(),
    );

    if (newBox) {
      state.getNextTempId();
    }

    // Stay in magic mode to allow multiple detections
    // User can click the button again or press Escape to exit

    return true; // Consumed the event
  }

  private static handleContextMenu(
    event: PointerEvent,
    worldPos: { x: number; y: number },
    state: StateManager,
  ): boolean {
    // Don't handle if clicking on context menu
    if (
      state.contextMenuState()?.visible &&
      ContextMenuHandler.isWithinMenu(event.target as HTMLElement)
    ) {
      return true;
    }

    // Close context menu if clicking outside
    if (state.contextMenuState()?.visible) {
      state.updateContextMenu(ContextMenuHandler.close());
      return true;
    }

    // Handle right-click to open context menu
    if (event.button === 2) {
      event.preventDefault();
      state.updateContextMenu(
        ContextMenuHandler.open(event.clientX, event.clientY, worldPos.x, worldPos.y),
      );
      return true;
    }

    return false;
  }

  private static handleCreateMode(
    event: PointerEvent,
    worldPos: { x: number; y: number },
    canvas: HTMLCanvasElement,
    state: StateManager,
  ): boolean {
    if (!state.isCreateMode()) return false;

    if (event.button === 0) {
      state.updateCreateState(BoxCreationHandler.startCreate(worldPos.x, worldPos.y));
      canvas.setPointerCapture(event.pointerId);
      return true;
    }

    return true; // Block other interactions in create mode
  }

  private static handleSelectedBoxInteraction(
    event: PointerEvent,
    worldPos: { x: number; y: number },
    canvas: HTMLCanvasElement,
    imageWidth: number,
    imageHeight: number,
    camera: Camera,
    boxes: Box[],
    state: StateManager,
  ): boolean {
    const selectedBoxId = state.selectedBoxId();

    if (isNullOrUndefined(selectedBoxId)) return false;

    const box = boxes.find((b) => String(getBoxId(b)) === selectedBoxId);
    if (!box) return false;

    const worldBox = BoxUtils.normalizeBoxToWorld(box, imageWidth, imageHeight);
    if (!worldBox) return false;

    // Try rotation
    if (this.handleRotationStart(event, worldPos, worldBox, canvas, box, camera, state))
      return true;

    // Try resize
    if (this.handleResizeStart(event, worldPos, worldBox, canvas, box, camera, state)) return true;

    // Try drag
    if (this.handleDragStart(event, worldPos, worldBox, canvas, box, state)) return true;

    return false;
  }

  private static handleRotationStart(
    event: PointerEvent,
    worldPos: { x: number; y: number },
    worldBox: { x: number; y: number; w: number; h: number; rotation: number },
    canvas: HTMLCanvasElement,
    box: Box,
    camera: Camera,
    state: StateManager,
  ): boolean {
    if (!HoverHandler.detectRotationKnob(worldPos.x, worldPos.y, worldBox, camera)) return false;

    const rotationInfo = BoxManipulationHandler.startRotation(worldPos.x, worldPos.y, worldBox);
    state.startRotating(rotationInfo.angle, rotationInfo.boxRotation);
    state.startInteraction(state.selectedBoxId()!, box.x, box.y, box.w, box.h, box.rotation || 0);
    state.setCursor('grabbing');
    canvas.setPointerCapture(event.pointerId);
    return true;
  }

  private static handleResizeStart(
    event: PointerEvent,
    worldPos: { x: number; y: number },
    worldBox: { x: number; y: number; w: number; h: number; rotation: number },
    canvas: HTMLCanvasElement,
    box: Box,
    camera: Camera,
    state: StateManager,
  ): boolean {
    const corner = HoverHandler.detectCornerHandle(worldPos.x, worldPos.y, worldBox, camera);
    if (!corner) return false;

    state.startResizing(corner);
    state.startInteraction(state.selectedBoxId()!, box.x, box.y, box.w, box.h, box.rotation || 0);
    state.updateLastPointer(worldPos.x, worldPos.y);
    state.setCursor('nwse-resize'); // Will be updated by cursor manager
    canvas.setPointerCapture(event.pointerId);
    return true;
  }

  private static handleDragStart(
    event: PointerEvent,
    worldPos: { x: number; y: number },
    worldBox: { x: number; y: number; w: number; h: number; rotation: number },
    canvas: HTMLCanvasElement,
    box: Box,
    state: StateManager,
  ): boolean {
    if (!CoordinateTransform.pointInBox(worldPos.x, worldPos.y, worldBox)) return false;

    state.startInteraction(state.selectedBoxId()!, box.x, box.y, box.w, box.h, box.rotation || 0);
    const dragInfo = BoxManipulationHandler.startDrag(worldPos.x, worldPos.y, worldBox);
    state.startDragging(
      dragInfo.dragStart.x,
      dragInfo.dragStart.y,
      dragInfo.boxStart.x,
      dragInfo.boxStart.y,
    );
    state.setCursor('move');
    canvas.setPointerCapture(event.pointerId);
    return true;
  }

  private static handleBoxSelection(
    worldPos: { x: number; y: number },
    boxes: Box[],
    quadtree: Quadtree<Box> | undefined,
    imageWidth: number,
    imageHeight: number,
    camera: Camera,
    state: StateManager,
    nametagMetricsCache: Map<string, TextMetrics>,
    ctx: CanvasRenderingContext2D | undefined,
  ): boolean {
    const hoveredBoxId = HoverHandler.detectHoveredBox(
      worldPos.x,
      worldPos.y,
      boxes,
      quadtree,
      imageWidth,
      imageHeight,
      camera,
      state.showNametags(),
      nametagMetricsCache,
      ctx,
    );

    if (hoveredBoxId) {
      state.updateSelectedBox(hoveredBoxId);

      // Prepare for potential drag - find the box and initialize drag state
      const box = boxes.find((b) => String(getBoxId(b)) === hoveredBoxId);
      if (box) {
        const worldBox = BoxUtils.normalizeBoxToWorld(box, imageWidth, imageHeight);
        if (worldBox && CoordinateTransform.pointInBox(worldPos.x, worldPos.y, worldBox)) {
          // Start interaction state so the box can be immediately dragged
          state.startInteraction(hoveredBoxId, box.x, box.y, box.w, box.h, box.rotation || 0);
          state.startDragging(worldPos.x, worldPos.y, worldBox.x, worldBox.y);
        }
      }

      return true;
    }

    return false;
  }

  private static handleCameraPanStart(event: PointerEvent, state: StateManager): void {
    state.updateSelectedBox(null);
    state.updateLastPointer(event.clientX, event.clientY);
    state.updatePointerDown(true);
  }

  /**
   * Handle pointer move event
   * Routes to handlers based on current state
   */
  static handlePointerMove(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    canvasWidth: number,
    canvasHeight: number,
    imageWidth: number,
    imageHeight: number,
    camera: Camera,
    boxes: Box[],
    state: StateManager,
    quadtree: Quadtree<Box> | undefined,
    nametagMetricsCache: Map<string, TextMetrics>,
    ctx: CanvasRenderingContext2D | undefined,
    onBoxesUpdate: (boxes: Box[]) => void,
    onCameraUpdate: (camera: Camera) => void,
  ): void {
    const rect = canvas.getBoundingClientRect();
    const mx = (event.clientX - rect.left) * state.devicePixelRatio();
    const my = (event.clientY - rect.top) * state.devicePixelRatio();
    const worldPos = CoordinateTransform.screenToWorld(mx, my, canvasWidth, canvasHeight, camera);

    state.updateMouseScreenPosition(event.clientX, event.clientY);

    // Handle active interactions
    if (this.handleCreatePreview(worldPos, state)) return;
    if (this.handleRotation(worldPos, boxes, imageWidth, imageHeight, state, onBoxesUpdate)) return;
    if (this.handleResize(worldPos, boxes, imageWidth, imageHeight, state, onBoxesUpdate)) return;
    if (this.handleDrag(worldPos, boxes, imageWidth, imageHeight, state, onBoxesUpdate)) return;
    if (
      this.handleCameraPan(
        event,
        camera,
        canvasWidth,
        canvasHeight,
        imageWidth,
        imageHeight,
        state,
        onCameraUpdate,
      )
    )
      return;

    // Handle hover detection
    this.handleHoverDetection(
      worldPos,
      boxes,
      quadtree,
      imageWidth,
      imageHeight,
      camera,
      canvas,
      state,
      nametagMetricsCache,
      ctx,
    );
  }

  private static handleCreatePreview(
    worldPos: { x: number; y: number },
    state: StateManager,
  ): boolean {
    if (!state.createState().isCreating) return false;

    state.updateCreateState(
      BoxCreationHandler.updatePreview(worldPos.x, worldPos.y, state.createState()),
    );
    return true;
  }

  private static handleRotation(
    worldPos: { x: number; y: number },
    boxes: Box[],
    imageWidth: number,
    imageHeight: number,
    state: StateManager,
    onBoxesUpdate: (boxes: Box[]) => void,
  ): boolean {
    if (!state.isRotating()) return false;

    const box = boxes.find((b) => String(getBoxId(b)) === state.selectedBoxId());
    if (!box) return true;

    const rotatedBox = BoxManipulationHandler.rotate(
      worldPos.x,
      worldPos.y,
      box,
      imageWidth,
      imageHeight,
      state.rotationStartAngle(),
      state.boxStartRotation(),
    );
    const updatedBoxes = BoxManipulationHandler.updateBoxInArray(boxes, rotatedBox);
    onBoxesUpdate(updatedBoxes);
    return true;
  }

  private static handleResize(
    worldPos: { x: number; y: number },
    boxes: Box[],
    imageWidth: number,
    imageHeight: number,
    state: StateManager,
    onBoxesUpdate: (boxes: Box[]) => void,
  ): boolean {
    if (!state.isResizing() || !state.resizeCorner()) return false;

    const box = boxes.find((b) => String(getBoxId(b)) === state.selectedBoxId());
    if (!box) return true;

    const resizedBox = BoxManipulationHandler.resize(
      worldPos.x,
      worldPos.y,
      box,
      imageWidth,
      imageHeight,
      state.resizeCorner()!,
    );
    const updatedBoxes = BoxManipulationHandler.updateBoxInArray(boxes, resizedBox);
    onBoxesUpdate(updatedBoxes);
    return true;
  }

  private static handleDrag(
    worldPos: { x: number; y: number },
    boxes: Box[],
    imageWidth: number,
    imageHeight: number,
    state: StateManager,
    onBoxesUpdate: (boxes: Box[]) => void,
  ): boolean {
    if (!state.isDraggingBox()) return false;

    const box = boxes.find((b) => String(getBoxId(b)) === state.selectedBoxId());
    if (!box) return true;

    const draggedBox = BoxManipulationHandler.drag(
      worldPos.x,
      worldPos.y,
      box,
      imageWidth,
      imageHeight,
      state.dragStartWorld(),
      state.boxStartPos(),
    );
    const updatedBoxes = BoxManipulationHandler.updateBoxInArray(boxes, draggedBox);
    onBoxesUpdate(updatedBoxes);
    return true;
  }

  private static handleCameraPan(
    event: PointerEvent,
    camera: Camera,
    canvasWidth: number,
    canvasHeight: number,
    imageWidth: number,
    imageHeight: number,
    state: StateManager,
    onCameraUpdate: (camera: Camera) => void,
  ): boolean {
    if (!state.isPointerDown()) return false;

    const dx = event.clientX - state.lastPointer().x;
    const dy = event.clientY - state.lastPointer().y;
    const newCamera = CameraHandler.pan(
      dx,
      dy,
      camera,
      canvasWidth,
      canvasHeight,
      imageWidth,
      imageHeight,
      state.minZoom(),
    );
    onCameraUpdate(newCamera);
    state.updateLastPointer(event.clientX, event.clientY);
    return true;
  }

  private static handleHoverDetection(
    worldPos: { x: number; y: number },
    boxes: Box[],
    quadtree: Quadtree<Box> | undefined,
    imageWidth: number,
    imageHeight: number,
    camera: Camera,
    canvas: HTMLCanvasElement,
    state: StateManager,
    nametagMetricsCache: Map<string, TextMetrics>,
    ctx: CanvasRenderingContext2D | undefined,
  ): void {
    const hoveredBoxId = HoverHandler.detectHoveredBox(
      worldPos.x,
      worldPos.y,
      boxes,
      quadtree,
      imageWidth,
      imageHeight,
      camera,
      state.showNametags(),
      nametagMetricsCache,
      ctx,
    );

    const hoverChanged = state.updateHoverState(hoveredBoxId);
    if (hoverChanged) {
      HoverHandler.updateCursorForHover(
        worldPos.x,
        worldPos.y,
        hoveredBoxId,
        state.selectedBoxId(),
        boxes,
        imageWidth,
        imageHeight,
        camera,
        state.isCreateMode(),
        state.currentCursor,
      );
    }
  }

  /**
   * Handle pointer up event
   * Completes interactions and saves to history
   */
  static handlePointerUp(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    canvasWidth: number,
    canvasHeight: number,
    imageWidth: number,
    imageHeight: number,
    camera: Camera,
    boxes: Box[],
    state: StateManager,
    historyService: HistoryService,
    onBoxesUpdate: (boxes: Box[]) => void,
    onRebuildIndex: () => void,
  ): void {
    const rect = canvas.getBoundingClientRect();
    const mx = (event.clientX - rect.left) * state.devicePixelRatio();
    const my = (event.clientY - rect.top) * state.devicePixelRatio();
    const worldPos = CoordinateTransform.screenToWorld(mx, my, canvasWidth, canvasHeight, camera);

    // Complete interactions
    if (
      this.completeBoxCreation(
        worldPos,
        imageWidth,
        imageHeight,
        boxes,
        state,
        historyService,
        onBoxesUpdate,
        onRebuildIndex,
      )
    )
      return;
    if (this.completeBoxManipulation(boxes, state, historyService, onRebuildIndex)) return;

    // Complete camera pan
    this.completeCameraPan(state);
  }

  private static completeBoxCreation(
    worldPos: { x: number; y: number },
    imageWidth: number,
    imageHeight: number,
    boxes: Box[],
    state: StateManager,
    historyService: HistoryService,
    onBoxesUpdate: (boxes: Box[]) => void,
    onRebuildIndex: () => void,
  ): boolean {
    if (!state.createState().isCreating || !state.createState().startPoint) return false;

    const start = state.createState().startPoint!;
    const newBox = BoxCreationHandler.completeCreate(
      start.x,
      start.y,
      worldPos.x,
      worldPos.y,
      imageWidth,
      imageHeight,
      state.getNextTempId(),
      historyService,
    );

    if (newBox) {
      onBoxesUpdate([...boxes, newBox]);
      state.updateSelectedBox(newBox.tempId!);
      onRebuildIndex();
    }

    state.updateCreateState(BoxCreationHandler.resetCreateState());
    return true;
  }

  private static completeBoxManipulation(
    boxes: Box[],
    state: StateManager,
    historyService: HistoryService,
    onRebuildIndex: () => void,
  ): boolean {
    if (!state.isAnyInteractionActive()) return false;

    const interactionStart = state.interactionStartState();
    const box = boxes.find((b) => String(getBoxId(b)) === state.selectedBoxId());

    if (interactionStart && box) {
      BoxManipulationHandler.completeManipulation(
        state.selectedBoxId()!,
        interactionStart,
        box,
        state.isRotating(),
        state.isResizing(),
        state.isDraggingBox(),
        historyService,
      );
      onRebuildIndex();
    }

    state.resetInteractionStates();
    return true;
  }

  private static completeCameraPan(state: StateManager): void {
    state.updatePointerDown(false);
  }

  /**
   * Handle wheel event for zooming
   */
  static handleWheel(
    event: WheelEvent,
    canvas: HTMLCanvasElement,
    canvasWidth: number,
    canvasHeight: number,
    imageWidth: number,
    imageHeight: number,
    camera: Camera,
    state: StateManager,
    onCameraUpdate: (camera: Camera) => void,
  ): void {
    event.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const mx = (event.clientX - rect.left) * state.devicePixelRatio();
    const my = (event.clientY - rect.top) * state.devicePixelRatio();
    const worldPos = CoordinateTransform.screenToWorld(mx, my, canvasWidth, canvasHeight, camera);

    const newCamera = CameraHandler.zoom(
      event.deltaY,
      worldPos.x,
      worldPos.y,
      camera,
      canvasWidth,
      canvasHeight,
      imageWidth,
      imageHeight,
      state.minZoom(),
    );

    onCameraUpdate(newCamera);
  }
}
