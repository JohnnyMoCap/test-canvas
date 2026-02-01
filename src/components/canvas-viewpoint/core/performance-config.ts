/**
 * Performance configuration constants
 */
export class PerformanceConfig {
  static readonly TARGET_FPS = 60; //TODO: 30fps looks ugly af but maybe make it a env var for customers with cheap laptops?
  static readonly FRAME_TIME = 1000 / PerformanceConfig.TARGET_FPS; // 16.67ms for 60fps
}
