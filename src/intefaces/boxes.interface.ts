interface BoxBase {
  x: number; // normalized 0–1
  y: number; // normalized 0–1
  w: number; // normalized 0–1 (relative to bg width)
  h: number; // normalized 0–1 (relative to bg height)
  rotation?: number; // Rotation in degrees
  color?: string;
}
export type Box =
  | (BoxBase & { id: number; tempId?: never }) // Only set when saved to database
  | (BoxBase & { tempId: number; id?: never }); // Set for newly created boxes before saving

/**
 * Gets the identifier for a box (id if saved, tempId if new)
 */
export function getBoxId(box: Box): number {
  if (box.id !== undefined) return box.id;
  if (box.tempId !== undefined) return box.tempId;
  throw new Error(`Box is missing both id and tempId: ${JSON.stringify(box)}`);
}
