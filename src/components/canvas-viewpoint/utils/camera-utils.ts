import { Camera } from '../core/types';
import { QuadtreeUtils } from './quadtree-utils';
import { Box, getBoxId } from '../../../interface/boxes.interface';
import { BoxUtils } from './box-utils';

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
    minZoom: number,
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
    imageHeight: number,
  ): number {
    return Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
  }

  /**
   * Gets the view bounds in absolute coordinates
   */
  static getViewBoundsInAbsolute(
    canvasWidth: number,
    canvasHeight: number,
    camera: Camera,
  ): { minX: number; minY: number; maxX: number; maxY: number } {
    // Transform all four corners of the canvas to absolute space
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

      const wx = cx / camera.zoom + camera.x;
      const wy = cy / camera.zoom + camera.y;

      minX = Math.min(minX, wx);
      minY = Math.min(minY, wy);
      maxX = Math.max(maxX, wx);
      maxY = Math.max(maxY, wy);
    }

    // Add margin to prevent pop-in at edges (in absolute space)
    // Margin accounts for the maximum AABB extension from nametags
    // Use the larger of width/height to ensure full coverage
    const margin =
      Math.max(QuadtreeUtils.ESTIMATED_NAMETAG_WIDTH, QuadtreeUtils.ESTIMATED_NAMETAG_HEIGHT) /
      camera.zoom;

    return {
      minX: minX - margin,
      minY: minY - margin,
      maxX: maxX + margin,
      maxY: maxY + margin,
    };
  }

  /**
   * Zoom and pan camera to fit a specific box in view
   */
  static zoomToBox(
    boxId: number | null | undefined,
    boxes: Box[],
    canvasWidth: number,
    canvasHeight: number,
    bgWidth: number,
    bgHeight: number,
    minZoom: number,
    padding: number = 50,
  ): Camera | null {
    const box = boxes.find((b) => getBoxId(b) === boxId);
    if (!box) return null;

    const AbsoluteBox = BoxUtils.normalizeBoxToAbsolute(box, bgWidth, bgHeight);
    if (!AbsoluteBox) return null;

    // Calculate zoom to fit box with padding
    const boxScreenWidth = AbsoluteBox.w;
    const boxScreenHeight = AbsoluteBox.h;

    const zoomX = (canvasWidth - padding * 2) / boxScreenWidth;
    const zoomY = (canvasHeight - padding * 2) / boxScreenHeight;
    const targetZoom = Math.min(zoomX, zoomY, 3); // Max zoom of 3x

    // Ensure zoom is at least minZoom
    const finalZoom = Math.max(targetZoom, minZoom);

    return {
      zoom: finalZoom,
      x: AbsoluteBox.x,
      y: AbsoluteBox.y,
    };
  }
}
