import { Box, getBoxId } from '../../../intefaces/boxes.interface';
import { Camera } from '../core/types';
import { CoordinateTransform } from './coordinate-transform';
import { BoxUtils } from './box-utils';
import { BoxCreationUtils } from './box-creation-utils';
import { BoxStateUtils } from './box-state-utils';

/**
 * Handles clipboard operations (copy, paste)
 */
export class ClipboardManager {
  /**
   * Copy a box to clipboard
   */
  static copyBox(boxId: string, boxes: Box[]): Box | null {
    const box = BoxStateUtils.findBoxById(boxes, boxId);
    return box ? { ...box } : null;
  }

  /**
   * Create a pasted box at the specified location
   */
  static createPastedBox(
    clipboard: Box,
    mouseScreenPos: { x: number; y: number } | null,
    canvas: HTMLCanvasElement,
    canvasRect: DOMRect,
    camera: Camera,
    bgWidth: number,
    bgHeight: number,
    devicePixelRatio: number,
    nextTempId: number,
  ): Box {
    let newX: number;
    let newY: number;

    // Check if current mouse position is over the canvas
    if (mouseScreenPos) {
      const isOverCanvas =
        mouseScreenPos.x >= canvasRect.left &&
        mouseScreenPos.x <= canvasRect.right &&
        mouseScreenPos.y >= canvasRect.top &&
        mouseScreenPos.y <= canvasRect.bottom;

      if (isOverCanvas) {
        // Mouse is over canvas - convert current position to world coordinates
        const mx = (mouseScreenPos.x - canvasRect.left) * devicePixelRatio;
        const my = (mouseScreenPos.y - canvasRect.top) * devicePixelRatio;
        const worldPos = CoordinateTransform.screenToWorld(
          mx,
          my,
          canvas.width,
          canvas.height,
          camera,
        );

        const normalizedMouse = BoxUtils.worldToNormalized(
          worldPos.x,
          worldPos.y,
          bgWidth,
          bgHeight,
        );
        newX = normalizedMouse.x;
        newY = normalizedMouse.y;
      } else {
        // Mouse is outside canvas - use fallback with visible offset
        newX = clipboard.x + 0.05; // 5% offset for visibility
        newY = clipboard.y + 0.05;
      }
    } else {
      // TODO: not working, fix.
      // No mouse position tracked - use fallback with visible offset
      newX = clipboard.x + 0.05;
      newY = clipboard.y + 0.05;
    }

    return {
      ...clipboard,
      tempId: BoxCreationUtils.generateTempId(nextTempId),
      id: undefined, // Clear id so it gets a new one on save
      x: newX,
      y: newY,
    };
  }
}
