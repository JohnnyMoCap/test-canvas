import { Box, getBoxId } from '../../../interface/boxes.interface';

/**
 * Utilities for managing box state and collections
 */
export class BoxStateUtils {
  /**
   * Updates a box by its ID
   */
  static updateBox(boxes: Box[], boxId: number, updates: Partial<Box>): Box[] {
    return boxes.map((b) => (getBoxId(b) === boxId ? ({ ...b, ...updates } as Box) : b));
  }

  /**
   * Removes a box by its ID
   */
  static removeBox(boxes: Box[], boxId: number): Box[] {
    return boxes.filter((b) => getBoxId(b) !== boxId);
  }

  /**
   * Finds a box by its ID
   */
  static findBoxById(boxes: Box[], boxId: number | undefined): Box | undefined {
    if (boxId === undefined) {
      return undefined;
    }
    return boxes.find((b) => getBoxId(b) === boxId);
  }
}
