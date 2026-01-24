import { Injectable, signal, computed, inject } from '@angular/core';
import { Box, getBoxId } from '../intefaces/boxes.interface';
import { HotkeyService } from './hotkey.service';

/**
 * Delta operation types for undo/redo
 */
export type DeltaType = 'ADD' | 'DELETE' | 'ROTATE' | 'CHANGE_CLASS' | 'RESIZE' | 'MOVE';

/**
 * Represents a single change to a box
 */
export interface BoxDelta {
  type: DeltaType;
  boxId: string | number;
  timestamp: number;
  before?: Partial<Box>;
  after?: Partial<Box>;
  box?: Box; // For ADD operations
}

/**
 * Manages undo/redo history with delta-based operations
 */
@Injectable({
  providedIn: 'root',
})
export class HistoryService {
  private readonly MAX_HISTORY = 100;
  private readonly STORAGE_KEY = 'canvas-history';
  private hotkeyService = inject(HotkeyService);

  private _undoStack = signal<BoxDelta[]>([]);
  private _redoStack = signal<BoxDelta[]>([]);
  private _boxes = signal<Box[]>([]);

  // Public signals - boxes is the source of truth
  boxes = this._boxes.asReadonly();

  // Filtered boxes with all filters applied (hide, etc.) - THE SOURCE OF TRUTH for rendering
  visibleBoxes = computed(() => {
    const allBoxes = this._boxes();
    const shouldHide = this.hotkeyService.hideBoxes();

    // If hide is enabled, return empty array
    if (shouldHide) {
      return [];
    }

    // Otherwise return all boxes
    return allBoxes;
  });

  canUndo = computed(() => this._undoStack().length > 0);
  canRedo = computed(() => this._redoStack().length > 0);
  historySize = computed(() => this._undoStack().length);

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Initializes the service with initial boxes
   * Should only be called once at app startup
   */
  initialize(boxes: Box[]): void {
    this._boxes.set(boxes);
  }

  /**
   * Records an ADD operation
   */
  recordAdd(box: Box): void {
    const delta: BoxDelta = {
      type: 'ADD',
      boxId: getBoxId(box),
      timestamp: Date.now(),
      box: { ...box },
    };
    this.pushDelta(delta);
    // Apply the delta to update boxes
    this._boxes.set(this.applyDeltaForward(delta, this._boxes()));
  }

  /**
   * Records a DELETE operation
   */
  recordDelete(boxId: string | number): void {
    const box = this._boxes().find((b) => getBoxId(b) === boxId);
    if (!box) return;

    const delta: BoxDelta = {
      type: 'DELETE',
      boxId,
      timestamp: Date.now(),
      box: { ...box },
    };
    this.pushDelta(delta);
    // Apply the delta to update boxes
    this._boxes.set(this.applyDeltaForward(delta, this._boxes()));
  }

  /**
   * Records a MOVE operation
   */
  recordMove(
    boxId: string | number,
    beforeX: number,
    beforeY: number,
    afterX: number,
    afterY: number,
  ): void {
    // Skip if no actual change
    if (beforeX === afterX && beforeY === afterY) return;

    const delta: BoxDelta = {
      type: 'MOVE',
      boxId,
      timestamp: Date.now(),
      before: { x: beforeX, y: beforeY },
      after: { x: afterX, y: afterY },
    };
    this.pushDelta(delta);
    // Apply the delta to update boxes
    this._boxes.set(this.applyDeltaForward(delta, this._boxes()));
  }

  /**
   * Records a RESIZE operation
   */
  recordResize(
    boxId: string | number,
    before: { x: number; y: number; w: number; h: number },
    after: { x: number; y: number; w: number; h: number },
  ): void {
    // Skip if no actual change
    if (
      before.x === after.x &&
      before.y === after.y &&
      before.w === after.w &&
      before.h === after.h
    )
      return;

    const delta: BoxDelta = {
      type: 'RESIZE',
      boxId,
      timestamp: Date.now(),
      before,
      after,
    };
    this.pushDelta(delta);
    // Apply the delta to update boxes
    this._boxes.set(this.applyDeltaForward(delta, this._boxes()));
  }

  /**
   * Records a ROTATE operation
   */
  recordRotate(boxId: string | number, beforeRotation: number, afterRotation: number): void {
    // Skip if no actual change
    if (beforeRotation === afterRotation) return;

    const delta: BoxDelta = {
      type: 'ROTATE',
      boxId,
      timestamp: Date.now(),
      before: { rotation: beforeRotation },
      after: { rotation: afterRotation },
    };
    this.pushDelta(delta);
    // Apply the delta to update boxes
    this._boxes.set(this.applyDeltaForward(delta, this._boxes()));
  }

  /**
   * Records a CHANGE_CLASS operation (color change)
   */
  recordChangeClass(boxId: string | number, beforeColor: string, afterColor: string): void {
    // Skip if no actual change
    if (beforeColor === afterColor) return;

    const delta: BoxDelta = {
      type: 'CHANGE_CLASS',
      boxId,
      timestamp: Date.now(),
      before: { color: beforeColor },
      after: { color: afterColor },
    };
    this.pushDelta(delta);
    // Apply the delta to update boxes
    this._boxes.set(this.applyDeltaForward(delta, this._boxes()));
  }

  /**
   * Performs undo operation
   */
  undo(): void {
    const stack = this._undoStack();
    if (stack.length === 0) return;

    const delta = stack[stack.length - 1];
    const newUndoStack = stack.slice(0, -1);
    this._undoStack.set(newUndoStack);

    // Add to redo stack
    const redoStack = [...this._redoStack(), delta];
    this._redoStack.set(redoStack);

    const updatedBoxes = this.applyDeltaReverse(delta, this._boxes());
    this._boxes.set(updatedBoxes);
    this.saveToStorage();
  }

  /**
   * Performs redo operation
   */
  redo(): void {
    const stack = this._redoStack();
    if (stack.length === 0) return;

    const delta = stack[stack.length - 1];
    const newRedoStack = stack.slice(0, -1);
    this._redoStack.set(newRedoStack);

    // Add back to undo stack
    const undoStack = [...this._undoStack(), delta];
    this._undoStack.set(undoStack);

    const updatedBoxes = this.applyDeltaForward(delta, this._boxes());
    this._boxes.set(updatedBoxes);
    this.saveToStorage();
  }

  /**
   * Clears all history
   */
  clear(): void {
    this._undoStack.set([]);
    this._redoStack.set([]);
    this.clearStorage();
  }

  /**
   * Gets current history statistics
   */
  getStats() {
    return computed(() => ({
      undoCount: this._undoStack().length,
      redoCount: this._redoStack().length,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    }));
  }

  /**
   * Pushes a delta to the undo stack
   */
  private pushDelta(delta: BoxDelta): void {
    let stack = [...this._undoStack(), delta];

    // Limit stack size
    if (stack.length > this.MAX_HISTORY) {
      stack = stack.slice(stack.length - this.MAX_HISTORY);
    }

    this._undoStack.set(stack);
    this._redoStack.set([]); // Clear redo stack on new action
    this.saveToStorage();
  }

  /**
   * Applies a delta in reverse (for undo)
   */
  private applyDeltaReverse(delta: BoxDelta, boxes: Box[]): Box[] {
    switch (delta.type) {
      case 'ADD':
        // Remove the added box
        return boxes.filter((b) => getBoxId(b) !== delta.boxId);

      case 'DELETE':
        // Restore the deleted box
        return delta.box ? [...boxes, delta.box] : boxes;

      case 'MOVE':
      case 'RESIZE':
      case 'ROTATE':
      case 'CHANGE_CLASS':
        // Revert to before state
        return boxes.map((b) => (getBoxId(b) === delta.boxId ? { ...b, ...delta.before } : b));

      default:
        return boxes;
    }
  }

  /**
   * Applies a delta forward
   */
  private applyDeltaForward(delta: BoxDelta, boxes: Box[]): Box[] {
    switch (delta.type) {
      case 'ADD':
        // Re-add the box
        return delta.box ? [...boxes, delta.box] : boxes;

      case 'DELETE':
        // Re-delete the box
        return boxes.filter((b) => getBoxId(b) !== delta.boxId);

      case 'MOVE':
      case 'RESIZE':
      case 'ROTATE':
      case 'CHANGE_CLASS':
        // Apply after state
        return boxes.map((b) => (getBoxId(b) == delta.boxId ? { ...b, ...delta.after } : b));

      default:
        return boxes;
    }
  }

  /**
   * Saves history to localStorage for crash recovery
   */
  private saveToStorage(): void {
    try {
      const data = {
        undoStack: this._undoStack(),
        redoStack: this._redoStack(),
        timestamp: Date.now(),
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save history to localStorage:', e);
    }
  }

  /**
   * Loads history from localStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) return;

      const data = JSON.parse(stored);

      // Only restore if less than 24 hours old
      const age = Date.now() - (data.timestamp || 0);
      if (age < 24 * 60 * 60 * 1000) {
        this._undoStack.set(data.undoStack || []);
        this._redoStack.set(data.redoStack || []);
      } else {
        this.clearStorage();
      }
    } catch (e) {
      console.warn('Failed to load history from localStorage:', e);
      this.clearStorage();
    }
  }

  /**
   * Clears localStorage
   */
  private clearStorage(): void {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to clear localStorage:', e);
    }
  }
}
