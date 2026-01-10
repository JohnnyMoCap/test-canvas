/**
 * Camera state and configuration
 */
export interface Camera {
  zoom: number;
  x: number;
  y: number;
  rotation: number;
}

/**
 * 2D point in world space
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Bounding box (AABB)
 */
export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Corner identifiers for resize operations
 */
export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

/**
 * Text metrics cache entry
 */
export interface TextMetrics {
  width: number;
  height: number;
}
