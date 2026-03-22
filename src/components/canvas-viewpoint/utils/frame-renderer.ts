import { Box, getBoxId } from '../../../interface/boxes.interface';
import { Camera, TextMetrics, MeasurementState } from '../core/types';
import { BOX_TYPES } from '../core/creation-state';
import { CreateBoxState } from '../core/creation-state';
import { BoxUtils } from './box-utils';
import { RenderUtils } from './render-utils';
import { NametagUtils } from './nametag-utils';
import { CreationUtils } from './creation-utils';
import { MeasurementRenderUtils } from './measurement-render-utils';
import { Quadtree } from '../core/quadtree';

/**
 * Handles the complete frame rendering pipeline
 */
export class FrameRenderer {
  /**
   * Renders a complete frame to the canvas
   */
  static renderFrame(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    camera: Camera,
    bgCanvas: HTMLCanvasElement | undefined,
    visibleBoxes: Box[],
    imageWidth: number,
    imageHeight: number,
    hoveredBoxId: number | null,
    selectedBoxId: number | null,
    showNametags: boolean,
    nametagMetricsCache: Map<string, TextMetrics>,
    createState: CreateBoxState,
    debugShowQuadtree: boolean,
    quadtree: Quadtree<Box> | undefined,
    measurementState: MeasurementState,
    currentMouseAbs: { x: number; y: number } | null,
    showPendingState: boolean,
  ): void {
    // Clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply camera transform
    RenderUtils.applyCameraTransform(ctx, canvas.width, canvas.height, camera);

    // Background
    if (bgCanvas) {
      ctx.drawImage(bgCanvas, -bgCanvas.width / 2, -bgCanvas.height / 2);
    }

    // Convert to absolute boxes
    const absBoxes = visibleBoxes
      .map((b) => (bgCanvas ? BoxUtils.normalizeBoxToAbsolute(b, imageWidth, imageHeight) : null))
      .filter((b): b is NonNullable<typeof b> => !!b);

    // Group by color for efficient rendering
    const groups = new Map<string, typeof absBoxes>();
    for (const b of absBoxes) {
      if (!groups.has(b.color)) groups.set(b.color, []);
      groups.get(b.color)!.push(b);
    }

    // Draw boxes
    for (const [_, boxes] of groups.entries()) {
      for (const b of boxes) {
        const isPending = showPendingState && b.raw.state === 'pending';
        RenderUtils.drawBox(ctx, b, camera, getBoxId(b.raw) === hoveredBoxId, isPending);

        if (getBoxId(b.raw) === selectedBoxId) {
          RenderUtils.drawSelectionUI(ctx, b, camera);
        }
      }
    }

    // Draw nametags
    if (showNametags) {
      for (const b of absBoxes) {
        NametagUtils.drawNametag(
          ctx,
          b,
          camera,
          canvas.width,
          canvas.height,
          nametagMetricsCache,
          showPendingState && b.raw.state === 'pending',
        );
      }
    }

    // Draw creation preview
    if (createState.isCreating && createState.startPoint && createState.currentPoint) {
      const previewBox = CreationUtils.createPreviewBox(
        createState.startPoint.x,
        createState.startPoint.y,
        createState.currentPoint.x,
        createState.currentPoint.y,
      );
      CreationUtils.drawCreationPreview(
        ctx,
        previewBox,
        BOX_TYPES['you tellin'].defaultColor,
        camera,
      );
    }

    // Debug quadtree
    if (debugShowQuadtree && quadtree) {
      ctx.save();
      RenderUtils.drawQuadtreeNode(ctx, quadtree.root, camera);
      ctx.restore();
    }

    // Draw measurement tool
    if (measurementState.isActive) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform for screen-space rendering
      MeasurementRenderUtils.render(
        ctx,
        measurementState,
        camera,
        canvas.width,
        canvas.height,
        imageWidth,
        imageHeight,
        currentMouseAbs,
      );
      ctx.restore();
    }
  }
}
