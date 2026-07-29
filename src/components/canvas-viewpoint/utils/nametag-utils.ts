import { Camera, ResizeCorner, TextMetrics, AbsoluteBox } from '../core/types';
import { Box, getBoxId } from '../../../interface/boxes.interface';

/**
 * Nametag rendering and hit detection utilities
 */
export class NametagUtils {
  /**
   * Computes the visible region of absolute space, given the camera and canvas size.
   * Returns null when canvas dimensions are unknown (visibility can't be determined).
   */
  private static getViewportBounds(
    camera: Camera,
    canvasWidth?: number,
    canvasHeight?: number,
  ): { left: number; right: number; top: number; bottom: number } | null {
    if (!canvasWidth || !canvasHeight) return null;
    const halfW = canvasWidth / (2 * camera.zoom);
    const halfH = canvasHeight / (2 * camera.zoom);
    return {
      left: camera.x - halfW,
      right: camera.x + halfW,
      top: camera.y - halfH,
      bottom: camera.y + halfH,
    };
  }

  /**
   * Picks which box corner to anchor the nametag to. Prefers a corner whose
   * resulting tag rectangle is FULLY on-screen (a corner point being visible
   * isn't enough - the tag extends up and to the right of it, and that
   * extent can still land off-screen), falling back to the topmost corner
   * when no placement keeps the tag fully visible.
   */
  private static pickLabelCorner(
    absCorners: { x: number; y: number }[],
    tagWidth: number,
    tagHeight: number,
    viewport: { left: number; right: number; top: number; bottom: number } | null,
  ): { x: number; y: number } {
    const tagFullyVisible = (c: { x: number; y: number }) => {
      if (!viewport) return true;
      const tagX = c.x;
      const tagY = c.y - tagHeight;
      return (
        tagX >= viewport.left &&
        tagX + tagWidth <= viewport.right &&
        tagY >= viewport.top &&
        tagY + tagHeight <= viewport.bottom
      );
    };

    const visibleCorners = absCorners.filter(tagFullyVisible);
    const candidates = visibleCorners.length > 0 ? visibleCorners : absCorners;

    let best = candidates[0];
    for (const corner of candidates) {
      if (corner.y < best.y) {
        best = corner;
      }
    }
    return best;
  }

  /**
   * Gets nametag bounds in absolute space
   */
  static getNametagBounds(
    box: AbsoluteBox,
    camera: Camera,
    metricsCache: Map<string, TextMetrics>,
    ctx?: CanvasRenderingContext2D,
    canvasWidth?: number,
    canvasHeight?: number,
  ): { x: number; y: number; w: number; h: number } | null {
    const text = String(getBoxId(box.raw));

    // Get or calculate metrics
    let metrics = metricsCache.get(text);
    if (!metrics) {
      if (ctx) {
        ctx.save();
        ctx.font = '12px Arial, sans-serif';
        const measured = ctx.measureText(text);
        metrics = { width: measured.width, height: 12 };
        metricsCache.set(text, metrics);
        ctx.restore();
      } else {
        return null;
      }
    }

    const padding = 4 / camera.zoom;
    const textWidth = metrics.width / camera.zoom;
    const textHeight = metrics.height / camera.zoom;
    const tagWidth = textWidth + padding * 2;
    const tagHeight = textHeight + padding * 2;

    // Get all four corners in local (rotated) space
    const corners = [
      { lx: -box.w / 2, ly: -box.h / 2 },
      { lx: box.w / 2, ly: -box.h / 2 },
      { lx: -box.w / 2, ly: box.h / 2 },
      { lx: box.w / 2, ly: box.h / 2 },
    ];

    // Transform corners to absolute space
    const cos = Math.cos(box.rotation);
    const sin = Math.sin(box.rotation);
    const absCorners = corners.map((c) => ({
      x: box.x + (c.lx * cos - c.ly * sin),
      y: box.y + (c.lx * sin + c.ly * cos),
    }));

    const viewport = this.getViewportBounds(camera, canvasWidth, canvasHeight);
    const labelCorner = this.pickLabelCorner(absCorners, tagWidth, tagHeight, viewport);

    const tagX = labelCorner.x;
    const tagY = labelCorner.y - tagHeight;

    return { x: tagX, y: tagY, w: tagWidth, h: tagHeight };
  }

  /**
   * Checks if a point is inside a nametag
   */
  static pointInNametag(
    wx: number,
    wy: number,
    box: AbsoluteBox,
    camera: Camera,
    metricsCache: Map<string, TextMetrics>,
    ctx?: CanvasRenderingContext2D,
    canvasWidth?: number,
    canvasHeight?: number,
  ): boolean {
    const bounds = this.getNametagBounds(box, camera, metricsCache, ctx, canvasWidth, canvasHeight);
    if (!bounds) return false;

    // Simple AABB check (nametag is always horizontal)
    return (
      wx >= bounds.x && wx <= bounds.x + bounds.w && wy >= bounds.y && wy <= bounds.y + bounds.h
    );
  }

  /**
   * Draws a nametag at the topmost corner of a box (always horizontal)
   */
  static drawNametag(
    ctx: CanvasRenderingContext2D,
    box: AbsoluteBox,
    camera: Camera,
    canvasWidth: number,
    canvasHeight: number,
    metricsCache: Map<string, TextMetrics>,
    isPending: boolean,
  ): void {
    const text = String(getBoxId(box.raw));

    // Get or calculate text metrics (cached for performance)
    let metrics = metricsCache.get(text);
    if (!metrics) {
      ctx.save();
      ctx.font = '12px Arial, sans-serif';
      const measured = ctx.measureText(text);
      metrics = { width: measured.width, height: 12 };
      metricsCache.set(text, metrics);
      ctx.restore();
    }

    // Nametag properties
    const padding = 4 / camera.zoom;
    const fontSize = 12 / camera.zoom;
    const textWidth = metrics.width / camera.zoom;
    const textHeight = metrics.height / camera.zoom;
    const tagWidth = textWidth + padding * 2;
    const tagHeight = textHeight + padding * 2;

    // Get all four corners in local (rotated) space
    const corners = [
      { lx: -box.w / 2, ly: -box.h / 2 },
      { lx: box.w / 2, ly: -box.h / 2 },
      { lx: -box.w / 2, ly: box.h / 2 },
      { lx: box.w / 2, ly: box.h / 2 },
    ];

    // Transform corners to absolute space
    const cos = Math.cos(box.rotation);
    const sin = Math.sin(box.rotation);
    const absCorners = corners.map((c) => ({
      x: box.x + (c.lx * cos - c.ly * sin),
      y: box.y + (c.lx * sin + c.ly * cos),
    }));

    // Pick a corner to anchor the tag to, preferring one whose tag rect is fully on-screen
    const viewport = this.getViewportBounds(camera, canvasWidth, canvasHeight);
    const labelCorner = this.pickLabelCorner(absCorners, tagWidth, tagHeight, viewport);

    // Draw nametag at the chosen corner, always horizontal
    ctx.save();
    ctx.setTransform(
      camera.zoom,
      0,
      0,
      camera.zoom,
      canvasWidth / 2 - camera.x * camera.zoom,
      canvasHeight / 2 - camera.y * camera.zoom,
    );

    const tagX = labelCorner.x;
    const tagY = labelCorner.y - tagHeight;

    // Draw nametag background
    ctx.fillStyle = isPending ? box.color.replace(')', ', 0.4)') : box.color;
    ctx.fillRect(tagX, tagY, tagWidth, tagHeight);

    // Draw nametag text
    ctx.fillStyle = 'white';
    ctx.font = `${fontSize}px Arial, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(text, tagX + padding, tagY + padding);

    ctx.restore();
  }
}
