# Canvas Viewpoint - Component Architecture

## Component Responsibilities

### Main Component (canvas-viewpoint.ts)

**Role:** Orchestrator & Event Coordinator

**Responsibilities:**

- Coordinate between utilities and services
- Manage Angular lifecycle
- Handle template bindings
- Route events to appropriate handlers
- Maintain component-level signals and state

**Does NOT:**

- Contain business logic
- Perform calculations
- Manipulate DOM directly (except via utilities)
- Handle complex state updates

---

## Utility Layer

### State Management

**state-manager.ts** - Single source of truth for component state

- Tracks all interaction states
- Manages flags and references
- Provides state mutation methods
- Encapsulates state logic

**cursor-manager.ts** - Cursor state and DOM updates

- Prevents redundant cursor updates
- Tracks current cursor state
- Provides cursor change interface

### Lifecycle & Rendering

**lifecycle-manager.ts** - Component lifecycle operations

- RAF loop management
- Canvas initialization
- Resize observer setup
- Index rebuilding coordination

**frame-renderer.ts** (existing) - Frame rendering

- Actual drawing operations
- Visual representation logic

### Event Processing

**pointer-event-handler.ts** - Pointer event delegation

- Routes events to appropriate actions
- Converts screen to world coordinates
- Detects interaction types
- Fires callbacks for actions

### Box Operations

**box-manipulator.ts** - Box transformation calculations

- Rotation math
- Resize math
- Move calculations
- Immutable updates

**box-creation-utils.ts** (existing) - Box creation

- Create from drag
- Create from context menu
- ID generation

**box-utils.ts** (existing) - Box utilities

- Coordinate transformations
- Normalization
- World/screen conversions

### User Actions

**clipboard-manager.ts** - Copy/paste operations

- Copy box state
- Calculate paste position
- Create pasted instances

**context-menu-utils.ts** (existing) - Context menu

- Open/close logic
- Position management
- Hit detection

### Detection & Query

**hover-detection-utils.ts** (existing) - Hover detection

- Find hovered boxes
- Nametag hit testing
- Quadtree querying

**interaction-utils.ts** (existing) - Interaction detection

- Corner handle detection
- Rotation knob detection
- Cursor type calculation

### Spatial Indexing

**quadtree-utils.ts** (existing) - Quadtree operations

- Build quadtree
- Query visible items
- Spatial optimization

**quadtree.ts** (existing) - Quadtree implementation

- Data structure
- Query methods

---

## Data Flow

### Event Flow

```
User Input (DOM Event)
    ↓
Component Event Handler (onPointerMove, etc.)
    ↓
PointerEventHandler.handle*()
    ↓
Multiple Callbacks
    ↓
- State Updates (StateManager)
- Box Manipulation (BoxManipulator)
- History Recording (HistoryService)
- Render Scheduling (Component)
```

### Render Flow

```
State Change
    ↓
Signal Update
    ↓
Effect Triggers
    ↓
scheduleRender()
    ↓
RAF Loop (LifecycleManager)
    ↓
renderFrame()
    ↓
FrameRenderer.renderFrame()
```

### State Synchronization

```
HistoryService.visibleBoxes (signal)
    ↓
Effect in Component
    ↓
localBoxes.set([...boxes])
    ↓
rebuildIndex()
    ↓
scheduleRender()
```

---

## Key Design Patterns

### 1. **Delegation Pattern**

The component delegates to specialized utilities:

- Events → PointerEventHandler
- Box updates → BoxManipulator
- Clipboard → ClipboardManager
- Lifecycle → LifecycleManager

### 2. **Callback Pattern**

Utilities use callbacks to communicate back:

```typescript
PointerEventHandler.handlePointerDown(
  event,
  state,
  boxes,
  // Callbacks:
  onContextMenuOpen,
  onCreateStart,
  onBoxInteractionStart,
  onCameraPanStart,
);
```

### 3. **Single Responsibility**

Each file has ONE clear purpose:

- StateManager: State
- LifecycleManager: Lifecycle
- BoxManipulator: Box transformations
- etc.

### 4. **Immutability Where Appropriate**

Box updates create new instances:

```typescript
const updatedBox = BoxManipulator.rotateBox(box, ...);
this.localBoxes.set(BoxManipulator.updateBoxInArray(...));
```

### 5. **Static Utility Classes**

Most utilities are static for simplicity:

```typescript
BoxManipulator.rotateBox(...)
PointerEventHandler.handleWheel(...)
ClipboardManager.copyBox(...)
```

---

## Extension Points

### Adding New Features

**New Interaction Type:**

1. Add state to StateManager
2. Add detection in PointerEventHandler
3. Add manipulation logic to BoxManipulator or new utility
4. Add render logic to FrameRenderer

**New Hotkey:**

1. Register in setupHotkeys()
2. Add handler method in component
3. Use existing utilities for logic

**New Tool:**

1. Add state to StateManager
2. Add event handling in PointerEventHandler
3. Create specialized utility if needed
4. Update render logic

---

## Testing Strategy

### Unit Tests

- **Utilities:** Easy to test (pure functions, static methods)
- **StateManager:** Test state transitions
- **BoxManipulator:** Test math calculations

### Integration Tests

- **Component:** Test orchestration
- **Event Flow:** Test callbacks fire correctly
- **Render Flow:** Test render scheduling

### Example:

```typescript
// Easy to test utility
describe('BoxManipulator', () => {
  it('should rotate box correctly', () => {
    const box = { x: 0.5, y: 0.5, rotation: 0 };
    const rotated = BoxManipulator.rotateBox(box, ...);
    expect(rotated.rotation).toBe(Math.PI / 4);
  });
});
```

---

## Performance Considerations

### Optimizations Maintained

- RAF loop with frame limiting
- Quadtree spatial indexing
- Dirty flag rendering
- Efficient state updates

### Optimizations Added

- Cursor manager prevents redundant updates
- State manager centralizes state checks
- Clear separation allows targeted optimization

---

## Future Improvements

### Potential Enhancements

1. **Command Pattern** for undo/redo
2. **Observer Pattern** for state changes
3. **Factory Pattern** for box creation
4. **Strategy Pattern** for different tools

### Refactoring Opportunities

1. Extract history operations to HistoryManager utility
2. Create RenderScheduler utility
3. Add BoxQueryService for complex queries
4. Create ToolManager for tool state
