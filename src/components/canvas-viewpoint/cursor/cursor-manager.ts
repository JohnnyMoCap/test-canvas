import { WritableSignal } from '@angular/core';
import { ResizeCorner } from '../core/types';
import { CursorStyles } from './cursor-styles';

/**
 * Cursor Manager - Layer between business logic and utils
 * Handles cursor state updates based on user interactions
 */
export class CursorManager {
  /**
   * Update cursor for resize interaction
   */
  static updateForResize(
    cursorSignal: WritableSignal<string>,
    canvasElement: HTMLCanvasElement | null,
    corner: ResizeCorner,
    box: { x: number; y: number; w: number; h: number; rotation: number },
  ): void {
    const cursor = CursorStyles.getResizeCursor(corner, box);
    this.setCursor(cursorSignal, canvasElement, cursor);
  }

  /**
   * Update cursor for rotation interaction
   */
  static updateForRotation(
    cursorSignal: WritableSignal<string>,
    canvasElement: HTMLCanvasElement | null,
  ): void {
    const cursor = CursorStyles.getRotateCursor();
    this.setCursor(cursorSignal, canvasElement, cursor);
  }

  /**
   * Update cursor for drag interaction
   */
  static updateForDrag(
    cursorSignal: WritableSignal<string>,
    canvasElement: HTMLCanvasElement | null,
  ): void {
    const cursor = CursorStyles.getDragCursor();
    this.setCursor(cursorSignal, canvasElement, cursor);
  }

  /**
   * Update cursor for hovering over box
   */
  static updateForHover(
    cursorSignal: WritableSignal<string>,
    canvasElement: HTMLCanvasElement | null,
  ): void {
    const cursor = CursorStyles.getHoverCursor();
    this.setCursor(cursorSignal, canvasElement, cursor);
  }

  /**
   * Update cursor for hovering over rotation knob
   */
  static updateForRotationKnob(
    cursorSignal: WritableSignal<string>,
    canvasElement: HTMLCanvasElement | null,
  ): void {
    const cursor = CursorStyles.getRotationKnobCursor();
    this.setCursor(cursorSignal, canvasElement, cursor);
  }

  /**
   * Update cursor to default
   */
  static updateToDefault(
    cursorSignal: WritableSignal<string>,
    canvasElement: HTMLCanvasElement | null,
  ): void {
    const cursor = CursorStyles.getDefaultCursor();
    this.setCursor(cursorSignal, canvasElement, cursor);
  }

  /**
   * Update cursor for create mode
   */
  static updateForCreateMode(
    cursorSignal: WritableSignal<string>,
    canvasElement: HTMLCanvasElement | null,
  ): void {
    const cursor = CursorStyles.getCreateModeCursor();
    this.setCursor(cursorSignal, canvasElement, cursor);
  }

  /**
   * Internal method to set cursor if changed
   */
  private static setCursor(
    cursorSignal: WritableSignal<string>,
    canvasElement: HTMLCanvasElement | null,
    cursor: string,
  ): void {
    if (cursorSignal() !== cursor) {
      cursorSignal.set(cursor);
      if (canvasElement) {
        canvasElement.style.cursor = cursor;
      }
    }
  }
}
