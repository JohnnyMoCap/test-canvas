# Architecture Analysis & Refactoring Proposal

## Current Architecture Problems

### 1. **Fragmented Responsibilities**

The current architecture has responsibilities scattered across too many places:

#### State is Everywhere

- **StateManager** holds 30+ signals for various states
- **CanvasViewportComponent** has its own signals (`camera`, `localBoxes`, `dirty`)
- **CursorManager** duplicates cursor tracking (also in StateManager)
- **PointerEventHandler** is stateless but receives state as parameters
- No clear ownership - who owns what?

#### Business Logic Split

- **Box manipulation logic** split between:
  - `BoxManipulator` (rotate, resize, move calculations)
  - `InteractionUtils` (detection logic)
  - `PointerEventHandler` (coordination)
  - `CanvasViewportComponent` (actual updates)
- **Cursor management** split between:
  - `CursorManager` (setter)
  - `StateManager` (tracking)
  - `PointerEventHandler` (detection in handlePointerMove)
  - `InteractionUtils` (getResizeCursor)
  - `CanvasViewportComponent` (callback wiring)

#### Callback Hell

The `PointerEventHandler` methods take 8-13 callback parameters each:

```typescript
handlePointerDown(
  event,
  canvas,
  state,
  camera,
  boxes,
  quadtree,
  cache,
  ctx,
  onContextMenuOpen, // callback 1
  onCreateStart, // callback 2
  onBoxInteractionStart, // callback 3
  onCameraPanStart, // callback 4
  onUpdateCursor, // callback 5
);

handlePointerMove(
  event,
  canvas,
  state,
  camera,
  boxes,
  quadtree,
  cache,
  ctx,
  onCreatePreview, // callback 1
  onRotate, // callback 2
  onResize, // callback 3
  onDrag, // callback 4
  onCameraPan, // callback 5
  onHoverDetection, // callback 6
  onUpdateCursor, // callback 7
);
```

**Why this is bad:**

- Hard to trace where actions happen
- Need to look in 3+ files to understand one feature
- Callbacks make testing difficult
- Adding new features requires touching many files

### 2. **Utils vs Managers vs Handlers**

There's no clear distinction:

- **Utils** (coordinate-transform, box-utils) - Pure functions ✅ Good
- **Managers** (state-manager, cursor-manager, lifecycle-manager, clipboard-manager) - Stateful classes
- **Handlers** (pointer-event-handler) - Stateless static methods with callbacks
- **Manipulators** (box-manipulator) - Pure static methods

**Confusion:**

- Why is `StateManager` a class but `PointerEventHandler` all static?
- Why is `CursorManager` separate from `StateManager`?
- Why does `ClipboardManager` exist when clipboard is in StateManager?

### 3. **Tight Coupling Through Callbacks**

The component must wire up every single action:

```typescript
onPointerMove(e: PointerEvent) {
  PointerEventHandler.handlePointerMove(
    // ...params,
    (worldX, worldY) => { this.handleRotation(worldX, worldY); },
    (worldX, worldY) => { this.handleResize(worldX, worldY); },
    (worldX, worldY) => { this.updateBoxPosition(...); },
    // etc...
  );
}
```

This means the component must:

- Know about ALL possible actions
- Implement handlers for each
- Wire them all up correctly
- Coordinate state updates

### 4. **State Mutation Inconsistency**

State updates happen in multiple ways:

```typescript
// Direct signal mutation
this.state.isRotating.set(true);

// Through StateManager methods
this.state.startInteraction(boxId, x, y, w, h, rotation);

// Component-level signals
this.localBoxes.set([...boxes]);
this.camera.set(newCamera);

// Through utility methods
this.cursorManager.setCursor(canvas, cursor);
```

---

## Proposed Architecture: Feature-Based Modules

### Core Principle

**Group code by feature, not by technical role**

Instead of having all "utils" together, group everything needed for a feature together.

### New Structure

```
src/components/canvas-viewpoint/
├── canvas-viewpoint.ts          # Thin orchestrator
├── canvas-viewpoint.html
├── canvas-viewpoint.css
│
├── core/
│   ├── types.ts                  # Shared types
│   ├── coordinate-transform.ts   # Pure math (used everywhere)
│   └── performance-config.ts     # Constants
│
├── state/
│   └── viewport-state.ts         # SINGLE state manager
│
├── features/
│   ├── box-interaction/
│   │   ├── box-interaction.controller.ts    # Owns rotation, resize, drag
│   │   ├── interaction-detector.ts          # Hit testing
│   │   └── box-manipulator.ts               # Math calculations
│   │
│   ├── box-creation/
│   │   ├── creation.controller.ts           # Owns create mode
│   │   └── creation-utils.ts                # Create logic
│   │
│   ├── camera/
│   │   ├── camera.controller.ts             # Owns pan, zoom
│   │   └── camera-utils.ts                  # Math
│   │
│   ├── selection/
│   │   ├── selection.controller.ts          # Owns select/hover
│   │   └── hover-detector.ts                # Hit testing
│   │
│   ├── clipboard/
│   │   └── clipboard.controller.ts          # Copy/paste
│   │
│   ├── context-menu/
│   │   └── context-menu.controller.ts       # Menu logic
│   │
│   └── rendering/
│       ├── render.controller.ts             # RAF loop, render scheduling
│       ├── frame-renderer.ts                # Canvas drawing
│       └── quadtree.ts                      # Spatial index
│
└── input/
    └── input-router.ts                      # Routes DOM events to features
```

### Key Changes

#### 1. **Feature Controllers Own Their Domain**

Each controller is a cohesive unit that owns:

- State (via ViewportState)
- Logic
- Event handling
- Side effects

**Example: BoxInteractionController**

```typescript
export class BoxInteractionController {
  constructor(
    private state: ViewportState,
    private historyService: HistoryService,
  ) {}

  // Public API - called by InputRouter
  handlePointerDown(worldPos: Point, boxes: Box[]): boolean {
    const selected = this.state.selectedBox;
    if (!selected) return false;

    // Check rotation knob
    if (this.detector.isOnRotationKnob(worldPos, selected)) {
      this.startRotation(worldPos, selected);
      return true; // Handled
    }

    // Check resize corners
    const corner = this.detector.getResizeCorner(worldPos, selected);
    if (corner) {
      this.startResize(worldPos, selected, corner);
      return true; // Handled
    }

    return false; // Not handled
  }

  handlePointerMove(worldPos: Point): void {
    if (this.state.interactionMode === 'rotating') {
      this.updateRotation(worldPos);
    } else if (this.state.interactionMode === 'resizing') {
      this.updateResize(worldPos);
    } else if (this.state.interactionMode === 'dragging') {
      this.updateDrag(worldPos);
    }
  }

  handlePointerUp(): void {
    if (this.state.interactionMode !== 'none') {
      this.commitInteraction();
      this.state.interactionMode = 'none';
    }
  }

  updateCursor(worldPos: Point): string | null {
    const selected = this.state.selectedBox;
    if (!selected) return null;

    if (this.detector.isOnRotationKnob(worldPos, selected)) {
      return this.state.isInteracting ? 'grabbing' : 'grab';
    }

    const corner = this.detector.getResizeCorner(worldPos, selected);
    if (corner) {
      return this.getResizeCursor(corner, selected);
    }

    return null; // Let someone else decide
  }

  // Private implementation
  private startRotation(worldPos: Point, box: Box) {
    this.state.interactionMode = 'rotating';
    this.state.rotationStart = Math.atan2(worldPos.y - box.y, worldPos.x - box.x);
    this.state.startSnapshot = { ...box };
    this.state.setCursor('grabbing');
  }

  private updateRotation(worldPos: Point) {
    const box = this.state.selectedBox!;
    const angle = Math.atan2(worldPos.y - box.y, worldPos.x - box.x);
    const delta = angle - this.state.rotationStart;

    box.rotation = this.state.startSnapshot!.rotation + delta;
    this.state.markDirty();
  }

  private commitInteraction() {
    const before = this.state.startSnapshot!;
    const after = this.state.selectedBox!;

    if (this.state.interactionMode === 'rotating') {
      this.historyService.recordRotate(after.id, before.rotation, after.rotation);
    }
    // ... similar for resize/drag
  }
}
```

#### 2. **Unified State Manager**

```typescript
export class ViewportState {
  // Boxes
  boxes = signal<Box[]>([]);
  selectedBoxId = signal<string | null>(null);
  hoveredBoxId = signal<string | null>(null);

  // Camera
  camera = signal<Camera>({ zoom: 1, x: 0, y: 0, rotation: 0 });

  // Interaction mode (replaces many boolean flags)
  interactionMode = signal<'none' | 'rotating' | 'resizing' | 'dragging' | 'panning' | 'creating'>(
    'none',
  );

  // Interaction context (only set when interactionMode !== 'none')
  rotationStart = signal<number>(0);
  resizeCorner = signal<ResizeCorner | null>(null);
  dragStart = signal<Point>({ x: 0, y: 0 });
  startSnapshot = signal<Box | null>(null);

  // UI
  cursor = signal<string>('default');
  contextMenu = signal<ContextMenuState | null>(null);

  // Canvas
  canvas = signal<HTMLCanvasElement | null>(null);
  ctx = signal<CanvasRenderingContext2D | null>(null);

  // Computed
  selectedBox = computed(() => {
    const id = this.selectedBoxId();
    return this.boxes().find((b) => b.id === id) || null;
  });

  isInteracting = computed(() => this.interactionMode() !== 'none');

  // Actions (encapsulate common patterns)
  setCursor(cursor: string) {
    if (this.cursor() !== cursor) {
      this.cursor.set(cursor);
      if (this.canvas()) {
        this.canvas()!.style.cursor = cursor;
      }
    }
  }

  selectBox(id: string | null) {
    this.selectedBoxId.set(id);
  }

  markDirty() {
    // Trigger render
  }
}
```

#### 3. **Input Router** (Instead of PointerEventHandler)

```typescript
export class InputRouter {
  private controllers: FeatureController[];

  constructor(
    private state: ViewportState,
    // Inject all feature controllers
    private boxInteraction: BoxInteractionController,
    private camera: CameraController,
    private selection: SelectionController,
    private creation: CreationController,
    private contextMenu: ContextMenuController,
  ) {
    this.controllers = [
      this.contextMenu, // Highest priority
      this.creation,
      this.boxInteraction,
      this.selection,
      this.camera, // Lowest priority (fallback)
    ];
  }

  onPointerDown(event: PointerEvent, canvas: HTMLCanvasElement): void {
    const worldPos = this.toWorldPos(event, canvas);

    // Try each controller in priority order
    for (const controller of this.controllers) {
      if (controller.handlePointerDown?.(worldPos, event)) {
        return; // Handled
      }
    }
  }

  onPointerMove(event: PointerEvent, canvas: HTMLCanvasElement): void {
    const worldPos = this.toWorldPos(event, canvas);

    // Update active interaction
    for (const controller of this.controllers) {
      if (controller.handlePointerMove?.(worldPos, event)) {
        return; // Handled
      }
    }

    // Update cursor (priority order)
    for (const controller of this.controllers) {
      const cursor = controller.updateCursor?.(worldPos);
      if (cursor) {
        this.state.setCursor(cursor);
        return;
      }
    }

    this.state.setCursor('default');
  }

  onPointerUp(event: PointerEvent): void {
    // Notify all controllers
    this.controllers.forEach((c) => c.handlePointerUp?.(event));
  }

  private toWorldPos(event: PointerEvent, canvas: HTMLCanvasElement): Point {
    const rect = canvas.getBoundingClientRect();
    const mx = (event.clientX - rect.left) * window.devicePixelRatio;
    const my = (event.clientY - rect.top) * window.devicePixelRatio;
    return CoordinateTransform.screenToWorld(
      mx,
      my,
      canvas.width,
      canvas.height,
      this.state.camera(),
    );
  }
}

interface FeatureController {
  handlePointerDown?(worldPos: Point, event: PointerEvent): boolean;
  handlePointerMove?(worldPos: Point, event: PointerEvent): boolean;
  handlePointerUp?(event: PointerEvent): void;
  updateCursor?(worldPos: Point): string | null;
}
```

#### 4. **Simplified Component**

```typescript
@Component({ ... })
export class CanvasViewportComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvasEl') canvasRef!: ElementRef<HTMLCanvasElement>;

  // Single state instance
  private state: ViewportState;

  // Feature controllers
  private inputRouter: InputRouter;
  private renderController: RenderController;

  constructor(
    private historyService: HistoryService,
    private hotkeyService: HotkeyService,
  ) {
    this.state = new ViewportState();

    // Initialize features
    const boxInteraction = new BoxInteractionController(this.state, historyService);
    const camera = new CameraController(this.state);
    const selection = new SelectionController(this.state);
    const creation = new CreationController(this.state, historyService);
    const contextMenu = new ContextMenuController(this.state, historyService);

    this.inputRouter = new InputRouter(
      this.state,
      boxInteraction,
      camera,
      selection,
      creation,
      contextMenu,
    );

    this.renderController = new RenderController(this.state);

    this.setupEffects();
  }

  ngAfterViewInit() {
    const canvas = this.canvasRef.nativeElement;
    this.state.canvas.set(canvas);
    this.state.ctx.set(canvas.getContext('2d'));
    this.renderController.start();
  }

  ngOnDestroy() {
    this.renderController.stop();
  }

  // Simple event delegation
  onPointerDown(e: PointerEvent) {
    this.inputRouter.onPointerDown(e, this.canvasRef.nativeElement);
  }

  onPointerMove(e: PointerEvent) {
    this.inputRouter.onPointerMove(e, this.canvasRef.nativeElement);
  }

  onPointerUp(e: PointerEvent) {
    this.inputRouter.onPointerUp(e);
  }

  onWheel(e: WheelEvent) {
    // Could be part of CameraController
    this.inputRouter.onWheel(e, this.canvasRef.nativeElement);
  }

  private setupEffects() {
    // Sync boxes from history
    effect(() => {
      const boxes = this.historyService.visibleBoxes();
      if (!this.state.isInteracting()) {
        this.state.boxes.set([...boxes]);
      }
    });

    // Trigger render on state changes
    effect(() => {
      const _ = this.state.camera();
      const __ = this.state.boxes();
      this.renderController.scheduleRender();
    });
  }
}
```

---

## Migration Path

### Phase 1: Consolidate State (Week 1)

1. Merge `CursorManager` into `StateManager` → `ViewportState`
2. Move component-level signals to `ViewportState`
3. Replace boolean flags with `interactionMode` enum
4. Update all references

### Phase 2: Create InputRouter (Week 2)

1. Create `InputRouter` class
2. Move coordinate conversion from `PointerEventHandler` to `InputRouter`
3. Keep callbacks initially but route through InputRouter
4. Test thoroughly

### Phase 3: Extract First Feature Controller (Week 2-3)

1. Start with simplest: `ContextMenuController`
2. Move logic from component + PointerEventHandler
3. Implement `FeatureController` interface
4. Wire into InputRouter
5. Remove old code paths

### Phase 4: Extract Remaining Controllers (Week 3-4)

1. `CreationController`
2. `BoxInteractionController` (rotate, resize, drag)
3. `CameraController`
4. `SelectionController`
5. Each: extract → test → remove old code

### Phase 5: Cleanup (Week 4)

1. Remove `PointerEventHandler`
2. Reorganize file structure
3. Update documentation
4. Remove unused utils

---

## Benefits

### 1. **Clear Ownership**

- Each feature has ONE controller that owns its logic
- State is centralized in `ViewportState`
- No more hunting through 5 files to understand rotation

### 2. **Easy to Find Code**

- Want to change rotation? → `features/box-interaction/`
- Want to change cursor logic? → Each controller's `updateCursor()`
- Want to add zoom constraints? → `features/camera/`

### 3. **Testable**

```typescript
describe('BoxInteractionController', () => {
  it('should rotate box on drag', () => {
    const state = new ViewportState();
    const history = new MockHistoryService();
    const controller = new BoxInteractionController(state, history);

    state.boxes.set([{ id: '1', x: 0, y: 0, rotation: 0 }]);
    state.selectBox('1');

    controller.handlePointerDown({ x: 10, y: 0 }, boxes);
    controller.handlePointerMove({ x: 0, y: 10 });

    expect(state.boxes()[0].rotation).toBeCloseTo(Math.PI / 2);
  });
});
```

### 4. **Extensible**

Add new feature:

1. Create controller implementing `FeatureController`
2. Add to `InputRouter.controllers`
3. Done - no touching existing code

### 5. **No Callback Hell**

Controllers call state/services directly. No 13-parameter functions.

### 6. **Priority System**

Input router tries controllers in order. Context menu gets first chance to handle events.

---

## Comparison

### Current (Finding rotation logic)

1. Look in `canvas-viewpoint.ts` → `onPointerDown`
2. See it calls `PointerEventHandler.handlePointerDown`
3. Look in `pointer-event-handler.ts` → find rotation detection
4. See it calls `InteractionUtils.detectRotationKnob`
5. Look in `interaction-utils.ts` → find detection logic
6. Back to pointer-event-handler → see it calls `onBoxInteractionStart`
7. Back to canvas-viewpoint → find callback wires to `scheduleRender()`
8. On move: `onPointerMove` → `PointerEventHandler.handlePointerMove` → callback → `handleRotation`
9. Look at `handleRotation` → calls `BoxManipulator.rotateBox`
10. Look in `box-manipulator.ts` → find actual rotation math

**10 steps across 5 files!**

### Proposed

1. Look in `features/box-interaction/box-interaction.controller.ts`
2. See `handlePointerDown` → detection
3. See `startRotation` → initialization
4. See `updateRotation` → math
5. See `commitInteraction` → history

**1 file, all logic together!**

---

## Decision Points

### Should we do this?

**Pros:**

- Much easier to understand and maintain
- Better testability
- Easier onboarding for new developers
- Scales better for new features

**Cons:**

- Significant refactor (4 weeks estimate)
- Risk of introducing bugs
- Need comprehensive testing

### Alternative: Incremental Improvements

If full refactor is too risky:

1. Merge StateManager + CursorManager
2. Reduce callback parameters (pass state object instead)
3. Add comments showing feature boundaries
4. Document current architecture clearly

**This gets 50% of benefits with 10% of risk.**
