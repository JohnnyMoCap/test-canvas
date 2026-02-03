# Canvas Viewport - Box Creation

## Overview

The canvas viewport supports two methods for creating bounding boxes on the background image:

1. **Drag-to-Create** (Create Mode)
2. **Context Menu** (Right-Click)

Both methods create boxes at the click location and record them to the history service for undo/redo support.

---

## Create Mode (Drag-to-Create)

### Activation

- Toggle via `@Input() createMode` binding
- Button in parent component sets this input
- Toggles the create mode on/off

### Behavior

When create mode is **active**:

- Cursor changes to crosshair
- Click and drag to create a box
- Dashed preview shows during drag
- Release to complete the box
- Minimum size enforced: 10×10 world pixels
- All other box interactions are disabled
- Selection is disabled
- Hover effects are disabled

When create mode is **inactive**:

- Normal interaction mode
- Click to select boxes
- Drag to move boxes
- Resize and rotate boxes

### Process

1. **Pointer Down** → `BoxCreationHandler.startCreate()`
   - Store start position (world coordinates)
   - Generate temporary ID
   - Update creation state in StateManager

2. **Pointer Move** → `BoxCreationHandler.updatePreview()`
   - Calculate current size from start to current position
   - Update preview box in creation state
   - Render dashed preview

3. **Pointer Up** → `BoxCreationHandler.completeCreate()`
   - Check minimum size (10×10 pixels)
   - If too small, discard
   - If valid, create final box with type "finding"
   - Record to `HistoryService.recordBoxCreation()`
   - Clear creation state

### Default Box Properties

Boxes created via drag-to-create:

- **Type**: "finding" (always)
- **Color**: Red (hsl(0, 70%, 50%))
- **Size**: Determined by drag distance
- **Rotation**: 0 radians
- **Position**: Where user dragged

---

## Context Menu (Right-Click)

### Activation

- Right-click anywhere on the canvas
- Menu appears at cursor position
- Works in any mode (create mode or normal mode)

### Box Type Options

The context menu provides these box types:

| Type       | Color  | Size (world px) | HSL Color          |
| ---------- | ------ | --------------- | ------------------ |
| 1234567    | Red    | 200 × 150       | hsl(0, 70%, 50%)   |
| 1234568    | Blue   | 150 × 100       | hsl(220, 70%, 50%) |
| 1234569    | Yellow | 100 × 75        | hsl(55, 90%, 55%)  |
| 1234560    | Green  | 120 × 90        | hsl(100, 50%, 45%) |

**Note:** Sizes are in world coordinates (pixels on the background image), not screen pixels.

### Size Scaling

Box sizes are automatically scaled based on current zoom level:

- At 100% zoom (1.0): Box appears at default size
- At 50% zoom (0.5): Box appears 2× larger on image
- At 200% zoom (2.0): Box appears 0.5× smaller on image

**Formula**: `actualSize = defaultSize / zoom`

This ensures boxes remain visually consistent on screen regardless of zoom.

### Process

1. **Right Click** → `ContextMenuHandler.open()`
   - Convert screen coords to world coords
   - Store world position
   - Update context menu state (visible, position, worldPos)

2. **User Selects Type** → `onBoxTypeSelect()`
   - Call `BoxCreationHandler.createBoxAt()`
   - Calculate zoom-scaled size
   - Generate unique ID
   - Create box object with selected type
   - Record to `HistoryService.recordBoxCreation()`

3. **Close Menu** → `ContextMenuHandler.close()`
   - Clear context menu state
   - Update cursor to reflect current state

### Menu Behavior

- Appears at cursor position (world coordinates)
- Can appear anywhere on canvas (even outside image bounds, but box creation will clamp to bounds)
- Closes when:
  - User selects a box type
  - User clicks outside menu
  - Escape key is pressed
- Does not close when hovering or scrolling

---

## Box Type Configuration

### Definition Location

Box types are defined in [core/creation-state.ts](core/creation-state.ts):

```typescript
export const BOX_TYPES: Record<BoxType, BoxTypeInfo> = {
  finding: {
    type: 'finding',
    label: 'Finding',
    defaultColor: 'hsl(0, 70%, 50%)', // Red
    defaultSize: { w: 200, h: 150 }, // World pixels
  },
  annotation: {
    type: 'annotation',
    label: 'Annotation',
    defaultColor: 'hsl(220, 70%, 50%)', // Blue
    defaultSize: { w: 150, h: 100 },
  },
  // ... more types
};
```

### Adding New Box Types

1. Add new type to `BoxType` union in [core/types.ts](core/types.ts)
2. Add entry to `BOX_TYPES` in [core/creation-state.ts](core/creation-state.ts)
3. Context menu will automatically include the new type

---

## Implementation Details

### Handlers

- **BoxCreationHandler** ([handlers/box-creation.handler.ts](handlers/box-creation.handler.ts))
  - `startCreate()` - Begin drag creation
  - `updatePreview()` - Update preview during drag
  - `completeCreate()` - Finalize box creation
  - `createBoxAt()` - Create box at specific position (context menu)

### State Management

- **StateManager** manages creation state:
  - `createModeActive` - Whether create mode is enabled
  - `creationState` - Current creation (start point, preview box, temp ID)
  - `contextMenuOpen` - Whether context menu is visible
  - `contextMenuPosition` - Screen coordinates for menu
  - `contextMenuWorldPos` - World coordinates for box creation

### Rendering

- **FrameRenderer** renders creation preview:
  - Dashed border (red)
  - Transparent fill
  - Only visible during active drag

### Coordinate System

All boxes are stored in **normalized coordinates** (0-1 range):

- Independent of image size
- Easy to scale to different resolutions
- Converted to world coordinates for rendering

**Conversion Flow**:

1. User drags → Screen coordinates
2. Convert to World coordinates → Pixels on image
3. Create box → World coordinates
4. Convert to Normalized → 0-1 range
5. Store in HistoryService → Normalized
6. Render → Convert back to World → Screen

---

## History Integration

All box creation methods record to HistoryService:

- `recordBoxCreation(box)` - Adds box to history
- Supports undo/redo via delta operations
- Saves to cookies with 1-day expiration
- Emits changes to `visibleBoxes` signal

---

## Disabling Creation

- Read-only mode (`@Input() readOnly`) disables all creation
- Create mode is disabled in read-only mode
- Context menu is disabled in read-only mode

---

## Files

### Core

- [core/creation-state.ts](core/creation-state.ts) - Box type definitions, creation state interface
- [core/types.ts](core/types.ts) - TypeScript interfaces (WorldBoxGeometry, BoxType)

### Handlers

- [handlers/box-creation.handler.ts](handlers/box-creation.handler.ts) - Creation logic

### Utilities

- [utils/box-creation-utils.ts](utils/box-creation-utils.ts) - Preview rendering (deprecated - logic moved to handler)
- [utils/box-utils.ts](utils/box-utils.ts) - Coordinate conversion (worldToNormalized, toWorld)

### Components

- [box-context-menu.component.ts](box-context-menu.component.ts) - Context menu UI component

### Main Component

- [canvas-viewpoint.ts](canvas-viewpoint.ts) - Orchestrates creation flows
- [canvas-viewpoint.html](canvas-viewpoint.html) - Template with context menu
- [canvas-viewpoint.css](canvas-viewpoint.css) - Styles for UI elements
