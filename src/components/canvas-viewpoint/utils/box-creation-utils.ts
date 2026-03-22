import { Box } from '../../../inteface/boxes.interface';
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
    absX: number,
    absY: number,
    camera: Camera,
    imageWidth: number,
    imageHeight: number,
    tempId: number,
  ): Box {
    const typeInfo = BOX_TYPES[type];

    // Scale default size based on zoom (larger at low zoom, smaller at high zoom)
    const absW = typeInfo.defaultSize.w / camera.zoom;
    const absH = typeInfo.defaultSize.h / camera.zoom;

    // Convert world position (center of box) to normalized coordinates
    const normalizedPos = BoxUtils.absoluteToNormalized(absX, absY, imageWidth, imageHeight);
    const normalizedDims = BoxUtils.absoluteDimensionsToNormalized(
      absW,
      absH,
      imageWidth,
      imageHeight,
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
    tempId: number,
    color?: string,
    minSize: number = 10,
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

    const normalizedPos = BoxUtils.absoluteToNormalized(centerX, centerY, imageWidth, imageHeight);
    const normalizedDims = BoxUtils.absoluteDimensionsToNormalized(
      width,
      height,
      imageWidth,
      imageHeight,
    );

    return {
      tempId,
      x: normalizedPos.x,
      y: normalizedPos.y,
      w: normalizedDims.w,
      h: normalizedDims.h,
      rotation: 0,
      color: color ?? BOX_TYPES['you tellin'].defaultColor,
    };
  }

  /**
   * Generates a unique temporary ID for a new box
   */
  static generateTempId(counter: number) {
    return 100000 + counter;
  }
}
