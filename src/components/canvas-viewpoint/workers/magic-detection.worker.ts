/// <reference lib="webworker" />

import type { MagicConfig, MagicWorkerRequest, MagicWorkerResult } from './magic-detection.types';
import { floodFill, sampleSeedReference } from './flood-fill';

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

  // Characterises the clicked area's edge/shading character, so the fill
  // can also grow across pixels that match on texture even when their raw
  // colour drifts outside tolerance - see flood-fill.ts's doc comment.
  const seedReference = sampleSeedReference(pixels, width, height, clickX, clickY, config.sampleRadius);

  // Run BFS
  const fill = floodFill(pixels, width, height, clickX, clickY, sr, sg, sb, {
    tolerance: usedTolerance,
    connectivity: config.connectivity,
    maxFillRatio: config.maxFillRatio,
    seedReference,
  });

  if (!fill) {
    if (config.debug) console.log('[MagicWorker] BFS returned no region');
    postResult({ success: false, reason: 'No region detected (too small or fill bled out)' });
    return;
  }

  const result = {
    centerX: fill.centerX,
    centerY: fill.centerY,
    bboxWidth: fill.width,
    bboxHeight: fill.height,
    rotation: fill.rotation,
    pixelCount: fill.pixelCount,
  };

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

// BFS flood fill and PCA rotation live in ./flood-fill and ./pca.
