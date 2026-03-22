# Canvas Viewpoint - Component Architecture

## Overview

The Canvas Viewpoint component is a feature-rich, interactive canvas for viewing and editing bounding boxes on background images. It uses a multi-layered architecture with clear separation of concerns.

---

## Architecture Layers

### Layer 1: Component (canvas-viewpoint.ts)

**Role:** Orchestrator and Angular Integration Point

**Responsibilities:**

- Handle Angular lifecycle (ngAfterViewInit, ngOnDestroy)
- Manage Angular-specific features (@Input, @Output, signals, effects)
- Route DOM events to PointerEventHandler
- Coordinate between handlers, utilities, and services
- Maintain component-level state (camera, localBoxes, dirty flag)
- Trigger renders via dirty flag

**What it does NOT do:**

- Calculate box transformations
- Detect interactions (clicks on handles, rotation knobs, etc.)
- Perform rendering operations
- Manage pointer capture or coordinate conversion

### Layer 2: Event Router (pointer-event-handler.ts)

**Role:** Event Routing and Priority Management

**Responsibilities:**

- Convert screen coordinates to absolute coordinates
- Route events to handlers based on priority order
- Determine which interaction should handle the event
- Pass necessary context to handlers

**Priority Order (handlePointerDown):**

1. **CTRL/CMD + Click** → Camera pan (skip all interactions)
2. **Measurement Mode** → Measurement tool operations
3. **Magic Mode** → Automatic box detection
4. **Context Menu** → Right-click menu
5. **Create Mode** → Drag-to-create boxes
6. **Selected Box Interaction** → Rotate/Resize/Drag selected box
7. **Box Selection** → Click unselected box to select it
8. **Camera Pan** → Default fallback

**No Business Logic:** Router only determines WHO handles the event, not HOW.

### Layer 3: Handlers (handlers/\*.ts)

**Role:** Feature-Specific Business Logic

Eight specialized handlers:

- **BoxCreationHandler** - Create boxes via drag or context menu
- **BoxManipulationHandler** - Rotate, resize, move boxes
- **CameraHandler** - Pan and zoom operations
- **ClipboardHandler** - Copy/paste operations
- **ContextMenuHandler** - Context menu state
- **HoverHandler** - Detect hover over boxes/handles/knobs
- **MagicDetectionHandler** - Automatic box detection from image
- **MeasurementHandler** - Measurement tool operations

**Responsibilities:**

- Implement feature-specific logic
- Calculate new states or values
- Return data (don't modify state directly)
- Stateless operations (except via StateManager)

### Layer 4: Utilities (utils/\*.ts)

**Role:** Reusable, Pure Functions

**Core Utilities:**

- **StateManager** - Centralized state management (all component state signals)
- **LifecycleManager** - RAF loop, canvas init, resize observer, quadtree rebuild
- **BoxManipulator** - Pure box transformation math (rotate, resize, move)
- **ClipboardManager** - Clipboard operations
- **CoordinateTransform** - Screen ↔ World coordinate conversion
- **BoxUtils** - Box normalization, world ↔ normalized conversion
- **CameraUtils** - Camera clamping, zoom-to-box calculations
- **BackgroundUtils** - Background image loading, min zoom calculation
- **FrameRenderer** - Actual canvas drawing operations
- **QuadtreeUtils** - Build and query spatial index

**Characteristics:**

- Most are static classes
- Pure functions (same input → same output)
- No side effects (except state-manager)
- Easily testable

---

## State Management

### StateManager (utils/state-manager.ts)

**Centralized State Container** - All component state lives here

**State Categories:**

1. **Canvas & Rendering** - canvas element, context, device pixel ratio, RAF ID, background canvas, zoom limits
2. **Read-Only Mode** - Disables all editing when enabled
3. **Box Creation** - Create mode active, creation state, temp ID counter
4. **Magic Detection** - Magic mode, tolerance, debug flag
5. **Measurement Tool** - Measurement points, metric dimensions
6. **Context Menu** - Menu visibility, position, absPos
7. **Selection & Hover** - Hovered box ID, selected box ID
8. **Box Interaction** - Pointer down, dragging, resizing, rotating, drag/resize/rotate state
9. **Clipboard** - Copied box
10. **UI State** - Cursor, mouse position, nametags visibility, debug flags, brightness/contrast

**Pattern:** Each state property follows:

```typescript
private _stateName = signal(initialValue);
readonly stateName = this._stateName.asReadonly();
updateStateName(value) { this._stateName.set(value); }
```

### Component-Level State

**Component maintains these signals:**

- `camera` - Camera position and zoom (controlled by component, used by all layers)
- `localBoxes` - Working copy of boxes (synced from HistoryService)
- `dirty` - Render flag (triggers RAF render when true)
- `nametagMetricsCache` - Text measurement cache
- `quadtree` - Spatial index for efficient queries

---

## Data Flow

### Event Flow: Pointer Down Example

```
1. User clicks canvas
   ↓
2. onPointerDown(event) - Component
   ↓
3. PointerEventHandler.handlePointerDown()
   - Convert screen → absolute coordinates
   - Check CTRL/CMD key
   - Check active modes (measurement, magic, create)
   - Check selected box interactions
   - Route to appropriate handler
   ↓
4. Handler (e.g., BoxManipulationHandler.startRotation())
   - Calculate rotation angle
   - Return rotation info
   ↓
5. Component receives return value
   - Update StateManager
   - Set pointer capture
   - Schedule render
```

### Render Flow

```
State Change (camera, boxes, etc.)
   ↓
Signal Update
   ↓
Effect Triggers scheduleRender()
   ↓
dirty.set(true)
   ↓
RAF Loop (60fps with throttle)
   ↓
if (dirty()) → renderFrame()
   ↓
FrameRenderer.renderFrame()
   - Draw background
   - Draw boxes
   - Draw selection UI
   - Draw creation preview
   ↓
dirty.set(false)
```

### History Integration

```
HistoryService.visibleBoxes (signal - source of truth)
   ↓
effect() in Component
   - Skip if dragging/interacting
   - Compare with localBoxes
   ↓
localBoxes.set([...boxes])
   ↓
rebuildIndex()
   ↓
scheduleRender()
```

### Box Modification Flow

```
User drags box
   ↓
onPointerMove
   ↓
PointerEventHandler routes to BoxManipulationHandler
   ↓
BoxManipulator.moveBox() - pure function
   ↓
Returns new box object
   ↓
Component updates localBoxes signal
   ↓
Render triggered
   ↓
On pointer up: HistoryService.recordMove()
```

---

## Coordinate Systems

### Three Coordinate Spaces

1. **Screen Space** - Pixels relative to browser viewport
2. **Canvas Space** - Pixels on the canvas element (accounting for devicePixelRatio)
3. **absolute space** - Pixels on the background image (independent of zoom/pan)

**Box Storage:** Boxes stored in **normalized coordinates** (0-1 range)

- Converted to absolute space for calculations
- Converted back to normalized for storage

**CoordinateTransform utility** handles all conversions.

---

## Key Features

### Create Mode

- Toggle via button or @Input
- Drag to create boxes
- Preview shown during drag
- Minimum size enforced (10x10)
- Disabled in read-only mode

### Magic Mode

- Click image to auto-detect boundaries
- Uses color similarity algorithm
- Adjustable tolerance
- Optional debug logging
- Creates box automatically

### Context Menu

- Right-click to open
- Select box type
- Box created at click position
- Size scaled based on zoom

### Measurement Tool

- Place two points
- Shows pixel and metric dimensions
- Drag points to adjust
- Used to calibrate pixel-to-meter ratio

### Box Manipulation

- **Rotate** - Drag rotation knob above box
- **Resize** - Drag corner handles
- **Move** - Drag box body
- All operations clamped to image bounds

### Selection & Hover

- Click to select box
- Hover shows resize handles
- Selected box shows rotation knob
- External selection via @Input

### Clipboard

- Copy (Ctrl+C) - Copy selected box
- Paste (Ctrl+V) - Paste at mouse position
- Delete (Delete key) - Remove selected box

### Read-Only Mode

- Disables all editing
- View and navigation only
- Clears selection on entry

---

## Performance Optimizations

1. **RAF Loop with Throttling** - 60fps limit, only renders when dirty
2. **Quadtree Spatial Index** - O(log n) box queries instead of O(n)
3. **Dirty Flag** - Avoids unnecessary renders
4. **Text Metrics Cache** - Avoid repeated text measurements
5. **Pointer Capture** - Ensures smooth dragging
6. **Effect Guards** - Skip updates during interactions

---

## File Organization

```
canvas-viewpoint/
├── canvas-viewpoint.ts (Main Component)
├── canvas-viewpoint.html (Template)
├── canvas-viewpoint.css (Styles)
├── box-context-menu.component.ts (Context Menu UI)
├── scale-bar.component.ts (Scale Bar UI)
├── core/
│   ├── types.ts (TypeScript interfaces)
│   ├── creation-state.ts (Box types and creation state)
│   ├── quadtree.ts (Spatial index implementation)
│   └── performance-config.ts (Performance constants)
├── cursor/
│   └── cursor-styles.ts (Cursor CSS generation)
├── handlers/
│   ├── box-creation.handler.ts
│   ├── box-manipulation.handler.ts
│   ├── camera.handler.ts
│   ├── clipboard.handler.ts
│   ├── context-menu.handler.ts
│   ├── hover.handler.ts
│   ├── magic-detection.handler.ts
│   └── measurement.handler.ts
└── utils/
    ├── state-manager.ts (Centralized state)
    ├── pointer-event-handler.ts (Event router)
    ├── lifecycle-manager.ts (Lifecycle operations)
    ├── box-manipulator.ts (Box transformations)
    ├── clipboard-manager.ts (Clipboard operations)
    ├── coordinate-transform.ts (Coordinate conversion)
    ├── frame-renderer.ts (Rendering)
    ├── camera-utils.ts (Camera operations)
    ├── box-utils.ts (Box utilities)
    ├── background-utils.ts (Background operations)
    ├── quadtree-utils.ts (Quadtree operations)
    └── [15+ other utilities]
```

---

## Testing Strategy

**Unit Tests:**

- Handlers - Test business logic
- Utilities - Test pure functions
- StateManager - Test state transitions

**Integration Tests:**

- Component - Test event routing
- Render flow - Test dirty flag and rendering

**E2E Tests:**

- Full user workflows
- Cross-feature interactions
