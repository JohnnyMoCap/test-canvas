import { CameraUtils } from './camera-utils';

// Toggle this to enable/disable mock loading delay
const MOCK_LOADING_DELAY = false;
const MOCK_DELAY_MS = 2000; // 2 seconds
const PLACEHOLDER_IMAGE = '/assets/photo-front-end-error.svg';

/**
 * Background image loading and management
 */
export class BackgroundUtils {
  /**
   * Loads a placeholder image immediately
   */
  static async loadPlaceholder(
    canvasWidth: number,
    canvasHeight: number,
  ): Promise<{
    canvas: HTMLCanvasElement;
    minZoom: number;
  }> {
    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => {
        const c = document.createElement('canvas');
        c.width = image.width;
        c.height = image.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(image, 0, 0);

        const minZoom = CameraUtils.calculateMinZoom(canvasWidth, canvasHeight, c.width, c.height);

        resolve({ canvas: c, minZoom });
      };

      image.onerror = (err) => reject(err);
      image.src = PLACEHOLDER_IMAGE;
    });
  }

  /**
   * Loads an image and creates an offscreen canvas
   */
  static async loadBackground(
    url: string,
    canvasWidth: number,
    canvasHeight: number,
  ): Promise<{
    canvas: HTMLCanvasElement;
    minZoom: number;
  }> {
    // Apply mock delay if enabled
    if (MOCK_LOADING_DELAY) {
      await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
    }

    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => {
        const c = document.createElement('canvas');
        c.width = image.width;
        c.height = image.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(image, 0, 0);

        const minZoom = CameraUtils.calculateMinZoom(canvasWidth, canvasHeight, c.width, c.height);

        resolve({ canvas: c, minZoom });
      };

      image.onerror = (err) => reject(err);
      image.src = url;
    });
  }

  /**
   * Recalculates minimum zoom on canvas resize
   */
  static recalculateMinZoom(
    canvasWidth: number,
    canvasHeight: number,
    bgWidth: number,
    bgHeight: number,
  ): number {
    return CameraUtils.calculateMinZoom(canvasWidth, canvasHeight, bgWidth, bgHeight);
  }
}
