import { Box, getBoxId } from '../../../intefaces/boxes.interface';

/**
 * Utilities for managing box state and collections
 */
export class BoxStateUtils {
  /**
   * Adds a new box to the collection
   */
  static addBox(boxes: Box[], newBox: Box): Box[] {
    return [...boxes, newBox];
  }

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
    return boxes.filter((b) => String(getBoxId(b)) !== boxId);
  }

  /**
   * Finds a box by its ID
   */
  static findBoxById(boxes: Box[], boxId: string): Box | undefined {
    return boxes.find((b) => String(getBoxId(b)) === boxId);
  }

  /**
   * Updates box position
   */
  static updateBoxPosition(boxes: Box[], boxId: string, x: number, y: number): Box[] {
    return BoxStateUtils.updateBox(boxes, boxId, { x, y });
  }

  /**
   * Updates box rotation
   */
  static updateBoxRotation(boxes: Box[], boxId: string, rotation: number): Box[] {
    return BoxStateUtils.updateBox(boxes, boxId, { rotation });
  }

  /**
   * Updates box dimensions and position
   */
  static updateBoxGeometry(
    boxes: Box[],
    boxId: string,
    x: number,
    y: number,
    w: number,
    h: number
  ): Box[] {
    return BoxStateUtils.updateBox(boxes, boxId, { x, y, w, h });
  }
}
