import { Injectable, signal, computed, effect, DestroyRef, inject } from '@angular/core';

/**
 * Hotkey command types
 */
export type HotkeyCommand = 'UNDO' | 'REDO' | 'COPY' | 'PASTE' | 'HIDE' | 'DELETE';

/**
 * Callback type for hotkey handlers
 */
export type HotkeyCallback = (event: KeyboardEvent) => void;

/**
 * Manages global keyboard shortcuts while respecting input focus
 */
@Injectable({
  providedIn: 'root',
})
export class HotkeyService {
  private destroyRef = inject(DestroyRef);
  private listeners = new Map<HotkeyCommand, Set<HotkeyCallback>>();
  private _enabled = signal(true);
  private _hideBoxes = signal(false);

  // Public computed signals
  enabled = computed(() => this._enabled());
  hideBoxes = computed(() => this._hideBoxes());

  constructor() {
    this.attachGlobalListener();
  }

  /**
   * Registers a callback for a specific hotkey command
   */
  on(command: HotkeyCommand, callback: HotkeyCallback): () => void {
    if (!this.listeners.has(command)) {
      this.listeners.set(command, new Set());
    }
    this.listeners.get(command)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(command)?.delete(callback);
    };
  }

  /**
   * Enables or disables all hotkeys
   */
  setEnabled(enabled: boolean): void {
    this._enabled.set(enabled);
  }

  /**
   * Toggles the hide boxes state
   */
  toggleHide(): void {
    this._hideBoxes.update((value) => !value);
  }

  /**
   * Sets the hide boxes state
   */
  setHide(hide: boolean): void {
    this._hideBoxes.set(hide);
  }

  /**
   * Checks if the active element is an input that should prevent hotkeys
   */
  private isInputFocused(): boolean {
    const activeElement = document.activeElement;
    if (!activeElement) return false;

    const tagName = activeElement.tagName.toLowerCase();
    const isContentEditable = (activeElement as HTMLElement).isContentEditable;

    return (
      tagName === 'input' || tagName === 'textarea' || tagName === 'select' || isContentEditable
    );
  }

  /**
   * Attaches global keyboard listener
   */
  private attachGlobalListener(): void {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if hotkeys are disabled
      if (!this._enabled()) return;

      // Ignore if user is in an input field
      if (this.isInputFocused()) return;

      const ctrl = event.ctrlKey || event.metaKey; // Support both Ctrl and Cmd (Mac)
      const shift = event.shiftKey;
      const key = event.key.toLowerCase();

      let command: HotkeyCommand | null = null;

      // Ctrl+Z - Undo
      if (ctrl && !shift && key === 'z') {
        command = 'UNDO';
        event.preventDefault();
      }
      // Ctrl+Y or Ctrl+Shift+Z - Redo
      else if ((ctrl && key === 'y') || (ctrl && shift && key === 'z')) {
        command = 'REDO';
        event.preventDefault();
      }
      // Ctrl+C - Copy
      else if (ctrl && key === 'c') {
        command = 'COPY';
        event.preventDefault();
      }
      // Ctrl+V - Paste
      else if (ctrl && key === 'v') {
        command = 'PASTE';
        event.preventDefault();
      }
      // H or Ctrl+H - Hide (prevent browser history popup)
      else if (ctrl && key === 'h') {
        event.preventDefault();
        this.toggleHide();
        return; // Don't execute callbacks, just toggle the state
      }
      // Delete or Backspace - Delete
      else if (key === 'delete' || key === 'backspace') {
        command = 'DELETE';
        event.preventDefault();
      }

      // Execute callbacks for the command
      if (command) {
        const callbacks = this.listeners.get(command);
        if (callbacks) {
          callbacks.forEach((callback) => callback(event));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Clean up on service destruction
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('keydown', handleKeyDown);
    });
  }

  /**
   * Gets a summary of registered hotkeys
   */
  getRegisteredCommands(): HotkeyCommand[] {
    return Array.from(this.listeners.keys());
  }

  /**
   * Gets the number of listeners for a specific command
   */
  getListenerCount(command: HotkeyCommand): number {
    return this.listeners.get(command)?.size || 0;
  }

  /**
   * Clears all listeners for a specific command
   */
  clearCommand(command: HotkeyCommand): void {
    this.listeners.delete(command);
  }

  /**
   * Clears all listeners
   */
  clearAll(): void {
    this.listeners.clear();
  }

  /**
   * Gets a human-readable description of all hotkeys
   */
  getHotkeyDescriptions(): Array<{ keys: string; command: HotkeyCommand; description: string }> {
    return [
      { keys: 'Ctrl+Z', command: 'UNDO', description: 'Undo last action' },
      { keys: 'Ctrl+Y / Ctrl+Shift+Z', command: 'REDO', description: 'Redo action' },
      { keys: 'Ctrl+C', command: 'COPY', description: 'Copy selected box' },
      { keys: 'Ctrl+V', command: 'PASTE', description: 'Paste copied box' },
      { keys: 'H', command: 'HIDE', description: 'Hide/show selected boxes' },
      { keys: 'Delete', command: 'DELETE', description: 'Delete selected box' },
    ];
  }
}
