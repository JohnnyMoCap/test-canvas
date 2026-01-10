import { Camera, ResizeCorner, TextMetrics } from '../core/types';

/**
 * Nametag rendering and hit detection utilities
 */
export class NametagUtils {
  /**
   * Gets nametag bounds in world space
   */
  static getNametagBounds(
    box: { id: number; x: number; y: number; w: number; h: number; rotation: number },
    camera: Camera,
    metricsCache: Map<string, TextMetrics>,
    ctx?: CanvasRenderingContext2D
  ): { x: number; y: number; w: number; h: number } | null {
    const text = String(box.id);

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

    // Transform corners to world space
    const cos = Math.cos(box.rotation);
    const sin = Math.sin(box.rotation);
    const worldCorners = corners.map((c) => ({
      x: box.x + (c.lx * cos - c.ly * sin),
      y: box.y + (c.lx * sin + c.ly * cos),
    }));

    // Find topmost corner
    let topmostCorner = worldCorners[0];
    for (const corner of worldCorners) {
      if (corner.y < topmostCorner.y) {
        topmostCorner = corner;
      }
    }

    const tagX = topmostCorner.x;
    const tagY = topmostCorner.y - tagHeight;

    return { x: tagX, y: tagY, w: tagWidth, h: tagHeight };
  }

  /**
   * Checks if a point is inside a nametag
   */
  static pointInNametag(
    wx: number,
    wy: number,
    box: { id: number; x: number; y: number; w: number; h: number; rotation: number },
    camera: Camera,
    metricsCache: Map<string, TextMetrics>,
    ctx?: CanvasRenderingContext2D
  ): boolean {
    const bounds = this.getNametagBounds(box, camera, metricsCache, ctx);
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
    box: {
      id: number;
      x: number;
      y: number;
      w: number;
      h: number;
      rotation: number;
      color: string;
    },
    camera: Camera,
    canvasWidth: number,
    canvasHeight: number,
    metricsCache: Map<string, TextMetrics>
  ): void {
    const text = String(box.id);

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

    // Transform corners to world space
    const cos = Math.cos(box.rotation);
    const sin = Math.sin(box.rotation);
    const worldCorners = corners.map((c) => ({
      x: box.x + (c.lx * cos - c.ly * sin),
      y: box.y + (c.lx * sin + c.ly * cos),
    }));

    // Find topmost corner in world space (smallest y)
    let topmostCorner = worldCorners[0];
    for (const corner of worldCorners) {
      if (corner.y < topmostCorner.y) {
        topmostCorner = corner;
      }
    }

    // Draw nametag at topmost corner, always horizontal
    ctx.save();
    ctx.setTransform(
      camera.zoom,
      0,
      0,
      camera.zoom,
      canvasWidth / 2 - camera.x * camera.zoom,
      canvasHeight / 2 - camera.y * camera.zoom
    );

    const tagX = topmostCorner.x;
    const tagY = topmostCorner.y - tagHeight;

    // Draw nametag background
    ctx.fillStyle = box.color;
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
