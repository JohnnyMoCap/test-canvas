import { Box } from '../../../intefaces/boxes.interface';
import { Camera } from '../core/types';
import { BoxType, BOX_TYPES } from '../core/creation-state';
import { BoxUtils } from './box-utils';

/**
 * Utilities for creating new boxes
 */
export class BoxCreationUtils {
  /**
   * Creates a new box from context menu selection
   */
  static createBoxFromContextMenu(
    type: BoxType,
    worldX: number,
    worldY: number,
    camera: Camera,
    imageWidth: number,
    imageHeight: number,
    tempId: string
  ): Box {
    const typeInfo = BOX_TYPES[type];

    // Scale default size based on zoom (larger at low zoom, smaller at high zoom)
    const worldW = typeInfo.defaultSize.w / camera.zoom;
    const worldH = typeInfo.defaultSize.h / camera.zoom;

    // Convert world position (center of box) to normalized coordinates
    const normalizedPos = BoxUtils.worldToNormalized(worldX, worldY, imageWidth, imageHeight);
    const normalizedDims = BoxUtils.worldDimensionsToNormalized(
      worldW,
      worldH,
      imageWidth,
      imageHeight
    );

    return {
      tempId,
      x: normalizedPos.x,
      y: normalizedPos.y,
      w: normalizedDims.w,
      h: normalizedDims.h,
      rotation: 0,
      color: typeInfo.defaultColor,
    };
  }

  /**
   * Creates a new box from drag-to-create mode
   */
  static createBoxFromDrag(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    imageWidth: number,
    imageHeight: number,
    tempId: string,
    color?: string,
    minSize: number = 10
  ): Box | null {
    // Calculate preview box dimensions
    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);

    // Only create if box is large enough
    if (width < minSize || height < minSize) {
      return null;
    }

    // Convert to normalized coordinates
    const centerX = left + width / 2;
    const centerY = top + height / 2;

    const normalizedPos = BoxUtils.worldToNormalized(centerX, centerY, imageWidth, imageHeight);
    const normalizedDims = BoxUtils.worldDimensionsToNormalized(
      width,
      height,
      imageWidth,
      imageHeight
    );

    return {
      tempId,
      x: normalizedPos.x,
      y: normalizedPos.y,
      w: normalizedDims.w,
      h: normalizedDims.h,
      rotation: 0,
      color: color ?? BOX_TYPES.finding.defaultColor,
    };
  }

  /**
   * Generates a unique temporary ID for a new box
   */
  static generateTempId(counter: number): string {
    return `temp-${counter}`;
  }
}
