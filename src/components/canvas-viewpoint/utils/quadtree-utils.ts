import { Box, getBoxId } from '../../../intefaces/boxes.interface';
import { Quadtree } from '../core/quadtree';
import { BoxUtils } from './box-utils';
import { CoordinateTransform } from './coordinate-transform';

/**
 * Utilities for managing spatial indexing with quadtree
 */
export class QuadtreeUtils {
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
        const estimatedTagWidth = 60;
        const estimatedTagHeight = 20;
        aabb = {
          x: aabb.x,
          y: aabb.y - estimatedTagHeight,
          w: Math.max(aabb.w, aabb.w + estimatedTagWidth),
          h: aabb.h + estimatedTagHeight,
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
    imageHeight: number
  ): Box[] {
    let results: Box[];

    // During drag/resize/rotate, quadtree is stale - use all boxes instead
    if (isDraggingOrInteracting || !quadtree) {
      results = boxes.filter((raw) => {
        const wb = BoxUtils.normalizeBoxToWorld(raw, imageWidth, imageHeight);
        if (!wb) return false;
        const halfW = wb.w / 2,
          halfH = wb.h / 2;
        return !(
          wb.x + halfW < bounds.minX ||
          wb.x - halfW > bounds.maxX ||
          wb.y + halfH < bounds.minY ||
          wb.y - halfH > bounds.maxY
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

    // Deduplicate
    const uniqueBoxes = new Map<string | number, Box>();
    for (const box of results) {
      uniqueBoxes.set(getBoxId(box), box);
    }
    return Array.from(uniqueBoxes.values());
  }
}
