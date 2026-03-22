import { Camera, Point, AbsoluteBoxGeometry } from '../core/types';

/**
 * Coordinate transformation utilities for canvas rendering
 */
export class CoordinateTransform {
  /**
   * Converts screen coordinates to absolute coordinates
   */
  static screenToAbsolute(
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number,
    camera: Camera,
  ): Point {
    const cx = screenX - canvasWidth / 2;
    const cy = screenY - canvasHeight / 2;

    return { x: cx / camera.zoom + camera.x, y: cy / camera.zoom + camera.y };
  }

  /**
   * Converts absolute coordinates to screen coordinates (inverse of screenToAbsolute)
   */
  static absoluteToScreen(
    absX: number,
    absY: number,
    canvasWidth: number,
    canvasHeight: number,
    camera: Camera,
  ): Point {
    return {
      x: (absX - camera.x) * camera.zoom + canvasWidth / 2,
      y: (absY - camera.y) * camera.zoom + canvasHeight / 2,
    };
  }

  /**
   * Converts screen delta to absolute delta
   */
  static screenDeltaToAbsolute(dx: number, dy: number, camera: Camera): Point {
    return { x: dx / camera.zoom, y: dy / camera.zoom };
  }

  /**
   * Checks if a point is inside a rotated box
   * Logic: Translate point to box center, un-rotate point, check AABB
   */
  static pointInBox(wx: number, wy: number, boxGeometry: AbsoluteBoxGeometry): boolean {
    // 1. Translate point so box center is at (0,0)
    const dx = wx - boxGeometry.x;
    const dy = wy - boxGeometry.y;

    // 2. Rotate point by inverse of box rotation
    const rot = -boxGeometry.rotation;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);

    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    // 3. Check bounds (box width/height are full dimensions centered at 0)
    const halfW = boxGeometry.w / 2;
    const halfH = boxGeometry.h / 2;

    return localX >= -halfW && localX <= halfW && localY >= -halfH && localY <= halfH;
  }

  /**
   * Calculates the axis-aligned bounding box (AABB) of a rotated box
   */
  static calculateRotatedAABB(boxGeometry: AbsoluteBoxGeometry): {
    x: number;
    y: number;
    w: number;
    h: number;
  } {
    const hw = boxGeometry.w / 2;
    const hh = boxGeometry.h / 2;

    // Four corners relative to center
    const corners = [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ];

    const cos = Math.cos(boxGeometry.rotation);
    const sin = Math.sin(boxGeometry.rotation);

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const p of corners) {
      // Rotate point
      const rx = p.x * cos - p.y * sin;
      const ry = p.x * sin + p.y * cos;

      // Translate to absolute
      const wx = boxGeometry.x + rx;
      const wy = boxGeometry.y + ry;

      minX = Math.min(minX, wx);
      minY = Math.min(minY, wy);
      maxX = Math.max(maxX, wx);
      maxY = Math.max(maxY, wy);
    }

    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
}
