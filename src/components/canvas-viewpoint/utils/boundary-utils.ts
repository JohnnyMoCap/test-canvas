import { Box } from '../../../interface/boxes.interface';
import { BoxUtils } from './box-utils';

/**
 * Utilities for boundary constraint checking and clamping.
 *
 * A box is allowed to have at most ONE of its 4 corners outside the canvas
 * two or more is not allowed.
 */
export class BoundaryUtils {
  /** True if at most one of the box's 4 (rotation-aware) corners falls outside the canvas. */
  static isBoxWithinBounds(box: Box, imageWidth: number, imageHeight: number): boolean {
    const AbsoluteBox = BoxUtils.normalizeBoxToAbsolute(box, imageWidth, imageHeight);
    if (!AbsoluteBox) return false;

    return this.countCornersOutOfBounds(AbsoluteBox, imageWidth, imageHeight) <= 1;
  }

  /**
   * Clamp a box position to stay within canvas bounds.
   * No-ops if the box already satisfies the "at most one corner out" rule.
   *
   * Otherwise, finds the closest valid position by trying each of the box's
   * 4 corners in turn as "the one allowed to stay out" and requiring the
   * other 3 to land fully inside. For a fixed shape/rotation, "these 3
   * corners in bounds" reduces to an independent x-range and y-range (each
   * corner's own containment is itself an x-range and a y-range, and
   * intersecting 3 of them is still just an x-range and a y-range), so the
   * closest point for a given privileged corner is a plain
   * point-in-rectangle clamp, not a search.
   *
   * `previousBox` (the box's position just before this move/resize, when
   * available) is used to keep privileging the SAME corner across a
   * continuous drag whenever that's still a valid choice, rather than
   * re-picking the globally nearest corner fresh every frame. That
   * re-picking is what caused a visible jump near a canvas CORNER: dragged
   * far enough past a corner, two DIFFERENT single-corner corrections can
   * sit almost equidistant from the cursor, and an infinitesimal mouse
   * movement can flip which one is nearest - even though the two
   * corrections themselves can be far apart. Sticking with whichever corner
   * was already privileged avoids re-deciding into a distant alternative
   * mid-drag; a fresh nearest-corner search only happens when there's no
   * established corner to stick with (drag just started) or it's no longer
   * a feasible choice.
   */
  static clampBoxToBounds(
    box: Box,
    imageWidth: number,
    imageHeight: number,
    previousBox?: Box,
  ): Box {
    const AbsoluteBox = BoxUtils.normalizeBoxToAbsolute(box, imageWidth, imageHeight);
    if (!AbsoluteBox) return box;

    if (this.countCornersOutOfBounds(AbsoluteBox, imageWidth, imageHeight) <= 1) {
      return box;
    }

    const canvasMinX = -imageWidth / 2;
    const canvasMaxX = imageWidth / 2;
    const canvasMinY = -imageHeight / 2;
    const canvasMaxY = imageHeight / 2;

    const offsets = this.cornerOffsets(AbsoluteBox);

    const evaluate = (privileged: number): { x: number; y: number; distance: number } | null => {
      let xLo = canvasMinX;
      let xHi = canvasMaxX;
      let yLo = canvasMinY;
      let yHi = canvasMaxY;

      for (let i = 0; i < offsets.length; i++) {
        if (i === privileged) continue;
        xLo = Math.max(xLo, canvasMinX - offsets[i].dx);
        xHi = Math.min(xHi, canvasMaxX - offsets[i].dx);
        yLo = Math.max(yLo, canvasMinY - offsets[i].dy);
        yHi = Math.min(yHi, canvasMaxY - offsets[i].dy);
      }

      // Infeasible for this box's shape/rotation (its AABB alone is wider or
      // taller than the canvas) - no position satisfies "these 3 in bounds."
      if (xLo > xHi || yLo > yHi) return null;

      const x = Math.min(Math.max(AbsoluteBox.x, xLo), xHi);
      const y = Math.min(Math.max(AbsoluteBox.y, yLo), yHi);
      return { x, y, distance: Math.hypot(x - AbsoluteBox.x, y - AbsoluteBox.y) };
    };

    const stickyCorner = previousBox ? this.findSoleOutCorner(previousBox, imageWidth, imageHeight) : -1;
    let chosen = stickyCorner >= 0 ? evaluate(stickyCorner) : null;

    if (!chosen) {
      let best: { x: number; y: number; distance: number } | null = null;
      for (let privileged = 0; privileged < offsets.length; privileged++) {
        const candidate = evaluate(privileged);
        if (candidate && (!best || candidate.distance < best.distance)) {
          best = candidate;
        }
      }
      // best is only null if the box's own AABB exceeds the canvas in some
      // dimension for every choice of privileged corner - clamp onto the
      // canvas centre as a last resort rather than returning an unmoved box.
      chosen = best ?? { x: 0, y: 0, distance: 0 };
    }

    const normalized = BoxUtils.absoluteToNormalized(chosen.x, chosen.y, imageWidth, imageHeight);

    return {
      ...box,
      x: normalized.x,
      y: normalized.y,
    };
  }

  /** The box's 4 corners as (dx, dy) offsets from its centre, accounting for rotation. */
  private static cornerOffsets(absBox: {
    w: number;
    h: number;
    rotation: number;
  }): { dx: number; dy: number }[] {
    const cos = Math.cos(absBox.rotation);
    const sin = Math.sin(absBox.rotation);
    const localCorners = [
      { lx: -absBox.w / 2, ly: -absBox.h / 2 },
      { lx: absBox.w / 2, ly: -absBox.h / 2 },
      { lx: -absBox.w / 2, ly: absBox.h / 2 },
      { lx: absBox.w / 2, ly: absBox.h / 2 },
    ];
    return localCorners.map((c) => ({
      dx: c.lx * cos - c.ly * sin,
      dy: c.lx * sin + c.ly * cos,
    }));
  }

  /** Index (0-3) of the box's sole out-of-bounds corner, or -1 if zero (or more than one) are out. */
  private static findSoleOutCorner(box: Box, imageWidth: number, imageHeight: number): number {
    const absBox = BoxUtils.normalizeBoxToAbsolute(box, imageWidth, imageHeight);
    if (!absBox) return -1;

    const canvasMinX = -imageWidth / 2;
    const canvasMaxX = imageWidth / 2;
    const canvasMinY = -imageHeight / 2;
    const canvasMaxY = imageHeight / 2;

    let outIndex = -1;
    let outCount = 0;
    const offsets = this.cornerOffsets(absBox);
    for (let i = 0; i < offsets.length; i++) {
      const x = absBox.x + offsets[i].dx;
      const y = absBox.y + offsets[i].dy;
      if (x < canvasMinX || x > canvasMaxX || y < canvasMinY || y > canvasMaxY) {
        outCount++;
        outIndex = i;
      }
    }
    return outCount === 1 ? outIndex : -1;
  }

  /** Counts how many of the box's 4 (rotation-aware) corners fall outside the canvas. */
  private static countCornersOutOfBounds(
    absBox: { x: number; y: number; w: number; h: number; rotation: number },
    imageWidth: number,
    imageHeight: number,
  ): number {
    const canvasMinX = -imageWidth / 2;
    const canvasMaxX = imageWidth / 2;
    const canvasMinY = -imageHeight / 2;
    const canvasMaxY = imageHeight / 2;

    let outCount = 0;
    for (const offset of this.cornerOffsets(absBox)) {
      const x = absBox.x + offset.dx;
      const y = absBox.y + offset.dy;
      if (x < canvasMinX || x > canvasMaxX || y < canvasMinY || y > canvasMaxY) {
        outCount++;
      }
    }
    return outCount;
  }
}
