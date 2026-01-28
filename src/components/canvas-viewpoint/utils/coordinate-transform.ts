import { Camera, Point, WorldBoxGeometry } from '../core/types';

/**
 * Coordinate transformation utilities for canvas rendering
 */
export class CoordinateTransform {
  /**
   * Converts screen coordinates to world coordinates
   */
  static screenToWorld(
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number,
    camera: Camera,
  ): Point {
    // Center-based coordinates: translate screen to canvas center
    const cx = screenX - canvasWidth / 2;
    const cy = screenY - canvasHeight / 2;

    // Apply inverse rotation then inverse scale then camera offset
    const cos = Math.cos(-camera.rotation);
    const sin = Math.sin(-camera.rotation);
    const rx = (cx * cos - cy * sin) / camera.zoom;
    const ry = (cx * sin + cy * cos) / camera.zoom;

    return { x: rx + camera.x, y: ry + camera.y };
  }

  /**
   * Converts screen delta to world delta
   */
  static screenDeltaToWorld(dx: number, dy: number, camera: Camera): Point {
    // Account for rotation + scale
    const cos = Math.cos(-camera.rotation);
    const sin = Math.sin(-camera.rotation);
    const rx = (dx * cos - dy * sin) / camera.zoom;
    const ry = (dx * sin + dy * cos) / camera.zoom;

    return { x: rx, y: ry };
  }

  /**
   * Checks if a point is inside a rotated box
   * Logic: Translate point to box center, un-rotate point, check AABB
   */
  static pointInBox(wx: number, wy: number, boxGeometry: WorldBoxGeometry): boolean {
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
  static calculateRotatedAABB(boxGeometry: WorldBoxGeometry): {
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

      // Translate to world
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
