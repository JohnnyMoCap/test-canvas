import { Signal, WritableSignal } from '@angular/core';
import { Quadtree } from '../core/quadtree';
import { Box } from '../../../inteface/boxes.interface';
import { QuadtreeUtils } from './quadtree-utils';
import { PerformanceConfig } from '../core/performance-config';

/**
 * Manages component lifecycle operations including render loop and frame scheduling
 */
export class LifecycleManager {
  /**
   * Starts the render loop and returns a stop function.
   *
   * Calling the returned function sets a `running` flag to false. The loop
   * checks this flag at the top of each tick and simply stops rescheduling
   * itself
   *
   */
  static startRenderLoop(dirtySignal: Signal<boolean>, renderCallback: () => void): () => void {
    // When set to false the loop stops rescheduling itself on the next tick.
    let running = true;
    let lastFrameTime = 0;

    const loop = (currentTime: number) => {
      if (!running) return;
      requestAnimationFrame(loop);

      // Cap at FRAME_TIME — skip the frame if not enough time has elapsed.
      if (currentTime - lastFrameTime < PerformanceConfig.FRAME_TIME) return;
      lastFrameTime = currentTime;

      // Only call into the render pipeline if something actually changed.
      // The dirty signal is set to true whenever state mutations occur.
      if (!dirtySignal()) return;

      renderCallback();
    };

    requestAnimationFrame(loop);

    // Return a stop function. The caller stores this and invokes it on destroy.
    return () => {
      running = false;
    };
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
