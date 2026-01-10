import { Camera } from '../core/types';
import { QTNode } from '../core/quadtree';
import { Box } from '../../../intefaces/boxes.interface';

/**
 * Canvas rendering utilities
 */
export class RenderUtils {
  /**
   * Applies camera transform to canvas context
   */
  static applyCameraTransform(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    camera: Camera
  ): void {
    ctx.setTransform(
      camera.zoom,
      0,
      0,
      camera.zoom,
      canvasWidth / 2 - camera.x * camera.zoom,
      canvasHeight / 2 - camera.y * camera.zoom
    );

    if (camera.rotation !== 0) {
      ctx.translate(camera.x, camera.y);
      ctx.rotate(camera.rotation);
      ctx.translate(-camera.x, -camera.y);
    }
  }

  /**
   * Draws a box with proper rotation and styling
   */
  static drawBox(
    ctx: CanvasRenderingContext2D,
    box: { x: number; y: number; w: number; h: number; rotation: number; color: string },
    camera: Camera,
    isHovered: boolean
  ): void {
    ctx.save();
    ctx.translate(box.x, box.y);
    if (box.rotation) ctx.rotate(box.rotation);

    // Draw box border with consistent line width
    ctx.strokeStyle = box.color;
    ctx.lineWidth = 3 / camera.zoom;
    ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);

    // Hover effect: semi-transparent fill
    if (isHovered) {
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = box.color;
      ctx.fillRect(-box.w / 2, -box.h / 2, box.w, box.h);
      ctx.globalAlpha = 1.0;
    }

    ctx.restore();
  }

  /**
   * Draws selection UI (corner handles and rotation knob)
   */
  static drawSelectionUI(
    ctx: CanvasRenderingContext2D,
    box: { x: number; y: number; w: number; h: number; rotation: number; color: string },
    camera: Camera
  ): void {
    ctx.save();
    ctx.translate(box.x, box.y);
    if (box.rotation) ctx.rotate(box.rotation);

    // Draw corner handles
    const handleSize = 12 / camera.zoom;
    const corners = [
      { x: -box.w / 2, y: -box.h / 2 }, // NW
      { x: box.w / 2, y: -box.h / 2 }, // NE
      { x: -box.w / 2, y: box.h / 2 }, // SW
      { x: box.w / 2, y: box.h / 2 }, // SE
    ];

    ctx.fillStyle = 'white';
    ctx.strokeStyle = box.color;
    ctx.lineWidth = 2 / camera.zoom;

    for (const corner of corners) {
      ctx.fillRect(corner.x - handleSize / 2, corner.y - handleSize / 2, handleSize, handleSize);
      ctx.strokeRect(corner.x - handleSize / 2, corner.y - handleSize / 2, handleSize, handleSize);
    }

    // Draw rotation knob (circle on the shorter side)
    const knobDistance = 30 / camera.zoom;
    const knobRadius = 8 / camera.zoom;

    // Position knob on shorter side
    const knobX = box.w < box.h ? box.w / 2 + knobDistance : 0;
    const knobY = box.w < box.h ? 0 : box.h / 2 + knobDistance;
    const lineStartX = box.w < box.h ? box.w / 2 : 0;
    const lineStartY = box.w < box.h ? 0 : box.h / 2;

    // Draw line from edge center to knob
    ctx.beginPath();
    ctx.moveTo(lineStartX, lineStartY);
    ctx.lineTo(knobX, knobY);
    ctx.strokeStyle = box.color;
    ctx.lineWidth = 2 / camera.zoom;
    ctx.stroke();

    // Draw knob circle
    ctx.beginPath();
    ctx.arc(knobX, knobY, knobRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();
    ctx.strokeStyle = box.color;
    ctx.lineWidth = 2 / camera.zoom;
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Recursively draws quadtree node bounds for debugging
   */
  static drawQuadtreeNode(ctx: CanvasRenderingContext2D, node: QTNode<Box>, camera: Camera): void {
    const { x, y, w, h } = node.bounds;

    // Draw bounds in world coordinates
    ctx.save();
    ctx.strokeStyle = 'rgba(0,255,0,0.25)';
    ctx.lineWidth = 1 / camera.zoom;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();

    // Recurse
    if (node.divided) {
      for (const child of node.children) {
        if (child) this.drawQuadtreeNode(ctx, child, camera);
      }
    }
  }
}
