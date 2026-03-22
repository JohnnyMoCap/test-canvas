/**
 * Context menu state management
 */
export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  absPos: { x: number; y: number } | null;
}

/**
 * Utilities for managing context menu state
 */
export class ContextMenuUtils {
  /**
   * Opens the context menu at the specified position
   */
  static open(screenX: number, screenY: number, absX: number, absY: number): ContextMenuState {
    return {
      visible: true,
      x: screenX,
      y: screenY,
      absPos: { x: absX, y: absY },
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
      absPos: null,
    };
  }

  /**
   * Checks if an element is within the context menu
   */
  static isWithinMenu(target: HTMLElement): boolean {
    return !!target.closest('app-box-context-menu');
  }
}
