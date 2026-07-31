/// <reference lib="webworker" />

import { SamModel, AutoProcessor, RawImage, Processor, Tensor } from '@huggingface/transformers';
import type { SamWorkerRequest, SamWorkerResponse } from './sam.types';
import { maskToBox } from './mask-to-box';

/**
 * SAM proposes several candidate masks per click (typically 3: roughly
 * "whole object" / "part" / "subpart"). Its own predicted IoU alone tends to
 * favour the largest, most unambiguous boundary - on a mostly-uniform
 * aircraft panel, that's often the whole panel, not the small local defect
 * the user actually clicked on. Preferring the SMALLEST candidate that still
 * clears a reasonable confidence bar biases toward the local/precise reading
 * this tool actually wants (click on ONE thing you've spotted), while still
 * falling back to the highest-IoU mask if nothing clears the bar (an
 * outright bad set of proposals, better to return the model's best guess
 * than nothing). Engineering judgment, not benchmarked - revisit with real
 * usage data.
 */
const MIN_CONFIDENT_IOU = 0.5;

/**
 * The processor/model classes are typed loosely by the library (config-driven
 * at runtime, not statically narrowed per model type) - this is the concrete
 * shape SlimSAM's processor actually exposes, used for the casts below.
 *
 * `SamProcessor` (the wrapper `AutoProcessor.from_pretrained` returns for a
 * SAM model) only forwards `reshape_input_points`/`post_process_masks` to
 * its inner `image_processor` - NOT `add_input_labels`, which must be called
 * on `image_processor` directly (confirmed against the installed package's
 * actual source, `models/sam/processing_sam.js`, not just its `.d.ts`).
 */
interface SamProcessor extends Processor {
  (image: RawImage): Promise<{
    pixel_values: Tensor;
    original_sizes: [number, number][];
    reshaped_input_sizes: [number, number][];
  }>;
  reshape_input_points(
    points: number[][][],
    originalSizes: [number, number][],
    reshapedSizes: [number, number][],
  ): Tensor;
  post_process_masks(
    masks: Tensor,
    originalSizes: [number, number][],
    reshapedSizes: [number, number][],
  ): Promise<Tensor[]>;
}

/** The one method `SamProcessor` doesn't forward - called on `processor.image_processor` directly. */
interface SamImageProcessorLabels {
  add_input_labels(labels: number[][][], points: Tensor): Tensor;
}

let model: SamModel | null = null;
let processor: SamProcessor | null = null;

// Cached per-image state, so repeated clicks on the SAME photo only pay the
// (relatively expensive) encoder cost once - only the decoder re-runs per click.
let imageEmbeddings: { image_embeddings: Tensor; image_positional_embeddings: Tensor } | null = null;
let processedInputs: {
  pixel_values: Tensor;
  original_sizes: [number, number][];
  reshaped_input_sizes: [number, number][];
} | null = null;

function post(message: SamWorkerResponse): void {
  postMessage(message);
}

addEventListener('message', async ({ data }: MessageEvent<SamWorkerRequest>) => {
  try {
    if (data.type === 'INIT') {
      model = (await SamModel.from_pretrained(data.modelId)) as SamModel;
      processor = (await AutoProcessor.from_pretrained(data.modelId)) as unknown as SamProcessor;
      post({ type: 'READY' });
      return;
    }

    if (data.type === 'SET_IMAGE') {
      if (!model || !processor) throw new Error('Model not initialised - INIT must complete first');

      const pixels = new Uint8ClampedArray(data.buffer);
      const image = new RawImage(pixels, data.width, data.height, 4);

      processedInputs = await processor(image);
      imageEmbeddings = await model.get_image_embeddings({ pixel_values: processedInputs.pixel_values });

      post({ type: 'IMAGE_PROCESSED', requestId: data.requestId });
      return;
    }

    if (data.type === 'PREDICT_CLICK') {
      if (!model || !processor || !processedInputs || !imageEmbeddings) {
        throw new Error('No image embedded yet - send SET_IMAGE before PREDICT_CLICK');
      }

      const inputPoints = [[[data.x, data.y]]];
      const inputLabels = [[[1]]]; // 1 = foreground point

      const reshapedPoints = processor.reshape_input_points(
        inputPoints,
        processedInputs.original_sizes,
        processedInputs.reshaped_input_sizes,
      );
      const reshapedLabels = (
        processor.image_processor as unknown as SamImageProcessorLabels
      ).add_input_labels(inputLabels, reshapedPoints);

      const outputs = await model({
        ...imageEmbeddings,
        input_points: reshapedPoints,
        input_labels: reshapedLabels,
      });

      const masks = await processor.post_process_masks(
        outputs.pred_masks,
        processedInputs.original_sizes,
        processedInputs.reshaped_input_sizes,
      );

      const iouScores = outputs.iou_scores.data as Float32Array;
      const maskTensor = masks[0];
      const [, , maskHeight, maskWidth] = maskTensor.dims;
      const maskData = maskTensor.data as Uint8Array;
      const maskPixels = maskHeight * maskWidth;

      const candidates = Array.from(iouScores, (iou, i) => {
        const offset = i * maskPixels;
        let pixelCount = 0;
        for (let p = offset; p < offset + maskPixels; p++) {
          if (maskData[p]) pixelCount++;
        }
        return { index: i, iou, pixelCount };
      });

      const confident = candidates.filter((c) => c.iou >= MIN_CONFIDENT_IOU);
      const chosen =
        confident.length > 0
          ? confident.reduce((smallest, c) => (c.pixelCount < smallest.pixelCount ? c : smallest))
          : candidates.reduce((best, c) => (c.iou > best.iou ? c : best));

      if (data.debug) {
        console.log(
          '[SAM] Candidates:',
          candidates.map((c) => ({
            index: c.index,
            iou: c.iou.toFixed(3),
            pixelCount: c.pixelCount,
            areaPct: ((100 * c.pixelCount) / maskPixels).toFixed(1) + '%',
          })),
          'chosen index:',
          chosen.index,
        );
      }

      const mask = maskData.subarray(chosen.index * maskPixels, (chosen.index + 1) * maskPixels);

      const box = maskToBox(mask, maskWidth, maskHeight);
      if (!box) {
        post({ type: 'NO_MASK', requestId: data.requestId });
        return;
      }

      post({
        type: 'MASK_RESULT',
        requestId: data.requestId,
        centerX: box.centerX,
        centerY: box.centerY,
        bboxWidth: box.width,
        bboxHeight: box.height,
        rotation: box.rotation,
        pixelCount: box.pixelCount,
        confidence: chosen.iou,
      });
      return;
    }
  } catch (err) {
    post({
      type: 'ERROR',
      requestId: 'requestId' in data ? data.requestId : -1,
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
