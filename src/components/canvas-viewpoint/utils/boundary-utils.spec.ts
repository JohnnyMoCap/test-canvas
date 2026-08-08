import { describe, it, expect } from 'vitest';
import { BoundaryUtils } from './boundary-utils';
import { Box } from '../../../interface/boxes.interface';

// 100x100 image -> absolute canvas bounds are [-50, 50] x [-50, 50].
const IMAGE_SIZE = 100;

function makeBox(x: number, y: number, w: number, h: number, rotation = 0): Box {
  return { tempId: 1, x, y, w, h, rotation };
}

describe('BoundaryUtils', () => {
  it('is within bounds and unchanged when fully inside', () => {
    const box = makeBox(0.5, 0.5, 0.2, 0.2);

    expect(BoundaryUtils.isBoxWithinBounds(box, IMAGE_SIZE, IMAGE_SIZE)).toBe(true);
    expect(BoundaryUtils.clampBoxToBounds(box, IMAGE_SIZE, IMAGE_SIZE)).toEqual(box);
  });

  it('is within bounds and unchanged when exactly one corner is outside', () => {
    // A 10x10 box rotated 45deg becomes a diamond whose 4 vertices sit
    // ~7.07 units from its centre along a single axis each (up/right/left/down).
    // Centring it at (0, -45) pushes only the "up" vertex past y=-50.
    const box = makeBox(0.5, 0.05, 0.1, 0.1, Math.PI / 4);

    expect(BoundaryUtils.isBoxWithinBounds(box, IMAGE_SIZE, IMAGE_SIZE)).toBe(true);
    expect(BoundaryUtils.clampBoxToBounds(box, IMAGE_SIZE, IMAGE_SIZE)).toEqual(box);
  });

  it('is out of bounds and gets clamped when two corners are outside', () => {
    // Same diamond, centred near the canvas's top-right corner instead - now
    // both the "up" and "right" vertices cross their respective bounds.
    const box = makeBox(0.95, 0.05, 0.1, 0.1, Math.PI / 4);

    expect(BoundaryUtils.isBoxWithinBounds(box, IMAGE_SIZE, IMAGE_SIZE)).toBe(false);

    const clamped = BoundaryUtils.clampBoxToBounds(box, IMAGE_SIZE, IMAGE_SIZE);
    expect(clamped).not.toEqual(box);
    expect(BoundaryUtils.isBoxWithinBounds(clamped, IMAGE_SIZE, IMAGE_SIZE)).toBe(true);
  });

  it('stops right at the boundary instead of snapping all the way back to fully inside', () => {
    const box = makeBox(0.95, 0.05, 0.1, 0.1, Math.PI / 4);
    const clamped = BoundaryUtils.clampBoxToBounds(box, IMAGE_SIZE, IMAGE_SIZE);

    // Nudging a little further from the clamped result toward the original
    // (invalid) position should tip it back over into invalid - proving the
    // clamp stopped right at the boundary, not somewhere well short of it.
    const nudged = makeBox(
      clamped.x + (box.x - clamped.x) * 0.05,
      clamped.y + (box.y - clamped.y) * 0.05,
      box.w,
      box.h,
      box.rotation,
    );
    expect(BoundaryUtils.isBoxWithinBounds(nudged, IMAGE_SIZE, IMAGE_SIZE)).toBe(false);
  });

  it('near a canvas corner, clamps along a single axis rather than pulling back on both', () => {
    // Same diamond, centred near the canvas's bottom-right corner: the
    // "right" vertex breaches the right wall and the "bottom" vertex
    // breaches the bottom wall - two DIFFERENT corners, two DIFFERENT walls.
    // Clamping X alone (or Y alone) already resolves this to exactly one
    // corner out, and needs a ~2.07 unit move; clamping both axes together
    // (the old, over-eager behaviour) would move it ~2.93 units instead.
    const box = makeBox(0.95, 0.95, 0.1, 0.1, Math.PI / 4);
    expect(BoundaryUtils.isBoxWithinBounds(box, IMAGE_SIZE, IMAGE_SIZE)).toBe(false);

    const clamped = BoundaryUtils.clampBoxToBounds(box, IMAGE_SIZE, IMAGE_SIZE);
    expect(BoundaryUtils.isBoxWithinBounds(clamped, IMAGE_SIZE, IMAGE_SIZE)).toBe(true);

    const movedX = (clamped.x - box.x) * IMAGE_SIZE;
    const movedY = (clamped.y - box.y) * IMAGE_SIZE;
    const distanceMoved = Math.hypot(movedX, movedY);
    expect(distanceMoved).toBeLessThan(2.5); // single-axis correction (~2.07), not both-axes (~2.93)

    // Exactly one axis should have moved, the other left untouched.
    const axesMoved = [Math.abs(movedX) > 0.01, Math.abs(movedY) > 0.01].filter(Boolean).length;
    expect(axesMoved).toBe(1);
  });

  it('produces no visible jump as the box is dragged smoothly past a canvas corner', () => {
    // Sweep the (invalid, off-canvas) raw drag position along a straight
    // line that crosses the exact diagonal from the canvas's bottom-right
    // corner - the point where, evaluated fresh with no history, which
    // corner "wins" the privileged-out slot would flip. Threading each
    // frame's own clamped result back in as `previousBox` (exactly how
    // box-manipulator.ts calls this during a real drag) should keep it
    // privileging the same corner the whole way through instead of
    // re-deciding - and re-deciding is what caused a visible jump, since
    // the two candidate corrections can sit far apart even when almost
    // equidistant from the cursor.
    const w = 0.1,
      h = 0.1,
      rotation = Math.PI / 4;
    const step = 0.5; // absolute units
    let prevBox: Box | null = null;
    let prevClamped: { x: number; y: number } | null = null;

    for (let t = -10; t <= 10; t += step) {
      // Raw centre sweeps through (55 + t, 55 - t) in absolute space -
      // straddling the symmetric point (55, 55) relative to the corner at (50, 50).
      const rawAbsX = 55 + t;
      const rawAbsY = 55 - t;
      const box = makeBox(
        (rawAbsX + IMAGE_SIZE / 2) / IMAGE_SIZE,
        (rawAbsY + IMAGE_SIZE / 2) / IMAGE_SIZE,
        w,
        h,
        rotation,
      );

      const clamped = BoundaryUtils.clampBoxToBounds(
        box,
        IMAGE_SIZE,
        IMAGE_SIZE,
        prevBox ?? undefined,
      );
      const clampedAbs = {
        x: clamped.x * IMAGE_SIZE - IMAGE_SIZE / 2,
        y: clamped.y * IMAGE_SIZE - IMAGE_SIZE / 2,
      };

      if (prevClamped) {
        const jump = Math.hypot(clampedAbs.x - prevClamped.x, clampedAbs.y - prevClamped.y);
        // The raw position itself moves sqrt(2)*step per iteration; a jump
        // several times larger than that would mean the output snapped
        // between two different corrections instead of tracking smoothly.
        expect(jump).toBeLessThan(step * 3);
      }
      prevClamped = clampedAbs;
      prevBox = clamped;
    }
  });
});
