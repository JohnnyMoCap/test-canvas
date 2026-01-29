import { Box, getBoxId } from '../../../intefaces/boxes.interface';
import { ResizeCorner } from '../core/types';
import { BoxUtils } from './box-utils';
import { BoxStateUtils } from './box-state-utils';
import { BoundaryUtils } from './boundary-utils';

/**
 * Handles box manipulation operations (rotate, resize, move)
 */
export class BoxManipulator {
  /**
   * Rotate a box
   */
  static rotateBox(
    box: Box,
    worldX: number,
    worldY: number,
    bgWidth: number,
    bgHeight: number,
    rotationStartAngle: number,
    boxStartRotation: number,
  ): Box {
    const wb = BoxUtils.normalizeBoxToWorld(box, bgWidth, bgHeight);
    if (!wb) return box;

    const currentAngle = Math.atan2(worldY - wb.y, worldX - wb.x);
    const deltaAngle = currentAngle - rotationStartAngle;
    const newRotation = boxStartRotation + deltaAngle;

    return { ...box, rotation: newRotation };
  }

  /**
   * Resize a box from a corner
   */
  static resizeBox(
    box: Box,
    worldX: number,
    worldY: number,
    bgWidth: number,
    bgHeight: number,
    resizeCorner: ResizeCorner,
  ): Box {
    const wb = BoxUtils.normalizeBoxToWorld(box, bgWidth, bgHeight);
    if (!wb) return box;

    // Transform mouse to local space
    const dx = worldX - wb.x;
    const dy = worldY - wb.y;
    const rot = -wb.rotation;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const localMouseX = dx * cos - dy * sin;
    const localMouseY = dx * sin + dy * cos;

    // Anchor corners
    const anchorCorners = {
      se: { x: -wb.w / 2, y: -wb.h / 2 },
      sw: { x: wb.w / 2, y: -wb.h / 2 },
      ne: { x: -wb.w / 2, y: wb.h / 2 },
      nw: { x: wb.w / 2, y: wb.h / 2 },
    };

    const anchor = anchorCorners[resizeCorner];
    const deltaX = localMouseX - anchor.x;
    const deltaY = localMouseY - anchor.y;

    // New center in local space
    const newLocalCenterX = anchor.x + deltaX / 2;
    const newLocalCenterY = anchor.y + deltaY / 2;

    // Transform back to world
    const cosRot = Math.cos(wb.rotation);
    const sinRot = Math.sin(wb.rotation);
    const newWorldCenterX = wb.x + (newLocalCenterX * cosRot - newLocalCenterY * sinRot);
    const newWorldCenterY = wb.y + (newLocalCenterX * sinRot + newLocalCenterY * cosRot);

    // Convert to normalized
    const normalizedPos = BoxUtils.worldToNormalized(
      newWorldCenterX,
      newWorldCenterY,
      bgWidth,
      bgHeight,
    );
    const normalizedDims = BoxUtils.worldDimensionsToNormalized(
      Math.max(1, Math.abs(deltaX)),
      Math.max(1, Math.abs(deltaY)),
      bgWidth,
      bgHeight,
    );

    const resizedBox = {
      ...box,
      x: normalizedPos.x,
      y: normalizedPos.y,
      w: normalizedDims.w,
      h: normalizedDims.h,
    };

    // Clamp to bounds to ensure box stays fully within canvas
    return BoundaryUtils.clampBoxToBounds(resizedBox, bgWidth, bgHeight);
  }

  /**
   * Move a box to a new position, clamped to canvas bounds
   */
  static moveBox(box: Box, worldX: number, worldY: number, bgWidth: number, bgHeight: number): Box {
    const normalized = BoxUtils.worldToNormalized(worldX, worldY, bgWidth, bgHeight);
    const movedBox = {
      ...box,
      x: normalized.x,
      y: normalized.y,
    };

    // Clamp to bounds to ensure box stays fully within canvas
    return BoundaryUtils.clampBoxToBounds(movedBox, bgWidth, bgHeight);
  }

  /**
   * Update box in array and return new array
   */
  static updateBoxInArray(boxes: Box[], updatedBox: Box): Box[] {
    const boxId = String(getBoxId(updatedBox));
    const boxesRes = BoxStateUtils.updateBox(boxes, boxId, updatedBox);
    return boxesRes;
  }
}
