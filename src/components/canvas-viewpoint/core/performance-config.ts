/**
 * Performance configuration constants
 */
export class PerformanceConfig {
  static readonly TARGET_FPS = 60;
  static readonly FRAME_TIME = 1000 / PerformanceConfig.TARGET_FPS; // ~16.67ms for 60fps
}
