export interface Box {
  id: number;
  x: number; // normalized 0–1
  y: number; // normalized 0–1
  w: number; // normalized 0–1 (relative to bg width)
  h: number; // normalized 0–1 (relative to bg height)
  rotation?: number;
  color?: string;
}
