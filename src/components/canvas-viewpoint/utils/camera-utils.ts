import { Camera } from '../core/types';

/**
 * Camera manipulation and constraints utilities
 */
export class CameraUtils {
  /**
   * Clamps camera position to ensure background image fills the canvas
   */
  static clampCamera(
    camera: Camera,
    canvasWidth: number,
    canvasHeight: number,
    imageWidth: number,
    imageHeight: number,
    minZoom: number
  ): Camera {
    const halfViewW = canvasWidth / (2 * camera.zoom);
    const halfViewH = canvasHeight / (2 * camera.zoom);

    const minX = -imageWidth / 2 + halfViewW;
    const maxX = imageWidth / 2 - halfViewW;
    const minY = -imageHeight / 2 + halfViewH;
    const maxY = imageHeight / 2 - halfViewH;

    const clampedX = minX > maxX ? 0 : Math.min(maxX, Math.max(minX, camera.x));
    const clampedY = minY > maxY ? 0 : Math.min(maxY, Math.max(minY, camera.y));

    return {
      ...camera,
      x: clampedX,
      y: clampedY,
      zoom: Math.max(minZoom, camera.zoom),
    };
  }

  /**
   * Calculates minimum zoom level to fit image in canvas
   */
  static calculateMinZoom(
    canvasWidth: number,
    canvasHeight: number,
    imageWidth: number,
    imageHeight: number
  ): number {
    return Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
  }

  /**
   * Gets the view bounds in world coordinates
   */
  static getViewBoundsInWorld(
    canvasWidth: number,
    canvasHeight: number,
    camera: Camera
  ): { minX: number; minY: number; maxX: number; maxY: number } {
    // Transform all four corners of the canvas to world space
    const corners = [
      { x: 0, y: 0 },
      { x: canvasWidth, y: 0 },
      { x: canvasWidth, y: canvasHeight },
      { x: 0, y: canvasHeight },
    ];

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const corner of corners) {
      const cx = corner.x - canvasWidth / 2;
      const cy = corner.y - canvasHeight / 2;

      const cos = Math.cos(-camera.rotation);
      const sin = Math.sin(-camera.rotation);
      const rx = (cx * cos - cy * sin) / camera.zoom;
      const ry = (cx * sin + cy * cos) / camera.zoom;

      const wx = rx + camera.x;
      const wy = ry + camera.y;

      minX = Math.min(minX, wx);
      minY = Math.min(minY, wy);
      maxX = Math.max(maxX, wx);
      maxY = Math.max(maxY, wy);
    }

    return { minX, minY, maxX, maxY };
  }
}
