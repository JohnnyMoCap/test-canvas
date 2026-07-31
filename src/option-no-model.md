# Tier A: Zero-Model, Zero-Download Auto-Detection

## Contrast with the SlimSAM approach

The SlimSAM/Transformers.js plan above gets you a real segmentation model
running client-side — genuinely good masks, but it costs you a model
download (tens of MB, cached after first load), a WASM/WebGPU inference
pass per photo, and a dependency on Hugging Face's CDN being reachable the
first time a user opens the app.

This guide is the other end of the spectrum: **no model, no download, no
CDN, no new dependency at all.** It's built entirely out of classic image
processing (edge detection, local variance, color flood-fill) running in
the same Worker infrastructure your Magic Wand tool already uses. It ships
today, works fully offline from first load, and its "detect whole photo"
step is just three passes over pixels you already have full-resolution
access to.

The tradeoff is real: this is heuristics, not learned features. It will
have a real false-positive/false-negative rate, especially on subtle
dents and low-contrast cracks — it's a reliable _bootstrap_, not a
long-term replacement for a trained model.

---

## 1. Install

Nothing. No `npm install`. This reuses your existing `magic-detection`
Worker pattern with new pure functions in `utils/`.

---

## 2. The core idea

Your three target defect classes each have a distinct _classical_ visual
signature (this is the same breakdown from §8 of the integration brief):

| Defect | Signature                              | Classical technique                            |
| ------ | -------------------------------------- | ---------------------------------------------- |
| Rust   | Distinct color region                  | Grid-seeded flood-fill (you already have this) |
| Crack  | Thin, high-contrast edge               | Sobel/Canny edge detection, elongation filter  |
| Dent   | Local shading anomaly, no color change | Local variance / gradient-magnitude mapping    |

Run all three passes over the full-resolution `ImageData`, collect
candidate boxes from each, merge overlapping ones, and hand the result to
`historyService.recordAdd()` exactly like `MagicDetectionHandler` does
today — same integration point, no new review-flow work needed.

---

## 3. Worker: `auto-detection.worker.ts`

```ts
/// <reference lib="webworker" />
import { findRustCandidates } from './passes/rust-pass';
import { findCrackCandidates } from './passes/crack-pass';
import { findDentCandidates } from './passes/dent-pass';
import { mergeCandidates } from './passes/merge';
import type { DetectionCandidate } from './passes/types';

addEventListener('message', (e: MessageEvent) => {
  const { imageData, width, height } = e.data as {
    imageData: Uint8ClampedArray;
    width: number;
    height: number;
  };

  const rust = findRustCandidates(imageData, width, height);
  const cracks = findCrackCandidates(imageData, width, height);
  const dents = findDentCandidates(imageData, width, height);

  const merged = mergeCandidates([...rust, ...cracks, ...dents], /* iouThreshold */ 0.3);

  postMessage({ type: 'DETECTION_RESULT', candidates: merged });
});
```

Transfer the buffer the same zero-copy way `magic-detection.handler.ts`
already does — nothing changes about that part of your pattern.

---

## 4. Pass 1 — Rust: reuse the existing flood-fill, just grid-seed it

You don't write new logic here. Take the exact flood-fill/PCA code behind
Magic Wand and run it from a coarse grid of seed points instead of one
user click, then discard fills that hit the `maxFillRatio` safety valve
(same abort condition, now used as a _filter_ instead of a failure).

```ts
// passes/rust-pass.ts
import { floodFillFromSeed } from '../../workers/magic-fill'; // existing logic
import type { DetectionCandidate } from './types';

export function findRustCandidates(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): DetectionCandidate[] {
  const gridStep = 32; // px, tune against typical defect size
  const candidates: DetectionCandidate[] = [];
  const visited = new Uint8Array(width * height);

  for (let y = gridStep / 2; y < height; y += gridStep) {
    for (let x = gridStep / 2; x < width; x += gridStep) {
      const idx = y * width + x;
      if (visited[idx]) continue;

      const fill = floodFillFromSeed(data, width, height, x, y, {
        maxFillRatio: 0.15, // same safety valve as Magic Wand
        autoTolerance: true,
      });

      if (!fill || fill.aborted) continue;
      if (fill.pixelCount < 40) continue; // too small to be a real region

      fill.pixels.forEach((p) => (visited[p] = 1));
      candidates.push({
        kind: 'rust',
        box: fill.toNormalizedBox(width, height), // uses box-utils.ts
        confidence: fill.colorCohesion, // 0–1, how tight the color match was
      });
    }
  }

  return candidates;
}
```

Marking visited pixels as you go means overlapping grid seeds that land
in the same rust patch collapse into one candidate for free, before you
even get to the merge step.

---

## 5. Pass 2 — Cracks: Sobel edges, filtered by shape

Cracks are thin and high-aspect-ratio. Plain edge detection finds _every_
edge (including normal surface texture and object boundaries), so the
filter that matters is elongation, not just "has an edge."

```ts
// passes/crack-pass.ts
import type { DetectionCandidate } from './types';
import { sobelMagnitude } from './sobel';
import { connectedComponents } from './connected-components';
import { toNormalizedBox } from '../../utils/box-utils';

export function findCrackCandidates(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): DetectionCandidate[] {
  const gray = toGrayscale(data, width, height);
  const edges = sobelMagnitude(gray, width, height, /* threshold */ 40);
  const components = connectedComponents(edges, width, height);

  const candidates: DetectionCandidate[] = [];
  for (const comp of components) {
    const { minX, minY, maxX, maxY, pixelCount } = comp;
    const w = maxX - minX;
    const h = maxY - minY;
    const aspectRatio = Math.max(w, h) / Math.max(1, Math.min(w, h));
    const fillRatio = pixelCount / (w * h);

    // Cracks: long and thin, sparse fill (a line, not a blob)
    if (aspectRatio < 4) continue;
    if (fillRatio > 0.35) continue;
    if (pixelCount < 15) continue;

    candidates.push({
      kind: 'crack',
      box: toNormalizedBox(minX, minY, w, h, width, height),
      confidence: Math.min(1, aspectRatio / 12),
      rotation: comp.principalAngle, // PCA on edge pixels, same trick as Magic Wand
    });
  }

  return candidates;
}
```

`principalAngle` here is the same PCA-for-rotation idea already used in
the Magic Wand pipeline (§3.5 of the brief) — applied to edge pixels
instead of flood-filled region pixels.

---

## 6. Pass 3 — Dents: local variance / gradient mapping

Dents don't reliably show up in either color or hard edges — they show up
as a smooth local change in shading (a highlight/shadow gradient across
an otherwise flat, uniform surface). A local-variance map over gradient
magnitude, at a coarser scale than the crack pass, tends to isolate this.

```ts
// passes/dent-pass.ts
import type { DetectionCandidate } from './types';
import { sobelMagnitude } from './sobel';
import { boxBlur } from './box-blur';
import { connectedComponents } from './connected-components';
import { toNormalizedBox } from '../../utils/box-utils';

export function findDentCandidates(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): DetectionCandidate[] {
  const gray = toGrayscale(data, width, height);

  // Low-threshold gradient map — catches subtle shading, not hard edges
  const gradients = sobelMagnitude(gray, width, height, /* threshold */ 8);

  // Smooth to find *regions* of elevated gradient, not individual edge pixels
  const smoothed = boxBlur(gradients, width, height, /* radius */ 12);

  const components = connectedComponents(smoothed, width, height, {
    binarizeThreshold: 20,
  });

  const candidates: DetectionCandidate[] = [];
  for (const comp of components) {
    const { minX, minY, maxX, maxY, pixelCount } = comp;
    const w = maxX - minX;
    const h = maxY - minY;
    const aspectRatio = Math.max(w, h) / Math.max(1, Math.min(w, h));

    // Dents: roughly blob-shaped, not thin like cracks
    if (aspectRatio > 3) continue;
    if (pixelCount < 80) continue;

    candidates.push({
      kind: 'dent',
      box: toNormalizedBox(minX, minY, w, h, width, height),
      confidence: comp.meanIntensity / 255,
    });
  }

  return candidates;
}
```

This pass is the weakest link in Tier A — it's the closest thing to a
"guess," and will need real tuning against your actual inspection photos
(surface material and lighting vary a lot per §8). Treat its confidence
scores as low-trust and expect a higher false-positive rate here than the
other two passes; it's the one most worth flagging as "unproven" in review.

---

## 7. Merge pass: NMS across all three candidate sets

Different passes can each fire on the same physical defect (e.g. a rust
patch with a slightly raised edge might trip both the rust and dent
pass). Standard box-IoU non-max-suppression, keeping the higher-confidence
box:

```ts
// passes/merge.ts
import type { DetectionCandidate } from './types';

export function mergeCandidates(
  candidates: DetectionCandidate[],
  iouThreshold: number,
): DetectionCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const kept: DetectionCandidate[] = [];

  for (const cand of sorted) {
    const overlaps = kept.some((k) => iou(k.box, cand.box) > iouThreshold);
    if (!overlaps) kept.push(cand);
  }

  return kept;
}

function iou(a: DetectionCandidate['box'], b: DetectionCandidate['box']): number {
  // standard axis-aligned IoU on normalized center-form boxes;
  // rotation ignored for the overlap test (good enough for NMS purposes)
  const ax1 = a.x - a.w / 2,
    ax2 = a.x + a.w / 2;
  const ay1 = a.y - a.h / 2,
    ay2 = a.y + a.h / 2;
  const bx1 = b.x - b.w / 2,
    bx2 = b.x + b.w / 2;
  const by1 = b.y - b.h / 2,
    by2 = b.y + b.h / 2;

  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const intersection = ix * iy;
  const union = a.w * a.h + b.w * b.h - intersection;
  return union > 0 ? intersection / union : 0;
}
```

---

## 8. Handler: `auto-detection.handler.ts`

Same shape as `MagicDetectionHandler` — owns the Worker, exposes
`destroy()`, reports a busy state, and turns each candidate into a
`Box{state:'pending'}` via `historyService.recordAdd()`. This is the part
that's identical regardless of which detection approach (Tier A or Tier
B) feeds it, which is the whole point of the §5 contract in the original
brief — the handler doesn't care how the boxes were produced.

```ts
// handlers/auto-detection.handler.ts
export class AutoDetectionHandler {
  private worker: Worker;
  public isRunning = signal(false);

  constructor(
    private state: CanvasState,
    private historyService: HistoryService,
  ) {
    this.worker = new Worker(new URL('../workers/auto-detection.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = ({ data }) => this.onWorkerResult(data);
  }

  runDetection(): void {
    const bgc = this.state.bgCanvas();
    const ctx = bgc.getContext('2d')!;
    const imageData = ctx.getImageData(0, 0, bgc.width, bgc.height);

    this.isRunning.set(true);
    this.worker.postMessage(
      { imageData: imageData.data, width: bgc.width, height: bgc.height },
      [imageData.data.buffer], // zero-copy transfer, same as Magic Wand
    );
  }

  private onWorkerResult(data: { type: string; candidates: DetectionCandidate[] }) {
    if (data.type !== 'DETECTION_RESULT') return;

    for (const cand of data.candidates) {
      this.historyService.recordAdd({
        ...cand.box,
        state: 'pending',
        tempId: this.state.getNextTempId(),
        color: colorForDefectKind(cand.kind), // placeholder taxonomy per §2
      });
    }

    this.isRunning.set(false);
  }

  destroy(): void {
    this.worker.terminate();
  }
}
```

---

## 9. Why this wins (as a Tier A pitch)

1. **Zero new dependencies, zero downloads.** Ships in your next build,
   works offline from the very first load, no CDN in the critical path.
2. **Reuses code you already trust.** The rust pass literally _is_ the
   Magic Wand's flood-fill, just grid-seeded — same safety valve, same
   PCA rotation logic, no new failure modes to learn.
3. **Same Worker/handler shape as everything else in the codebase.** No
   architectural deviation — `AutoDetectionHandler` looks exactly like
   `MagicDetectionHandler` from the component's point of view.
4. **Cheap to run repeatedly.** No model warm-up, no embedding cache to
   manage — every run is a fresh, fast pixel pass, useful if you want
   "detect" to be re-runnable after a crop/rotate without a reload cost.

## 10. Why it's a bootstrap, not the final answer

- No real learned prior — false positives on surface texture, false
  negatives on subtle dents, are expected and will need real tuning
  against your actual photo set, not just the sample values above.
- No path to open-vocabulary classes (§8's "extensible taxonomy" goal) —
  each new defect _type_ needs a new hand-written pass, unlike SAM+CLIP
  or Grounded-SAM, which generalize via prompts.
- Doesn't improve with usage the way a trained model does — accepted/
  rejected pending boxes from user review are still valuable as future
  training data (same as noted for the backend path), but Tier A itself
  has no way to consume that data to get better over time.

Good as the thing you ship this week; the trained-model paths (Tier B
client-side, or the backend Grounded-SAM/SAM plan) remain the place this
eventually needs to land for real accuracy.
