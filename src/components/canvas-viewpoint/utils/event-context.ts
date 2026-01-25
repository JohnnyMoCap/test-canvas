import { Camera, ResizeCorner } from '../core/types';
import { Box } from '../../../intefaces/boxes.interface';

/**
 * Callbacks that event handlers can invoke.
 * Groups related callbacks to reduce parameter count.
 */
export interface EventContext {
  // State queries
  getBoxes(): Box[];
  getCamera(): Camera;

  // Actions - Box creation
  onCreateStart(worldX: number, worldY: number): void;
  onCreatePreview(worldX: number, worldY: number): void;
  onCreateComplete(startX: number, startY: number, endX: number, endY: number): void;

  // Actions - Box interaction
  onBoxInteractionStart(
    boxId: string,
    isRotating: boolean,
    isResizing: boolean,
    isDragging: boolean,
    resizeCorner?: ResizeCorner,
  ): void;
  onRotate(worldX: number, worldY: number): void;
  onResize(worldX: number, worldY: number): void;
  onDrag(worldX: number, worldY: number): void;
  onInteractionComplete(
    boxId: string,
    startState: { x: number; y: number; w: number; h: number; rotation: number },
    box: Box,
    isRotating: boolean,
    isResizing: boolean,
    isDragging: boolean,
  ): void;

  // Actions - Camera
  onCameraPanStart(): void;
  onCameraPan(dx: number, dy: number): void;
  onZoom(newCamera: Camera, worldX: number, worldY: number): void;

  // Actions - Context menu
  onContextMenuOpen(x: number, y: number, worldX: number, worldY: number): void;

  // Actions - Hover & UI
  onHoverDetection(worldX: number, worldY: number): void;
  onUpdateCursor(cursor: string): void;

  // Actions - Lifecycle
  onRebuildIndex(): void;
}
