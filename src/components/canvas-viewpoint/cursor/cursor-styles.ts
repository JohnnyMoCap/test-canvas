import { ResizeCorner } from '../core/types';

/**
 * Cursor style utilities - Layer between business logic and utils
 * Handles cursor appearance logic based on interaction context
 */
export class CursorStyles {
  /**
   * Returns appropriate cursor style for a resize corner based on its actual world position
   * Takes into account the box's rotation to show the correct resize direction
   */
  static getResizeCursor(
    corner: ResizeCorner,
    box: { x: number; y: number; w: number; h: number; rotation: number },
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

  /**
   * Get cursor for rotation interaction
   */
  static getRotateCursor(): string {
    return 'grabbing';
  }

  /**
   * Get cursor for dragging interaction
   */
  static getDragCursor(): string {
    return 'grabbing';
  }

  /**
   * Get cursor for hovering over a box
   */
  static getHoverCursor(): string {
    return 'move';
  }

  /**
   * Get cursor for hovering over rotation knob
   */
  static getRotationKnobCursor(): string {
    return 'grab';
  }

  /**
   * Get default cursor
   */
  static getDefaultCursor(): string {
    return 'default';
  }

  /**
   * Get cursor for create mode
   */
  static getCreateModeCursor(): string {
    return 'crosshair';
  }
}
