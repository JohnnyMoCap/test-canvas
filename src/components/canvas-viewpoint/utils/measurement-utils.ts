import { MeasurementPoint, MeasurementState } from '../core/types';

/**
 * Measurement tool utilities for calculating and managing measurements
 * Layer 4: Pure utility functions
 */
export class MeasurementUtils {
  /**
   * Calculate the Euclidean distance between two points
   */
  static calculateDistance(p1: MeasurementPoint, p2: MeasurementPoint): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Calculate metric distance based on canvas distance and image dimensions
   * @param canvasDistance - Distance in world coordinates (same scale as image pixels)
   * @param imageWidth - Width of the background image in pixels
   * @param imageHeight - Height of the background image in pixels
   * @param metricWidth - Real-world width in meters
   * @param metricHeight - Real-world height in meters
   * @returns Distance in meters
   */
  static calculateMetricDistance(
    canvasDistance: number,
    imageWidth: number,
    imageHeight: number,
    metricWidth: number,
    metricHeight: number,
  ): number {
    // Calculate pixels per meter ratio
    // Assuming the image represents the full metric dimensions
    const pixelsPerMeterX = imageWidth / metricWidth;
    const pixelsPerMeterY = imageHeight / metricHeight;

    // Use average of both dimensions for diagonal measurements
    const avgPixelsPerMeter = (pixelsPerMeterX + pixelsPerMeterY) / 2;

    // Convert world distance to meters
    // World coordinates are at the same scale as image pixels (at zoom=1)
    return canvasDistance / avgPixelsPerMeter;
  }

  /**
   * Format distance for display
   */
  static formatDistance(meters: number): string {
    if (meters < 1) {
      return `${(meters * 100).toFixed(1)} cm`;
    } else if (meters < 1000) {
      return `${meters.toFixed(2)} m`;
    } else {
      return `${(meters / 1000).toFixed(2)} km`;
    }
  }

  /**
   * Calculate the midpoint between two points
   */
  static getMidpoint(p1: MeasurementPoint, p2: MeasurementPoint): MeasurementPoint {
    return {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2,
    };
  }

  /**
   * Check if a point is near another point (for hit detection)
   * @param point - Point to check
   * @param target - Target point
   * @param threshold - Distance threshold in world coordinates
   */
  static isPointNear(
    point: MeasurementPoint,
    target: MeasurementPoint,
    threshold: number,
  ): boolean {
    const distance = this.calculateDistance(point, target);
    return distance <= threshold;
  }

  /**
   * Create initial measurement state
   */
  static createInitialState(metricWidth: number = 10, metricHeight: number = 10): MeasurementState {
    return {
      isActive: false,
      pointOne: null,
      pointTwo: null,
      isDraggingPoint: null,
      metricWidth,
      metricHeight,
    };
  }

  /**
   * Reset measurement points
   */
  static resetPoints(state: MeasurementState): MeasurementState {
    return {
      ...state,
      pointOne: null,
      pointTwo: null,
      isDraggingPoint: null,
    };
  }

  /**
   * Set point one
   */
  static setPointOne(state: MeasurementState, point: MeasurementPoint): MeasurementState {
    return {
      ...state,
      pointOne: point,
      pointTwo: null,
      isDraggingPoint: null,
    };
  }

  /**
   * Set point two
   */
  static setPointTwo(state: MeasurementState, point: MeasurementPoint): MeasurementState {
    return {
      ...state,
      pointTwo: point,
    };
  }

  /**
   * Update metric dimensions
   */
  static updateMetricDimensions(
    state: MeasurementState,
    width: number,
    height: number,
  ): MeasurementState {
    return {
      ...state,
      metricWidth: Math.max(0.1, width),
      metricHeight: Math.max(0.1, height),
    };
  }

  /**
   * Activate measurement tool
   */
  static activate(state: MeasurementState): MeasurementState {
    return {
      ...state,
      isActive: true,
    };
  }

  /**
   * Deactivate measurement tool and clear all points
   */
  static deactivate(state: MeasurementState): MeasurementState {
    return {
      ...state,
      isActive: false,
      pointOne: null,
      pointTwo: null,
      isDraggingPoint: null,
    };
  }
}
