import { Camera, ResizeCorner } from '../core/types';

/**
 * Interaction utilities for box manipulation
 */
export class InteractionUtils {
  /**
   * Detects if a point is near the rotation knob of a box
   */
  static detectRotationKnob(
    wx: number,
    wy: number,
    box: { x: number; y: number; w: number; h: number; rotation: number },
    camera: Camera
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
    camera: Camera
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
   * Returns appropriate cursor style for a corner based on its actual world position
   */
  static getResizeCursor(
    corner: ResizeCorner,
    box: { x: number; y: number; w: number; h: number; rotation: number }
  ): string {
    // Get the actual world position of the corner
    const cornerOffsets = {
      nw: { x: -box.w / 2, y: -box.h / 2 },
      ne: { x: box.w / 2, y: -box.h / 2 },
      sw: { x: -box.w / 2, y: box.h / 2 },
      se: { x: box.w / 2, y: box.h / 2 },
    };

    const offset = cornerOffsets[corner];
    const cos = Math.cos(box.rotation);
    const sin = Math.sin(box.rotation);

    // Rotate corner offset
    const rotatedX = offset.x * cos - offset.y * sin;
    const rotatedY = offset.x * sin + offset.y * cos;

    // Calculate angle from box center to this corner in world space
    const angle = Math.atan2(rotatedY, rotatedX);

    // Normalize angle to 0-360 degrees
    let degrees = ((angle * 180) / Math.PI + 360) % 360;

    // Map angle to cursor type (8 directions)
    // 0° = right, 90° = down, 180° = left, 270° = up
    if (degrees >= 337.5 || degrees < 22.5) return 'ew-resize';
    if (degrees >= 22.5 && degrees < 67.5) return 'se-resize';
    if (degrees >= 67.5 && degrees < 112.5) return 'ns-resize';
    if (degrees >= 112.5 && degrees < 157.5) return 'sw-resize';
    if (degrees >= 157.5 && degrees < 202.5) return 'ew-resize';
    if (degrees >= 202.5 && degrees < 247.5) return 'nw-resize';
    if (degrees >= 247.5 && degrees < 292.5) return 'ns-resize';
    if (degrees >= 292.5 && degrees < 337.5) return 'ne-resize';

    return 'nwse-resize';
  }
}
