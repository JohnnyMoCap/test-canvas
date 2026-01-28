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

/**
 * Geometric properties of a box in world space
 * ONLY contains spatial data - no metadata, no styling, no business logic properties
 * Used for purely geometric calculations (hit detection, transformations, etc.)
 */
export interface WorldBoxGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

/**
 * Complete world box with all metadata
 * Extends WorldBoxGeometry and adds all non-geometric properties
 * Used for rendering and operations that need access to the original box data
 *
 * Future properties may include:
 * - ML classification data
 * - Ownership/permission data
 * - Real-world measurement metrics
 * - Custom metadata
 */
export interface WorldBox extends WorldBoxGeometry {
  raw: import('../../../intefaces/boxes.interface').Box;
  color: string;
}
