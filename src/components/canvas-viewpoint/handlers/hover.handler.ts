import { WritableSignal } from '@angular/core';
import { Box, getBoxId } from '../../../intefaces/boxes.interface';
import { Camera, ResizeCorner, TextMetrics } from '../core/types';
import { Quadtree } from '../core/quadtree';
import { BoxUtils } from '../utils/box-utils';
import { NametagUtils } from '../utils/nametag-utils';
import { CoordinateTransform } from '../utils/coordinate-transform';
import { CursorManager } from '../cursor/cursor-manager';

/**
 * Handler for hover detection and interaction point detection
 * Layer 3: Business Logic
 */
export class HoverHandler {
  /**
   * Detects which box (if any) is under the cursor
   */
  static detectHoveredBox(
    wx: number,
    wy: number,
    boxes: Box[],
    quadtree: Quadtree<Box> | undefined,
    imageWidth: number,
    imageHeight: number,
    camera: Camera,
    showNametags: boolean,
    nametagMetricsCache: Map<string, TextMetrics>,
    ctx: CanvasRenderingContext2D | undefined,
  ): string | null {
    const candidates = quadtree ? (quadtree.queryRange(wx - 1, wy - 1, 2, 2) as Box[]) : boxes;

    for (let i = candidates.length - 1; i >= 0; i--) {
      const rawBox = candidates[i];
      const worldBox = BoxUtils.normalizeBoxToWorld(rawBox, imageWidth, imageHeight);
      if (!worldBox) continue;

      if (
        showNametags &&
        NametagUtils.pointInNametag(wx, wy, worldBox, camera, nametagMetricsCache, ctx)
      ) {
        return String(getBoxId(rawBox));
      }

      if (CoordinateTransform.pointInBox(wx, wy, worldBox)) {
        return String(getBoxId(rawBox));
      }
    }

    return null;
  }

  /**
   * Detects if a point is near the rotation knob of a box
   */
  static detectRotationKnob(
    wx: number,
    wy: number,
    box: { x: number; y: number; w: number; h: number; rotation: number },
    camera: Camera,
  ): boolean {
    const knobDistance = 30 / camera.zoom;
    const knobSize = 10 / camera.zoom;

    // Calculate knob position on the shorter side
    const localKnobX = 0;
    const localKnobY = box.w < box.h ? 0 : box.h / 2 + knobDistance;
    const localKnobX2 = box.w < box.h ? box.w / 2 + knobDistance : 0;
    const localKnobY2 = box.w < box.h ? 0 : 0;

    // Use the shorter side
    const finalKnobX = box.w < box.h ? localKnobX2 : localKnobX;
    const finalKnobY = box.w < box.h ? localKnobY2 : localKnobY;

    // Rotate knob position to world space
    const cos = Math.cos(box.rotation);
    const sin = Math.sin(box.rotation);
    const knobWorldX = box.x + (finalKnobX * cos - finalKnobY * sin);
    const knobWorldY = box.y + (finalKnobX * sin + finalKnobY * cos);

    // Check if point is within knob radius
    const dist = Math.sqrt((wx - knobWorldX) ** 2 + (wy - knobWorldY) ** 2);
    return dist < knobSize;
  }

  /**
   * Detects if a point is near a corner handle of a box
   */
  static detectCornerHandle(
    wx: number,
    wy: number,
    box: { x: number; y: number; w: number; h: number; rotation: number },
    camera: Camera,
  ): ResizeCorner | null {
    const handleSize = 12 / camera.zoom;
    const threshold = handleSize;

    // Transform point to box local space (accounting for rotation)
    const dx = wx - box.x;
    const dy = wy - box.y;
    const rot = -box.rotation;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    const corners: Array<{ name: ResizeCorner; x: number; y: number }> = [
      { name: 'nw', x: -box.w / 2, y: -box.h / 2 },
      { name: 'ne', x: box.w / 2, y: -box.h / 2 },
      { name: 'sw', x: -box.w / 2, y: box.h / 2 },
      { name: 'se', x: box.w / 2, y: box.h / 2 },
    ];

    for (const corner of corners) {
      const distX = Math.abs(localX - corner.x);
      const distY = Math.abs(localY - corner.y);
      if (distX < threshold && distY < threshold) {
        return corner.name;
      }
    }

    return null;
  }

  /**
   * Update cursor based on hover state and interaction points
   */
  static updateCursorForHover(
    wx: number,
    wy: number,
    hoveredBoxId: string | null,
    selectedBoxId: string | null,
    boxes: Box[],
    imageWidth: number,
    imageHeight: number,
    camera: Camera,
    isCreateMode: boolean,
    cursorSignal: WritableSignal<string>,
    canvasElement: HTMLCanvasElement | null,
  ): void {
    // In create mode, always use crosshair
    if (isCreateMode) {
      CursorManager.updateForCreateMode(cursorSignal, canvasElement);
      return;
    }

    // If hovering over selected box, check for interaction points
    if (hoveredBoxId && hoveredBoxId === selectedBoxId) {
      const box = boxes.find((b) => String(getBoxId(b)) === selectedBoxId);
      if (box) {
        const worldBox = BoxUtils.normalizeBoxToWorld(box, imageWidth, imageHeight);
        if (worldBox) {
          // Check rotation knob first
          if (this.detectRotationKnob(wx, wy, worldBox, camera)) {
            CursorManager.updateForRotationKnob(cursorSignal, canvasElement);
            return;
          }

          // Check corner handles
          const corner = this.detectCornerHandle(wx, wy, worldBox, camera);
          if (corner) {
            CursorManager.updateForResize(cursorSignal, canvasElement, corner, worldBox);
            return;
          }
        }
      }

      // Hovering over box but not on interaction points
      CursorManager.updateForHover(cursorSignal, canvasElement);
      return;
    }

    // Hovering over any box
    if (hoveredBoxId) {
      CursorManager.updateForHover(cursorSignal, canvasElement);
      return;
    }

    // No hover
    CursorManager.updateToDefault(cursorSignal, canvasElement);
  }
}
