import { Box, getBoxId } from '../../../intefaces/boxes.interface';
import { Camera, TextMetrics } from '../core/types';
import { BOX_TYPES } from '../core/creation-state';
import { CreateBoxState } from '../core/creation-state';
import { BoxUtils } from './box-utils';
import { RenderUtils } from './render-utils';
import { NametagUtils } from './nametag-utils';
import { CreationUtils } from './creation-utils';
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
    hoveredBoxId: string | null,
    selectedBoxId: string | null,
    showNametags: boolean,
    nametagMetricsCache: Map<string, TextMetrics>,
    createState: CreateBoxState,
    debugShowQuadtree: boolean,
    quadtree: Quadtree<Box> | undefined,
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

    // Convert to world boxes
    const worldBoxes = visibleBoxes
      .map((b) => (bgCanvas ? BoxUtils.normalizeBoxToWorld(b, imageWidth, imageHeight) : null))
      .filter((b): b is NonNullable<typeof b> => !!b);

    // Group by color for efficient rendering
    const groups = new Map<string, typeof worldBoxes>();
    for (const b of worldBoxes) {
      if (!groups.has(b.color)) groups.set(b.color, []);
      groups.get(b.color)!.push(b);
    }

    // Draw boxes
    for (const [_, boxes] of groups.entries()) {
      for (const b of boxes) {
        RenderUtils.drawBox(ctx, b, camera, String(getBoxId(b.raw)) === hoveredBoxId);

        if (String(getBoxId(b.raw)) === selectedBoxId) {
          RenderUtils.drawSelectionUI(ctx, b, camera);
        }
      }
    }

    // Draw nametags
    if (showNametags) {
      for (const b of worldBoxes) {
        NametagUtils.drawNametag(ctx, b, camera, canvas.width, canvas.height, nametagMetricsCache);
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
      CreationUtils.drawCreationPreview(ctx, previewBox, BOX_TYPES.finding.defaultColor, camera);
    }

    // Debug quadtree
    if (debugShowQuadtree && quadtree) {
      ctx.save();
      RenderUtils.drawQuadtreeNode(ctx, quadtree.root, camera);
      ctx.restore();
    }
  }
}
