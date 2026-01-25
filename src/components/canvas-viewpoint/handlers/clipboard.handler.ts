import { WritableSignal } from '@angular/core';
import { Box, getBoxId } from '../../../intefaces/boxes.interface';
import { Camera } from '../core/types';
import { ClipboardManager as ClipboardUtils } from '../utils/clipboard-manager';
import { HistoryService } from '../../../services/history.service';

/**
 * Handler for clipboard operations (copy, paste, cut)
 * Layer 3: Business Logic
 */
export class ClipboardHandler {
  /**
   * Copy selected box to clipboard
   */
  static copy(
    selectedBoxId: string | null,
    boxes: Box[],
    clipboardSignal: WritableSignal<Box | null>,
  ): void {
    if (!selectedBoxId) return;

    const copiedBox = ClipboardUtils.copyBox(selectedBoxId, boxes);
    if (copiedBox) {
      clipboardSignal.set(copiedBox);
    }
  }

  /**
   * Cut selected box to clipboard and remove from boxes
   */
  static cut(
    selectedBoxId: string | null,
    boxes: Box[],
    clipboardSignal: WritableSignal<Box | null>,
    historyService: HistoryService,
  ): { clipboard: Box | null; updatedBoxes: Box[] } {
    if (!selectedBoxId) {
      return { clipboard: null, updatedBoxes: boxes };
    }

    const box = boxes.find((b) => String(getBoxId(b)) === selectedBoxId);
    if (!box) {
      return { clipboard: null, updatedBoxes: boxes };
    }

    // Copy to clipboard
    clipboardSignal.set({ ...box });

    // Remove from boxes
    const updatedBoxes = boxes.filter((b) => String(getBoxId(b)) !== selectedBoxId);

    // Record in history
    const boxId = getBoxId(box);
    historyService.recordDelete(boxId);

    return { clipboard: { ...box }, updatedBoxes };
  }

  /**
   * Paste box from clipboard
   */
  static paste(
    clipboard: Box | null,
    mouseScreenPos: { x: number; y: number } | null,
    canvas: HTMLCanvasElement,
    canvasRect: DOMRect,
    camera: Camera,
    bgWidth: number,
    bgHeight: number,
    devicePixelRatio: number,
    nextTempId: number,
    historyService: HistoryService,
  ): Box | null {
    if (!clipboard) return null;

    const pastedBox = ClipboardUtils.createPastedBox(
      clipboard,
      mouseScreenPos,
      canvas,
      canvasRect,
      camera,
      bgWidth,
      bgHeight,
      devicePixelRatio,
      nextTempId,
    );

    historyService.recordAdd(pastedBox);

    return pastedBox;
  }

  /**
   * Delete selected box
   */
  static delete(selectedBoxId: string | null, boxes: Box[], historyService: HistoryService): Box[] {
    if (!selectedBoxId) return boxes;

    const box = boxes.find((b) => String(getBoxId(b)) === selectedBoxId);
    if (!box) return boxes;

    const boxId = getBoxId(box);
    historyService.recordDelete(boxId);

    return boxes.filter((b) => String(getBoxId(b)) !== selectedBoxId);
  }
}
