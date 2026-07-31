import { describe, it, expect } from 'vitest';
import { floodFill, sampleSeedReference } from './flood-fill';

/** Builds a WxH RGBA buffer filled with `bg`, with a `rect` region filled with `fg`. */
function makeImage(
  width: number,
  height: number,
  bg: [number, number, number],
  fg: [number, number, number],
  rect: { x0: number; y0: number; x1: number; y1: number },
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inRect = x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
      const [r, g, b] = inRect ? fg : bg;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

describe('floodFill', () => {
  it('fills a solid-colour rectangle and reports its exact bounding box and pixel count', () => {
    const pixels = makeImage(40, 40, [0, 0, 0], [255, 0, 0], { x0: 10, y0: 10, x1: 19, y1: 19 });

    const result = floodFill(pixels, 40, 40, 15, 15, 255, 0, 0, {
      tolerance: 10,
      connectivity: 4,
      maxFillRatio: 0.5,
    });

    expect(result).not.toBeNull();
    expect(result!.minX).toBe(10);
    expect(result!.minY).toBe(10);
    expect(result!.maxX).toBe(19);
    expect(result!.maxY).toBe(19);
    expect(result!.pixelCount).toBe(100); // 10x10
  });

  it('does not bleed past a tolerance boundary into a dissimilar-colour background', () => {
    const pixels = makeImage(40, 40, [0, 0, 0], [255, 0, 0], { x0: 10, y0: 10, x1: 19, y1: 19 });

    const result = floodFill(pixels, 40, 40, 15, 15, 255, 0, 0, {
      tolerance: 10, // background (0,0,0) is 255 away from seed - well outside tolerance
      connectivity: 4,
      maxFillRatio: 0.5,
    });

    expect(result!.pixelCount).toBe(100); // stayed inside the red rectangle
  });

  it('bleeds into a similar-enough colour when tolerance is loose', () => {
    // Background is a near-red, well within a loose tolerance of the seed colour.
    const pixels = makeImage(40, 40, [250, 5, 5], [255, 0, 0], { x0: 10, y0: 10, x1: 19, y1: 19 });

    const result = floodFill(pixels, 40, 40, 15, 15, 255, 0, 0, {
      tolerance: 20,
      connectivity: 4,
      maxFillRatio: 1, // must allow the fill to cover the whole image without aborting
    });

    expect(result!.pixelCount).toBe(40 * 40); // filled the entire image
  });

  it('aborts (returns null) when the region exceeds maxFillRatio', () => {
    const pixels = makeImage(40, 40, [255, 0, 0], [255, 0, 0], { x0: 0, y0: 0, x1: 39, y1: 39 });

    const result = floodFill(pixels, 40, 40, 20, 20, 255, 0, 0, {
      tolerance: 10,
      connectivity: 4,
      maxFillRatio: 0.1, // whole image is one colour - far exceeds 10%
    });

    expect(result).toBeNull();
  });

  it('returns null for a region smaller than the 10px floor', () => {
    // A single 2x2 patch of a distinct colour surrounded by background.
    const pixels = makeImage(40, 40, [0, 0, 0], [255, 0, 0], { x0: 20, y0: 20, x1: 21, y1: 21 });

    const result = floodFill(pixels, 40, 40, 20, 20, 255, 0, 0, {
      tolerance: 10,
      connectivity: 4,
      maxFillRatio: 0.5,
    });

    expect(result).toBeNull();
  });

  it('computes a nonzero rotation for an elongated diagonal-ish region', () => {
    // A thin diagonal staircase of the seed colour.
    const width = 40,
      height = 40;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        pixels[i] = 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
        pixels[i + 3] = 255;
      }
    }
    for (let t = 0; t < 20; t++) {
      const x = 10 + t;
      const y = 10 + t;
      const i = (y * width + x) * 4;
      pixels[i] = 255;
      pixels[i + 1] = 0;
      pixels[i + 2] = 0;
    }

    const result = floodFill(pixels, width, height, 10, 10, 255, 0, 0, {
      tolerance: 10,
      connectivity: 8, // diagonal steps need diagonal connectivity to chain together
      maxFillRatio: 0.9,
    });

    expect(result).not.toBeNull();
    expect(Math.abs(result!.rotation)).toBeCloseTo(Math.PI / 4, 1);
  });

  it('computes a tight oriented box for a diagonal region, not the oversized axis-aligned square', () => {
    // Same thin diagonal staircase as above.
    const width = 40,
      height = 40;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        pixels[i] = 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
        pixels[i + 3] = 255;
      }
    }
    for (let t = 0; t < 20; t++) {
      const x = 10 + t;
      const y = 10 + t;
      const i = (y * width + x) * 4;
      pixels[i] = 255;
      pixels[i + 1] = 0;
      pixels[i + 2] = 0;
    }

    const result = floodFill(pixels, width, height, 10, 10, 255, 0, 0, {
      tolerance: 10,
      connectivity: 8,
      maxFillRatio: 0.9,
    });

    expect(result).not.toBeNull();
    // Axis-aligned bbox is a ~20x20 square (unusably oversized for a 1px-wide line).
    expect(result!.maxX - result!.minX + 1).toBeCloseTo(20, 0);
    expect(result!.maxY - result!.minY + 1).toBeCloseTo(20, 0);
    // The oriented box should be close to the line's true shape: long and thin.
    expect(result!.height).toBeLessThan(3);
    expect(result!.width).toBeGreaterThan(25);
  });
});

describe('floodFill multi-cue growth (seedReference)', () => {
  /**
   * A horizontal 2px-thick "crack" band (rows 9-10) on a background that
   * itself ramps slowly (20 -> 80 across x), with the band always exactly
   * 130 brighter than the background directly below/above it. That keeps
   * the band/background edge strength constant at every column (so the
   * gradient cue's reference stays valid arbitrarily far from the seed),
   * while the band's own raw colour still drifts enough along x to run a
   * tight, seed-anchored colour tolerance out of road quickly.
   */
  function makeConstContrastBand(width: number, height: number): Uint8ClampedArray {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const baseline = 20 + (x * 60) / (width - 1);
        const inBand = y === 9 || y === 10;
        const value = Math.round(inBand ? baseline + 130 : baseline);
        const i = (y * width + x) * 4;
        pixels[i] = value;
        pixels[i + 1] = value;
        pixels[i + 2] = value;
        pixels[i + 3] = 255;
      }
    }
    return pixels;
  }

  it('colour alone stops early against a fixed, tight seed tolerance as the band drifts', () => {
    const width = 60,
      height = 20;
    const pixels = makeConstContrastBand(width, height);
    const seedIdx = (9 * width + 5) * 4;

    const result = floodFill(pixels, width, height, 5, 9, pixels[seedIdx], pixels[seedIdx], pixels[seedIdx], {
      tolerance: 15,
      connectivity: 4,
      maxFillRatio: 1,
    });

    expect(result).not.toBeNull();
    expect(result!.maxX - result!.minX).toBeLessThan(20);
  });

  it('the gradient cue carries the fill much further along a matching-edge band than colour alone would reach', () => {
    const width = 60,
      height = 20;
    const pixels = makeConstContrastBand(width, height);
    const seedIdx = (9 * width + 5) * 4;
    const seedReference = sampleSeedReference(pixels, width, height, 5, 9, 3);

    const result = floodFill(pixels, width, height, 5, 9, pixels[seedIdx], pixels[seedIdx], pixels[seedIdx], {
      tolerance: 15,
      connectivity: 4,
      maxFillRatio: 1,
      seedReference,
    });

    expect(result).not.toBeNull();
    expect(result!.maxX - result!.minX).toBeGreaterThan(40);
  });

  it('does not bleed into an unrelated flat region past a genuinely flat buffer, even with an active seedReference', () => {
    const width = 60,
      height = 20;
    const pixels = makeConstContrastBand(width, height);
    // Flatten everything from x=40 on (a plain continuation of the background,
    // no band) so there is a real flat gap between the band and the block below -
    // otherwise the block's own boundary is itself an edge that could
    // coincidentally match the seed's edge-strength reference, muddying what
    // this test is actually checking.
    for (let y = 0; y < height; y++) {
      for (let x = 40; x < width; x++) {
        const i = (y * width + x) * 4;
        pixels[i] = 20;
        pixels[i + 1] = 20;
        pixels[i + 2] = 20;
      }
    }
    // A large flat block of a distinct colour, unconnected in tone or texture to the band.
    for (let y = 0; y < height; y++) {
      for (let x = 50; x < width; x++) {
        const i = (y * width + x) * 4;
        pixels[i] = 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 255;
      }
    }
    const seedIdx = (9 * width + 5) * 4;
    const seedReference = sampleSeedReference(pixels, width, height, 5, 9, 3);

    const result = floodFill(pixels, width, height, 5, 9, pixels[seedIdx], pixels[seedIdx], pixels[seedIdx], {
      tolerance: 15,
      connectivity: 4,
      maxFillRatio: 1,
      seedReference,
    });

    expect(result).not.toBeNull();
    // Stayed within the band/flat-buffer zone - never reached the blue block at x >= 50.
    expect(result!.maxX).toBeLessThan(50);
  });

  /**
   * A ramping region overlaid with small deterministic dither - texture
   * throughout, in both brightness variability and (incidentally) some
   * local edge activity. Doesn't attempt to isolate the gradient cue from
   * the shading cue (in practice a genuinely textured area tends to trip
   * both at once); it demonstrates the combined effect the multi-cue
   * acceptance test is meant to have: colour alone runs out of road
   * quickly as the base level drifts from the seed, while the combined
   * cues carry the fill much further across the same textured region.
   */
  function makeDitheredRamp(width: number, height: number): Uint8ClampedArray {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const base = 100 + (80 * x) / (width - 1);
        const dither = ((((x * 37 + y * 17) % 7) - 3) * 6) / 3; // deterministic pseudo-noise, roughly -6..+6
        const value = Math.max(0, Math.min(255, Math.round(base + dither)));
        const i = (y * width + x) * 4;
        pixels[i] = value;
        pixels[i + 1] = value;
        pixels[i + 2] = value;
        pixels[i + 3] = 255;
      }
    }
    return pixels;
  }

  it('the combined cues carry the fill further across a dithered, ramping region than colour alone', () => {
    const width = 60,
      height = 20;
    const pixels = makeDitheredRamp(width, height);
    const seedIdx = (9 * width + 5) * 4;

    const baseline = floodFill(pixels, width, height, 5, 9, pixels[seedIdx], pixels[seedIdx], pixels[seedIdx], {
      tolerance: 30,
      connectivity: 4,
      maxFillRatio: 1,
    });

    const seedReference = sampleSeedReference(pixels, width, height, 5, 9, 3);
    const withCues = floodFill(pixels, width, height, 5, 9, pixels[seedIdx], pixels[seedIdx], pixels[seedIdx], {
      tolerance: 30,
      connectivity: 4,
      maxFillRatio: 1,
      seedReference,
    });

    expect(baseline).not.toBeNull();
    expect(withCues).not.toBeNull();
    expect(withCues!.maxX - withCues!.minX).toBeGreaterThan(baseline!.maxX - baseline!.minX);
  });
});
