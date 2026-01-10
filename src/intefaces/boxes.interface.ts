export interface Box {
  id?: number; // Only set when saved to database
  tempId?: string; // Set for newly created boxes before saving
  x: number; // normalized 0–1
  y: number; // normalized 0–1
  w: number; // normalized 0–1 (relative to bg width)
  h: number; // normalized 0–1 (relative to bg height)
  rotation?: number;
  color?: string;
}

/**
 * Gets the identifier for a box (id if saved, tempId if new)
 */
export function getBoxId(box: Box): string | number {
  return box.id !== undefined ? box.id : box.tempId!;
}
