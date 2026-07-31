/**
 * Principal-component orientation from running sums - the "best-fit
 * rotation" for an irregular pixel region (a flood-filled region, a SAM
 * mask, ...) without storing the individual pixel positions.
 *
 * The caller accumulates `sumX, sumY, sumXX, sumXY, sumYY` inline while it
 * already has to walk the region once for its own purposes (BFS queue,
 * mask scan, ...), then calls this once at the end.
 */
export function computeRotationPCA(
  n: number,
  sumX: number,
  sumY: number,
  sumXX: number,
  sumXY: number,
  sumYY: number,
): number {
  if (n < 3) return 0;

  const mx = sumX / n;
  const my = sumY / n;

  // Covariance matrix components (corrected from running sums)
  const cxx = sumXX / n - mx * mx;
  const cxy = sumXY / n - mx * my;
  const cyy = sumYY / n - my * my;

  // If the region is roughly circular/isotropic, don't impose a rotation -
  // it would be meaningless and numerically unstable.
  if (Math.abs(cxx - cyy) < 0.01 && Math.abs(cxy) < 0.01) return 0;

  return 0.5 * Math.atan2(2 * cxy, cxx - cyy);
}
