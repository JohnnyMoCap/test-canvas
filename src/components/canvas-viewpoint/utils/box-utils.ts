import { Box, getBoxId } from '../../../intefaces/boxes.interface';

/**
 * Box normalization and transformation utilities
 */
export class BoxUtils {
  /**
   * Converts a normalized box (0..1 coords & sizes) into world units (pixels centered at origin)
   */
  static normalizeBoxToWorld(
    box: Box,
    imageWidth: number,
    imageHeight: number
  ): {
    raw: Box;
    x: number;
    y: number;
    w: number;
    h: number;
    rotation: number;
    color: string;
  } | null {
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
   * Converts world coordinates back to normalized coordinates (0..1)
   */
  static worldToNormalized(
    worldX: number,
    worldY: number,
    imageWidth: number,
    imageHeight: number
  ): { x: number; y: number } {
    return {
      x: (worldX + imageWidth / 2) / imageWidth,
      y: (worldY + imageHeight / 2) / imageHeight,
    };
  }

  /**
   * Converts world dimensions back to normalized dimensions (0..1)
   */
  static worldDimensionsToNormalized(
    worldW: number,
    worldH: number,
    imageWidth: number,
    imageHeight: number
  ): { w: number; h: number } {
    return {
      w: worldW / imageWidth,
      h: worldH / imageHeight,
    };
  }
}
