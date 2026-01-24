/**
 * Manages cursor state and updates
 */
export class CursorManager {
  private currentCursor = 'default';

  /**
   * Update cursor if it has changed
   */
  setCursor(canvas: HTMLCanvasElement, cursor: string): void {
    if (this.currentCursor !== cursor) {
      this.currentCursor = cursor;
      canvas.style.cursor = cursor;
    }
  }

  /**
   * Get current cursor
   */
  getCurrentCursor(): string {
    return this.currentCursor;
  }

  /**
   * Reset to default cursor
   */
  reset(canvas: HTMLCanvasElement): void {
    this.setCursor(canvas, 'default');
  }
}
