import { Box, getBoxId } from '../../../intefaces/boxes.interface';
import { BoxUtils } from './box-utils';
import { NametagUtils } from './nametag-utils';
import { CoordinateTransform } from './coordinate-transform';
import { Camera, TextMetrics } from '../core/types';
import { Quadtree } from '../core/quadtree';

/**
 * Hover detection utilities
 */
export class HoverDetectionUtils {
  /**
   * Detects which box (if any) is under the cursor
   */
  static detectHoveredBox(
    wx: number,
    wy: number,
    boxes: Box[],
    quadtree: Quadtree<Box> | undefined,
    imageWidth: number,
    imageHeight: number,
    camera: Camera,
    showNametags: boolean,
    nametagMetricsCache: Map<string, TextMetrics>,
    ctx: CanvasRenderingContext2D | undefined
  ): string | null {
    const candidates = quadtree ? (quadtree.queryRange(wx - 1, wy - 1, 2, 2) as Box[]) : boxes;

    for (let i = candidates.length - 1; i >= 0; i--) {
      const rawBox = candidates[i];
      const worldBox = BoxUtils.normalizeBoxToWorld(rawBox, imageWidth, imageHeight);
      if (!worldBox) continue;

      if (
        showNametags &&
        NametagUtils.pointInNametag(wx, wy, worldBox, camera, nametagMetricsCache, ctx)
      ) {
        return String(getBoxId(rawBox));
      }

      if (CoordinateTransform.pointInBox(wx, wy, worldBox)) {
        return String(getBoxId(rawBox));
      }
    }

    return null;
  }
}
