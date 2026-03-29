import { Box } from '../../../interface/boxes.interface';
import { HistoryService } from '../../../services/history.service';
import { LabelingStateManager } from '../utils/labeling-state-manager';
import { Quadtree } from './quadtree';

/**
 * Camera state and configuration
 */
export interface Camera {
  zoom: number;
  x: number;
  y: number;
}

/**
 * 2D point in absolute space
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
 * Geometric properties of a box in absolute space
 * ONLY contains spatial data - no metadata, no styling, no business logic properties
 * Used for purely geometric calculations (hit detection, transformations, etc.)
 */
export interface AbsoluteBoxGeometry {
  /**
   * X coordinate of the box's top-left corner in absolute space (pixels from image origin).
   * absolute space means coordinates relative to the background image, not the viewport.
   * Example: x=500 means 500 pixels from the left edge of the background image,
   * regardless of zoom level or camera pan position.
   */
  x: number;

  /**
   * Y coordinate of the box's top-left corner in absolute space (pixels from image origin).
   * absolute space means coordinates relative to the background image, not the viewport.
   * Example: y=300 means 300 pixels from the top edge of the background image.
   * Note: Increases downward (standard canvas coordinate system).
   */
  y: number;

  /**
   * Width of the box in absolute space pixels.
   * Represents the actual size on the background image, independent of viewport zoom.
   * Example: w=100 means the box is 100 pixels wide on the background image.
   * When zoomed in 2x, this still reads 100 but appears 200 pixels on screen.
   */
  w: number;

  /**
   * Height of the box in absolute space pixels.
   * Represents the actual size on the background image, independent of viewport zoom.
   * Example: h=80 means the box is 80 pixels tall on the background image.
   * Combined with width, defines the box's unrotated bounding rectangle.
   */
  h: number;

  /**
   * Rotation angle of the box around its center point, in radians (0 to 2π).
   * 0 = no rotation (box aligned with image axes)
   * π/2 = 90° clockwise rotation
   * π = 180° rotation (upside down)
   * 3π/2 = 270° clockwise (or 90° counter-clockwise)
   * Rotation is applied after positioning, so x/y still refer to the top-left
   * corner of the unrotated box.
   */
  rotation: number;
}

/**
 * Complete world box with all metadata
 * Extends AbsoluteBoxGeometry and adds all non-geometric properties
 * Used for rendering and operations that need access to the original box data
 *
 * Future properties may include:
 * - ML classification data
 * - Ownership/permission data
 * - Real-world measurement metrics
 * - Custom metadata
 */
export interface AbsoluteBox extends AbsoluteBoxGeometry {
  raw: import('../../../interface/boxes.interface').Box;
  color: string;
}

/**
 * Measurement point in absolute space
 */
export interface MeasurementPoint {
  x: number;
  y: number;
}

/**
 * Measurement state for the measurement tool
 */
export interface MeasurementState {
  isActive: boolean;
  pointOne: MeasurementPoint | null;
  pointTwo: MeasurementPoint | null;
  isDraggingPoint: 'one' | 'two' | null;
  metricWidth: number; // Real-world width in meters
  metricHeight: number; // Real-world height in meters
}

/**
 * Context object passed to all public PointerEventHandler methods.
 * Bundles the stable, per-component references that never change between events.
 */
export interface PointerHandlerContext {
  canvas: HTMLCanvasElement;
  state: LabelingStateManager;
  quadtree: Quadtree<Box> | undefined;
  nametagMetricsCache: Map<string, TextMetrics>;
  historyService: HistoryService;
}
