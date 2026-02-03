# Canvas Viewpoint - Flow Diagrams

## Pointer Event Flow

### handlePointerDown Priority Order

```
┌─────────────────────────────────────┐
│    User clicks/touches canvas       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  onPointerDown(event) - Component   │
│  - Get world coordinates            │
│  - Set pointer capture              │
│  - Call PointerEventHandler         │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ PointerEventHandler.handlePointerDown│
└──────────────┬──────────────────────┘
               │
               ▼
       ┌───────┴───────┐
       │ Priority Check │
       └───────┬───────┘
               │
    ┌──────────┴──────────┐
    │ CTRL/CMD Pressed?   │
    │ (Platform Specific) │
    └─────┬───────────┬───┘
          │ YES       │ NO
          ▼           │
    [Camera Pan]      │
    Exit              │
                      │
         ┌────────────┘
         │
         ▼
    ┌─────────────────┐
    │ Read-Only Mode? │
    └─────┬───────┬───┘
          │ YES   │ NO
          ▼       │
    [Return]      │
    Exit          │
                  │
       ┌──────────┘
       │
       ▼
    ┌──────────────────┐
    │ Measurement Mode?│
    └─────┬────────┬───┘
          │ YES    │ NO
          ▼        │
    [Measurement]  │
    Exit           │
                   │
        ┌──────────┘
        │
        ▼
    ┌──────────┐
    │Magic Mode?│
    └─────┬────┬┘
          │YES │NO
          ▼    │
    [Magic]    │
    Exit       │
               │
      ┌────────┘
      │
      ▼
    ┌──────────────────┐
    │ Right Click?     │
    └─────┬────────┬───┘
          │ YES    │ NO
          ▼        │
    [Context Menu] │
    Exit           │
                   │
          ┌────────┘
          │
          ▼
    ┌──────────────┐
    │ Create Mode? │
    └─────┬────┬───┘
          │YES │NO
          ▼    │
    [Box Create] │
    Exit         │
                 │
        ┌────────┘
        │
        ▼
    ┌─────────────────────┐
    │ Selected Box Exists?│
    └─────┬───────────┬───┘
          │ YES       │ NO
          │           ▼
          │     ┌──────────────┐
          │     │Clicked a Box?│
          │     └─────┬────┬───┘
          │           │YES │NO
          │           ▼    │
          │     [Select Box] │
          │     Exit         │
          │                  ▼
          │           [Camera Pan]
          │           Exit
          │
          ▼
    ┌──────────────────────┐
    │ HoverHandler.detect  │
    │ - Rotation Knob?     │
    │ - Resize Handle?     │
    │ - Box Body?          │
    └─────┬────────────────┘
          │
          ▼
    ┌─────────────┐
    │ Interaction │
    ├─────────────┤
    │ Rotate      │─→ [BoxManipulationHandler.startRotation]
    │ Resize      │─→ [BoxManipulationHandler.startResize]
    │ Drag        │─→ [BoxManipulationHandler.startDrag]
    └─────────────┘
```

---

## Pointer Move Flow

```
┌─────────────────────────────────────┐
│   onPointerMove(event) - Component  │
│   - Update mouse position in state  │
└──────────────┬──────────────────────┘
               │
               ▼
    ┌──────────────────┐
    │ Any Active       │
    │ Interaction?     │
    └─────┬────────┬───┘
          │ YES    │ NO
          │        │
          │        ▼
          │   ┌────────────────┐
          │   │ HoverHandler   │
          │   │ - Find hovered │
          │   │   box/handle   │
          │   │ - Update cursor│
          │   └────────────────┘
          │        │
          │        ▼
          │   [scheduleRender]
          │
          ▼
    ┌─────────────────┐
    │ Check Active:   │
    ├─────────────────┤
    │ - Dragging?     │
    │ - Resizing?     │
    │ - Rotating?     │
    │ - Creating?     │
    │ - Measuring?    │
    │ - Camera Pan?   │
    └─────┬───────────┘
          │
          ▼
    ┌─────────────────────┐
    │ Call Handler Update │
    ├─────────────────────┤
    │ BoxManipulator      │
    │ BoxCreationHandler  │
    │ MeasurementHandler  │
    │ CameraHandler       │
    └─────┬───────────────┘
          │
          ▼
    ┌─────────────────┐
    │ Update State    │
    │ - localBoxes    │
    │ - camera        │
    │ - creation state│
    └─────┬───────────┘
          │
          ▼
    [scheduleRender]
```

---

## Pointer Up Flow

```
┌─────────────────────────────────────┐
│    onPointerUp(event) - Component   │
│    - Release pointer capture        │
└──────────────┬──────────────────────┘
               │
               ▼
    ┌──────────────────┐
    │ Check Completion │
    ├──────────────────┤
    │ - Creating?      │
    │ - Moving?        │
    │ - Resizing?      │
    │ - Rotating?      │
    └─────┬────────────┘
          │
          ▼
    ┌─────────────────────┐
    │ Complete Action     │
    ├─────────────────────┤
    │ Record to History   │
    │ - recordBoxCreation │
    │ - recordMove        │
    │ - recordResize      │
    │ - recordRotation    │
    └─────┬───────────────┘
          │
          ▼
    ┌──────────────────┐
    │ Reset Interaction│
    │ States           │
    │ - dragging=false │
    │ - resizing=false │
    │ - rotating=false │
    │ - creating=false │
    └─────┬────────────┘
          │
          ▼
    ┌──────────────┐
    │Update Cursor │
    │to Hover State│
    └─────┬────────┘
          │
          ▼
    [scheduleRender]
```

---

## Wheel Event Flow (Zoom)

```
┌─────────────────────────────────────┐
│      onWheel(event) - Component     │
│      - Prevent default scroll       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ PointerEventHandler.handleWheel     │
│ - Get world coordinates at pointer  │
└──────────────┬──────────────────────┘
               │
               ▼
    ┌──────────────────┐
    │ CameraHandler    │
    │ .handleZoom()    │
    │ - Calculate new  │
    │   zoom level     │
    │ - Calculate new  │
    │   camera position│
    │   to keep point  │
    │   under cursor   │
    └─────┬────────────┘
          │
          ▼
    ┌──────────────────┐
    │ CameraUtils      │
    │ .clampCamera()   │
    │ - Enforce min/max│
    │   zoom           │
    │ - Keep camera in │
    │   bounds         │
    └─────┬────────────┘
          │
          ▼
    ┌──────────────────┐
    │ Update camera    │
    │ signal           │
    └─────┬────────────┘
          │
          ▼
    [scheduleRender]
```

---

## Render Flow

```
┌─────────────────────────────────────┐
│         scheduleRender()            │
│         dirty.set(true)             │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  RAF Loop (LifecycleManager)        │
│  - Checks dirty flag every frame    │
│  - 60fps throttle                   │
└──────────────┬──────────────────────┘
               │
         if dirty() === true
               │
               ▼
    ┌──────────────────┐
    │  renderFrame()   │
    └─────┬────────────┘
          │
          ▼
    ┌─────────────────────┐
    │ FrameRenderer       │
    │ .renderFrame()      │
    └─────┬───────────────┘
          │
          ├─→ Clear canvas
          │
          ├─→ Draw background image
          │
          ├─→ For each visible box:
          │   - Draw box rectangle
          │   - Draw nametag
          │   - Draw selection UI
          │   - Draw handles/knob
          │
          ├─→ Draw creation preview
          │
          ├─→ Draw measurement lines
          │
          └─→ Draw context menu

          │
          ▼
    ┌──────────────────┐
    │ dirty.set(false) │
    └──────────────────┘
```

---

## Box Creation Flow

### Drag-to-Create

```
┌─────────────────────────────────────┐
│   User drags in create mode         │
└──────────────┬──────────────────────┘
               │
        ┌──────┴──────┐
        │PointerDown  │
        └──────┬──────┘
               ▼
    ┌────────────────────┐
    │BoxCreationHandler  │
    │.startCreate()      │
    │- Store start point │
    │- Generate temp ID  │
    └─────┬──────────────┘
          │
          ▼
    ┌─────────────────────┐
    │Update creation state│
    │in StateManager      │
    └─────┬───────────────┘
          │
          ▼
    [Render preview]
          │
        ┌─┴─────┐
        │ Move  │
        └─┬─────┘
          ▼
    ┌────────────────────┐
    │BoxCreationHandler  │
    │.updatePreview()    │
    │- Calculate size    │
    └─────┬──────────────┘
          │
          ▼
    [Render preview]
          │
        ┌─┴─────┐
        │  Up   │
        └─┬─────┘
          ▼
    ┌────────────────────┐
    │BoxCreationHandler  │
    │.completeCreate()   │
    │- Check min size    │
    │- Create box        │
    └─────┬──────────────┘
          │
          ▼
    ┌─────────────────────┐
    │HistoryService       │
    │.recordBoxCreation() │
    └─────┬───────────────┘
          │
          ▼
    ┌─────────────────────┐
    │Clear creation state │
    └─────┬───────────────┘
          │
          ▼
    [scheduleRender]
```

### Context Menu Create

```
┌─────────────────────────────────────┐
│   User right-clicks canvas          │
└──────────────┬──────────────────────┘
               │
               ▼
    ┌────────────────────┐
    │ContextMenuHandler  │
    │.open()             │
    │- Store world pos   │
    └─────┬──────────────┘
          │
          ▼
    [Show context menu]
          │
          ▼
    ┌─────────────────┐
    │User selects type│
    └─────┬───────────┘
          │
          ▼
    ┌────────────────────┐
    │BoxCreationHandler  │
    │.createBoxAt()      │
    │- Calculate size    │
    │  based on zoom     │
    │- Generate ID       │
    └─────┬──────────────┘
          │
          ▼
    ┌─────────────────────┐
    │HistoryService       │
    │.recordBoxCreation() │
    └─────┬───────────────┘
          │
          ▼
    ┌─────────────────────┐
    │Close context menu   │
    └─────┬───────────────┘
          │
          ▼
    [scheduleRender]
```

---

## Box Manipulation Flow

### Rotation

```
┌─────────────────────────────────────┐
│   User drags rotation knob          │
└──────────────┬──────────────────────┘
               │
        ┌──────┴──────┐
        │PointerDown  │
        └──────┬──────┘
               ▼
    ┌────────────────────────┐
    │HoverHandler            │
    │.detectRotationKnob()   │
    │- Returns true if hit   │
    └─────┬──────────────────┘
          │
          ▼
    ┌────────────────────────┐
    │BoxManipulationHandler  │
    │.startRotation()        │
    │- Store initial angle   │
    │- Store box center      │
    └─────┬──────────────────┘
          │
          ▼
    ┌─────────────────────┐
    │Update rotating state│
    └─────┬───────────────┘
          │
        ┌─┴─────┐
        │ Move  │
        └─┬─────┘
          ▼
    ┌────────────────────┐
    │BoxManipulator      │
    │.rotateBox()        │
    │- Calculate angle   │
    │  using atan2       │
    │- Return new box    │
    └─────┬──────────────┘
          │
          ▼
    ┌─────────────────┐
    │Update localBoxes│
    └─────┬───────────┘
          │
          ▼
    [scheduleRender]
          │
        ┌─┴─────┐
        │  Up   │
        └─┬─────┘
          ▼
    ┌─────────────────────┐
    │HistoryService       │
    │.recordRotation()    │
    └─────┬───────────────┘
          │
          ▼
    ┌──────────────────┐
    │Reset rotation    │
    │state             │
    └─────┬────────────┘
          │
          ▼
    [scheduleRender]
```

### Resize

```
┌─────────────────────────────────────┐
│   User drags corner handle          │
└──────────────┬──────────────────────┘
               │
        ┌──────┴──────┐
        │PointerDown  │
        └──────┬──────┘
               ▼
    ┌────────────────────────┐
    │HoverHandler            │
    │.detectCornerHandle()   │
    │- Returns corner index  │
    └─────┬──────────────────┘
          │
          ▼
    ┌────────────────────────┐
    │BoxManipulationHandler  │
    │.startResize()          │
    │- Store opposite corner │
    │- Store initial mouse   │
    └─────┬──────────────────┘
          │
          ▼
    ┌─────────────────────┐
    │Update resizing state│
    └─────┬───────────────┘
          │
        ┌─┴─────┐
        │ Move  │
        └─┬─────┘
          ▼
    ┌────────────────────┐
    │BoxManipulator      │
    │.resizeBox()        │
    │- Calculate new size│
    │- Maintain rotation │
    │- Return new box    │
    └─────┬──────────────┘
          │
          ▼
    ┌─────────────────┐
    │Update localBoxes│
    └─────┬───────────┘
          │
          ▼
    [scheduleRender]
          │
        ┌─┴─────┐
        │  Up   │
        └─┬─────┘
          ▼
    ┌─────────────────────┐
    │HistoryService       │
    │.recordResize()      │
    └─────┬───────────────┘
          │
          ▼
    ┌──────────────────┐
    │Reset resize      │
    │state             │
    └─────┬────────────┘
          │
          ▼
    [scheduleRender]
```

### Drag (Move)

```
┌─────────────────────────────────────┐
│   User drags box body               │
└──────────────┬──────────────────────┘
               │
        ┌──────┴──────┐
        │PointerDown  │
        └──────┬──────┘
               ▼
    ┌────────────────────────┐
    │BoxManipulationHandler  │
    │.startDrag()            │
    │- Store initial mouse   │
    │- Store initial box pos │
    └─────┬──────────────────┘
          │
          ▼
    ┌─────────────────────┐
    │Update dragging state│
    └─────┬───────────────┘
          │
        ┌─┴─────┐
        │ Move  │
        └─┬─────┘
          ▼
    ┌────────────────────┐
    │BoxManipulator      │
    │.moveBox()          │
    │- Calculate delta   │
    │- Clamp to bounds   │
    │- Return new box    │
    └─────┬──────────────┘
          │
          ▼
    ┌─────────────────┐
    │Update localBoxes│
    └─────┬───────────┘
          │
          ▼
    [scheduleRender]
          │
        ┌─┴─────┐
        │  Up   │
        └─┬─────┘
          ▼
    ┌─────────────────────┐
    │HistoryService       │
    │.recordMove()        │
    └─────┬───────────────┘
          │
          ▼
    ┌──────────────────┐
    │Reset dragging    │
    │state             │
    └─────┬────────────┘
          │
          ▼
    [scheduleRender]
```

---

## History Integration Flow

```
┌─────────────────────────────────────┐
│ HistoryService.visibleBoxes (signal)│
│ - Source of truth for boxes         │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  effect() in Component              │
│  - Watches visibleBoxes changes     │
└──────────────┬──────────────────────┘
               │
         ┌─────┴─────┐
         │ Skip if:  │
         │ dragging  │
         │ resizing  │
         │ rotating  │
         │ creating  │
         └─────┬─────┘
               │ NO (not interacting)
               ▼
    ┌──────────────────┐
    │ Compare with     │
    │ localBoxes       │
    └─────┬────────────┘
          │
    Different?
          │ YES
          ▼
    ┌─────────────────┐
    │localBoxes.set() │
    │[...boxes]       │
    └─────┬───────────┘
          │
          ▼
    ┌─────────────────┐
    │rebuildIndex()   │
    │- QuadtreeUtils  │
    └─────┬───────────┘
          │
          ▼
    [scheduleRender]
```

---

## Coordinate Transformation Flow

```
┌─────────────────────────────────────┐
│         DOM Event                   │
│         event.clientX/Y             │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  CoordinateTransform                │
│  .screenToWorld()                   │
└──────────────┬──────────────────────┘
               │
         ┌─────┴─────┐
         │ Step 1:   │
         │ Screen to │
         │ Canvas    │
         │ - Subtract│
         │   canvas  │
         │   offset  │
         │ - Multiply│
         │   by DPR  │
         └─────┬─────┘
               │
               ▼
         ┌─────┴─────┐
         │ Step 2:   │
         │ Canvas to │
         │ World     │
         │ - Divide  │
         │   by zoom │
         │ - Add     │
         │   camera  │
         │   position│
         └─────┬─────┘
               │
               ▼
┌─────────────────────────────────────┐
│  World Coordinates (pixels on image)│
│  Used for all calculations          │
└─────────────────────────────────────┘
```

### Box Storage Transformation

```
┌─────────────────────────────────────┐
│  World Box (pixels on image)        │
│  { x: 500, y: 300, w: 200, h: 100 } │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  BoxUtils.toNormalized()            │
│  - Divide by image dimensions       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Normalized Box (0-1 range)         │
│  { x: 0.5, y: 0.3, w: 0.2, h: 0.1 } │
│  Stored in HistoryService           │
│  Saved to cookies                   │
└─────────────────────────────────────┘
```

---

## Quadtree Query Flow

```
┌─────────────────────────────────────┐
│  Need to find visible boxes         │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  QuadtreeUtils.queryQuadtree()      │
└──────────────┬──────────────────────┘
               │
               ▼
    ┌──────────────────┐
    │ Define viewport  │
    │ rectangle in     │
    │ world coords     │
    └─────┬────────────┘
          │
          ▼
    ┌──────────────────┐
    │ Quadtree.query() │
    │ - Traverse tree  │
    │ - Check bounds   │
    │ - Return items   │
    └─────┬────────────┘
          │
          ▼
    ┌──────────────────┐
    │ O(log n) instead │
    │ of O(n) linear   │
    │ search           │
    └──────────────────┘
```

---

## Measurement Tool Flow

```
┌─────────────────────────────────────┐
│   User toggles measurement mode     │
└──────────────┬──────────────────────┘
               │
               ▼
    ┌────────────────────────┐
    │MeasurementHandler      │
    │.toggleMeasurementMode()│
    │- Clear points          │
    │- Update state          │
    └─────┬──────────────────┘
          │
          ▼
    [Update cursor]
          │
        ┌─┴────────┐
        │ Click 1  │
        └─┬────────┘
          ▼
    ┌────────────────────────┐
    │MeasurementHandler      │
    │.handlePointerDown()    │
    │- Store point 1         │
    └─────┬──────────────────┘
          │
          ▼
    [scheduleRender]
          │
        ┌─┴────────┐
        │ Click 2  │
        └─┬────────┘
          ▼
    ┌────────────────────────┐
    │MeasurementHandler      │
    │.handlePointerDown()    │
    │- Store point 2         │
    │- Calculate distance    │
    └─────┬──────────────────┘
          │
          ▼
    [scheduleRender]
    [Show measurement line]
          │
        ┌─┴────────┐
        │ Drag pt  │
        └─┬────────┘
          ▼
    ┌────────────────────────┐
    │MeasurementHandler      │
    │.handlePointerMove()    │
    │- Update point position │
    │- Recalculate distance  │
    └─────┬──────────────────┘
          │
          ▼
    [scheduleRender]
```

---

## Magic Detection Flow

```
┌─────────────────────────────────────┐
│   User clicks in magic mode         │
└──────────────┬──────────────────────┘
               │
               ▼
    ┌────────────────────────┐
    │MagicDetectionHandler   │
    │.detectAndCreateBox()   │
    └─────┬──────────────────┘
          │
          ▼
    ┌──────────────────┐
    │ Get pixel color  │
    │ at click point   │
    └─────┬────────────┘
          │
          ▼
    ┌──────────────────┐
    │ Flood fill       │
    │ - Check adjacent │
    │   pixels         │
    │ - Compare color  │
    │   with tolerance │
    │ - Track visited  │
    │ - Find bounds    │
    └─────┬────────────┘
          │
          ▼
    ┌──────────────────┐
    │ Calculate AABB   │
    │ of detected area │
    └─────┬────────────┘
          │
          ▼
    ┌────────────────────┐
    │BoxCreationHandler  │
    │.createBoxAt()      │
    │- Use detected bbox │
    └─────┬──────────────┘
          │
          ▼
    ┌─────────────────────┐
    │HistoryService       │
    │.recordBoxCreation() │
    └─────┬───────────────┘
          │
          ▼
    [scheduleRender]
```
