# Canvas Viewpoint Component

An interactive canvas component for viewing and editing bounding boxes on background images, built with Angular 17+ signals and standalone components.

---

## Documentation

- **[COMPONENT-ARCHITECTURE.md](COMPONENT-ARCHITECTURE.md)** - Complete architecture overview, layers, handlers, state management
- **[FLOW-DIAGRAM.md](FLOW-DIAGRAM.md)** - Visual flow diagrams for all interactions (pointer events, rendering, box manipulation, etc.)
- **[README-CREATION.md](README-CREATION.md)** - Box creation features (drag-to-create, context menu)
- **[NEW-ARCHITECTURE.md](NEW-ARCHITECTURE.md)** - Architecture vision document (may be outdated)

---

## Features

### Interactive Box Editing

- **Create** - Drag-to-create boxes or right-click context menu
- **Select** - Click to select boxes
- **Move** - Drag selected box to reposition
- **Resize** - Drag corner handles to resize
- **Rotate** - Drag rotation knob to rotate (radians: 0 to 2π)
- **Delete** - Press Delete key to remove selected box
- **Copy/Paste** - Ctrl+C / Ctrl+V to duplicate boxes

### Camera Controls

- **Pan** - Drag canvas to move camera (or hold Ctrl/Cmd and drag)
- **Zoom** - Scroll wheel to zoom in/out (zooms to cursor position)
- **Fit to Image** - Auto-calculated min/max zoom limits
- **Zoom to Box** - Programmatic zoom to specific box

### Special Tools

- **Measurement Tool** - Place two points to measure pixel and metric distances
- **Magic Detection** - Click to auto-detect box boundaries using color similarity
- **Read-Only Mode** - View-only mode with no editing allowed
- **Nametag Display** - Toggle box labels on/off

### Performance

- **Quadtree Spatial Index** - O(log n) box queries for large datasets
- **RAF Rendering** - 60fps throttled render loop
- **Dirty Flag** - Only render when state changes
- **High-DPI Support** - devicePixelRatio scaling for crisp rendering

### Persistence

- **History/Undo** - Full undo/redo support via HistoryService
- **Cookie Storage** - Boxes saved to cookies with 1-day expiration (path-specific, SameSite=Strict)
- **Delta Operations** - Efficient history tracking with delta patches

---

## Architecture

### 3-Layer Design

1. **Component Layer** (canvas-viewpoint.ts) - Angular orchestrator
2. **Event Router Layer** (pointer-event-handler.ts) - Priority-based event routing
3. **Handler Layer** (handlers/\*.ts) - Feature-specific business logic

### Handlers (8 Total)

| Handler                | Responsibility                        |
| ---------------------- | ------------------------------------- |
| BoxCreationHandler     | Create boxes via drag or context menu |
| BoxManipulationHandler | Rotate, resize, move boxes            |
| CameraHandler          | Pan and zoom operations               |
| ClipboardHandler       | Copy/paste operations                 |
| ContextMenuHandler     | Context menu state                    |
| HoverHandler           | Detect hover over boxes/handles/knobs |
| MagicDetectionHandler  | Automatic box detection from image    |
| MeasurementHandler     | Measurement tool operations           |

### State Management

**StateManager** (utils/state-manager.ts) - Centralized reactive state

All component state lives in StateManager as signals:

- Canvas & rendering (canvas, context, DPR, RAF ID)
- Interaction state (dragging, resizing, rotating)
- Tools (measurement, magic, context menu)
- UI state (cursor, hover, selection)
- Read-only mode

### Coordinate Systems

Three coordinate spaces with transformations:

1. **Screen Space** - Browser viewport pixels (event.clientX/Y)
2. **Canvas Space** - Canvas element pixels (accounting for devicePixelRatio)
3. **absolute space** - Background image pixels (normalized 0-1 for storage)

**CoordinateTransform utility** handles all conversions.

### Rendering

**FrameRenderer** (utils/frame-renderer.ts) renders to canvas:

- Background image
- Boxes with rotation support
- Nametags
- Selection UI (handles, rotation knob)
- Creation preview (dashed)
- Measurement lines
- Context menu

Triggered by dirty flag via effects, executes in RAF loop (60fps throttled).

---

## File Structure

```
canvas-viewpoint/
├── canvas-viewpoint.ts          (786 lines) Main component orchestrator
├── canvas-viewpoint.html        Template
├── canvas-viewpoint.css         Styles
├── canvas-viewpoint.spec.ts     Tests
├── box-context-menu.component.ts           Context menu UI
├── scale-bar.component.ts                  Scale bar UI
│
├── core/
│   ├── types.ts                 TypeScript interfaces (AbsoluteBoxGeometry, etc.)
│   ├── creation-state.ts        Box type definitions, creation state
│   ├── quadtree.ts              Spatial index implementation
│   └── performance-config.ts    Performance constants
│
├── cursor/
│   └── cursor-styles.ts         Cursor CSS generation
│
├── handlers/
│   ├── box-creation.handler.ts       (155 lines)
│   ├── box-manipulation.handler.ts   (178 lines)
│   ├── camera.handler.ts             (53 lines)
│   ├── clipboard.handler.ts          (93 lines)
│   ├── context-menu.handler.ts       (63 lines)
│   ├── hover.handler.ts              (181 lines)
│   ├── magic-detection.handler.ts    (146 lines)
│   └── measurement.handler.ts        (198 lines)
│
└── utils/
    ├── state-manager.ts              (621 lines) Centralized state
    ├── pointer-event-handler.ts      (806 lines) Event routing
    ├── lifecycle-manager.ts          (76 lines) RAF loop, resize
    ├── box-manipulator.ts            (128 lines) Box transformations
    ├── clipboard-manager.ts          (98 lines) Clipboard ops
    ├── coordinate-transform.ts       (179 lines) Coordinate conversion
    ├── frame-renderer.ts             (614 lines) Rendering
    ├── camera-utils.ts               (170 lines) Camera ops
    ├── box-utils.ts                  (245 lines) Box utilities
    ├── background-utils.ts           (89 lines) Background ops
    ├── quadtree-utils.ts             (49 lines) Quadtree ops
    ├── box-creation-utils.ts         (136 lines) Creation utilities
    ├── box-state-utils.ts            (37 lines) Box state utilities
    ├── boundary-utils.ts             (96 lines) Boundary checks
    ├── color-utils.ts                (52 lines) Color utilities
    ├── context-menu-utils.ts         (51 lines) Context menu utilities
    ├── creation-utils.ts             (38 lines) Creation utilities (legacy)
    ├── magic-detection-utils.ts      (111 lines) Magic detection utilities
    ├── measurement-render-utils.ts   (186 lines) Measurement rendering
    ├── measurement-utils.ts          (95 lines) Measurement calculations
    ├── nametag-utils.ts              (158 lines) Nametag rendering
    ├── render-utils.ts               (49 lines) Render utilities
    └── validation-utils.ts           (41 lines) Validation utilities
```

---

## Usage

### Basic Setup

```typescript
import { CanvasViewportComponent } from './components/canvas-viewpoint/canvas-viewpoint';

@Component({
  selector: 'app-root',
  imports: [CanvasViewportComponent],
  template: `
    <canvas-viewpoint
      [backgroundImageUrl]="imageUrl"
      [createMode]="createMode"
      [readOnly]="readOnly"
      [selectedBoxId]="selectedId"
      (boxesChange)="onBoxesChange($event)"
      (selectedBoxIdChange)="onSelectionChange($event)"
    />
  `,
})
export class AppComponent {
  imageUrl = 'assets/image.jpg';
  createMode = false;
  readOnly = false;
  selectedId: string | null = null;

  onBoxesChange(boxes: AbsoluteBoxGeometry[]) {
    console.log('Boxes changed:', boxes);
  }

  onSelectionChange(id: string | null) {
    console.log('Selection changed:', id);
  }
}
```

### Inputs

| Input                | Type    | Description                         |
| -------------------- | ------- | ----------------------------------- |
| backgroundImageUrl   | string  | URL to background image             |
| createMode           | boolean | Enable drag-to-create mode          |
| readOnly             | boolean | Disable all editing (view-only)     |
| selectedBoxId        | string  | Externally control selection        |
| showNametags         | boolean | Show/hide box labels                |
| brightnessAdjustment | number  | Brightness adjustment (-100 to 100) |
| contrastAdjustment   | number  | Contrast adjustment (-100 to 100)   |

### Outputs

| Output              | Type               | Description                  |
| ------------------- | ------------------ | ---------------------------- |
| boxesChange         | AbsoluteBoxGeometry[] | Emits when boxes change      |
| selectedBoxIdChange | string \| null     | Emits when selection changes |

### Public Methods

Component exposes these methods via template reference:

```typescript
@ViewChild(CanvasViewportComponent) canvas!: CanvasViewportComponent;

// Zoom operations
canvas.zoomToBox(boxId: string);          // Zoom to specific box
canvas.fitToScreen();                     // Fit image to screen

// Measurement tool
canvas.toggleMeasurementTool();           // Toggle measurement mode
canvas.updateMetricDimensions(w, h);      // Set real-world dimensions

// Magic detection
canvas.toggleMagicMode();                 // Toggle magic mode
canvas.setMagicTolerance(tolerance);      // Set color tolerance

// Debug
canvas.toggleQuadtreeDebug();             // Show/hide quadtree
canvas.toggleMagicDebug();                // Show magic detection debug
```

---

## Box Types

Defined in [core/creation-state.ts](core/creation-state.ts):

| Type       | Color  | Default Size (px) | Usage            |
| ---------- | ------ | ----------------- | ---------------- |
| finding    | Red    | 200 × 150         | Primary findings |
| annotation | Blue   | 150 × 100         | Annotations      |
| highlight  | Yellow | 100 × 75          | Highlights       |
| comment    | Green  | 120 × 90          | Comments         |

Add new types by extending `BOX_TYPES` constant.

---

## Coordinate Conversion

```typescript
// Screen → World
const absPos = CoordinateTransform.screenToAbsolute(screenX, screenY, camera, state);

// World → Normalized (for storage)
const normalized = BoxUtils.absoluteToNormalized(AbsoluteBox, bgSize);

// Normalized → World (for rendering)
const AbsoluteBox = BoxUtils.toWorld(normalized, bgSize);
```

---

## Performance Considerations

- **Quadtree Rebuild** - Automatically rebuilds when boxes change (debounced)
- **Visible Box Query** - Only renders boxes in viewport (O(log n) via quadtree)
- **Text Metrics Cache** - Caches nametag measurements
- **RAF Throttle** - Limits renders to 60fps
- **Dirty Flag** - Skips renders when nothing changed
- **Effect Guards** - Prevents sync loops during interactions

---

## Keyboard Shortcuts

| Key             | Action                       |
| --------------- | ---------------------------- |
| Ctrl/Cmd + C    | Copy selected box            |
| Ctrl/Cmd + V    | Paste copied box             |
| Delete          | Delete selected box          |
| Escape          | Clear selection / Exit modes |
| Ctrl/Cmd + Drag | Camera pan (forced)          |

---

## Rotation

All rotation is in **radians** (0 to 2π):

- 0 radians = 0°
- π/2 radians = 90°
- π radians = 180°
- 2π radians = 360°

Uses `Math.cos()`, `Math.sin()`, `Math.atan2()` for calculations.

---

## Dependencies

- **Angular 17+** - Signals, effects, standalone components
- **HistoryService** - Box storage, undo/redo
- **HotkeyService** - Keyboard shortcut management

---

## Browser Support

- Modern browsers with Canvas 2D API
- Pointer Events API
- ES2020+ JavaScript
- CSS Grid & Flexbox

---

## Testing

Run component tests:

```bash
ng test
```

Main test file: [canvas-viewpoint.spec.ts](canvas-viewpoint.spec.ts)

---

## Development

### Adding a Handler

1. Create handler file in `handlers/`
2. Implement static methods for business logic
3. Add routing logic in `pointer-event-handler.ts`
4. Update component to use handler
5. Add tests

### Adding State

1. Add property to StateManager (private signal + readonly accessor + update method)
2. Use in handlers/component
3. Update effects if needed

### Debugging

Enable debug modes:

```typescript
canvas.toggleQuadtreeDebug(); // Show spatial index
canvas.toggleMagicDebug(); // Show magic detection logs
```

---

## Known Issues

None currently documented.

---

## License

Internal project - not licensed for external use.
