import { Box, getBoxId } from '../../../intefaces/boxes.interface';
import { Quadtree } from '../core/quadtree';
import { Camera, ResizeCorner } from '../core/types';
import { CoordinateTransform } from './coordinate-transform';
import { BoxUtils } from './box-utils';
import { NametagUtils } from './nametag-utils';
import { InteractionUtils } from './interaction-utils';
import { HoverDetectionUtils } from './hover-detection-utils';
import { ContextMenuUtils } from './context-menu-utils';
import { BoxCreationUtils } from './box-creation-utils';
import { StateManager } from './state-manager';

/**
 * Handles all pointer event logic including mouse/touch interactions
 */
export class PointerEventHandler {
  /**
   * Handle pointer down event
   */
  static handlePointerDown(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    state: StateManager,
    camera: Camera,
    boxes: Box[],
    quadtree: Quadtree<Box> | undefined,
    nametagMetricsCache: Map<string, any>,
    ctx: CanvasRenderingContext2D | undefined,
    onContextMenuOpen: (x: number, y: number, worldX: number, worldY: number) => void,
    onCreateStart: (worldX: number, worldY: number) => void,
    onBoxInteractionStart: (
      boxId: string,
      isRotating: boolean,
      isResizing: boolean,
      isDragging: boolean,
      resizeCorner?: ResizeCorner,
    ) => void,
    onCameraPanStart: () => void,
    onUpdateCursor: (cursor: string) => void,
  ): void {
    const rect = canvas.getBoundingClientRect();
    const mx = (event.clientX - rect.left) * state.devicePixelRatio();
    const my = (event.clientY - rect.top) * state.devicePixelRatio();
    const worldPos = CoordinateTransform.screenToWorld(mx, my, canvas.width, canvas.height, camera);

    // Don't handle if clicking on context menu
    if (
      state.contextMenuState()?.visible &&
      ContextMenuUtils.isWithinMenu(event.target as HTMLElement)
    ) {
      return;
    }

    // Close context menu if clicking outside
    if (state.contextMenuState()?.visible) {
      state.contextMenuState.set(ContextMenuUtils.close());
      return;
    }

    // Handle right-click for context menu
    if (event.button === 2) {
      event.preventDefault();
      onContextMenuOpen(event.clientX, event.clientY, worldPos.x, worldPos.y);
      return;
    }

    // Handle create mode
    if (state.isCreateMode() && event.button === 0) {
      onCreateStart(worldPos.x, worldPos.y);
      (event.target as Element).setPointerCapture?.(event.pointerId);
      return;
    }

    // Disable normal interactions in create mode
    if (state.isCreateMode()) return;

    // Check rotation knob
    if (state.selectedBoxId()) {
      const box = boxes.find((b) => String(getBoxId(b)) == state.selectedBoxId());
      const bgc = state.bgCanvas();
      if (box && bgc) {
        const wb = BoxUtils.normalizeBoxToWorld(box, bgc.width, bgc.height);
        if (wb && InteractionUtils.detectRotationKnob(worldPos.x, worldPos.y, wb, camera)) {
          state.isRotating.set(true);
          state.rotationStartAngle.set(Math.atan2(worldPos.y - wb.y, worldPos.x - wb.x));
          state.boxStartRotation.set(wb.rotation);
          state.startInteraction(
            state.selectedBoxId()!,
            box.x,
            box.y,
            box.w,
            box.h,
            box.rotation || 0,
          );
          onBoxInteractionStart(state.selectedBoxId()!, true, false, false);
          onUpdateCursor('grabbing');
          (event.target as Element).setPointerCapture?.(event.pointerId);
          return;
        }

        // Check corner handles
        if (wb) {
          const corner = InteractionUtils.detectCornerHandle(worldPos.x, worldPos.y, wb, camera);
          if (corner) {
            state.isResizing.set(true);
            state.resizeCorner.set(corner);
            state.startInteraction(
              state.selectedBoxId()!,
              box.x,
              box.y,
              box.w,
              box.h,
              box.rotation || 0,
            );
            state.dragStartWorld.set(worldPos);
            state.boxStartPos.set({ x: wb.x, y: wb.y });
            onBoxInteractionStart(state.selectedBoxId()!, false, true, false, corner);
            (event.target as Element).setPointerCapture?.(event.pointerId);
            return;
          }
        }
      }
    }

    // Check box/nametag click
    const candidates = quadtree
      ? (quadtree.queryRange(worldPos.x - 1, worldPos.y - 1, 2, 2) as Box[])
      : boxes;

    let clickedBoxId: string | null = null;
    for (let i = candidates.length - 1; i >= 0; i--) {
      const rawBox = candidates[i];
      const bgc = state.bgCanvas();
      if (!bgc) continue;
      const worldBox = BoxUtils.normalizeBoxToWorld(rawBox, bgc.width, bgc.height);
      if (!worldBox) continue;

      if (
        state.showNametags() &&
        NametagUtils.pointInNametag(
          worldPos.x,
          worldPos.y,
          worldBox,
          camera,
          nametagMetricsCache,
          ctx,
        )
      ) {
        clickedBoxId = String(getBoxId(rawBox));
        break;
      }

      if (CoordinateTransform.pointInBox(worldPos.x, worldPos.y, worldBox)) {
        clickedBoxId = String(getBoxId(rawBox));
        break;
      }
    }

    if (clickedBoxId) {
      state.selectedBoxId.set(clickedBoxId);
      state.isDraggingBox.set(true);
      state.dragStartWorld.set(worldPos);
      const box = boxes.find((b) => String(getBoxId(b)) === clickedBoxId);
      const bgc = state.bgCanvas();
      if (box && bgc) {
        const wb = BoxUtils.normalizeBoxToWorld(box, bgc.width, bgc.height);
        if (wb) state.boxStartPos.set({ x: wb.x, y: wb.y });
        state.startInteraction(clickedBoxId, box.x, box.y, box.w, box.h, box.rotation || 0);
      }
      onBoxInteractionStart(clickedBoxId, false, false, true);
    } else {
      if (state.selectedBoxId) {
        state.selectedBoxId.set(null);
      }
      state.isPointerDown.set(true);
      onCameraPanStart();
    }

    state.lastPointer.set({ x: event.clientX, y: event.clientY });
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }

  /**
   * Handle pointer up event
   */
  static handlePointerUp(
    event: PointerEvent,
    state: StateManager,
    boxes: Box[],
    onCreateComplete: (startX: number, startY: number, endX: number, endY: number) => void,
    onInteractionComplete: (
      boxId: string,
      startState: { x: number; y: number; w: number; h: number; rotation: number },
      box: Box,
      isRotating: boolean,
      isResizing: boolean,
      isDragging: boolean,
    ) => void,
    onRebuildIndex: () => void,
  ): void {
    const createState = state.createState();
    // Handle create mode
    if (createState?.isCreating && createState?.startPoint && createState?.currentPoint) {
      onCreateComplete(
        createState?.startPoint.x,
        createState?.startPoint.y,
        createState?.currentPoint.x,
        createState?.currentPoint.y,
      );
      state.resetCreationState();
    }

    // Record history delta for completed interaction
    const startState = state.interactionStartState();
    if (startState) {
      const box = boxes.find((b) => String(getBoxId(b)) === startState?.boxId);
      if (box) {
        onInteractionComplete(
          startState?.boxId,
          startState,
          box,
          state.isRotating(),
          state.isResizing(),
          state.isDraggingBox(),
        );
      }
    }

    state.resetInteractionStates();

    // Rebuild quadtree after interaction ends
    if (state.isDraggingOrInteracting) {
      state.isDraggingOrInteracting.set(false);
      onRebuildIndex();
    }

    (event.target as Element).releasePointerCapture?.(event.pointerId);
  }

  /**
   * Handle pointer move event
   */
  static handlePointerMove(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    state: StateManager,
    camera: Camera,
    boxes: Box[],
    quadtree: Quadtree<Box> | undefined,
    nametagMetricsCache: Map<string, any>,
    ctx: CanvasRenderingContext2D | undefined,
    onCreatePreview: (worldX: number, worldY: number) => void,
    onRotate: (worldX: number, worldY: number) => void,
    onResize: (worldX: number, worldY: number) => void,
    onDrag: (worldX: number, worldY: number) => void,
    onCameraPan: (dx: number, dy: number) => void,
    onHoverDetection: (worldX: number, worldY: number) => void,
    onUpdateCursor: (cursor: string) => void,
  ): void {
    const rect = canvas.getBoundingClientRect();
    const mx = (event.clientX - rect.left) * state.devicePixelRatio();
    const my = (event.clientY - rect.top) * state.devicePixelRatio();
    const worldPos = CoordinateTransform.screenToWorld(mx, my, canvas.width, canvas.height, camera);

    // Track mouse screen position
    state.updateMouseScreenPosition(event.clientX, event.clientY);

    // Handle creation preview
    if (state.createState()?.isCreating && state.createState()?.startPoint) {
      onCreatePreview(worldPos.x, worldPos.y);
      return;
    }

    // Disable normal interactions in create mode
    if (state.isCreateMode()) return;

    if (state.isRotating() && state.selectedBoxId()) {
      state.isDraggingOrInteracting.set(true);
      onRotate(worldPos.x, worldPos.y);
      return;
    }

    if (state.isResizing() && state.selectedBoxId() && state.resizeCorner()) {
      state.isDraggingOrInteracting.set(true);
      onResize(worldPos.x, worldPos.y);
      return;
    }

    if (state.isDraggingBox() && state.selectedBoxId()) {
      const dx = worldPos.x - state.dragStartWorld().x;
      const dy = worldPos.y - state.dragStartWorld().y;
      const newX = state.boxStartPos().x + dx;
      const newY = state.boxStartPos().y + dy;
      state.isDraggingOrInteracting.set(true);
      onDrag(newX, newY);
      return;
    }

    const bgc = state.bgCanvas();
    // Handle cursor updates when hovering over selected box
    if (state.selectedBoxId() && !state.isPointerDown() && bgc) {
      const box = boxes.find((b) => String(getBoxId(b)) == state.selectedBoxId());
      if (box) {
        const wb = BoxUtils.normalizeBoxToWorld(box, bgc.width, bgc.height);
        if (wb) {
          if (InteractionUtils.detectRotationKnob(worldPos.x, worldPos.y, wb, camera)) {
            onUpdateCursor('grab');
          } else {
            const corner = InteractionUtils.detectCornerHandle(worldPos.x, worldPos.y, wb, camera);
            if (corner) {
              onUpdateCursor(InteractionUtils.getResizeCursor(corner, wb));
            } else {
              onUpdateCursor(state.hoveredBoxId() ? 'move' : 'default');
            }
          }
        }
      }
    }

    // Hover detection
    if (!state.isPointerDown() && !state.isDraggingBox()) {
      onHoverDetection(worldPos.x, worldPos.y);
    }

    // Camera panning
    if (state.isPointerDown()) {
      const dx = (event.clientX - state.lastPointer().x) * state.devicePixelRatio();
      const dy = (event.clientY - state.lastPointer().y) * state.devicePixelRatio();
      state.lastPointer.set({ x: event.clientX, y: event.clientY });
      onCameraPan(dx, dy);
    } else {
      state.lastPointer.set({ x: event.clientX, y: event.clientY });
    }
  }

  /**
   * Handle wheel event for zooming
   */
  static handleWheel(
    event: WheelEvent,
    canvas: HTMLCanvasElement,
    camera: Camera,
    devicePixelRatio: number,
    minZoom: number,
    onZoom: (newCamera: Camera, worldX: number, worldY: number) => void,
  ): void {
    event.preventDefault();
    const delta = -event.deltaY;
    const zoomFactor = Math.exp(delta * 0.0015);
    const rect = canvas.getBoundingClientRect();
    const cx = (event.clientX - rect.left) * devicePixelRatio;
    const cy = (event.clientY - rect.top) * devicePixelRatio;

    const worldBefore = CoordinateTransform.screenToWorld(
      cx,
      cy,
      canvas.width,
      canvas.height,
      camera,
    );
    const newZoom = Math.min(16, Math.max(minZoom || 0.0001, camera.zoom * zoomFactor));
    const newCam = { ...camera, zoom: newZoom };
    const worldAfter = CoordinateTransform.screenToWorld(
      cx,
      cy,
      canvas.width,
      canvas.height,
      newCam,
    );

    const dx = worldAfter.x - worldBefore.x;
    const dy = worldAfter.y - worldBefore.y;

    const updatedCam = { ...newCam, x: camera.x - dx, y: camera.y - dy };
    onZoom(updatedCam, worldBefore.x, worldBefore.y);
  }
}
