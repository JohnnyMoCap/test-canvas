import { Box, getBoxId } from '../../../intefaces/boxes.interface';

/**
 * Utilities for managing box state and collections
 */
export class BoxStateUtils {
  /**
   * Updates a box by its ID
   */
  static updateBox(boxes: Box[], boxId: string, updates: Partial<Box>): Box[] {
    return boxes.map((b) => (String(getBoxId(b)) === boxId ? { ...b, ...updates } : b));
  }

  /**
   * Removes a box by its ID
   */
  static removeBox(boxes: Box[], boxId: string): Box[] {
    return boxes.filter((b) => String(getBoxId(b)) != boxId);
  }

  /**
   * Finds a box by its ID
   */
  static findBoxById(boxes: Box[], boxId: string | undefined): Box | undefined {
    if (!boxId) {
      return undefined;
    }
    return boxes.find((b) => String(getBoxId(b)) === boxId);
  }
}
