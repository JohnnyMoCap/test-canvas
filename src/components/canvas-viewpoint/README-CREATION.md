# Canvas Viewport Component - Box Creation Features

## Overview

The canvas viewport now supports two methods for creating boxes/findings on the canvas.

## Features

### 1. Create Mode (Drag-to-Create)

- **Activation**: Click the "Create Mode" button in the top-right corner
- **Usage**:
  - Click and drag on the canvas to create a box
  - The box will preview with a dashed border as you drag
  - Release to finalize the box (minimum size: 10x10 pixels)
  - Boxes created this way use the default "Finding" color (red)
- **Behavior**:
  - All interactions with existing boxes are disabled in create mode
  - Hover effects are disabled
  - Selection is disabled
  - Cursor changes to crosshair
- **Exit**: Click the "Exit Create" button to return to normal mode

### 2. Context Menu (Right-Click)

- **Activation**: Right-click anywhere on the canvas
- **Usage**:
  - A context menu appears at the cursor position
  - Select from predefined box types:
    - **Finding** (Red) - 200×150px
    - **Annotation** (Blue) - 150×100px
    - **Highlight** (Yellow) - 100×75px
    - **Comment** (Green) - 120×90px
  - Box is created at the right-click position with the selected type
- **Behavior**:
  - Box size is automatically scaled based on current zoom level
  - Menu can appear anywhere, even outside canvas bounds
  - Menu closes when clicking outside or selecting a type

## Box Types Configuration

Box types are defined in `core/creation-state.ts`:

```typescript
export const BOX_TYPES: Record<BoxType, BoxTypeInfo> = {
  finding: {
    type: 'finding',
    label: 'Finding',
    defaultColor: 'hsl(0, 70%, 50%)',
    defaultSize: { w: 200, h: 150 },
  },
  // ... more types
};
```

You can easily add new box types by extending this configuration.

## Technical Details

### New Files

- `core/creation-state.ts` - Box creation state and type definitions
- `utils/creation-utils.ts` - Creation preview rendering utilities
- `box-context-menu.component.ts` - Standalone context menu component

### Modified Files

- `canvas-viewpoint.ts` - Main component with creation logic
- `canvas-viewpoint.html` - Template with context menu
- `canvas-viewpoint.css` - Styling for create mode button

### Key Utilities

- `CreationUtils.createPreviewBox()` - Calculates box from drag points
- `CreationUtils.drawCreationPreview()` - Renders dashed preview
- `BoxUtils.worldToNormalized()` - Converts coordinates for storage
- `BoxUtils.worldDimensionsToNormalized()` - Converts dimensions for storage
