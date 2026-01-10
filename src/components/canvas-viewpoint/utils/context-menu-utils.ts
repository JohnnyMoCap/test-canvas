/**
 * Context menu state management
 */
export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  worldPos: { x: number; y: number } | null;
}

/**
 * Utilities for managing context menu state
 */
export class ContextMenuUtils {
  /**
   * Opens the context menu at the specified position
   */
  static open(screenX: number, screenY: number, worldX: number, worldY: number): ContextMenuState {
    return {
      visible: true,
      x: screenX,
      y: screenY,
      worldPos: { x: worldX, y: worldY },
    };
  }

  /**
   * Closes the context menu
   */
  static close(): ContextMenuState {
    return {
      visible: false,
      x: 0,
      y: 0,
      worldPos: null,
    };
  }

  /**
   * Checks if an element is within the context menu
   */
  static isWithinMenu(target: HTMLElement): boolean {
    return !!target.closest('app-box-context-menu');
  }
}
