# Canvas Viewpoint Architecture

## Layer Structure

### Layer 1: Component (canvas-viewpoint.ts)

- **Responsibility**: Thin wrapper for Angular integration
- **What it does**: Receives DOM events, manages Angular lifecycle, renders to canvas
- **What it doesn't do**: Business logic, state management decisions

### Layer 2: State Manager & Event Router

- **StateManager** (utils/state-manager.ts): Owns all signals and provides typed update methods
  - Easy traceability: Search for `updateCamera()`, `updateSelectedBox()`, etc. to find all state updates
  - Single source of truth for component state
- **PointerEventHandler** (utils/pointer-event-handler.ts): Routes events to handlers
  - Checks state and determines which handler to call
  - Implements priority logic (context menu > creation > interaction > selection > camera)

### Layer 3: Business Logic Handlers

Located in `handlers/` directory:

- **box-creation.handler.ts**: Create boxes via drag or context menu
- **box-manipulation.handler.ts**: Drag, resize, rotate boxes
- **camera.handler.ts**: Pan and zoom camera
- **clipboard.handler.ts**: Copy, cut, paste, delete
- **context-menu.handler.ts**: Open/close context menu
- **hover.handler.ts**: Detect hover, interaction points, update cursors

All handlers use **static methods** for explicitness and pass **typed services** individually.

### Layer 3.5: Cursor Layer

Located in `cursor/` directory:

- **cursor-manager.ts**: Updates cursor state based on interaction type
- **cursor-styles.ts**: Determines appropriate cursor for different contexts
  - Includes `getResizeCursor()` logic that accounts for box rotation

### Layer 4: Utils

Located in `utils/` directory:

Pure utility functions for:

- Coordinate transformations
- Box calculations
- Camera math
- Background rendering
- Color management
- etc.

## State Update Traceability

All state updates flow through StateManager's typed methods:

```typescript
// Find all camera updates
state.updateCamera(newCamera);

// Find all selected box updates
state.updateSelectedBox(boxId);

// Find all pointer state updates
state.updatePointerDown(true);
state.startDragging(wx, wy, bx, by);
state.startResizing(corner);
state.startRotating(angle, rotation);
```

**To track where a state gets updated**: Search for the update method name (e.g., `updateCamera`)

## Event Flow Example

### User clicks on a box corner to resize:

1. **Component** receives `pointerdown` event → calls `onPointerDown(e)`
2. **Component** calls `PointerEventHandler.handlePointerDown()` with all required data
3. **PointerEventHandler** checks state and determines this is a resize operation
4. **PointerEventHandler** calls:
   - `state.startResizing(corner)` to update state
   - `state.startInteraction(...)` to save box's initial state
   - `BoxManipulationHandler.startResize()` to set cursor
5. **BoxManipulationHandler** calls `CursorManager.updateForResize()`
6. **CursorManager** calls `CursorStyles.getResizeCursor()` to get the right cursor
7. **CursorManager** updates the signal and canvas element

### User moves mouse while resizing:

1. **Component** receives `pointermove` event → calls `onPointerMove(e)`
2. **Component** calls `PointerEventHandler.handlePointerMove()`
3. **PointerEventHandler** checks `state.isResizing()` and calls handler
4. **BoxManipulationHandler.resize()** computes new box dimensions
5. **BoxManipulationHandler.updateBoxInArray()** returns updated array
6. **Component** updates localBoxes signal via callback
7. **Component** schedules render

### User releases mouse:

1. **Component** receives `pointerup` event → calls `onPointerUp(e)`
2. **Component** calls `PointerEventHandler.handlePointerUp()`
3. **PointerEventHandler** checks `state.isAnyInteractionActive()`
4. **BoxManipulationHandler.completeManipulation()** saves to history
5. **HistoryService.recordResize()** records the change
6. **State** is reset via `state.resetInteractionStates()`

## Design Principles

1. **Linear Flow**: Component → StateManager/Router → Handlers → Utils
2. **Separation of Concerns**: "WHEN to do" (router) vs "WHAT to do" (handlers)
3. **Explicit Dependencies**: All services passed individually with types
4. **Easy Traceability**: Typed update methods make it easy to find state changes
5. **Static Methods**: Handlers are stateless, all state in StateManager
6. **No Callbacks**: Replaced EventContext callbacks with direct handler calls
