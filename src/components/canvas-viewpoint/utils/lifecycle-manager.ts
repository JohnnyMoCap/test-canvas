import { Signal, WritableSignal } from '@angular/core';
import { Quadtree } from '../core/quadtree';
import { Box } from '../../../intefaces/boxes.interface';
import { Camera } from '../core/types';
import { QuadtreeUtils } from './quadtree-utils';
import { PerformanceConfig } from '../core/performance-config';

/**
 * Manages component lifecycle operations including render loop and frame scheduling
 */
export class LifecycleManager {
  /**
   * Start the render loop
   */
  static startRenderLoop(
    rafRef: { value: number },
    lastFrameTimeRef: { value: number },
    dirtySignal: Signal<boolean>,
    renderCallback: () => void,
  ): void {
    const loop = (currentTime: number) => {
      rafRef.value = requestAnimationFrame(loop);

      // Frame rate limiting
      const elapsed = currentTime - lastFrameTimeRef.value;
      if (elapsed < PerformanceConfig.FRAME_TIME) return;

      lastFrameTimeRef.value = currentTime - (elapsed % PerformanceConfig.FRAME_TIME);

      if (!dirtySignal()) return;
      renderCallback();
    };
    rafRef.value = requestAnimationFrame(loop);
  }

  /**
   * Stop the render loop
   */
  static stopRenderLoop(raf: number): void {
    cancelAnimationFrame(raf);
  }

  /**
   * Setup resize observer for canvas
   */
  static setupPageResizeObserver(element: HTMLElement, onResize: () => void): ResizeObserver {
    const ro = new ResizeObserver(onResize);
    ro.observe(element);
    return ro;
  }

  /**
   * Initialize canvas context
   */
  static initializeCanvas(
    canvas: HTMLCanvasElement,
    devicePixelRatio: number,
  ): CanvasRenderingContext2D {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context not supported');
    ctx.imageSmoothingEnabled = false;
    return ctx;
  }

  /**
   * Rebuild quadtree index
   */
  static rebuildIndex(
    boxes: Box[],
    bgCanvas: HTMLCanvasElement | undefined,
    showNametags: boolean,
  ): Quadtree<Box> | undefined {
    if (!bgCanvas) return undefined;

    return QuadtreeUtils.rebuildQuadtree(boxes, bgCanvas.width, bgCanvas.height, showNametags);
  }
}
