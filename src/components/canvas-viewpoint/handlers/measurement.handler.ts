import { MeasurementPoint, MeasurementState, Camera } from '../core/types';
import { MeasurementUtils } from '../utils/measurement-utils';
import { StateManager } from '../utils/state-manager';

/**
 * Handler for measurement tool interactions
 * Layer 3: Business Logic Handler
 */
export class MeasurementHandler {
  /**
   * Handle pointer down in measurement mode
   * Returns true if the event was handled
   */
  static handlePointerDown(
    worldPos: MeasurementPoint,
    camera: Camera,
    state: StateManager,
  ): boolean {
    const measurementState = state.measurementState();
    if (!measurementState.isActive) return false;

    const pointOne = measurementState.pointOne;
    const pointTwo = measurementState.pointTwo;

    // Calculate hit detection threshold - use a fixed world-space size that represents ~15 pixels on screen
    // This ensures consistent clicking regardless of zoom level
    const hitThreshold = 15 / camera.zoom;

    // Check if clicking on point two (higher priority)
    if (pointTwo && MeasurementUtils.isPointNear(worldPos, pointTwo, hitThreshold)) {
      state.updateMeasurementState({
        ...measurementState,
        isDraggingPoint: 'two',
      });
      return true;
    }

    // Check if clicking on point one
    if (pointOne && MeasurementUtils.isPointNear(worldPos, pointOne, hitThreshold)) {
      state.updateMeasurementState({
        ...measurementState,
        isDraggingPoint: 'one',
      });
      return true;
    }

    // If both points exist and clicking away from them, clear all points
    if (pointOne && pointTwo) {
      state.updateMeasurementState(MeasurementUtils.resetPoints(measurementState));
      return true;
    }

    // If only point one exists, set point two
    if (pointOne && !pointTwo) {
      state.updateMeasurementState(MeasurementUtils.setPointTwo(measurementState, worldPos));
      return true;
    }

    // If no points exist, set point one
    state.updateMeasurementState(MeasurementUtils.setPointOne(measurementState, worldPos));
    return true;
  }

  /**
   * Handle pointer move in measurement mode
   */
  static handlePointerMove(worldPos: MeasurementPoint, state: StateManager): boolean {
    const measurementState = state.measurementState();
    if (!measurementState.isActive) return false;

    const draggingPoint = measurementState.isDraggingPoint;

    // If dragging a point, update its position
    if (draggingPoint === 'one') {
      state.updateMeasurementState({
        ...measurementState,
        pointOne: worldPos,
      });
      return true;
    }

    if (draggingPoint === 'two') {
      state.updateMeasurementState({
        ...measurementState,
        pointTwo: worldPos,
      });
      return true;
    }

    return false;
  }

  /**
   * Handle pointer up in measurement mode
   */
  static handlePointerUp(state: StateManager): boolean {
    const measurementState = state.measurementState();
    if (!measurementState.isActive) return false;

    // Stop dragging any point
    if (measurementState.isDraggingPoint) {
      state.updateMeasurementState({
        ...measurementState,
        isDraggingPoint: null,
      });
      return true;
    }

    return false;
  }

  /**
   * Get cursor style for measurement mode
   */
  static getCursorStyle(
    worldPos: MeasurementPoint | null,
    camera: Camera,
    state: StateManager,
  ): string {
    const measurementState = state.measurementState();
    if (!measurementState.isActive || !worldPos) return 'crosshair';

    const pointOne = measurementState.pointOne;
    const pointTwo = measurementState.pointTwo;
    const hitThreshold = 15 / camera.zoom;

    // Check if hovering over a point
    if (pointTwo && MeasurementUtils.isPointNear(worldPos, pointTwo, hitThreshold)) {
      return 'move';
    }

    if (pointOne && MeasurementUtils.isPointNear(worldPos, pointOne, hitThreshold)) {
      return 'move';
    }

    return 'crosshair';
  }

  /**
   * Toggle measurement mode on/off
   */
  static toggleMeasurementMode(state: StateManager): void {
    const measurementState = state.measurementState();

    if (measurementState.isActive) {
      state.updateMeasurementState(MeasurementUtils.deactivate(measurementState));
    } else {
      state.updateMeasurementState(MeasurementUtils.activate(measurementState));
    }
  }

  /**
   * Update metric dimensions
   */
  static updateMetricDimensions(width: number, height: number, state: StateManager): void {
    const measurementState = state.measurementState();
    state.updateMeasurementState(
      MeasurementUtils.updateMetricDimensions(measurementState, width, height),
    );
  }
}
