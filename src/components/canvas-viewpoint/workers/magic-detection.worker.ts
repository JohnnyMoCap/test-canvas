/// <reference lib="webworker" />

import type { MagicConfig, MagicWorkerRequest, MagicWorkerResult } from './magic-detection.types';

addEventListener('message', ({ data }: MessageEvent<MagicWorkerRequest>) => {
  const start = performance.now();
  const { buffer, width, height, clickX, clickY, config } = data;

  if (clickX < 0 || clickX >= width || clickY < 0 || clickY >= height) {
    postResult({ success: false, reason: 'Click outside image bounds' });
    return;
  }

  const pixels = new Uint8ClampedArray(buffer);

  // Validate seed pixel is not transparent
  const seedBaseIdx = (clickY * width + clickX) * 4;
  if (pixels[seedBaseIdx + 3] < 10) {
    postResult({ success: false, reason: 'Seed pixel is transparent' });
    return;
  }

  // Compute working tolerance
  const usedTolerance = config.autoTune
    ? computeAutoTolerance(pixels, width, height, clickX, clickY, config)
    : config.manualTolerance;

  if (config.debug) {
    console.log('[MagicWorker] Starting BFS', { clickX, clickY, usedTolerance, config });
  }

  // Read seed color (single pixel at click point for BFS reference)
  const sr = pixels[seedBaseIdx];
  const sg = pixels[seedBaseIdx + 1];
  const sb = pixels[seedBaseIdx + 2];

  // Run BFS
  const result = bfsFill(pixels, width, height, clickX, clickY, sr, sg, sb, usedTolerance, config);

  if (!result) {
    if (config.debug) console.log('[MagicWorker] BFS returned no region');
    postResult({ success: false, reason: 'No region detected (too small or fill bled out)' });
    return;
  }

  const elapsed = performance.now() - start;

  if (config.debug) {
    console.log('[MagicWorker] Done', {
      pixelCount: result.pixelCount,
      bbox: {
        cx: result.centerX.toFixed(1),
        cy: result.centerY.toFixed(1),
        w: result.bboxWidth,
        h: result.bboxHeight,
      },
      rotation: ((result.rotation * 180) / Math.PI).toFixed(1) + '°',
      usedTolerance: usedTolerance.toFixed(1),
      elapsedMs: elapsed.toFixed(2),
    });
  }

  postResult({
    success: true,
    ...result,
    usedTolerance,
    elapsedMs: elapsed,
  });
});

function postResult(result: MagicWorkerResult): void {
  postMessage(result);
}

// ---------------------------------------------------------------------------
// Auto-tolerance via local variance sampling
// ---------------------------------------------------------------------------

function computeAutoTolerance(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  config: MagicConfig,
): number {
  const r = config.sampleRadius;
  let rSum = 0,
    gSum = 0,
    bSum = 0;
  let rSqSum = 0,
    gSqSum = 0,
    bSqSum = 0;
  let n = 0;

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const idx = (ny * width + nx) * 4;
      const rv = pixels[idx],
        gv = pixels[idx + 1],
        bv = pixels[idx + 2];
      rSum += rv;
      gSum += gv;
      bSum += bv;
      rSqSum += rv * rv;
      gSqSum += gv * gv;
      bSqSum += bv * bv;
      n++;
    }
  }

  // Variance per channel: E[X²] - E[X]²
  const rVar = n > 0 ? rSqSum / n - (rSum / n) ** 2 : 0;
  const gVar = n > 0 ? gSqSum / n - (gSum / n) ** 2 : 0;
  const bVar = n > 0 ? bSqSum / n - (bSum / n) ** 2 : 0;
  const stdDev = Math.sqrt((rVar + gVar + bVar) / 3);

  const raw = config.baseTolerance + config.toleranceScaleFactor * stdDev + config.manualAdjustment;
  return Math.max(config.toleranceMin, Math.min(config.toleranceMax, raw));
}

// ---------------------------------------------------------------------------
// BFS flood fill
// ---------------------------------------------------------------------------

interface BfsResult {
  centerX: number;
  centerY: number;
  bboxWidth: number;
  bboxHeight: number;
  rotation: number;
  pixelCount: number;
}

function bfsFill(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  sr: number,
  sg: number,
  sb: number,
  tolerance: number,
  config: MagicConfig,
): BfsResult | null {
  const totalPixels = width * height;
  const maxFillPixels = Math.floor(totalPixels * config.maxFillRatio);
  const use8Way = config.connectivity === 8;

  // Use typed arrays for performance — no object allocation inside the loop
  const visited = new Uint8Array(totalPixels);
  // Worst-case queue is the whole image; use Int32Array for compact storage
  const queue = new Int32Array(totalPixels);
  let head = 0;
  let tail = 0;

  let minX = startX,
    maxX = startX,
    minY = startY,
    maxY = startY;
  let pixelCount = 0;

  // PCA running sums (computed inline — no second pass needed)
  let sumX = 0,
    sumY = 0,
    sumXX = 0,
    sumXY = 0,
    sumYY = 0;

  // Seed
  const seedPos = startY * width + startX;
  visited[seedPos] = 1;
  queue[tail++] = seedPos;

  // Neighbour offsets: 4-way [right, left, down, up] or 8-way (adds diagonals)
  const dx4 = [1, -1, 0, 0];
  const dy4 = [0, 0, 1, -1];
  const dx8 = [1, -1, 0, 0, 1, 1, -1, -1];
  const dy8 = [0, 0, 1, -1, 1, -1, 1, -1];
  const dxArr = use8Way ? dx8 : dx4;
  const dyArr = use8Way ? dy8 : dy4;
  const numNeighbours = dxArr.length;

  while (head < tail) {
    const pos = queue[head++];
    const x = pos % width;
    const y = (pos / width) | 0;

    // This pixel is part of the region (only pixels that passed the color test are queued)
    pixelCount++;

    if (pixelCount > maxFillPixels) return null; // bleed guard

    if (x < minX) minX = x;
    else if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    else if (y > maxY) maxY = y;

    // Accumulate PCA sums
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
    sumYY += y * y;

    // Expand to neighbours
    for (let i = 0; i < numNeighbours; i++) {
      const nx = x + dxArr[i];
      const ny = y + dyArr[i];

      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const nPos = ny * width + nx;
      if (visited[nPos]) continue;

      // Mark visited BEFORE color check to prevent duplicate enqueues
      visited[nPos] = 1;

      // Manhattan distance on RGB — fast, no sqrt
      const nIdx = nPos * 4;
      const dist =
        Math.abs(pixels[nIdx] - sr) +
        Math.abs(pixels[nIdx + 1] - sg) +
        Math.abs(pixels[nIdx + 2] - sb);

      if (dist <= tolerance) {
        queue[tail++] = nPos;
      }
    }
  }

  if (pixelCount < 10) return null;

  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    bboxWidth: maxX - minX + 1,
    bboxHeight: maxY - minY + 1,
    rotation: computeRotationPCA(pixelCount, sumX, sumY, sumXX, sumXY, sumYY),
    pixelCount,
  };
}

// ---------------------------------------------------------------------------
// PCA rotation from running sums (no points array needed)
// ---------------------------------------------------------------------------

function computeRotationPCA(
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

  // If region is roughly circular/isotropic, don't impose a rotation
  if (Math.abs(cxx - cyy) < 0.01 && Math.abs(cxy) < 0.01) return 0;

  return 0.5 * Math.atan2(2 * cxy, cxx - cyy);
}
