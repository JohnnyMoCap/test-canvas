import { ContextMenuState, ContextMenuUtils } from '../utils/context-menu-utils';

/**
 * Handler for context menu operations
 * Layer 3: Business Logic
 */
export class ContextMenuHandler {
  /**
   * Open context menu at specified position
   */
  static open(screenX: number, screenY: number, worldX: number, worldY: number): ContextMenuState {
    return ContextMenuUtils.open(screenX, screenY, worldX, worldY);
  }

  /**
   * Close context menu
   */
  static close(): ContextMenuState {
    return ContextMenuUtils.close();
  }

  /**
   * Check if click is within context menu
   */
  static isWithinMenu(target: HTMLElement): boolean {
    return ContextMenuUtils.isWithinMenu(target);
  }
}
