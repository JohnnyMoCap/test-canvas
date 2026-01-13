import { Box, getBoxId } from '../../../intefaces/boxes.interface';
import { Quadtree } from '../core/quadtree';
import { BoxUtils } from './box-utils';
import { CoordinateTransform } from './coordinate-transform';

/**
 * Utilities for managing spatial indexing with quadtree
 */
export class QuadtreeUtils {
  // Nametag estimation constants used for spatial indexing
  // These must match the actual nametag rendering bounds
  static readonly ESTIMATED_NAMETAG_WIDTH = 60;
  static readonly ESTIMATED_NAMETAG_HEIGHT = 20;

  /**
   * Rebuilds the quadtree from scratch with current boxes
   */
  static rebuildQuadtree(
    boxes: Box[],
    imageWidth: number,
    imageHeight: number,
    showNametags: boolean
  ): Quadtree<Box> | undefined {
    if (boxes.length === 0) {
      return undefined;
    }

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    const items = [];

    for (const raw of boxes) {
      const b = BoxUtils.normalizeBoxToWorld(raw, imageWidth, imageHeight);
      if (!b) continue;

      let aabb = CoordinateTransform.calculateRotatedAABB(b);

      // Include nametag estimate
      if (showNametags) {
        aabb = {
          x: aabb.x,
          y: aabb.y - QuadtreeUtils.ESTIMATED_NAMETAG_HEIGHT,
          w: Math.max(aabb.w, QuadtreeUtils.ESTIMATED_NAMETAG_WIDTH),
          h: aabb.h + QuadtreeUtils.ESTIMATED_NAMETAG_HEIGHT,
        };
      }

      items.push({ raw, aabb });

      minX = Math.min(minX, aabb.x);
      minY = Math.min(minY, aabb.y);
      maxX = Math.max(maxX, aabb.x + aabb.w);
      maxY = Math.max(maxY, aabb.y + aabb.h);
    }

    if (minX === Infinity) {
      return undefined;
    }

    const quadtree = new Quadtree<Box>(minX, minY, maxX - minX, maxY - minY, 8);

    for (const item of items) {
      quadtree.insert({
        x: item.aabb.x,
        y: item.aabb.y,
        w: item.aabb.w,
        h: item.aabb.h,
        payload: item.raw,
      });
    }

    return quadtree;
  }

  /**
   * Queries visible boxes with fallback during interactions
   */
  static queryVisible(
    boxes: Box[],
    quadtree: Quadtree<Box> | undefined,
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
    isDraggingOrInteracting: boolean,
    imageWidth: number,
    imageHeight: number,
    showNametags: boolean
  ): Box[] {
    let results: Box[];

    // During drag/resize/rotate, quadtree is stale - use all boxes instead
    if (isDraggingOrInteracting || !quadtree) {
      results = boxes.filter((raw) => {
        const b = BoxUtils.normalizeBoxToWorld(raw, imageWidth, imageHeight);
        if (!b) return false;

        // Calculate AABB with rotation (same logic as quadtree build)
        let aabb = CoordinateTransform.calculateRotatedAABB(b);

        // Include nametag bounds to match quadtree behavior
        if (showNametags) {
          aabb = {
            x: aabb.x,
            y: aabb.y - QuadtreeUtils.ESTIMATED_NAMETAG_HEIGHT,
            w: Math.max(aabb.w, QuadtreeUtils.ESTIMATED_NAMETAG_WIDTH),
            h: aabb.h + QuadtreeUtils.ESTIMATED_NAMETAG_HEIGHT,
          };
        }

        // Check if AABB intersects with view bounds
        return !(
          aabb.x + aabb.w < bounds.minX ||
          aabb.x > bounds.maxX ||
          aabb.y + aabb.h < bounds.minY ||
          aabb.y > bounds.maxY
        );
      });
    } else {
      results = quadtree.queryRange(
        bounds.minX,
        bounds.minY,
        bounds.maxX - bounds.minX,
        bounds.maxY - bounds.minY
      ) as Box[];
    }

    // Deduplicate and maintain consistent order
    const uniqueBoxes = new Map<string | number, Box>();
    for (const box of results) {
      uniqueBoxes.set(getBoxId(box), box);
    }

    // Return in original array order for consistency
    return boxes.filter((box) => uniqueBoxes.has(getBoxId(box)));
  }
}
