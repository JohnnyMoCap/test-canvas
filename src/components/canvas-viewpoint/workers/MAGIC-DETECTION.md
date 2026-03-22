# Magic Detection — How It Works

The Magic Wand tool lets a user click anywhere on the background image and automatically places an annotation box around the object located there. This document explains the whole system from click to box in plain English.

---

## Bird's-Eye View

```
User clicks → PointerEventHandler
                → MagicDetectionHandler.handlePointerDown()
                    → reads background image pixels
                    → sends pixels + click position to Web Worker
                                                    ↓ (background thread)
                                        magic-detection.worker.ts
                                            → auto-tune tolerance
                                            → flood-fill (BFS)
                                            → compute rotation (PCA)
                                            → post result back
                    ← receives result
                    → converts pixel geometry → normalized Box
                    → saves to history (Undo/Redo works)
                    → triggers canvas redraw
```

---

## Why a Web Worker?

For a large image (e.g. 4 K = ~8 million pixels) the flood-fill algorithm may need to inspect every single pixel. Running that on the **main thread** would freeze the browser for several seconds — the canvas would stop animating and pointer events would queue up unprocessed.

A **Web Worker** is a true background thread. The main thread hands off the pixel data and immediately continues rendering. When the Worker finishes it posts a message back, and the main thread records the result.

### Zero-Copy Pixel Transfer

Pixel data (`ImageData.data.buffer`) is **transferred** to the Worker as an `ArrayBuffer`, not copied. This means:

- No matter how large the image, the hand-off is instantaneous.
- The main thread loses access to that buffer the moment it sends it (the OS reassigns ownership to the Worker thread).
- A fresh `getImageData` call is needed for the next detection — this is intentional and keeps the two threads from sharing mutable state.

---

## Step 1 — Convert the Click to a Background-Image Pixel

The user clicks somewhere on the screen. The viewport may be zoomed in or panned, so a screen coordinate does **not** directly correspond to a background-image pixel.

The conversion chain is:

| Space                  | Origin                  | Unit                                     |
| ---------------------- | ----------------------- | ---------------------------------------- |
| Screen coordinate      | browser window top-left | CSS pixels                               |
| Canvas device pixel    | canvas element top-left | physical pixels (×DPR for HiDPI screens) |
| Absolute coordinate    | image centre            | image pixels (same scale as the image)   |
| Background-image pixel | image top-left          | image pixels                             |

```
screen → ×devicePixelRatio → canvas device pixel
       → CoordinateTransform.screenToAbsolute() (accounts for zoom + pan)
       → + imageWidth/2, + imageHeight/2 (shift origin from centre to top-left)
       → clamp to [0, imageWidth-1] × [0, imageHeight-1]
```

---

## Step 2 — Colour Tolerance

The flood-fill needs to know when to **stop expanding**. A pixel is accepted if its colour is within `tolerance` of the seed pixel's colour. Getting this threshold right is critical:

- Too low → the fill stops at every tiny colour variation (shadow, texture, JPEG compression artefact). The box will be tiny.
- Too high → the fill leaks beyond the object into the background. The box will be huge.

### Auto-Tune Mode (default)

The Worker samples a small square window around the click point (default 15×15 px, controlled by `sampleRadius`) and measures the **statistical variance** of each colour channel (Red, Green, Blue). The variance tells us how much the colours vary locally:

- On a smooth, uniformly coloured wall → low variance → the fill can use a tight tolerance.
- On a noisy or textured surface → high variance → tolerance needs to be looser so the fill doesn't fragment.

The formula is:

```
stdDev      = sqrt( (Var(R) + Var(G) + Var(B)) / 3 )
tolerance   = baseTolerance + toleranceScaleFactor × stdDev + manualAdjustment
tolerance   = clamp(tolerance, toleranceMin, toleranceMax)
```

All of these parameters are configurable in `MagicConfig`.

### Manual Mode

When `autoTune = false`, the `manualTolerance` value is used directly without any variance calculation.

---

## Step 3 — Flood Fill (BFS)

This is the core algorithm. Starting from the seed pixel (the clicked pixel), we expand outward to all neighbouring pixels whose colour is within tolerance of the seed colour.

### Algorithm

```
queue = [seedPixel]
visited = empty set

while queue is not empty:
    pixel = queue.pop_front()
    mark pixel as part of the region

    for each neighbour (up to 8, depending on connectivity setting):
        if not visited and colour_distance(neighbour, seed) ≤ tolerance:
            add to queue
            mark as visited
```

This is standard Breadth-First Search (BFS), sometimes called "paint bucket" fill.

### Colour Distance

We use **Manhattan distance on RGB**:

```
distance = |R1 - R2| + |G1 - G2| + |B1 - B2|
```

Maximum possible value is 765 (= 3 × 255). This is significantly faster than Euclidean distance (no square root, no multiplication) and good enough for colour-similarity testing.

### Connectivity

- **4-way** (default): each pixel has 4 neighbours — up, down, left, right. Produces cleaner, less jagged edges.
- **8-way**: each pixel has 8 neighbours (adds 4 diagonals). Better at bridging narrow diagonal features but can leak through single-pixel gaps.

### Safety Valve — maxFillRatio

If the accepted region grows beyond `maxFillRatio × totalPixels` (default 15 %), the algorithm aborts and returns a failure. This prevents runaway fill when the user clicks on a background that has no clear colour boundary.

### Performance Details

For large images the naive implementation (using a JS `Array` and object `{x, y}` positions) would be painfully slow. Several optimisations are used:

| Technique                             | Why                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `Int32Array` as queue                 | Avoids JS object allocation; typed arrays are far faster for large counts       |
| `Uint8Array` as visited set           | O(1) mark and lookup; cheaper memory than `Set<number>`                         |
| Flat position index (`y × width + x`) | Single integer instead of two-property object per pixel                         |
| Mark visited **before** colour test   | Prevents the same pixel from being enqueued multiple times by different parents |
| PCA sums accumulated **inline**       | No second pass, no separate array of pixel positions needed                     |

---

## Step 4 — Bounding Box Rotation (PCA)

After the flood-fill, we have a set of all accepted pixels. Rather than a plain axis-aligned bounding box (which would poorly fit a diagonal or rotated object), we compute the **orientation** of the region using Principal Component Analysis (PCA).

### What PCA Does Here

PCA finds the axis along which the pixel positions vary the most — the "long axis" of the shape. We use this as the bounding box rotation so the box fits the object snugly.

### Computing It Without Storing Pixel Positions

Normally PCA on a point set requires storing all the points, then computing means and covariance. For millions of pixels that would require a huge amount of memory.

Instead, we accumulate **running sums** during the BFS loop itself:

```
sumX, sumY           — for computing the mean position
sumX², sumXY, sumY²  — for computing the covariance matrix
```

At the end, the covariance matrix entries can be computed with simple division:

```
Var(X)    = sumX² / n  - (sumX / n)²
Var(Y)    = sumY² / n  - (sumY / n)²
Cov(X, Y) = sumXY / n  - (sumX / n) × (sumY / n)
```

And the angle of the first principal component is:

```
θ = 0.5 × atan2( 2 × Cov(X,Y),  Var(X) − Var(Y) )
```

If the region is approximately circular (both variances are equal and cross-covariance is near zero), no rotation is applied — it would be meaningless and numerically unstable.

---

## Step 5 — Converting the Result to a Box

The Worker returns coordinates in **background-image pixel space** (origin = top-left corner of the image).

The app stores boxes in **normalized space** (origin = image centre, values in the range 0–1 expressed as fractions of the image size).

The conversion in `MagicDetectionHandler.buildBoxFromResult()`:

```
absoluteX = centerX - imageWidth / 2      // shift origin from top-left to centre
absoluteY = centerY - imageHeight / 2

normalizedX = absoluteX / (imageWidth / 2)    // express as fraction
normalizedY = absoluteY / (imageHeight / 2)
normalizedW = bboxWidth  / imageWidth
normalizedH = bboxHeight / imageHeight
```

The box is then committed to `HistoryService` so Undo/Redo works, the spatial index is rebuilt, and the canvas is redrawn.

---

## File Map

| File                                  | Responsibility                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `handlers/magic-detection.handler.ts` | Owns the Worker; converts click events to worker requests; converts worker results to Boxes       |
| `workers/magic-detection.worker.ts`   | Background thread; auto-tolerance; flood-fill; PCA rotation                                       |
| `workers/magic-detection.types.ts`    | Shared data shapes (`MagicConfig`, `MagicWorkerRequest`, `MagicWorkerResult`)                     |
| `handlers/pointer-event-handler.ts`   | Routes the pointer-down event to `MagicDetectionHandler` when magic mode is active                |
| `utils/state-manager.ts`              | Stores `magicAutoTune`, `magicTolerance`, `magicAdjustment`, `isMagicMode`, `debugMagicDetection` |

---

## Configuration Reference

All fields live in `MagicConfig` (defined in `magic-detection.types.ts`).

| Field                  | Default | Description                                                    |
| ---------------------- | ------- | -------------------------------------------------------------- |
| `autoTune`             | `true`  | Derive tolerance from local variance automatically             |
| `manualTolerance`      | —       | Used directly when `autoTune = false`                          |
| `manualAdjustment`     | `0`     | ±Offset on top of the auto-tuned tolerance                     |
| `baseTolerance`        | `20`    | Starting point before variance is added                        |
| `toleranceScaleFactor` | `1.5`   | How strongly local noise boosts the tolerance                  |
| `toleranceMin`         | `15`    | Hard minimum tolerance                                         |
| `toleranceMax`         | `110`   | Hard maximum tolerance                                         |
| `sampleRadius`         | `7`     | Half-width of the variance sampling window (→ 15×15 px)        |
| `connectivity`         | `4`     | Neighbour count per pixel (4 = cardinal only, 8 = + diagonals) |
| `maxFillRatio`         | `0.15`  | Abort if the region exceeds 15 % of the image                  |
| `debug`                | `false` | Log detailed timing and geometry to the console                |
