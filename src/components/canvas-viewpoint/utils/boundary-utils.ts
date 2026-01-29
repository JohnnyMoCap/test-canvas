import { Box } from '../../../intefaces/boxes.interface';
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
    const worldBox = BoxUtils.normalizeBoxToWorld(box, imageWidth, imageHeight);
    if (!worldBox) return false;

    // Calculate axis-aligned bounding box (AABB) for rotated box
    const cos = Math.abs(Math.cos(worldBox.rotation));
    const sin = Math.abs(Math.sin(worldBox.rotation));
    const aabbWidth = worldBox.w * cos + worldBox.h * sin;
    const aabbHeight = worldBox.w * sin + worldBox.h * cos;

    // AABB bounds in world space
    const minX = worldBox.x - aabbWidth / 2;
    const maxX = worldBox.x + aabbWidth / 2;
    const minY = worldBox.y - aabbHeight / 2;
    const maxY = worldBox.y + aabbHeight / 2;

    // Canvas bounds in world space (centered at origin)
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
    const worldBox = BoxUtils.normalizeBoxToWorld(box, imageWidth, imageHeight);
    if (!worldBox) return box;

    // Calculate AABB for rotated box
    const cos = Math.abs(Math.cos(worldBox.rotation));
    const sin = Math.abs(Math.sin(worldBox.rotation));
    const aabbWidth = worldBox.w * cos + worldBox.h * sin;
    const aabbHeight = worldBox.w * sin + worldBox.h * cos;

    // Canvas bounds in world space
    const canvasMinX = -imageWidth / 2;
    const canvasMaxX = imageWidth / 2;
    const canvasMinY = -imageHeight / 2;
    const canvasMaxY = imageHeight / 2;

    // Clamp center position to keep AABB within bounds
    let clampedX = worldBox.x;
    let clampedY = worldBox.y;

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
    const normalized = BoxUtils.worldToNormalized(clampedX, clampedY, imageWidth, imageHeight);

    return {
      ...box,
      x: normalized.x,
      y: normalized.y,
    };
  }
}
