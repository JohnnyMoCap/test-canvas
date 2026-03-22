import { WritableSignal } from '@angular/core';
import { Box, getBoxId } from '../../../interface/boxes.interface';
import { ResizeCorner, AbsoluteBoxGeometry } from '../core/types';
import { BoxManipulator } from '../utils/box-manipulator';
import { HistoryService } from '../../../services/history.service';

/**
 * Handler for box manipulation operations (drag, resize, rotate)
 * Layer 3: Business Logic
 */
export class BoxManipulationHandler {
  /**
   * Start box rotation
   */
  static startRotation(
    absX: number,
    absY: number,
    boxGeometry: AbsoluteBoxGeometry,
  ): { angle: number; boxRotation: number } {
    const angle = Math.atan2(absY - boxGeometry.y, absX - boxGeometry.x);
    return { angle, boxRotation: boxGeometry.rotation };
  }

  /**
   * Perform box rotation
   */
  static rotate(
    absX: number,
    absY: number,
    box: Box,
    bgWidth: number,
    bgHeight: number,
    rotationStartAngle: number,
    boxStartRotation: number,
  ): Box {
    return BoxManipulator.rotateBox(
      box,
      absX,
      absY,
      bgWidth,
      bgHeight,
      rotationStartAngle,
      boxStartRotation,
    );
  }

  /**
   * Perform box resize
   */
  static resize(
    absX: number,
    absY: number,
    box: Box,
    bgWidth: number,
    bgHeight: number,
    resizeCorner: ResizeCorner,
  ): Box {
    return BoxManipulator.resizeBox(box, absX, absY, bgWidth, bgHeight, resizeCorner);
  }

  /**
   * Start box drag
   */
  static startDrag(
    absX: number,
    absY: number,
    box: { x: number; y: number; w: number; h: number },
  ): { dragStart: { x: number; y: number }; boxStart: { x: number; y: number } } {
    return {
      dragStart: { x: absX, y: absY },
      boxStart: { x: box.x, y: box.y },
    };
  }

  /**
   * Perform box drag
   */
  static drag(
    absX: number,
    absY: number,
    box: Box,
    bgWidth: number,
    bgHeight: number,
    dragStartAbsolute: { x: number; y: number },
    boxStartPos: { x: number; y: number },
  ): Box {
    const deltaX = absX - dragStartAbsolute.x;
    const deltaY = absY - dragStartAbsolute.y;
    const newWorldX = boxStartPos.x + deltaX;
    const newWorldY = boxStartPos.y + deltaY;
    return BoxManipulator.moveBox(box, newWorldX, newWorldY, bgWidth, bgHeight);
  }

  static completeManipulation(
    boxId: number,
    startState: AbsoluteBoxGeometry,
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
