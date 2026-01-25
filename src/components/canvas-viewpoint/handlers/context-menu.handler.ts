import { WritableSignal } from '@angular/core';
import { ContextMenuState, ContextMenuUtils } from '../utils/context-menu-utils';

/**
 * Handler for context menu operations
 * Layer 3: Business Logic
 */
export class ContextMenuHandler {
  /**
   * Open context menu at specified position
   */
  static open(
    screenX: number,
    screenY: number,
    worldX: number,
    worldY: number,
    contextMenuStateSignal: WritableSignal<ContextMenuState | null>,
  ): void {
    const state = ContextMenuUtils.open(screenX, screenY, worldX, worldY);
    contextMenuStateSignal.set(state);
  }

  /**
   * Close context menu
   */
  static close(contextMenuStateSignal: WritableSignal<ContextMenuState | null>): void {
    const state = ContextMenuUtils.close();
    contextMenuStateSignal.set(state);
  }

  /**
   * Check if click is within context menu
   */
  static isWithinMenu(target: HTMLElement): boolean {
    return ContextMenuUtils.isWithinMenu(target);
  }
}
