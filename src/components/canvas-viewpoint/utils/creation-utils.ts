import { Camera } from '../core/types';

/**
 * Utilities for box creation
 */
export class CreationUtils {
  /**
   * Creates a preview box from drag points
   */
  static createPreviewBox(
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): { x: number; y: number; w: number; h: number } {
    const minX = Math.min(startX, endX);
    const minY = Math.min(startY, endY);
    const maxX = Math.max(startX, endX);
    const maxY = Math.max(startY, endY);

    return {
      x: minX + (maxX - minX) / 2,
      y: minY + (maxY - minY) / 2,
      w: maxX - minX,
      h: maxY - minY,
    };
  }

  /**
   * Draws a creation preview box
   */
  static drawCreationPreview(
    ctx: CanvasRenderingContext2D,
    box: { x: number; y: number; w: number; h: number },
    color: string,
    camera: Camera
  ): void {
    ctx.save();
    ctx.translate(box.x, box.y);

    // Draw dashed border
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / camera.zoom;
    ctx.setLineDash([10 / camera.zoom, 5 / camera.zoom]);
    ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);

    // Draw semi-transparent fill
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = color;
    ctx.fillRect(-box.w / 2, -box.h / 2, box.w, box.h);

    ctx.restore();
  }

  /**
   * Gets cursor style for create mode
   */
  static getCreateCursor(): string {
    return 'crosshair';
  }
}
