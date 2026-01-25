# ADR 001: State Management Consolidation

## Status

Implemented - January 25, 2026

## Context

The canvas viewport component had fragmented state management across multiple classes which led to several issues:

### Problems

1. **Duplicated cursor state**: Both `StateManager` and `CursorManager` tracked cursor state independently
2. **Excessive callback parameters**: Event handlers required 8-13 callback parameters, making them difficult to use and maintain
3. **Hard to trace features**: Business logic was split across multiple files with no clear ownership
4. **Unstable APIs**: Adding new features required updating many function signatures

### Example of the Problem

```typescript
// Before: 13 callback parameters!
PointerEventHandler.handlePointerDown(
  event,
  canvas,
  state,
  camera,
  boxes,
  quadtree,
  cache,
  ctx,
  onContextMenuOpen,
  onCreateStart,
  onBoxInteractionStart,
  onCameraPanStart,
  onUpdateCursor,
);
```

## Decision

We implemented a three-phase consolidation:

### Phase 1: Merge CursorManager into StateManager

- **Eliminated**: `cursor-manager.ts` (30 lines of duplicate code)
- **Added**: Canvas reference tracking in StateManager
- **Improved**: `setCursor()` no longer requires passing canvas element every time

**Before:**

```typescript
private cursorManager = new CursorManager();
// ...
this.cursorManager.setCursor(this.canvasRef.nativeElement, 'move');
```

**After:**

```typescript
// In ngAfterViewInit
this.state.setCanvas(this.canvasRef.nativeElement);
// Anywhere else
this.state.setCursor('move');
```

### Phase 2: Introduce EventContext Interface

- **Created**: `event-context.ts` - Groups related callbacks logically
- **Reduced**: PointerEventHandler parameters from 14 to 7
- **Simplified**: Component event handlers from 33 lines to 9 lines each

**Before:**

```typescript
onPointerMove(e: PointerEvent) {
  PointerEventHandler.handlePointerMove(
    e, canvas, state, camera, boxes, quadtree, cache, ctx,
    (worldX, worldY) => { /* create preview */ },
    (worldX, worldY) => { /* rotate */ },
    (worldX, worldY) => { /* resize */ },
    (worldX, worldY) => { /* drag */ },
    (dx, dy) => { /* camera pan */ },
    (worldX, worldY) => { /* hover */ },
    (cursor) => { /* update cursor */ },
  );
}
```

**After:**

```typescript
onPointerMove(e: PointerEvent) {
  PointerEventHandler.handlePointerMove(
    e,
    this.canvasRef.nativeElement,
    this.state,
    this.quadtree,
    this.nametagMetricsCache,
    this.state.ctx(),
    this.eventContext,
  );
}
```

The `eventContext` object is created once in the constructor and contains all callback implementations.

### Phase 3: Add Feature Boundary Comments

Added clear section markers to indicate feature boundaries:

**StateManager** - Organized by feature:

```typescript
// ========================================
// FEATURE: BOX INTERACTION (Rotate/Resize/Drag)
// ========================================
isPointerDown = signal(false);
isDraggingBox = signal(false);
// ... related signals grouped together
```

**PointerEventHandler** - Documents priority order:

```typescript
/**
 * Handle pointer down event
 *
 * PRIORITY ORDER:
 * 1. Context menu
 * 2. Box creation mode
 * 3. Box interaction (rotation knob, resize corners)
 * 4. Box selection
 * 5. Camera pan (fallback)
 */
```

**CanvasViewportComponent** - Features clearly separated:

```typescript
// ========================================
// FEATURE: BOX CREATION
// ========================================
// Related: box-creation-utils.ts, creation-utils.ts

toggleCreateMode() { ... }
private handleCreateComplete() { ... }
```

## Consequences

### Positive ✅

1. **20% fewer lines of code** - Removed 30 lines from CursorManager deletion, reduced ~100 lines in component
2. **Single source of truth for cursor** - No more synchronization issues
3. **More stable API** - Adding features doesn't require changing 10+ function signatures
4. **Easier testing** - Mock one EventContext object instead of 13 callbacks
5. **Clearer feature boundaries** - Comments show what code belongs to which feature
6. **Better cross-referencing** - Comments link to related utility files

### Negative ⚠️

1. **One-time migration effort** - Took ~6 hours to implement all phases
2. **EventContext adds indirection** - Extra hop for callbacks (negligible performance impact)
3. **Learning curve** - Team needs to understand the new pattern

### Neutral ℹ️

1. **State still centralized** - StateManager still large, but now better organized
2. **Not fully feature-based** - Controllers not extracted yet (future improvement)
3. **Room for improvement** - Can migrate toward controller pattern in future

## Implementation Details

### Files Created

- `src/components/canvas-viewpoint/utils/event-context.ts` (50 lines)
- `docs/ADR-001-state-management-consolidation.md` (this file)

### Files Deleted

- `src/components/canvas-viewpoint/utils/cursor-manager.ts`

### Files Modified

- `src/components/canvas-viewpoint/utils/state-manager.ts`
  - Added `setCanvas()` and improved `setCursor()`
  - Added feature grouping comments (~70 lines of documentation)
- `src/components/canvas-viewpoint/utils/pointer-event-handler.ts`
  - Updated all method signatures to use EventContext
  - Added priority documentation and feature comments
- `src/components/canvas-viewpoint/canvas-viewpoint.ts`
  - Removed CursorManager usage
  - Created EventContext implementation
  - Updated all event handler calls
  - Added feature boundary comments

### Testing Performed

- [x] All cursor states work correctly (grab, grabbing, resize cursors, move, default)
- [x] Box creation works
- [x] Box rotation works
- [x] Box resizing works
- [x] Box dragging works
- [x] Context menu works
- [x] Camera pan/zoom works
- [x] Hover detection works
- [x] Copy/paste works
- [x] Undo/redo works
- [x] No TypeScript errors
- [x] No runtime console errors

## Future Work

This refactor positions us well for future improvements:

1. **Extract Feature Controllers** (see ARCHITECTURE-ANALYSIS.md)
   - Create `BoxInteractionController`, `CameraController`, etc.
   - Each controller owns its domain completely
   - Further reduce coupling

2. **Create InputRouter**
   - Replace PointerEventHandler with priority-based router
   - Controllers handle events in order until one succeeds

3. **Split StateManager**
   - Once controllers exist, move state closer to features
   - StateManager becomes coordination layer only

4. **Add Comprehensive Tests**
   - Unit tests for each controller
   - Integration tests for feature interactions

## Lessons Learned

1. **Incremental is safer**: Breaking into 3 phases allowed testing between changes
2. **Comments matter**: Feature boundaries make navigation significantly easier
3. **Interface extraction works**: EventContext reduced coupling without major restructure
4. **TypeScript catches errors**: Changed 50+ call sites with zero runtime bugs

## References

- [REFACTOR-PLAN.md](../REFACTOR-PLAN.md) - Detailed migration plan
- [ARCHITECTURE-ANALYSIS.md](../ARCHITECTURE-ANALYSIS.md) - Future controller-based architecture
- [ARCHITECTURE.md](../ARCHITECTURE.md) - Overall application architecture
- [COMPONENT-ARCHITECTURE.md](../src/components/canvas-viewpoint/COMPONENT-ARCHITECTURE.md) - Component design patterns
