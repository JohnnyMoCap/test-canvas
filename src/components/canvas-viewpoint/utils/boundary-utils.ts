import { Box } from '../../../interface/boxes.interface';
import { BoxUtils } from './box-utils';

/**
 * Utilities for boundary constraint checking and clamping
 */
export class BoundaryUtils {
  /**
   * Check if a box (in normalized coordinates) is fully within canvas bounds
   * Accounts for rotation by checking if the box's AABB fits within 0-1 range
   */
  static isBoxWithinBounds(box: Box, imageWidth: number, imageHeight: number): boolean {
    const AbsoluteBox = BoxUtils.normalizeBoxToAbsolute(box, imageWidth, imageHeight);
    if (!AbsoluteBox) return false;

    // Calculate axis-aligned bounding box (AABB) for rotated box
    const cos = Math.abs(Math.cos(AbsoluteBox.rotation));
    const sin = Math.abs(Math.sin(AbsoluteBox.rotation));
    const aabbWidth = AbsoluteBox.w * cos + AbsoluteBox.h * sin;
    const aabbHeight = AbsoluteBox.w * sin + AbsoluteBox.h * cos;

    // AABB bounds in absolute space
    const minX = AbsoluteBox.x - aabbWidth / 2;
    const maxX = AbsoluteBox.x + aabbWidth / 2;
    const minY = AbsoluteBox.y - aabbHeight / 2;
    const maxY = AbsoluteBox.y + aabbHeight / 2;

    // Canvas bounds in absolute space (centered at origin)
    const canvasMinX = -imageWidth / 2;
    const canvasMaxX = imageWidth / 2;
    const canvasMinY = -imageHeight / 2;
    const canvasMaxY = imageHeight / 2;

    // Check if AABB is fully within canvas bounds
    return minX >= canvasMinX && maxX <= canvasMaxX && minY >= canvasMinY && maxY <= canvasMaxY;
  }

  /**
   * Clamp a box position to stay within canvas bounds
   * Returns a new box with clamped position
   */
  static clampBoxToBounds(box: Box, imageWidth: number, imageHeight: number): Box {
    const AbsoluteBox = BoxUtils.normalizeBoxToAbsolute(box, imageWidth, imageHeight);
    if (!AbsoluteBox) return box;

    // Calculate AABB for rotated box
    const cos = Math.abs(Math.cos(AbsoluteBox.rotation));
    const sin = Math.abs(Math.sin(AbsoluteBox.rotation));
    const aabbWidth = AbsoluteBox.w * cos + AbsoluteBox.h * sin;
    const aabbHeight = AbsoluteBox.w * sin + AbsoluteBox.h * cos;

    // Canvas bounds in absolute space
    const canvasMinX = -imageWidth / 2;
    const canvasMaxX = imageWidth / 2;
    const canvasMinY = -imageHeight / 2;
    const canvasMaxY = imageHeight / 2;

    // Clamp center position to keep AABB within bounds
    let clampedX = AbsoluteBox.x;
    let clampedY = AbsoluteBox.y;

    const halfAABBWidth = aabbWidth / 2;
    const halfAABBHeight = aabbHeight / 2;

    if (clampedX - halfAABBWidth < canvasMinX) {
      clampedX = canvasMinX + halfAABBWidth;
    }
    if (clampedX + halfAABBWidth > canvasMaxX) {
      clampedX = canvasMaxX - halfAABBWidth;
    }
    if (clampedY - halfAABBHeight < canvasMinY) {
      clampedY = canvasMinY + halfAABBHeight;
    }
    if (clampedY + halfAABBHeight > canvasMaxY) {
      clampedY = canvasMaxY - halfAABBHeight;
    }

    // Convert back to normalized coordinates
    const normalized = BoxUtils.absoluteToNormalized(clampedX, clampedY, imageWidth, imageHeight);

    return {
      ...box,
      x: normalized.x,
      y: normalized.y,
    };
  }
}
