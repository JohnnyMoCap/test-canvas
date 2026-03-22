import { Box } from '../../../inteface/boxes.interface';
import { Quadtree } from '../core/quadtree';
import { PointerHandlerContext, TextMetrics, WorldBoxGeometry } from '../core/types';
import { CoordinateTransform } from '../utils/coordinate-transform';
import { BoxUtils } from '../utils/box-utils';
import { NametagUtils } from '../utils/nametag-utils';
import { StateManager } from '../utils/state-manager';
import { HistoryService } from '../../../services/history.service';
import { HoverHandler } from './hover.handler';
import { BoxManipulationHandler } from './box-manipulation.handler';
import { BoxStateUtils } from '../utils/box-state-utils';
import { BoxCreationHandler } from './box-creation.handler';
import { CameraHandler } from './camera.handler';
import { ContextMenuHandler } from './context-menu.handler';
import { MagicDetectionHandler } from './magic-detection.handler';
import { MeasurementHandler } from './measurement.handler';
import { isNullOrUndefined } from '../utils/validation-utils';
import { CursorStyles } from '../cursor/cursor-styles';

/**
 * Routes pointer events to appropriate handlers based on state
 * Layer 2: Event Router
 */
export class PointerEventHandler {
  /**
   * Handle pointer down event
   * Routes to handlers based on priority: measurement > magic detection > context menu > creation > interaction > selection > camera
   */
  static handlePointerDown(event: PointerEvent, hctx: PointerHandlerContext): void {
    const { canvas, state, quadtree, nametagMetricsCache, historyService } = hctx;
    const bgc = state.bgCanvas();
    if (!bgc) return;

    const rect = canvas.getBoundingClientRect();
    const mx = (event.clientX - rect.left) * state.devicePixelRatio();
    const my = (event.clientY - rect.top) * state.devicePixelRatio();
    const worldPos = CoordinateTransform.screenToWorld(
      mx,
      my,
      canvas.width,
      canvas.height,
      state.camera(),
    );

    // Check if CTRL/CMD is pressed - if so, skip all box interactions and go straight to camera pan;
    const shouldSkipInteractions = event.ctrlKey || event.metaKey || state.readOnlyMode();

    if (shouldSkipInteractions && !state.measurementState().isActive) {
      this.handleCameraPanStart(event, state);
      return;
    }

    if (state.measurementState().isActive && event.button == 0) {
      this.handleMeasurementMode(worldPos, state);
      return;
    }

    if (state.isMagicMode() && bgc) {
      this.handleMagicDetection(event, canvas, state, historyService);
      return;
    }

    //works but still build in a very stupid way, fix this
    if (state.contextMenuState()?.visible || event.button === 2) {
      this.handleContextMenu(event, worldPos, state);
      return;
    }

    // Box Creation (blocked in read-only and when CTRL pressed)
    if (state.isCreateMode() && event.button === 0) {
      this.handleCreateMode(event, worldPos, canvas, state);
      return;
    }

    //Box Interaction (Rotation, Resize, Drag) for selected box (blocked in read-only and when CTRL pressed)
    if (this.handleSelectedBoxInteraction(event, worldPos, canvas, state)) return;

    // Selection (clicking on unselected box) (blocked in read-only and when CTRL pressed)
    if (this.handleBoxSelection(worldPos, state, quadtree, nametagMetricsCache)) return;

    // PRIORITY 8: Camera Pan
    this.handleCameraPanStart(event, state);
    return;
  }

  private static handleMeasurementMode(worldPos: { x: number; y: number }, state: StateManager) {
    MeasurementHandler.handlePointerDown(worldPos, state.camera(), state);
  }

  private static handleMagicDetection(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    state: StateManager,
    historyService: HistoryService,
  ) {
    const bgCanvas = state.bgCanvas();
    if (!bgCanvas) return;

    const newBox = MagicDetectionHandler.detectAndCreateBox(
      event,
      canvas,
      bgCanvas,
      state.camera(),
      state.devicePixelRatio(),
      state.magicTolerance(),
      state.nextTempId(),
      historyService,
      state.debugMagicDetection(),
    );

    if (newBox) {
      state.getNextTempId();
    }

    return;
  }

  private static handleContextMenu(
    event: PointerEvent,
    worldPos: { x: number; y: number },
    state: StateManager,
  ) {
    // Don't handle if clicking on context menu
    if (
      state.contextMenuState()?.visible &&
      ContextMenuHandler.isWithinMenu(event.target as HTMLElement)
    ) {
      return;
    }

    // Close context menu if clicking outside
    if (state.contextMenuState()?.visible) {
      state.updateContextMenu(ContextMenuHandler.close());
      return;
    }

    // Handle right-click to open context menu
    if (event.button === 2) {
      event.preventDefault();
      state.updateContextMenu(
        ContextMenuHandler.open(event.clientX, event.clientY, worldPos.x, worldPos.y),
      );
      return;
    }

    return;
  }

  private static handleCreateMode(
    event: PointerEvent,
    worldPos: { x: number; y: number },
    canvas: HTMLCanvasElement,
    state: StateManager,
  ) {
    state.updateCreateState(BoxCreationHandler.startCreate(worldPos.x, worldPos.y));
    canvas.setPointerCapture(event.pointerId);
  }

  private static handleSelectedBoxInteraction(
    event: PointerEvent,
    worldPos: { x: number; y: number },
    canvas: HTMLCanvasElement,
    state: StateManager,
  ): boolean {
    const selectedBoxId = state.selectedBoxId();

    if (isNullOrUndefined(selectedBoxId)) return false;

    const boxes = state.localBoxes();
    const bgc = state.bgCanvas();
    if (!bgc) return false;

    const box = BoxStateUtils.findBoxById(boxes, selectedBoxId);
    if (!box) return false;

    const worldBox = BoxUtils.normalizeBoxToWorld(box, bgc.width, bgc.height);
    if (!worldBox) return false;

    // Try rotation
    if (this.handleRotationStart(event, worldPos, worldBox, canvas, box, state)) return true;

    // Try resize
    if (this.handleResizeStart(event, worldPos, worldBox, canvas, box, state)) return true;

    // Try drag
    if (this.handleDragStart(event, worldPos, worldBox, canvas, box, state)) return true;

    return false;
  }

  private static handleRotationStart(
    event: PointerEvent,
    worldPos: { x: number; y: number },
    boxGeometry: WorldBoxGeometry,
    canvas: HTMLCanvasElement,
    box: Box,
    state: StateManager,
  ): boolean {
    if (!HoverHandler.detectRotationKnob(worldPos.x, worldPos.y, boxGeometry, state.camera()))
      return false;

    const rotationInfo = BoxManipulationHandler.startRotation(worldPos.x, worldPos.y, boxGeometry);
    state.startRotating(rotationInfo.angle, rotationInfo.boxRotation);
    state.startInteraction(state.selectedBoxId()!, box.x, box.y, box.w, box.h, box.rotation || 0);
    state.setCursor(CursorStyles.getRotateCursor());
    canvas.setPointerCapture(event.pointerId);
    return true;
  }

  private static handleResizeStart(
    event: PointerEvent,
    worldPos: { x: number; y: number },
    boxGeometry: WorldBoxGeometry,
    canvas: HTMLCanvasElement,
    box: Box,
    state: StateManager,
  ): boolean {
    const corner = HoverHandler.detectCornerHandle(
      worldPos.x,
      worldPos.y,
      boxGeometry,
      state.camera(),
    );

    if (!corner) return false;

    state.startResizing(corner);
    state.startInteraction(state.selectedBoxId()!, box.x, box.y, box.w, box.h, box.rotation || 0);
    state.updateLastPointer(worldPos.x, worldPos.y);
    const resizeCursor = CursorStyles.getResizeCursor(corner, boxGeometry);
    state.setCursor(resizeCursor);
    canvas.setPointerCapture(event.pointerId);
    return true;
  }

  private static handleDragStart(
    event: PointerEvent,
    worldPos: { x: number; y: number },
    boxGeometry: WorldBoxGeometry,
    canvas: HTMLCanvasElement,
    box: Box,
    state: StateManager,
  ): boolean {
    if (!CoordinateTransform.pointInBox(worldPos.x, worldPos.y, boxGeometry)) return false;

    state.startInteraction(state.selectedBoxId()!, box.x, box.y, box.w, box.h, box.rotation || 0);
    const dragInfo = BoxManipulationHandler.startDrag(worldPos.x, worldPos.y, boxGeometry);
    state.startDragging(
      dragInfo.dragStart.x,
      dragInfo.dragStart.y,
      dragInfo.boxStart.x,
      dragInfo.boxStart.y,
    );
    state.setCursor(CursorStyles.getDragCursor());
    canvas.setPointerCapture(event.pointerId);
    return true;
  }

  private static handleBoxSelection(
    worldPos: { x: number; y: number },
    state: StateManager,
    quadtree: Quadtree<Box> | undefined,
    nametagMetricsCache: Map<string, TextMetrics>,
  ): boolean {
    const boxes = state.localBoxes();
    const bgc = state.bgCanvas();
    if (!bgc) return false;
    const camera = state.camera();
    const ctx = state.ctx();

    const hoveredBoxId = HoverHandler.detectHoveredBox(
      worldPos.x,
      worldPos.y,
      boxes,
      quadtree,
      bgc.width,
      bgc.height,
      camera,
      state.showNametags(),
      nametagMetricsCache,
      ctx,
      state.selectedBoxId(),
    );

    if (hoveredBoxId) {
      state.updateSelectedBox(hoveredBoxId);

      // Prepare for potential drag - find the box and initialize drag state
      const box = BoxStateUtils.findBoxById(boxes, hoveredBoxId);
      if (box) {
        const worldBox = BoxUtils.normalizeBoxToWorld(box, bgc.width, bgc.height);
        if (worldBox) {
          // Check if clicking on box OR nametag - both should enable dragging
          const clickedOnBox = CoordinateTransform.pointInBox(worldPos.x, worldPos.y, worldBox);
          const clickedOnNametag =
            state.showNametags() &&
            NametagUtils.pointInNametag(
              worldPos.x,
              worldPos.y,
              worldBox,
              camera,
              nametagMetricsCache,
              ctx,
            );

          if (clickedOnBox || clickedOnNametag) {
            // Start interaction state so the box can be immediately dragged
            state.startInteraction(hoveredBoxId, box.x, box.y, box.w, box.h, box.rotation || 0);
            state.startDragging(worldPos.x, worldPos.y, worldBox.x, worldBox.y);
          }
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
    state.setCursor(CursorStyles.getDragCursor());
  }

  /**
   * Handle pointer move event
   * Routes to handlers based on current state
   */
  static handlePointerMove(event: PointerEvent, hctx: PointerHandlerContext): void {
    const { canvas, state, quadtree, nametagMetricsCache } = hctx;
    const bgc = state.bgCanvas();
    if (!bgc) return;

    const rect = canvas.getBoundingClientRect();
    const mx = (event.clientX - rect.left) * state.devicePixelRatio();
    const my = (event.clientY - rect.top) * state.devicePixelRatio();
    const worldPos = CoordinateTransform.screenToWorld(
      mx,
      my,
      canvas.width,
      canvas.height,
      state.camera(),
    );

    state.updateMouseScreenPosition(event.clientX, event.clientY);

    // Handle measurement mode
    if (this.handleMeasurementMove(worldPos, state)) return;

    // Handle active interactions
    if (this.handleCreatePreview(worldPos, state)) return;
    if (this.handleRotation(worldPos, state)) return;
    if (this.handleResize(worldPos, state)) return;
    if (this.handleDrag(worldPos, state)) return;
    if (this.handleCameraPan(event, canvas, state)) return;

    // Handle hover detection (skip in measurement mode)
    if (!state.measurementState().isActive) {
      this.handleHoverDetection(worldPos, state, quadtree, nametagMetricsCache);
    } else {
      // Update cursor for measurement mode
      const cursor = MeasurementHandler.getCursorStyle(worldPos, state.camera(), state);
      state.setCursor(cursor);
    }
  }

  private static handleMeasurementMove(
    worldPos: { x: number; y: number },
    state: StateManager,
  ): boolean {
    if (!state.measurementState().isActive) return false;

    return MeasurementHandler.handlePointerMove(worldPos, state);
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

  private static handleRotation(worldPos: { x: number; y: number }, state: StateManager): boolean {
    if (!state.isRotating()) return false;

    const boxes = state.localBoxes();
    const bgc = state.bgCanvas();
    if (!bgc) return false;

    const box = BoxStateUtils.findBoxById(boxes, state.selectedBoxId()!);
    if (!box) return true;

    const rotatedBox = BoxManipulationHandler.rotate(
      worldPos.x,
      worldPos.y,
      box,
      bgc.width,
      bgc.height,
      state.rotationStartAngle(),
      state.boxStartRotation(),
    );
    const updatedBoxes = BoxManipulationHandler.updateBoxInArray(boxes, rotatedBox);
    state.updateLocalBoxes(updatedBoxes);
    return true;
  }

  private static handleResize(worldPos: { x: number; y: number }, state: StateManager): boolean {
    if (!state.isResizing() || !state.resizeCorner()) return false;

    const boxes = state.localBoxes();
    const bgc = state.bgCanvas();
    if (!bgc) return false;

    const box = BoxStateUtils.findBoxById(boxes, state.selectedBoxId()!);
    if (!box) return true;

    const resizedBox = BoxManipulationHandler.resize(
      worldPos.x,
      worldPos.y,
      box,
      bgc.width,
      bgc.height,
      state.resizeCorner()!,
    );
    const updatedBoxes = BoxManipulationHandler.updateBoxInArray(boxes, resizedBox);
    state.updateLocalBoxes(updatedBoxes);
    return true;
  }

  private static handleDrag(worldPos: { x: number; y: number }, state: StateManager): boolean {
    if (!state.isDraggingBox()) return false;

    const boxes = state.localBoxes();
    const bgc = state.bgCanvas();
    if (!bgc) return false;

    const box = BoxStateUtils.findBoxById(boxes, state.selectedBoxId()!);
    if (!box) return true;

    const draggedBox = BoxManipulationHandler.drag(
      worldPos.x,
      worldPos.y,
      box,
      bgc.width,
      bgc.height,
      state.dragStartWorld(),
      state.boxStartPos(),
    );
    const updatedBoxes = BoxManipulationHandler.updateBoxInArray(boxes, draggedBox);
    state.updateLocalBoxes(updatedBoxes);
    return true;
  }

  private static handleCameraPan(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    state: StateManager,
  ): boolean {
    if (!state.isPointerDown()) return false;

    const bgc = state.bgCanvas();
    if (!bgc) return false;

    const camera = state.camera();
    const dx = event.clientX - state.lastPointer().x;
    const dy = event.clientY - state.lastPointer().y;
    const newCamera = CameraHandler.pan(
      dx,
      dy,
      camera,
      canvas.width,
      canvas.height,
      bgc.width,
      bgc.height,
      state.minZoom(),
    );
    state.updateCamera(newCamera);
    state.updateLastPointer(event.clientX, event.clientY);
    return true;
  }

  private static handleHoverDetection(
    worldPos: { x: number; y: number },
    state: StateManager,
    quadtree: Quadtree<Box> | undefined,
    nametagMetricsCache: Map<string, TextMetrics>,
  ): void {
    const boxes = state.localBoxes();
    const bgc = state.bgCanvas();
    if (!bgc) return;
    const camera = state.camera();
    const ctx = state.ctx();

    const hoveredBoxId = HoverHandler.detectHoveredBox(
      worldPos.x,
      worldPos.y,
      boxes,
      quadtree,
      bgc.width,
      bgc.height,
      camera,
      state.showNametags(),
      nametagMetricsCache,
      ctx,
      state.selectedBoxId(),
    );

    state.updateHoverState(hoveredBoxId);

    if (hoveredBoxId || (Number(hoveredBoxId) ?? -1) === 0) {
      HoverHandler.updateCursorForHover(
        worldPos.x,
        worldPos.y,
        hoveredBoxId,
        state.selectedBoxId(),
        boxes,
        bgc.width,
        bgc.height,
        camera,
        state,
      );
    }
  }

  /**
   * Handle pointer up event
   * Completes interactions and saves to history
   */
  static handlePointerUp(event: PointerEvent, hctx: PointerHandlerContext): void {
    const { canvas, state, historyService } = hctx;
    const bgc = state.bgCanvas();
    if (!bgc) return;

    const rect = canvas.getBoundingClientRect();
    const mx = (event.clientX - rect.left) * state.devicePixelRatio();
    const my = (event.clientY - rect.top) * state.devicePixelRatio();
    const worldPos = CoordinateTransform.screenToWorld(
      mx,
      my,
      canvas.width,
      canvas.height,
      state.camera(),
    );

    // Handle measurement mode
    if (this.completeMeasurement(state)) return;

    // Complete interactions
    if (this.completeBoxCreation(worldPos, state, historyService)) return;
    if (this.completeBoxManipulation(worldPos, state, historyService)) return;

    // Complete camera pan
    this.completeCameraPan(worldPos, state);
  }

  private static completeMeasurement(state: StateManager): boolean {
    if (!state.measurementState().isActive) return false;

    return MeasurementHandler.handlePointerUp(state);
  }

  private static completeBoxCreation(
    worldPos: { x: number; y: number },
    state: StateManager,
    historyService: HistoryService,
  ): boolean {
    if (!state.createState().isCreating || !state.createState().startPoint) return false;

    const bgc = state.bgCanvas();
    if (!bgc) return false;
    const boxes = state.localBoxes();
    const start = state.createState().startPoint!;
    const newBox = BoxCreationHandler.completeCreate(
      start.x,
      start.y,
      worldPos.x,
      worldPos.y,
      bgc.width,
      bgc.height,
      state.getNextTempId(),
      historyService,
    );

    if (newBox && newBox.tempId) {
      state.updateLocalBoxes([...boxes, newBox]);
      state.updateSelectedBox(newBox.tempId);
    }

    state.updateCreateState(BoxCreationHandler.resetCreateState());
    return true;
  }

  private static completeBoxManipulation(
    worldPos: { x: number; y: number },
    state: StateManager,
    historyService: HistoryService,
  ): boolean {
    if (!state.isAnyInteractionActive()) return false;

    const boxes = state.localBoxes();
    const bgc = state.bgCanvas();
    if (!bgc) return false;
    const camera = state.camera();

    const interactionStart = state.interactionStartState();
    const box = BoxStateUtils.findBoxById(boxes, state.selectedBoxId()!);

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
    }

    state.resetInteractionStates();

    HoverHandler.updateCursorForHover(
      worldPos.x,
      worldPos.y,
      state.hoveredBoxId(),
      state.selectedBoxId(),
      boxes,
      bgc.width,
      bgc.height,
      camera,
      state,
    );

    return true;
  }

  private static completeCameraPan(worldPos: { x: number; y: number }, state: StateManager): void {
    const boxes = state.localBoxes();
    const bgc = state.bgCanvas();
    const camera = state.camera();

    state.updatePointerDown(false);

    if (bgc) {
      HoverHandler.updateCursorForHover(
        worldPos.x,
        worldPos.y,
        state.hoveredBoxId(),
        state.selectedBoxId(),
        boxes,
        bgc.width,
        bgc.height,
        camera,
        state,
      );
    }
  }

  /**
   * Handle wheel event for zooming
   */
  static handleWheel(event: WheelEvent, hctx: PointerHandlerContext): void {
    const { canvas, state } = hctx;
    const bgc = state.bgCanvas();
    if (!bgc) return;

    event.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const mx = (event.clientX - rect.left) * state.devicePixelRatio();
    const my = (event.clientY - rect.top) * state.devicePixelRatio();
    const camera = state.camera();
    const worldPos = CoordinateTransform.screenToWorld(mx, my, canvas.width, canvas.height, camera);

    const newCamera = CameraHandler.zoom(
      event.deltaY,
      worldPos.x,
      worldPos.y,
      camera,
      canvas.width,
      canvas.height,
      bgc.width,
      bgc.height,
      state.minZoom(),
    );

    state.updateCamera(newCamera);
  }
}
