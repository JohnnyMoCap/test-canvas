import { WritableSignal } from '@angular/core';
import { Box, getBoxId } from '../../../intefaces/boxes.interface';
import { ResizeCorner } from '../core/types';
import { BoxManipulator } from '../utils/box-manipulator';
import { HistoryService } from '../../../services/history.service';
import { CursorManager } from '../cursor/cursor-manager';

/**
 * Handler for box manipulation operations (drag, resize, rotate)
 * Layer 3: Business Logic
 */
export class BoxManipulationHandler {
  /**
   * Start box rotation
   */
  static startRotation(
    worldX: number,
    worldY: number,
    box: { x: number; y: number; w: number; h: number; rotation: number },
  ): { angle: number; boxRotation: number } {
    const angle = Math.atan2(worldY - box.y, worldX - box.x);
    return { angle, boxRotation: box.rotation };
  }

  /**
   * Perform box rotation
   */
  static rotate(
    worldX: number,
    worldY: number,
    box: Box,
    bgWidth: number,
    bgHeight: number,
    rotationStartAngle: number,
    boxStartRotation: number,
  ): Box {
    return BoxManipulator.rotateBox(
      box,
      worldX,
      worldY,
      bgWidth,
      bgHeight,
      rotationStartAngle,
      boxStartRotation,
    );
  }

  /**
   * Start box resize - returns nothing, just for cursor update
   */
  static startResize(
    corner: ResizeCorner,
    box: { x: number; y: number; w: number; h: number; rotation: number },
  ): void {
    // Just a marker method - actual logic handled by caller
  }

  /**
   * Perform box resize
   */
  static resize(
    worldX: number,
    worldY: number,
    box: Box,
    bgWidth: number,
    bgHeight: number,
    resizeCorner: ResizeCorner,
  ): Box {
    return BoxManipulator.resizeBox(box, worldX, worldY, bgWidth, bgHeight, resizeCorner);
  }

  /**
   * Start box drag
   */
  static startDrag(
    worldX: number,
    worldY: number,
    box: { x: number; y: number; w: number; h: number },
  ): { dragStart: { x: number; y: number }; boxStart: { x: number; y: number } } {
    return {
      dragStart: { x: worldX, y: worldY },
      boxStart: { x: box.x, y: box.y },
    };
  }

  /**
   * Perform box drag
   */
  static drag(
    worldX: number,
    worldY: number,
    box: Box,
    bgWidth: number,
    bgHeight: number,
    dragStartWorld: { x: number; y: number },
    boxStartPos: { x: number; y: number },
  ): Box {
    const deltaX = worldX - dragStartWorld.x;
    const deltaY = worldY - dragStartWorld.y;
    const newWorldX = boxStartPos.x + deltaX;
    const newWorldY = boxStartPos.y + deltaY;
    return BoxManipulator.moveBox(box, newWorldX, newWorldY, bgWidth, bgHeight);
  }

  /**
   * Complete box manipulation and save to history
   */
  static completeManipulation(
    boxId: string,
    startState: { x: number; y: number; w: number; h: number; rotation: number },
    currentBox: Box,
    isRotating: boolean,
    isResizing: boolean,
    isDragging: boolean,
    historyService: HistoryService,
  ): void {
    const actionType = isRotating ? 'rotate' : isResizing ? 'resize' : isDragging ? 'drag' : 'move';

    // Only save if box actually changed
    const changed =
      currentBox.x !== startState.x ||
      currentBox.y !== startState.y ||
      currentBox.w !== startState.w ||
      currentBox.h !== startState.h ||
      currentBox.rotation !== startState.rotation;

    if (changed) {
      if (actionType === 'rotate') {
        historyService.recordRotate(boxId, startState.rotation ?? 0, currentBox.rotation ?? 0);
      } else if (actionType === 'resize') {
        historyService.recordResize(
          boxId,
          { x: startState.x, y: startState.y, w: startState.w, h: startState.h },
          { x: currentBox.x, y: currentBox.y, w: currentBox.w, h: currentBox.h },
        );
      } else {
        historyService.recordMove(boxId, startState.x, startState.y, currentBox.x, currentBox.y);
      }
    }
  }

  /**
   * Update boxes array with modified box
   */
  static updateBoxInArray(boxes: Box[], updatedBox: Box): Box[] {
    return BoxManipulator.updateBoxInArray(boxes, updatedBox);
  }
}
