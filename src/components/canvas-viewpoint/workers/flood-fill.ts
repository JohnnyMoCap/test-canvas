import { computeRotationPCA } from './pca';

/** Minimal set of knobs a flood-fill needs — decoupled from any single feature's UI config shape. */
export interface FloodFillOptions {
  /** Manhattan RGB distance a neighbour may differ from the seed colour before the fill stops. Range 0–765. */
  tolerance: number;
  /** 4 = cardinal neighbours only (cleaner edges). 8 = + diagonals (bridges narrow gaps, can leak). */
  connectivity: 4 | 8;
  /** Abort (return null) if the accepted region exceeds this fraction of the image - the fill has leaked. */
  maxFillRatio: number;
  /**
   * Local texture/shading character of the area around the seed - see
   * `sampleSeedReference()`. When provided, a neighbour that fails the
   * colour test can still be accepted if it matches the seed's gradient or
   * shading character (see `floodFill`'s doc comment). Omit (or pass the
   * zero reference) to fall back to pure colour-distance behaviour.
   */
  seedReference?: SeedReference;
}

export interface FloodFillResult {
  /** AXIS-ALIGNED bounding box of the accepted region, in image-pixel coordinates (top-left origin). Only matches the region's true tight bounds when `rotation` is 0 - for a rotated region, use `centerX`/`centerY`/`width`/`height` instead (see below). */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Best-fit rotation of the region (radians), via PCA on the accepted pixels. */
  rotation: number;
  /**
   * Center of a TIGHT bounding box measured along the region's own rotated
   * axes (i.e. what you get by rotating the accepted pixels by -`rotation`
   * before taking their min/max, then rotating the result back) - together
   * with `width`/`height`/`rotation`, this is what should be drawn: a
   * rectangle of `width`x`height` centred here and rotated by `rotation`.
   * Deliberately NOT the same as the axis-aligned box above: reusing that
   * box's `width`/`height` next to a non-zero `rotation` over-sizes and
   * misaligns the drawn box, since the axis-aligned extent of a rotated
   * (e.g. diagonal) region is larger than its extent along its own axes.
   */
  centerX: number;
  centerY: number;
  /** Width/height of the tight oriented bounding box - see `centerX`/`centerY`. */
  width: number;
  height: number;
  /** Number of pixels accepted into the region. */
  pixelCount: number;
}

/** A neighbourhood's average edge strength/direction and brightness variability - see `sampleSeedReference()`. */
export interface SeedReference {
  /**
   * Average gradient VECTOR across the sampled neighbourhood - used only to
   * establish a representative edge direction. Deliberately distinct from
   * `maxGradMag`: a thin symmetric line/band (background-edge-line-edge-background)
   * has opposite-signed gradients on its two flanks that cancel out here,
   * which is exactly the desired "no single coherent direction" signal for
   * that shape.
   */
  avgGradX: number;
  avgGradY: number;
  /**
   * The STRONGEST per-pixel gradient magnitude (sum-of-absolutes, cheaper
   * than sqrt(gx²+gy²)) found anywhere in the sampled window - not an
   * average, which would be diluted by however much of the window happens
   * to be flat background around a thin feature (a 1-2px rivet rim or
   * crack line only occupies a sliver of a several-pixel-wide sampling
   * window). The max is what tells us "there's an edge at least this
   * strong somewhere near the seed," which is the actual question a
   * candidate pixel elsewhere on that same edge needs to be compared
   * against.
   */
  maxGradMag: number;
  /** Standard deviation of luma across the sampled neighbourhood. */
  stdDev: number;
}

const ZERO_SEED_REFERENCE: SeedReference = { avgGradX: 0, avgGradY: 0, maxGradMag: 0, stdDev: 0 };

/** A seed neighbourhood this flat/textureless doesn't carry a meaningful edge direction/strength to compare against - see the gating in `isAccepted()`. */
const MIN_MEANINGFUL_GRADIENT = 15;
/** Below this, the seed neighbourhood is essentially flat - shading-similarity isn't a meaningful signal there either. */
const MIN_MEANINGFUL_STDDEV = 8;
const GRADIENT_MAGNITUDE_TOLERANCE = 40;
const GRADIENT_DIRECTION_COS_TOLERANCE = Math.cos((35 * Math.PI) / 180);
const VARIANCE_STDDEV_TOLERANCE = 15;
/** Half-width of the window used to measure a candidate pixel's own local shading variability. */
const LOCAL_VARIANCE_WINDOW_RADIUS = 1;

/**
 * Breadth-first flood fill starting at (startX, startY): expands to every
 * neighbouring pixel that is similar enough to the seed on ANY of three
 * cues:
 *   1. Colour - Manhattan RGB distance from the seed pixel, within `tolerance`.
 *      This is the original, primary cue and alone is enough for solid-coloured
 *      objects on a contrasting background.
 *   2. Gradient - local Sobel edge strength/direction close to the seed
 *      neighbourhood's average. Lets the fill continue across an
 *      anti-aliased or textured edge (a rivet's rim, a crack's outline)
 *      where the raw colour drifts pixel-to-pixel but the "this is an edge,
 *      and it point this way" character stays consistent.
 *   3. Shading - local brightness variability close to the seed
 *      neighbourhood's. Lets the fill continue across a smooth brightness
 *      gradient (a dent's shaded basin) that a tight colour tolerance would
 *      otherwise stop at partway through.
 * Cues 2 and 3 only apply when the seed neighbourhood itself shows a
 * meaningful amount of that signal (see `MIN_MEANINGFUL_GRADIENT`/
 * `MIN_MEANINGFUL_STDDEV`) - two different flat, textureless colours both
 * read as "no edge, no variance", which would otherwise make them
 * indistinguishable and let the fill leak across any flat-to-flat colour
 * boundary. Pass no `seedReference` (or omit it) to disable cues 2 and 3
 * entirely and get the original colour-only behaviour.
 *
 * Returns null if the fill is too small to be meaningful (<10 px) or
 * exceeds `maxFillRatio` (leaked past the object, no clean boundary to stop at).
 */
export function floodFill(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  seedR: number,
  seedG: number,
  seedB: number,
  options: FloodFillOptions,
): FloodFillResult | null {
  const totalPixels = width * height;
  const maxFillPixels = Math.floor(totalPixels * options.maxFillRatio);
  const use8Way = options.connectivity === 8;
  const seedRef = options.seedReference ?? ZERO_SEED_REFERENCE;
  const gradientCueActive = seedRef.maxGradMag >= MIN_MEANINGFUL_GRADIENT;
  const shadingCueActive = seedRef.stdDev >= MIN_MEANINGFUL_STDDEV;

  // Typed arrays throughout - no per-pixel object allocation, this runs over
  // potentially millions of pixels.
  const visited = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels); // worst case: the whole image
  let head = 0;
  let tail = 0;

  let minX = startX,
    maxX = startX,
    minY = startY,
    maxY = startY;
  let pixelCount = 0;

  // PCA running sums, accumulated inline - no second pass over the region.
  let sumX = 0,
    sumY = 0,
    sumXX = 0,
    sumXY = 0,
    sumYY = 0;

  const seedPos = startY * width + startX;
  visited[seedPos] = 1;
  queue[tail++] = seedPos;

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

    pixelCount++;
    if (pixelCount > maxFillPixels) return null; // bleed guard

    if (x < minX) minX = x;
    else if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    else if (y > maxY) maxY = y;

    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
    sumYY += y * y;

    for (let i = 0; i < numNeighbours; i++) {
      const nx = x + dxArr[i];
      const ny = y + dyArr[i];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const nPos = ny * width + nx;
      if (visited[nPos]) continue;

      // Mark visited BEFORE the acceptance test so the same pixel is never
      // enqueued twice by two different parents.
      visited[nPos] = 1;

      const nIdx = nPos * 4;
      const colorDist =
        Math.abs(pixels[nIdx] - seedR) +
        Math.abs(pixels[nIdx + 1] - seedG) +
        Math.abs(pixels[nIdx + 2] - seedB);

      const accepted =
        colorDist <= options.tolerance ||
        (gradientCueActive && isGradientSimilar(pixels, width, height, nx, ny, seedRef)) ||
        (shadingCueActive && isShadingSimilar(pixels, width, height, nx, ny, seedRef));

      if (accepted) {
        queue[tail++] = nPos;
      }
    }
  }

  if (pixelCount < 10) return null;

  const rotation = computeRotationPCA(pixelCount, sumX, sumY, sumXX, sumXY, sumYY);
  const oriented = computeOrientedBounds(queue, pixelCount, width, rotation, sumX / pixelCount, sumY / pixelCount);

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

/**
 * Re-walks the already-collected accepted pixels (queue[0..pixelCount)) to
 * find their tight bounds along the region's own rotated axes, rather than
 * the world axes - see `FloodFillResult.centerX`'s doc comment for why this
 * differs from the axis-aligned box. `queue` already holds every accepted
 * position after the BFS loop above, so this costs one more O(pixelCount)
 * pass, no extra memory.
 */
function computeOrientedBounds(
  queue: Int32Array,
  pixelCount: number,
  imageWidth: number,
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

  for (let i = 0; i < pixelCount; i++) {
    const pos = queue[i];
    const dx = (pos % imageWidth) - meanX;
    const dy = ((pos / imageWidth) | 0) - meanY;
    // Rotate by -rotation to express (dx, dy) in the region's own local axes.
    const u = dx * cos + dy * sin;
    const v = -dx * sin + dy * cos;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }

  const localCenterU = (minU + maxU) / 2;
  const localCenterV = (minV + maxV) / 2;

  return {
    // Rotate the local centre back by +rotation to place it in image coordinates.
    centerX: meanX + localCenterU * cos - localCenterV * sin,
    centerY: meanY + localCenterU * sin + localCenterV * cos,
    width: maxU - minU + 1,
    height: maxV - minV + 1,
  };
}

/**
 * Samples a square window around (cx, cy) to characterise the seed
 * neighbourhood's edge strength/direction and brightness variability, for
 * `floodFill`'s gradient/shading cues. A single-level measurement over the
 * whole window (not "average of per-pixel local stats") - the same
 * approach the existing colour auto-tolerance sampling already uses for
 * colour variance, reused here for the same reason: cheap, one pass, and
 * exactly what a "does this area generally have texture" question needs.
 */
export function sampleSeedReference(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
): SeedReference {
  let sumGray = 0,
    sumGraySq = 0,
    sumGradX = 0,
    sumGradY = 0,
    maxGradMag = 0,
    n = 0;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;

      const gray = grayAt(pixels, (y * width + x) * 4);
      sumGray += gray;
      sumGraySq += gray * gray;

      const grad = sobelAt(pixels, width, height, x, y);
      sumGradX += grad.gx;
      sumGradY += grad.gy;
      const gradMag = Math.abs(grad.gx) + Math.abs(grad.gy);
      if (gradMag > maxGradMag) maxGradMag = gradMag;
      n++;
    }
  }

  if (n === 0) return ZERO_SEED_REFERENCE;

  const meanGray = sumGray / n;
  const stdDev = Math.sqrt(Math.max(0, sumGraySq / n - meanGray * meanGray));

  return { avgGradX: sumGradX / n, avgGradY: sumGradY / n, maxGradMag, stdDev };
}

/** Accepts a candidate whose local edge strength is close to the seed's, and (when both have a clear direction) points the same way. */
function isGradientSimilar(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  seedRef: SeedReference,
): boolean {
  const grad = sobelAt(pixels, width, height, x, y);
  const gradMag = Math.abs(grad.gx) + Math.abs(grad.gy);
  if (Math.abs(gradMag - seedRef.maxGradMag) > GRADIENT_MAGNITUDE_TOLERANCE) return false;

  // Direction is only meaningful when the candidate has a clear edge AND the
  // seed's own averaged vector wasn't cancelled out by opposing edges on a
  // thin symmetric line/band (see SeedReference.avgGradX/Y) - either way,
  // there's nothing trustworthy to compare against, so don't constrain.
  const seedDirMag = Math.hypot(seedRef.avgGradX, seedRef.avgGradY);
  if (gradMag < MIN_MEANINGFUL_GRADIENT || seedDirMag < MIN_MEANINGFUL_GRADIENT) return true;

  const cos = (grad.gx * seedRef.avgGradX + grad.gy * seedRef.avgGradY) / (Math.hypot(grad.gx, grad.gy) * seedDirMag);
  return cos >= GRADIENT_DIRECTION_COS_TOLERANCE;
}

/** Accepts a candidate whose immediate local brightness variability is close to the seed neighbourhood's. */
function isShadingSimilar(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  seedRef: SeedReference,
): boolean {
  const localStdDev = localStdDevAt(pixels, width, height, x, y, LOCAL_VARIANCE_WINDOW_RADIUS);
  return Math.abs(localStdDev - seedRef.stdDev) <= VARIANCE_STDDEV_TOLERANCE;
}

/** Rec. 601 luma at one pixel, given its RGBA byte offset. */
function grayAt(pixels: Uint8ClampedArray, idx: number): number {
  return 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
}

/** 3x3 Sobel gradient at one pixel, sum-of-absolutes style (see `SeedReference.maxGradMag`). Out-of-bounds neighbours clamp to the image edge. */
function sobelAt(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): { gx: number; gy: number } {
  const at = (dx: number, dy: number): number => {
    const cx = Math.min(width - 1, Math.max(0, x + dx));
    const cy = Math.min(height - 1, Math.max(0, y + dy));
    return grayAt(pixels, (cy * width + cx) * 4);
  };

  const tl = at(-1, -1),
    t = at(0, -1),
    tr = at(1, -1);
  const l = at(-1, 0),
    r = at(1, 0);
  const bl = at(-1, 1),
    b = at(0, 1),
    br = at(1, 1);

  const gx = tr + 2 * r + br - tl - 2 * l - bl;
  const gy = bl + 2 * b + br - tl - 2 * t - tr;
  return { gx, gy };
}

/** Standard deviation of luma over a small window around (x, y) - a candidate pixel's own local "how much does brightness wobble right here" measurement. */
function localStdDevAt(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
): number {
  let sum = 0,
    sumSq = 0,
    n = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const gray = grayAt(pixels, (ny * width + nx) * 4);
      sum += gray;
      sumSq += gray * gray;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
}
