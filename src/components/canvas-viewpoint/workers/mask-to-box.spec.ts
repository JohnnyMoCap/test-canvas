import { describe, it, expect } from 'vitest';
import { maskToBox } from './mask-to-box';

describe('maskToBox', () => {
  it('returns null for an all-zero mask', () => {
    const mask = new Uint8Array(10 * 10);
    expect(maskToBox(mask, 10, 10)).toBeNull();
  });

  it('computes matching axis-aligned and oriented bounds for a non-rotated square mask', () => {
    const width = 20,
      height = 20;
    const mask = new Uint8Array(width * height);
    for (let y = 5; y <= 14; y++) {
      for (let x = 5; x <= 14; x++) {
        mask[y * width + x] = 1;
      }
    }

    const box = maskToBox(mask, width, height);

    expect(box).not.toBeNull();
    expect(box!.rotation).toBeCloseTo(0, 5);
    expect(box!.width).toBeCloseTo(10, 0);
    expect(box!.height).toBeCloseTo(10, 0);
    expect(box!.centerX).toBeCloseTo((box!.minX + box!.maxX) / 2, 5);
    expect(box!.centerY).toBeCloseTo((box!.minY + box!.maxY) / 2, 5);
  });

  it('computes a tight oriented box for a diagonal mask, not the oversized axis-aligned square', () => {
    const width = 40,
      height = 40;
    const mask = new Uint8Array(width * height);
    for (let t = 0; t < 20; t++) {
      mask[(10 + t) * width + (10 + t)] = 1;
    }

    const box = maskToBox(mask, width, height);

    expect(box).not.toBeNull();
    expect(Math.abs(box!.rotation)).toBeCloseTo(Math.PI / 4, 1);
    // Axis-aligned bbox is a ~20x20 square (unusably oversized for a 1px-wide diagonal line).
    expect(box!.maxX - box!.minX + 1).toBeCloseTo(20, 0);
    // The oriented box should reflect the line's true shape: long and thin.
    expect(box!.height).toBeLessThan(3);
    expect(box!.width).toBeGreaterThan(25);
  });
});
