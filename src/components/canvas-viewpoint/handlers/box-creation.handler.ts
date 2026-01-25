import { WritableSignal } from '@angular/core';
import { Box } from '../../../intefaces/boxes.interface';
import { CreateBoxState } from '../core/creation-state';
import { BoxType } from '../core/creation-state';
import { Camera } from '../core/types';
import { BoxCreationUtils } from '../utils/box-creation-utils';
import { HistoryService } from '../../../services/history.service';

/**
 * Handler for box creation operations
 * Layer 3: Business Logic
 */
export class BoxCreationHandler {
  /**
   * Start creating a box via drag-to-create
   */
  static startCreate(
    worldX: number,
    worldY: number,
    createStateSignal: WritableSignal<CreateBoxState>,
  ): void {
    createStateSignal.set({
      isCreating: true,
      startPoint: { x: worldX, y: worldY },
      currentPoint: { x: worldX, y: worldY },
    });
  }

  /**
   * Update preview during drag-to-create
   */
  static updatePreview(
    worldX: number,
    worldY: number,
    createStateSignal: WritableSignal<CreateBoxState>,
  ): void {
    const current = createStateSignal();
    if (current.isCreating && current.startPoint) {
      createStateSignal.set({
        ...current,
        currentPoint: { x: worldX, y: worldY },
      });
    }
  }

  /**
   * Complete drag-to-create and add box
   */
  static completeCreate(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    imageWidth: number,
    imageHeight: number,
    nextTempId: number,
    historyService: HistoryService,
    color?: string,
    minSize: number = 10,
  ): Box | null {
    const tempId = BoxCreationUtils.generateTempId(nextTempId);
    const newBox = BoxCreationUtils.createBoxFromDrag(
      startX,
      startY,
      endX,
      endY,
      imageWidth,
      imageHeight,
      tempId,
      color,
      minSize,
    );

    if (newBox) {
      historyService.recordAdd(newBox);
    }

    return newBox;
  }

  /**
   * Create box from context menu
   */
  static createFromContextMenu(
    type: BoxType,
    worldX: number,
    worldY: number,
    camera: Camera,
    imageWidth: number,
    imageHeight: number,
    nextTempId: number,
    historyService: HistoryService,
  ): Box {
    const tempId = BoxCreationUtils.generateTempId(nextTempId);
    const newBox = BoxCreationUtils.createBoxFromContextMenu(
      type,
      worldX,
      worldY,
      camera,
      imageWidth,
      imageHeight,
      tempId,
    );

    historyService.recordAdd(newBox);

    return newBox;
  }

  /**
   * Reset creation state
   */
  static resetCreateState(createStateSignal: WritableSignal<CreateBoxState>): void {
    createStateSignal.set({
      isCreating: false,
      startPoint: null,
      currentPoint: null,
    });
  }
}
