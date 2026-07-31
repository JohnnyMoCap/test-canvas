import { describe, it, expect } from 'vitest';
import { computeRotationPCA } from './pca';

/** Accumulates the running sums computeRotationPCA expects, from a plain point list. */
function sumsOf(points: Array<{ x: number; y: number }>) {
  let sumX = 0,
    sumY = 0,
    sumXX = 0,
    sumXY = 0,
    sumYY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXX += p.x * p.x;
    sumXY += p.x * p.y;
    sumYY += p.y * p.y;
  }
  return { n: points.length, sumX, sumY, sumXX, sumXY, sumYY };
}

describe('computeRotationPCA', () => {
  it('returns 0 for fewer than 3 points (not enough to define an orientation)', () => {
    const { n, sumX, sumY, sumXX, sumXY, sumYY } = sumsOf([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(computeRotationPCA(n, sumX, sumY, sumXX, sumXY, sumYY)).toBe(0);
  });

  it('returns 0 for a roughly circular/isotropic point set', () => {
    const points = [
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: -1, y: 0 },
    ];
    const { n, sumX, sumY, sumXX, sumXY, sumYY } = sumsOf(points);
    expect(computeRotationPCA(n, sumX, sumY, sumXX, sumXY, sumYY)).toBe(0);
  });

  it('finds a horizontal principal axis (~0 rad) for a horizontal line of points', () => {
    const points = [-3, -2, -1, 0, 1, 2, 3].map((x) => ({ x, y: 0 }));
    const { n, sumX, sumY, sumXX, sumXY, sumYY } = sumsOf(points);
    const angle = computeRotationPCA(n, sumX, sumY, sumXX, sumXY, sumYY);
    expect(angle).toBeCloseTo(0, 5);
  });

  it('finds a vertical principal axis (~π/2 rad) for a vertical line of points', () => {
    const points = [-3, -2, -1, 0, 1, 2, 3].map((y) => ({ x: 0, y }));
    const { n, sumX, sumY, sumXX, sumXY, sumYY } = sumsOf(points);
    const angle = computeRotationPCA(n, sumX, sumY, sumXX, sumXY, sumYY);
    expect(Math.abs(angle)).toBeCloseTo(Math.PI / 2, 5);
  });

  it('finds a ~45° principal axis for a diagonal line of points', () => {
    const points = [-3, -2, -1, 0, 1, 2, 3].map((v) => ({ x: v, y: v }));
    const { n, sumX, sumY, sumXX, sumXY, sumYY } = sumsOf(points);
    const angle = computeRotationPCA(n, sumX, sumY, sumXX, sumXY, sumYY);
    expect(Math.abs(angle)).toBeCloseTo(Math.PI / 4, 5);
  });
});
