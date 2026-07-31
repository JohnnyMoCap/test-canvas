import { computeRotationPCA } from './pca';

export interface MaskBoxResult {
  /** AXIS-ALIGNED bounding box of the mask's "on" pixels (top-left origin). Only matches the region's true tight bounds when `rotation` is 0 - see `centerX`/`centerY`/`width`/`height` for the rotated case. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Best-fit rotation of the masked region (radians), via PCA on its "on" pixels. */
  rotation: number;
  /**
   * Center of a TIGHT bounding box measured along the region's own rotated
   * axes, not the world axes - see `FloodFillResult.centerX` in
   * `flood-fill.ts` for the identical reasoning (reusing the axis-aligned
   * box's width/height next to a non-zero rotation over-sizes and
   * misaligns the drawn box).
   */
  centerX: number;
  centerY: number;
  /** Width/height of the tight oriented bounding box - see `centerX`/`centerY`. */
  width: number;
  height: number;
  pixelCount: number;
}

/**
 * Walks a row-major boolean mask (0/1 per byte) to compute its bounding box
 * and PCA rotation - the same running-sums trick `flood-fill.ts` and
 * `connected-components.ts` use, applied to a mask that already exists
 * (from a model) instead of one built pixel-by-pixel via BFS. A second pass
 * then finds the tight bounding box along the region's own rotated axes
 * (see `MaskBoxResult.centerX`).
 * Returns null if the mask has no "on" pixels at all.
 */
export function maskToBox(mask: Uint8Array, width: number, height: number): MaskBoxResult | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let pixelCount = 0;
  let sumX = 0,
    sumY = 0,
    sumXX = 0,
    sumXY = 0,
    sumYY = 0;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!mask[row + x]) continue;

      pixelCount++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sumX += x;
      sumY += y;
      sumXX += x * x;
      sumXY += x * y;
      sumYY += y * y;
    }
  }

  if (pixelCount === 0) return null;

  const rotation = computeRotationPCA(pixelCount, sumX, sumY, sumXX, sumXY, sumYY);
  const oriented = computeOrientedBounds(mask, width, height, rotation, sumX / pixelCount, sumY / pixelCount);

  return {
    minX,
    minY,
    maxX,
    maxY,
    rotation,
    centerX: oriented.centerX,
    centerY: oriented.centerY,
    width: oriented.width,
    height: oriented.height,
    pixelCount,
  };
}

/** Same oriented-bounds computation as `flood-fill.ts`'s `computeOrientedBounds` - re-walks the mask's "on" pixels in the region's own rotated axes instead of the world axes. */
function computeOrientedBounds(
  mask: Uint8Array,
  width: number,
  height: number,
  rotation: number,
  meanX: number,
  meanY: number,
): { centerX: number; centerY: number; width: number; height: number } {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!mask[row + x]) continue;

      const dx = x - meanX;
      const dy = y - meanY;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }

  const localCenterU = (minU + maxU) / 2;
  const localCenterV = (minV + maxV) / 2;

  return {
    centerX: meanX + localCenterU * cos - localCenterV * sin,
    centerY: meanY + localCenterU * sin + localCenterV * cos,
    width: maxU - minU + 1,
    height: maxV - minV + 1,
  };
}
