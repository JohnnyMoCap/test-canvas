# Component Flow Diagram

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     User Interactions                           │
│            (Mouse, Touch, Keyboard, Wheel)                      │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              CanvasViewportComponent                            │
│                   (Orchestrator)                                │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Event Handlers                                          │  │
│  │  • onPointerDown/Up/Move                                 │  │
│  │  • onWheel                                               │  │
│  │  • Context menu events                                   │  │
│  └─────────────┬────────────────────────────────────────────┘  │
│                │                                                │
│                │  Delegates to utilities                        │
│                ▼                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Coordination Layer                                      │  │
│  │  • handleRotation()                                      │  │
│  │  • handleResize()                                        │  │
│  │  • handleCreateComplete()                                │  │
│  │  • detectHover()                                         │  │
│  └─────────────┬────────────────────────────────────────────┘  │
│                │                                                │
└────────────────┼────────────────────────────────────────────────┘
                 │
                 │  Uses utilities
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Utility Layer                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │  State Managers  │  │  Event Handlers  │  │  Lifecycle   │ │
│  ├──────────────────┤  ├──────────────────┤  ├──────────────┤ │
│  │ StateManager     │  │ PointerEvent     │  │ Lifecycle    │ │
│  │  • State props   │  │ Handler          │  │ Manager      │ │
│  │  • State logic   │  │  • handlePointer │  │  • RAF loop  │ │
│  │  • Reset methods │  │    Down/Up/Move  │  │  • Init      │ │
│  │                  │  │  • handleWheel   │  │  • Resize    │ │
│  │ CursorManager    │  │  • Event routing │  │              │ │
│  │  • setCursor()   │  │                  │  │              │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │ Box Operations   │  │  User Actions    │  │  Detection   │ │
│  ├──────────────────┤  ├──────────────────┤  ├──────────────┤ │
│  │ BoxManipulator   │  │ ClipboardManager │  │ HoverDetect  │ │
│  │  • rotateBox()   │  │  • copyBox()     │  │ Utils        │ │
│  │  • resizeBox()   │  │  • pastBox()     │  │  • detect    │ │
│  │  • moveBox()     │  │                  │  │    hovered   │ │
│  │                  │  │ ContextMenuUtils │  │              │ │
│  │ BoxCreationUtils │  │  • open/close    │  │ Interaction  │ │
│  │  • createFrom    │  │  • positioning   │  │ Utils        │ │
│  │    Drag/Menu     │  │                  │  │  • corner    │ │
│  └──────────────────┘  └──────────────────┘  │    handles   │ │
│                                               └──────────────┘ │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │  Rendering       │  │  Spatial Index   │  │ Transforms   │ │
│  ├──────────────────┤  ├──────────────────┤  ├──────────────┤ │
│  │ FrameRenderer    │  │ QuadtreeUtils    │  │ Coordinate   │ │
│  │  • renderFrame() │  │  • rebuild       │  │ Transform    │ │
│  │  • draw boxes    │  │  • query         │  │  • screen↔   │ │
│  │  • draw UI       │  │                  │  │    world     │ │
│  │                  │  │ Quadtree         │  │              │ │
│  │ BackgroundUtils  │  │  • data struct   │  │ CameraUtils  │ │
│  │  • load image    │  │  • queryRange    │  │  • clamp     │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                         │
                         │  Updates
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Data Layer                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │  Angular Signals │  │    Services      │  │    Core      │ │
│  ├──────────────────┤  ├──────────────────┤  ├──────────────┤ │
│  │ camera           │  │ HistoryService   │  │ Box          │ │
│  │ localBoxes       │  │  • undo/redo     │  │ Camera       │ │
│  │ dirty            │  │  • recordAdd     │  │ CreateState  │ │
│  │                  │  │  • recordMove    │  │ etc.         │ │
│  │                  │  │                  │  │              │ │
│  │                  │  │ HotkeyService    │  │              │ │
│  │                  │  │  • register      │  │              │ │
│  │                  │  │  • trigger       │  │              │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Event Flow Example: Box Rotation

```
1. User drags rotation knob
   │
   ▼
2. onPointerMove(event) in Component
   │
   ▼
3. PointerEventHandler.handlePointerMove()
   │ (detects rotation in progress)
   │
   ▼
4. Calls onRotate callback with (worldX, worldY)
   │
   ▼
5. Component.handleRotation(wx, wy)
   │
   ▼
6. BoxManipulator.rotateBox(box, wx, wy, ...)
   │ (pure function, calculates new rotation)
   │
   ▼
7. Returns updated box
   │
   ▼
8. BoxManipulator.updateBoxInArray(boxes, updatedBox)
   │
   ▼
9. localBoxes.set([...]) (signal update)
   │
   ▼
10. Effect triggers
    │
    ▼
11. scheduleRender()
    │
    ▼
12. RAF loop picks up dirty flag
    │
    ▼
13. FrameRenderer.renderFrame(...)
    │
    ▼
14. Canvas updated with rotated box
```

## Data Flow: History Integration

```
┌──────────────────────────┐
│   HistoryService         │
│   (Source of Truth)      │
│                          │
│   visibleBoxes (signal)  │
└────────────┬─────────────┘
             │
             │ Effect watches
             ▼
┌──────────────────────────┐
│   Component              │
│                          │
│   effect(() => {         │
│     boxes = history      │
│       .visibleBoxes()    │
│     localBoxes.set(...)  │
│     rebuildIndex()       │
│   })                     │
└────────────┬─────────────┘
             │
             │ Local copy for
             │ real-time updates
             ▼
┌──────────────────────────┐
│   localBoxes (signal)    │
│   (Working Copy)         │
│                          │
│   • Modified during      │
│     interactions         │
│   • Triggers render      │
│   • Synced back via      │
│     history recording    │
└──────────────────────────┘
```

## Render Pipeline

```
┌──────────────────────────┐
│  State Change            │
│  (camera, boxes, etc.)   │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│  Effect Triggered        │
│  scheduleRender()        │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│  dirty.set(true)         │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│  RAF Loop (60fps)        │
│  Checks dirty flag       │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│  renderFrame()           │
│  • Get view bounds       │
│  • Query visible boxes   │
│  • Call FrameRenderer    │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│  FrameRenderer           │
│  • Clear canvas          │
│  • Draw background       │
│  • Draw boxes            │
│  • Draw nametags         │
│  • Draw selection UI     │
│  • Draw creation preview │
│  • Draw debug (quadtree) │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│  Canvas Updated          │
│  dirty.set(false)        │
└──────────────────────────┘
```

## Interaction State Machine

```
                    ┌──────────────┐
                    │   IDLE       │
                    └───────┬──────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
            ▼               ▼               ▼
    ┌─────────────┐  ┌──────────┐  ┌──────────────┐
    │  HOVERING   │  │ PANNING  │  │  CREATING    │
    │             │  │  CAMERA  │  │  BOX         │
    └─────────────┘  └──────────┘  └──────────────┘
            │
            │ Click on box
            ▼
    ┌─────────────┐
    │  SELECTED   │
    └───────┬─────┘
            │
     ┌──────┼──────┐
     │      │      │
     ▼      ▼      ▼
┌─────┐ ┌──────┐ ┌────────┐
│DRAG │ │RESIZE│ │ROTATE  │
└─────┘ └──────┘ └────────┘
     │      │      │
     └──────┼──────┘
            │ Pointer up
            ▼
    ┌─────────────┐
    │  SELECTED   │
    │ (record to  │
    │  history)   │
    └─────────────┘
```

## Utility Dependency Graph

```
Component
  │
  ├─ StateManager
  │   └─ (no dependencies)
  │
  ├─ CursorManager
  │   └─ (no dependencies)
  │
  ├─ LifecycleManager
  │   └─ QuadtreeUtils
  │       └─ BoxUtils
  │
  ├─ PointerEventHandler
  │   ├─ CoordinateTransform
  │   ├─ BoxUtils
  │   ├─ NametagUtils
  │   ├─ InteractionUtils
  │   ├─ HoverDetectionUtils
  │   ├─ ContextMenuUtils
  │   └─ BoxCreationUtils
  │
  ├─ BoxManipulator
  │   └─ BoxUtils
  │
  ├─ ClipboardManager
  │   ├─ CoordinateTransform
  │   ├─ BoxUtils
  │   └─ BoxCreationUtils
  │
  └─ FrameRenderer
      ├─ BackgroundUtils
      ├─ RenderUtils
      ├─ NametagUtils
      └─ ColorUtils
```

## Section Organization in Component

```typescript
// ========== STATE & SIGNALS ==========
// Minimal declarations, most state in StateManager

// ========== CONSTRUCTOR ==========
// Initialize managers, setup effects/hotkeys

// ========== LIFECYCLE HOOKS ==========
// ngAfterViewInit, ngOnDestroy (delegated)

// ========== PUBLIC API ==========
// resetCamera, toggleCreateMode, etc.

// ========== EVENT HANDLERS ==========
// onWheel, onPointerDown/Up/Move (delegated)

// ========== PRIVATE SETUP METHODS ==========
// setupEffects, setupHotkeys, initializeCanvas, etc.

// ========== INTERACTION HANDLERS ==========
// handleCreateComplete, recordInteractionHistory, etc.

// ========== BOX MANIPULATION ==========
// handleRotation, handleResize, updateBoxPosition (delegated)

// ========== DETECTION ==========
// detectHover (delegated)

// ========== RENDERING ==========
// scheduleRender, renderFrame, queryVisible

// ========== BACKGROUND & LAYOUT ==========
// loadBackground, onResize

// ========== INDEX & CAMERA ==========
// rebuildIndex, clampCamera

// ========== CURSOR & UI ==========
// updateCursor

// ========== HOTKEY HANDLERS ==========
// handleUndo, handleRedo, handleCopy, handlePaste
```

---

**Key Principles:**

1. **Separation of Concerns** - Each utility has one job
2. **Clear Delegation** - Component orchestrates, utilities execute
3. **Data Flow** - Unidirectional from events to state to render
4. **Testability** - Pure functions and isolated utilities
5. **Maintainability** - Easy to locate and modify specific functionality
