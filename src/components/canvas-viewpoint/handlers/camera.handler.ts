import { Camera } from '../core/types';
import { CameraUtils } from '../utils/camera-utils';

/**
 * Handler for camera operations (pan, zoom)
 * Layer 3: Business Logic
 */
export class CameraHandler {
  /**
   * Start camera pan
   */
  static startPan(x: number, y: number): { x: number; y: number } {
    return { x, y };
  }

  /**
   * Perform camera pan
   */
  static pan(
    dx: number,
    dy: number,
    camera: Camera,
    canvasWidth: number,
    canvasHeight: number,
    imageWidth: number,
    imageHeight: number,
    minZoom: number,
  ): Camera {
    const newCamera: Camera = {
      ...camera,
      x: camera.x - dx / camera.zoom,
      y: camera.y - dy / camera.zoom,
    };

    return CameraUtils.clampCamera(
      newCamera,
      canvasWidth,
      canvasHeight,
      imageWidth,
      imageHeight,
      minZoom,
    );
  }

  /**
   * Perform camera zoom
   */
  static zoom(
    delta: number,
    absX: number,
    absY: number,
    camera: Camera,
    canvasWidth: number,
    canvasHeight: number,
    imageWidth: number,
    imageHeight: number,
    minZoom: number,
    maxZoom: number = 10,
  ): Camera {
    const zoomSpeed = 0.001;
    const zoomFactor = Math.exp(-delta * zoomSpeed);
    const newZoom = Math.max(minZoom, Math.min(maxZoom, camera.zoom * zoomFactor));

    // Calculate new camera position to zoom towards world point
    const dx = absX - camera.x;
    const dy = absY - camera.y;

    // When zooming in (newZoom > camera.zoom), we want to move camera towards the point
    // scale should be positive and < 1 when zooming in
    const scale = 1 - camera.zoom / newZoom;
    const newX = camera.x + dx * scale;
    const newY = camera.y + dy * scale;

    const newCamera: Camera = {
      ...camera,
      x: newX,
      y: newY,
      zoom: newZoom,
    };

    return CameraUtils.clampCamera(
      newCamera,
      canvasWidth,
      canvasHeight,
      imageWidth,
      imageHeight,
      minZoom,
    );
  }

  /**
   * Calculate minimum zoom for canvas
   */
  static calculateMinZoom(
    canvasWidth: number,
    canvasHeight: number,
    imageWidth: number,
    imageHeight: number,
  ): number {
    return CameraUtils.calculateMinZoom(canvasWidth, canvasHeight, imageWidth, imageHeight);
  }
}
