import { WritableSignal } from '@angular/core';
import { Box } from '../../../inteface/boxes.interface';
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
  static startCreate(absX: number, absY: number): CreateBoxState {
    return {
      isCreating: true,
      startPoint: { x: absX, y: absY },
      currentPoint: { x: absX, y: absY },
    };
  }

  /**
   * Update preview during drag-to-create
   */
  static updatePreview(
    absX: number,
    absY: number,
    currentState: CreateBoxState,
  ): CreateBoxState {
    if (currentState.isCreating && currentState.startPoint) {
      return {
        ...currentState,
        currentPoint: { x: absX, y: absY },
      };
    }
    return currentState;
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
    absX: number,
    absY: number,
    camera: Camera,
    imageWidth: number,
    imageHeight: number,
    nextTempId: number,
    historyService: HistoryService,
  ): Box {
    const tempId = BoxCreationUtils.generateTempId(nextTempId);
    const newBox = BoxCreationUtils.createBoxFromContextMenu(
      type,
      absX,
      absY,
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
  static resetCreateState(): CreateBoxState {
    return {
      isCreating: false,
      startPoint: null,
      currentPoint: null,
    };
  }
}
