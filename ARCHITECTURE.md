# Canvas Application Architecture

## Recent Updates

**January 25, 2026**: Completed state management consolidation refactor
- Merged CursorManager into StateManager
- Introduced EventContext pattern for cleaner event handling
- Added feature boundary comments throughout codebase
- See [ADR-001](docs/ADR-001-state-management-consolidation.md) for details

---

## Single Source of Truth: HistoryService.visibleBoxes

The application uses a centralized state management pattern where **HistoryService.visibleBoxes** is the single source of truth for all rendered box data.

### Data Flow

```
App (initialize) → HistoryService.boxes (raw data)
                         ↓
                   + Apply Filters (hide, etc.)
                         ↓
                   HistoryService.visibleBoxes (FILTERED SOURCE OF TRUTH)
                         ↓
                   CanvasViewport.localBoxes (mutable copy)
                         ↓
    User Interaction → Mutate localBoxes for real-time feedback
                         ↓
    Interaction Complete → HistoryService.record*() → Updates boxes signal
                         ↓
                   visibleBoxes recomputes → localBoxes resyncs
```

### Key Components

#### 1. **HistoryService** (`src/services/history.service.ts`)

- **Owns** the `boxes` signal (raw box data)
- **Provides** `visibleBoxes` computed signal (THE SOURCE OF TRUTH)
- **Applies** filters from HotkeyService (hide toggle)
- **Provides** undo/redo functionality with delta-based history
- **Methods:**
  - `initialize(boxes)` - Set initial boxes (called once at app startup)
  - `recordAdd(box)` - Adds box, records delta, updates boxes signal
  - `recordDelete(boxId)` - Removes box, records delta, updates boxes signal
  - `recordMove(...)` - Records position change, updates boxes signal
  - `recordResize(...)` - Records geometry change, updates boxes signal
  - `recordRotate(...)` - Records rotation change, updates boxes signal
  - `recordChangeClass(...)` - Records color change, updates boxes signal
  - `undo()` - Reverts last change, updates boxes signal
  - `redo()` - Reapplies undone change, updates boxes signal
- **Computed Signals:**
  - `visibleBoxes` - Boxes with all filters applied (hide, etc.) - THE SOURCE OF TRUTH

#### 2. **HotkeyService** (`src/services/hotkey.service.ts`)

- **Manages** global keyboard shortcuts
- **Provides** `hideBoxes` signal (toggled with H key)
- **Methods:**
  - `toggleHide()` - Toggles hide state
  - `setHide(boolean)` - Sets hide state explicitly
- **Hotkeys:**
  - Ctrl+Z - Undo
  - Ctrl+Y / Ctrl+Shift+Z - Redo
  - Ctrl+C - Copy
  - Ctrl+V - Paste (at mouse position or with visible offset)
  - H - Toggle hide all boxes

#### 3. **CanvasViewportComponent** (`src/components/canvas-viewpoint/`)

- **Subscribes** to `historyService.visibleBoxes()` and creates **local mutable copy**
- **Maintains** `localBoxes` signal for real-time interactions
- **Tracks** mouse position in world coordinates for paste functionality
- **Interaction Flow:**
  1. User starts drag/resize/rotate → Store initial state from `localBoxes`
  2. During interaction → **Directly mutate `localBoxes`** for smooth 60 FPS visuals
  3. On pointerUp → Call `historyService.record*()` with before/after states
  4. HistoryService updates its boxes signal → Triggers visibleBoxes recompute
  5. Effect resyncs `localBoxes` from `historyService.visibleBoxes()`

#### 4. **App Component** (`src/app/app.ts`)

- **Initializes** HistoryService with initial boxes
- Canvas automatically subscribes to HistoryService

### Benefits

1. **Single Source of Truth**: HistoryService.visibleBoxes is the canonical filtered state
2. **Reactive Filters**: Hide toggle automatically updates all subscribers
3. **Mutable Local Copy**: Canvas can mutate freely for performance without affecting history
4. **Automatic Resync**: Changes from history (undo/redo) or filters automatically update canvas
5. **Clean History**: Only committed interactions create history entries
6. **Performance**: Direct mutations during drag avoid signal overhead
7. **Clear Separation**: History logic separate from rendering logic

### Interaction Pattern

**Real-time Interaction (During Drag):**

```typescript
// Canvas mutates local copy directly - no history created
onPointerMove() {
  const box = this.localBoxes().find(b => getBoxId(b) === boxId);
  box.x = newX;
  box.y = newY;
  this.localBoxes.set([...this.localBoxes()]); // Signal update triggers render
}
```

**Commit Interaction (On Pointer Up):**

```typescript
onPointerUp() {
  // Get final state from local copy
  const box = this.localBoxes().find(b => getBoxId(b) === boxId);

  // Record to history with before/after
  this.historyService.recordMove(boxId, startX, startY, box.x, box.y);

  // HistoryService updates its boxes signal
  // visibleBoxes recomputes with filters
  // Effect automatically resyncs localBoxes from visibleBoxes
}
```

**Paste with Mouse Position:**

```typescript
handlePaste() {
  // Paste at last mouse position in world coordinates (center of box)
  if (this.lastMouseWorld) {
    newX = worldToNormalized(this.lastMouseWorld.x);
    newY = worldToNormalized(this.lastMouseWorld.y);
  } else {
    // Fallback with visible offset (5%)
    newX = clipboard.x + 0.05;
    newY = clipboard.y + 0.05;
  }
  this.historyService.recordAdd(newBox);
}
```

**Hide Toggle:**

```typescript
// User presses H key
HotkeyService.toggleHide() // Updates hideBoxes signal
    ↓
HistoryService.visibleBoxes recomputes
    ↓
Canvas.localBoxes resyncs (empty array if hidden)
    ↓
Canvas re-renders (shows/hides all boxes)
```

### Why This Design?

1. **Performance**: Mutating local copy during drag is faster than signal updates on every frame
2. **Clean History**: Only final states are recorded, not intermediate drag frames
3. **Automatic Sync**: Undo/redo automatically propagates to canvas via effect
4. **Reactive Filters**: Hide toggle works seamlessly without canvas involvement
5. **Clear Ownership**: HistoryService owns truth, HotkeyService owns UI state, Canvas owns presentation

This ensures:

- Smooth 60 FPS interactions with direct mutations
- Clean history with one entry per interaction (not per frame)
- Automatic synchronization between history, filters, and canvas
- No duplicate state management
- Reactive UI state (hide) without manual propagation
