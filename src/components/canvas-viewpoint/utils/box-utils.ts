import { Box, getBoxId } from '../../../interface/boxes.interface';
import { AbsoluteBox } from '../core/types';

/**
 * Box normalization and transformation utilities
 */
export class BoxUtils {
  /**
   * Converts a normalized box (0..1 coords & sizes) into absolute units (pixels centered at origin)
   */
  static normalizeBoxToAbsolute(
    box: Box,
    imageWidth: number,
    imageHeight: number,
  ): AbsoluteBox | null {
    if (!imageWidth || !imageHeight) return null;

    return {
      raw: box,
      x: box.x * imageWidth - imageWidth / 2,
      y: box.y * imageHeight - imageHeight / 2,
      w: box.w * imageWidth,
      h: box.h * imageHeight,
      rotation: box.rotation ?? 0,
      color: box.color ?? '#ffffff88',
    };
  }

  /**
   * Converts absolute coordinates back to normalized coordinates (0..1)
   */
  static absoluteToNormalized(
    absX: number,
    absY: number,
    imageWidth: number,
    imageHeight: number,
  ): { x: number; y: number } {
    return {
      x: (absX + imageWidth / 2) / imageWidth,
      y: (absY + imageHeight / 2) / imageHeight,
    };
  }

  /**
   * Converts world dimensions back to normalized dimensions (0..1)
   */
  static absoluteDimensionsToNormalized(
    absW: number,
    absH: number,
    imageWidth: number,
    imageHeight: number,
  ): { w: number; h: number } {
    return {
      w: absW / imageWidth,
      h: absH / imageHeight,
    };
  }
}
