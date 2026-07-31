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
   * Perform camera zoom from a wheel delta, anchored on a world point.
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
    return this.zoomTo(
      camera.zoom * zoomFactor,
      absX,
      absY,
      camera,
      canvasWidth,
      canvasHeight,
      imageWidth,
      imageHeight,
      minZoom,
      maxZoom,
    );
  }

  /**
   * Perform camera zoom from a multiplicative ratio (e.g. pinch distance
   * change), anchored on a world point. Shares the same anchor math as
   * `zoom()` so wheel-zoom and pinch-zoom can never drift apart.
   */
  static zoomByRatio(
    ratio: number,
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
    return this.zoomTo(
      camera.zoom * ratio,
      absX,
      absY,
      camera,
      canvasWidth,
      canvasHeight,
      imageWidth,
      imageHeight,
      minZoom,
      maxZoom,
    );
  }

  /**
   * Moves the camera to `targetZoom` (clamped to `[minZoom, maxZoom]`) while
   * keeping the world point `(absX, absY)` visually fixed on screen.
   */
  private static zoomTo(
    targetZoom: number,
    absX: number,
    absY: number,
    camera: Camera,
    canvasWidth: number,
    canvasHeight: number,
    imageWidth: number,
    imageHeight: number,
    minZoom: number,
    maxZoom: number,
  ): Camera {
    const newZoom = Math.max(minZoom, Math.min(maxZoom, targetZoom));

    // When zooming in (newZoom > camera.zoom), we want to move camera towards the point
    // scale should be positive and < 1 when zooming in
    const dx = absX - camera.x;
    const dy = absY - camera.y;
    const scale = 1 - camera.zoom / newZoom;

    const newCamera: Camera = {
      ...camera,
      x: camera.x + dx * scale,
      y: camera.y + dy * scale,
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
