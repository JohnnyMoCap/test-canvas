import { Camera, MeasurementPoint, MeasurementState } from '../core/types';
import { CoordinateTransform } from './coordinate-transform';
import { MeasurementUtils } from './measurement-utils';

/**
 * Rendering utilities for measurement tool
 * Layer 4: Pure utility functions
 */
export class MeasurementRenderUtils {
  /**
   * Render measurement points and line
   */
  static render(
    ctx: CanvasRenderingContext2D,
    state: MeasurementState,
    camera: Camera,
    canvasWidth: number,
    canvasHeight: number,
    imageWidth: number,
    imageHeight: number,
    currentMouseWorld: MeasurementPoint | null,
  ): void {
    if (!state.isActive) return;

    const pointOne = state.pointOne;
    const pointTwo = state.pointTwo;

    // Draw line from point one to cursor (if point one exists but not point two)
    if (pointOne && !pointTwo && currentMouseWorld) {
      this.renderLine(ctx, pointOne, currentMouseWorld, camera, canvasWidth, canvasHeight, true);
      this.renderDistance(
        ctx,
        pointOne,
        currentMouseWorld,
        camera,
        canvasWidth,
        canvasHeight,
        imageWidth,
        imageHeight,
        state.metricWidth,
        state.metricHeight,
      );
    }

    // Draw line between two points (if both exist)
    if (pointOne && pointTwo) {
      this.renderLine(ctx, pointOne, pointTwo, camera, canvasWidth, canvasHeight, false);
      this.renderDistance(
        ctx,
        pointOne,
        pointTwo,
        camera,
        canvasWidth,
        canvasHeight,
        imageWidth,
        imageHeight,
        state.metricWidth,
        state.metricHeight,
      );
    }

    // Draw points
    if (pointOne) {
      this.renderPoint(ctx, pointOne, camera, canvasWidth, canvasHeight, '#FF4444');
    }
    if (pointTwo) {
      this.renderPoint(ctx, pointTwo, camera, canvasWidth, canvasHeight, '#4444FF');
    }
  }

  /**
   * Render a line between two points
   */
  private static renderLine(
    ctx: CanvasRenderingContext2D,
    p1: MeasurementPoint,
    p2: MeasurementPoint,
    camera: Camera,
    canvasWidth: number,
    canvasHeight: number,
    dashed: boolean,
  ): void {
    const screen1 = CoordinateTransform.worldToScreen(
      p1.x,
      p1.y,
      canvasWidth,
      canvasHeight,
      camera,
    );
    const screen2 = CoordinateTransform.worldToScreen(
      p2.x,
      p2.y,
      canvasWidth,
      canvasHeight,
      camera,
    );

    ctx.save();
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 2;

    if (dashed) {
      ctx.setLineDash([10, 5]);
    }

    ctx.beginPath();
    ctx.moveTo(screen1.x, screen1.y);
    ctx.lineTo(screen2.x, screen2.y);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Render a measurement point
   */
  private static renderPoint(
    ctx: CanvasRenderingContext2D,
    point: MeasurementPoint,
    camera: Camera,
    canvasWidth: number,
    canvasHeight: number,
    color: string,
  ): void {
    const screen = CoordinateTransform.worldToScreen(
      point.x,
      point.y,
      canvasWidth,
      canvasHeight,
      camera,
    );

    ctx.save();

    // Outer circle (border)
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 8, 0, Math.PI * 2);
    ctx.fill();

    // Inner circle (colored)
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * Render distance text at the midpoint of the line
   */
  private static renderDistance(
    ctx: CanvasRenderingContext2D,
    p1: MeasurementPoint,
    p2: MeasurementPoint,
    camera: Camera,
    canvasWidth: number,
    canvasHeight: number,
    imageWidth: number,
    imageHeight: number,
    metricWidth: number,
    metricHeight: number,
  ): void {
    const midpoint = MeasurementUtils.getMidpoint(p1, p2);
    const screen = CoordinateTransform.worldToScreen(
      midpoint.x,
      midpoint.y,
      canvasWidth,
      canvasHeight,
      camera,
    );

    // Calculate distance
    const canvasDistance = MeasurementUtils.calculateDistance(p1, p2);
    const metricDistance = MeasurementUtils.calculateMetricDistance(
      canvasDistance,
      imageWidth,
      imageHeight,
      metricWidth,
      metricHeight,
    );

    const text = MeasurementUtils.formatDistance(metricDistance);

    ctx.save();
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Measure text
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = 20;

    // Draw background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(
      screen.x - textWidth / 2 - 8,
      screen.y - textHeight / 2 - 4,
      textWidth + 16,
      textHeight + 8,
    );

    // Draw text
    ctx.fillStyle = '#00FF00';
    ctx.fillText(text, screen.x, screen.y);

    ctx.restore();
  }
}
