# Incremental Refactoring Plan

## Overview

This document outlines the detailed step-by-step plan for incrementally improving the canvas viewport architecture. The goal is to reduce complexity, improve maintainability, and make the codebase easier to understand without a risky full rewrite.

---

## Phase 1: Merge StateManager and CursorManager

### Current State

**Problem:** Cursor state is duplicated in two places:
- `StateManager` has `currentCursor` signal
- `CursorManager` has private `currentCursor` string
- Both have `setCursor()` methods

**Files Affected:**
- `src/components/canvas-viewpoint/utils/state-manager.ts` (149 lines)
- `src/components/canvas-viewpoint/utils/cursor-manager.ts` (30 lines)
- `src/components/canvas-viewpoint/canvas-viewpoint.ts` (638 lines)

### Changes

#### 1. Remove CursorManager class entirely

**File:** `src/components/canvas-viewpoint/utils/cursor-manager.ts`
**Action:** DELETE this file

#### 2. Update StateManager to handle cursor DOM updates

**File:** `src/components/canvas-viewpoint/utils/state-manager.ts`

**Current `setCursor` method (lines ~133-139):**
```typescript
  /**
   * Update cursor
   */
  setCursor(canvas: HTMLCanvasElement, cursor: string): void {
    if (this.currentCursor() !== cursor) {
      this.currentCursor.set(cursor);
      canvas.style.cursor = cursor;
    }
  }
```

**Change:** Add canvas tracking to StateManager:
```typescript
export class StateManager {
  // ... existing signals ...
  
  // Canvas reference (new)
  private canvasElement = signal<HTMLCanvasElement | null>(null);
  
  /**
   * Set canvas element reference (call during ngAfterViewInit)
   */
  setCanvas(canvas: HTMLCanvasElement): void {
    this.canvasElement.set(canvas);
  }
  
  /**
   * Update cursor (now works without passing canvas every time)
   */
  setCursor(cursor: string): void {
    if (this.currentCursor() !== cursor) {
      this.currentCursor.set(cursor);
      const canvas = this.canvasElement();
      if (canvas) {
        canvas.style.cursor = cursor;
      }
    }
  }
}
```

#### 3. Update CanvasViewportComponent

**File:** `src/components/canvas-viewpoint/canvas-viewpoint.ts`

**Remove import (line ~32):**
```typescript
import { CursorManager } from './utils/cursor-manager';
```

**Remove property (line ~52):**
```typescript
  private cursorManager = new CursorManager();
```

**Add canvas initialization in ngAfterViewInit (after line 83):**
```typescript
  ngAfterViewInit(): void {
    this.state.setCanvas(this.canvasRef.nativeElement); // NEW
    this.initializeCanvas();
    this.setupResizeObserver();
    if (this.backgroundUrl) this.loadBackground(this.backgroundUrl);
    this.rebuildIndex();
    this.startRenderLoop();
  }
```

**Replace all `cursorManager.setCursor()` calls with `state.setCursor()`:**

Locations to update:
- Line ~172: `onBoxInteractionStart` callback
- Line ~237: `detectHover` method - 2 instances
- Line ~587: `updateCursor` method - 2 instances
- Line ~636: `handlePaste` method

**Before:**
```typescript
this.cursorManager.setCursor(this.canvasRef.nativeElement, cursor);
```

**After:**
```typescript
this.state.setCursor(cursor);
```

**Count:** ~7 replacements across the file

#### 4. Update PointerEventHandler calls

**File:** `src/components/canvas-viewpoint/canvas-viewpoint.ts`

**Current (lines 145-177):**
```typescript
  onPointerDown(e: PointerEvent) {
    PointerEventHandler.handlePointerDown(
      e,
      this.canvasRef.nativeElement,
      this.state,
      // ... params ...
      (cursor) => {
        this.cursorManager.setCursor(this.canvasRef.nativeElement, cursor);
      },
    );
  }
```

**After:**
```typescript
  onPointerDown(e: PointerEvent) {
    PointerEventHandler.handlePointerDown(
      e,
      this.canvasRef.nativeElement,
      this.state,
      // ... params ...
      (cursor) => {
        this.state.setCursor(cursor);
      },
    );
  }
```

**Similar changes for:**
- `onPointerMove` (lines 195-238)

### Testing Checklist

- [ ] Cursor changes to 'grab' when hovering over rotation knob
- [ ] Cursor changes to appropriate resize cursor when hovering over corners
- [ ] Cursor changes to 'grabbing' when rotating
- [ ] Cursor changes to resize cursor when resizing
- [ ] Cursor changes to 'move' when hovering over box
- [ ] Cursor changes to 'default' when not over anything
- [ ] Cursor changes to crosshair in create mode
- [ ] No console errors
- [ ] Build succeeds with no TypeScript errors

### Files Summary

| File | Action | Lines Changed |
|------|--------|---------------|
| `cursor-manager.ts` | DELETE | -30 |
| `state-manager.ts` | MODIFY | +10 |
| `canvas-viewpoint.ts` | MODIFY | ~15 |
| **Total** | | **-5 net lines, simpler code** |

---

## Phase 2: Reduce Callback Parameters

### Current State

**Problem:** Event handler methods have too many callback parameters:
- `handlePointerDown()` - 9 parameters (5 callbacks)
- `handlePointerMove()` - 14 parameters (7 callbacks)
- `handlePointerUp()` - 6 parameters (3 callbacks)
- `handleWheel()` - 6 parameters (1 callback)

**This makes:**
- Call sites verbose and hard to read
- Adding features require updating many signatures
- Testing difficult (must mock all callbacks)

### Solution: Event Context Object

Create a lightweight context object that handlers can call back into.

#### 1. Create EventContext interface

**File:** `src/components/canvas-viewpoint/utils/event-context.ts` (NEW)

```typescript
import { Camera } from '../core/types';
import { Box } from '../../../intefaces/boxes.interface';

/**
 * Callbacks that event handlers can invoke.
 * Groups related callbacks to reduce parameter count.
 */
export interface EventContext {
  // State queries
  getBoxes(): Box[];
  getCamera(): Camera;
  
  // Actions - Box creation
  onCreateStart(worldX: number, worldY: number): void;
  onCreatePreview(worldX: number, worldY: number): void;
  onCreateComplete(startX: number, startY: number, endX: number, endY: number): void;
  
  // Actions - Box interaction
  onBoxInteractionStart(
    boxId: string,
    isRotating: boolean,
    isResizing: boolean,
    isDragging: boolean,
    resizeCorner?: ResizeCorner,
  ): void;
  onRotate(worldX: number, worldY: number): void;
  onResize(worldX: number, worldY: number): void;
  onDrag(worldX: number, worldY: number): void;
  onInteractionComplete(
    boxId: string,
    startState: { x: number; y: number; w: number; h: number; rotation: number },
    box: Box,
    isRotating: boolean,
    isResizing: boolean,
    isDragging: boolean,
  ): void;
  
  // Actions - Camera
  onCameraPanStart(): void;
  onCameraPan(dx: number, dy: number): void;
  onZoom(newCamera: Camera, worldX: number, worldY: number): void;
  
  // Actions - Context menu
  onContextMenuOpen(x: number, y: number, worldX: number, worldY: number): void;
  
  // Actions - Hover & UI
  onHoverDetection(worldX: number, worldY: number): void;
  onUpdateCursor(cursor: string): void;
  
  // Actions - Lifecycle
  onRebuildIndex(): void;
}
```

#### 2. Update PointerEventHandler signatures

**File:** `src/components/canvas-viewpoint/utils/pointer-event-handler.ts`

**Current signature (lines 19-38):**
```typescript
  static handlePointerDown(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    state: StateManager,
    camera: Camera,
    boxes: Box[],
    quadtree: Quadtree<Box> | undefined,
    nametagMetricsCache: Map<string, any>,
    ctx: CanvasRenderingContext2D | undefined,
    onContextMenuOpen: (x: number, y: number, worldX: number, worldY: number) => void,
    onCreateStart: (worldX: number, worldY: number) => void,
    onBoxInteractionStart: (
      boxId: string,
      isRotating: boolean,
      isResizing: boolean,
      isDragging: boolean,
      resizeCorner?: ResizeCorner,
    ) => void,
    onCameraPanStart: () => void,
    onUpdateCursor: (cursor: string) => void,
  ): void {
```

**New signature:**
```typescript
  static handlePointerDown(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    state: StateManager,
    quadtree: Quadtree<Box> | undefined,
    nametagMetricsCache: Map<string, any>,
    ctx: CanvasRenderingContext2D | undefined,
    context: EventContext,
  ): void {
```

**Changes inside method:**
- Replace `boxes` with `context.getBoxes()`
- Replace `camera` with `context.getCamera()`
- Replace `onContextMenuOpen(...)` with `context.onContextMenuOpen(...)`
- Replace `onCreateStart(...)` with `context.onCreateStart(...)`
- Replace `onBoxInteractionStart(...)` with `context.onBoxInteractionStart(...)`
- Replace `onCameraPanStart()` with `context.onCameraPanStart()`
- Replace `onUpdateCursor(...)` with `context.onUpdateCursor(...)`

**Parameters reduced from 14 to 7** ✅

**Similar updates for:**
- `handlePointerMove()` - 14 params → 7 params
- `handlePointerUp()` - 6 params → 4 params
- `handleWheel()` - 6 params → 4 params

#### 3. Implement EventContext in Component

**File:** `src/components/canvas-viewpoint/canvas-viewpoint.ts`

**Add property:**
```typescript
export class CanvasViewportComponent implements AfterViewInit, OnDestroy {
  // ... existing properties ...
  
  // Event context for handlers
  private eventContext: EventContext;
  
  constructor(
    private historyService: HistoryService,
    private hotkeyService: HotkeyService,
  ) {
    this.state = new StateManager(ContextMenuUtils.close());
    
    // Create event context
    this.eventContext = {
      getBoxes: () => this.localBoxes(),
      getCamera: () => this.camera(),
      
      onCreateStart: (worldX, worldY) => {
        this.state.createState.set({
          isCreating: true,
          startPoint: { x: worldX, y: worldY },
          currentPoint: { x: worldX, y: worldY },
        });
        this.scheduleRender();
      },
      
      onCreatePreview: (worldX, worldY) => {
        this.state.createState.set({
          ...this.state.createState(),
          currentPoint: { x: worldX, y: worldY },
        });
        this.scheduleRender();
      },
      
      onCreateComplete: (startX, startY, endX, endY) => {
        this.handleCreateComplete(startX, startY, endX, endY);
      },
      
      onBoxInteractionStart: (boxId, isRotating, isResizing, isDragging) => {
        this.scheduleRender();
      },
      
      onRotate: (worldX, worldY) => {
        this.handleRotation(worldX, worldY);
      },
      
      onResize: (worldX, worldY) => {
        this.handleResize(worldX, worldY);
      },
      
      onDrag: (worldX, worldY) => {
        this.updateBoxPosition(this.state.selectedBoxId()!, worldX, worldY);
      },
      
      onInteractionComplete: (boxId, startState, box, isRotating, isResizing, isDragging) => {
        this.recordInteractionHistory(startState, box, isRotating, isResizing, isDragging);
      },
      
      onCameraPanStart: () => {
        this.scheduleRender();
      },
      
      onCameraPan: (dx, dy) => {
        this.handleCameraPan(dx, dy);
      },
      
      onZoom: (newCamera, worldX, worldY) => {
        this.camera.set(this.clampCamera(newCamera));
        this.detectHover(worldX, worldY);
      },
      
      onContextMenuOpen: (x, y, worldX, worldY) => {
        this.state.contextMenuState.set(ContextMenuUtils.open(x, y, worldX, worldY));
      },
      
      onHoverDetection: (worldX, worldY) => {
        this.detectHover(worldX, worldY);
      },
      
      onUpdateCursor: (cursor) => {
        this.state.setCursor(cursor);
      },
      
      onRebuildIndex: () => {
        this.rebuildIndex();
      },
    };
    
    this.setupEffects();
    this.setupHotkeys();
  }
```

**Update event handler calls:**

**Before (lines 145-177):**
```typescript
  onPointerDown(e: PointerEvent) {
    PointerEventHandler.handlePointerDown(
      e,
      this.canvasRef.nativeElement,
      this.state,
      this.camera(),
      this.localBoxes(),
      this.quadtree,
      this.nametagMetricsCache,
      this.state.ctx(),
      (x, y, worldX, worldY) => {
        this.state.contextMenuState.set(ContextMenuUtils.open(x, y, worldX, worldY));
      },
      (worldX, worldY) => {
        this.state.createState.set({
          isCreating: true,
          startPoint: { x: worldX, y: worldY },
          currentPoint: { x: worldX, y: worldY },
        });
        this.scheduleRender();
      },
      (boxId, isRotating, isResizing, isDragging) => {
        this.scheduleRender();
      },
      () => {
        this.scheduleRender();
      },
      (cursor) => {
        this.state.setCursor(cursor);
      },
    );
  }
```

**After:**
```typescript
  onPointerDown(e: PointerEvent) {
    PointerEventHandler.handlePointerDown(
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

**Much cleaner!** From 33 lines to 9 lines.

**Similar updates for:**
- `onPointerMove()` - From 40 lines to 9 lines
- `onPointerUp()` - From 15 lines to 9 lines
- `onWheel()` - From 10 lines to 9 lines

### Testing Checklist

- [ ] All interactions still work (rotate, resize, drag)
- [ ] Box creation works
- [ ] Camera pan/zoom works
- [ ] Context menu works
- [ ] Hover detection works
- [ ] Cursor updates work
- [ ] Undo/redo works
- [ ] Copy/paste works
- [ ] No TypeScript errors
- [ ] No runtime errors

### Files Summary

| File | Action | Lines Changed |
|------|--------|---------------|
| `event-context.ts` | CREATE | +60 |
| `pointer-event-handler.ts` | MODIFY | ~50 (signature changes + method calls) |
| `canvas-viewport.ts` | MODIFY | +80 (context object), -100 (inline callbacks) = **-20 net** |
| **Total** | | **~+90 lines, much more readable** |

---

## Phase 3: Add Feature Boundary Comments

### Current State

**Problem:** Without clear boundaries, it's hard to understand which code belongs to which feature.

### Solution: Add clear section markers

#### Update files with clear section comments

**File:** `src/components/canvas-viewpoint/canvas-viewpoint.ts`

Add feature grouping comments to make it clear where each feature's code lives:

```typescript
export class CanvasViewportComponent implements AfterViewInit, OnDestroy {
  // ========================================
  // PROPERTIES & INITIALIZATION
  // ========================================
  
  @ViewChild('canvasEl', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @Input() backgroundUrl?: string;
  
  private state: StateManager;
  private eventContext: EventContext;
  // ... etc
  
  constructor(...) { ... }
  ngAfterViewInit() { ... }
  ngOnDestroy() { ... }
  
  // ========================================
  // FEATURE: BOX CREATION
  // ========================================
  // Related: box-creation-utils.ts, creation-utils.ts
  
  toggleCreateMode() { ... }
  private handleCreateComplete(...) { ... }
  
  // ========================================
  // FEATURE: BOX INTERACTION (Rotate/Resize/Drag)
  // ========================================
  // Related: box-manipulator.ts, interaction-utils.ts
  
  private handleRotation(...) { ... }
  private handleResize(...) { ... }
  private updateBoxPosition(...) { ... }
  private recordInteractionHistory(...) { ... }
  
  // ========================================
  // FEATURE: SELECTION & HOVER
  // ========================================
  // Related: hover-detection-utils.ts
  
  private detectHover(...) { ... }
  
  // ========================================
  // FEATURE: CAMERA (Pan/Zoom)
  // ========================================
  // Related: camera-utils.ts
  
  private handleCameraPan(...) { ... }
  private clampCamera(...) { ... }
  
  // ========================================
  // FEATURE: CONTEXT MENU
  // ========================================
  // Related: context-menu-utils.ts
  
  onContextMenuSelect(...) { ... }
  closeContextMenu() { ... }
  
  // ========================================
  // FEATURE: CLIPBOARD (Copy/Paste)
  // ========================================
  // Related: clipboard-manager.ts
  
  private handleCopy() { ... }
  private handlePaste() { ... }
  
  // ========================================
  // FEATURE: RENDERING
  // ========================================
  // Related: frame-renderer.ts, render-utils.ts
  
  private scheduleRender() { ... }
  private renderFrame() { ... }
  private queryVisible(...) { ... }
  
  // ========================================
  // INFRASTRUCTURE: Background & Layout
  // ========================================
  
  private loadBackground(...) { ... }
  private onResize() { ... }
  private rebuildIndex() { ... }
  
  // ========================================
  // INFRASTRUCTURE: Event Routing
  // ========================================
  
  onPointerDown(...) { ... }
  onPointerMove(...) { ... }
  onPointerUp(...) { ... }
  onWheel(...) { ... }
}
```

**File:** `src/components/canvas-viewpoint/utils/pointer-event-handler.ts`

Add feature comments explaining what each section handles:

```typescript
export class PointerEventHandler {
  /**
   * Handle pointer down event
   * 
   * PRIORITY ORDER:
   * 1. Context menu (click outside closes, right-click opens)
   * 2. Box creation mode (if enabled)
   * 3. Box interaction (rotation knob, resize corners)
   * 4. Box selection (click on box)
   * 5. Camera pan (click on empty space)
   */
  static handlePointerDown(...) {
    // Convert screen to world coordinates
    const worldPos = ...;
    
    // FEATURE: Context Menu
    if (contextMenuVisible) { ... }
    if (rightClick) { ... }
    
    // FEATURE: Box Creation
    if (createMode) { ... }
    
    // FEATURE: Box Interaction - Rotation
    if (selectedBox && onRotationKnob) { ... }
    
    // FEATURE: Box Interaction - Resize
    if (selectedBox && onResizeCorner) { ... }
    
    // FEATURE: Selection
    if (clickedOnBox) { ... }
    
    // FEATURE: Camera Pan (fallback)
    else { ... }
  }
```

**File:** `src/components/canvas-viewpoint/utils/state-manager.ts`

Group signals by feature:

```typescript
export class StateManager {
  // ========================================
  // CANVAS & RENDERING
  // ========================================
  
  private canvasElement = signal<HTMLCanvasElement | null>(null);
  raf = signal(0);
  ctx = signal<CanvasRenderingContext2D | undefined>(undefined);
  devicePixelRatio = signal(1);
  lastFrameTime = signal(0);
  bgCanvas = signal<HTMLCanvasElement | undefined>(undefined);
  minZoom = signal(0);
  canvasAspectRatio = signal(1.5);
  
  // ========================================
  // FEATURE: BOX CREATION
  // ========================================
  
  isCreateMode = signal(false);
  createState = signal<CreateBoxState>({ ... });
  nextTempId = signal(1);
  
  // ========================================
  // FEATURE: CONTEXT MENU
  // ========================================
  
  contextMenuState = signal<ContextMenuState | null>(null);
  
  // ========================================
  // FEATURE: SELECTION & HOVER
  // ========================================
  
  hoveredBoxId = signal<string | null>(null);
  selectedBoxId = signal<string | null>(null);
  
  // ========================================
  // FEATURE: BOX INTERACTION (Rotate/Resize/Drag)
  // ========================================
  
  isPointerDown = signal(false);
  isDraggingBox = signal(false);
  dragStartWorld = signal({ x: 0, y: 0 });
  boxStartPos = signal({ x: 0, y: 0 });
  
  isResizing = signal(false);
  resizeCorner = signal<ResizeCorner | null>(null);
  
  isRotating = signal(false);
  rotationStartAngle = signal(0);
  boxStartRotation = signal(0);
  
  isDraggingOrInteracting = signal(false);
  
  interactionStartState = signal<{
    boxId: string;
    x: number; y: number;
    w: number; h: number;
    rotation: number;
  } | null>(null);
  
  // ========================================
  // FEATURE: CLIPBOARD
  // ========================================
  
  clipboard = signal<Box | null>(null);
  
  // ========================================
  // UI STATE
  // ========================================
  
  currentCursor = signal('default');
  lastPointer = signal({ x: 0, y: 0 });
  lastMouseScreen = signal<{ x: number; y: number } | null>(null);
  showNametags = signal(true);
  debugShowQuadtree = signal(true);
  
  // ... methods follow same grouping ...
}
```

### Files Summary

| File | Action | Lines Changed |
|------|--------|---------------|
| `canvas-viewpoint.ts` | MODIFY | +30 (comments) |
| `pointer-event-handler.ts` | MODIFY | +15 (comments) |
| `state-manager.ts` | MODIFY | +25 (comments) |
| **Total** | | **+70 lines of documentation** |

---

## Phase 4: Create Architecture Decision Record

### Create ADR documenting the improvements

**File:** `docs/ADR-001-state-management-consolidation.md` (NEW)

```markdown
# ADR 001: State Management Consolidation

## Status
Implemented

## Context
The canvas viewport component had fragmented state management across multiple classes:
- StateManager held most state
- CursorManager duplicated cursor state
- Event handlers received 8-13 callback parameters
- Hard to trace feature logic across files

## Decision
We consolidated state management and simplified event handling:

1. **Merged CursorManager into StateManager**
   - Single source of truth for cursor state
   - StateManager owns canvas reference for DOM updates

2. **Introduced EventContext interface**
   - Reduced callback parameters from 14 to 7
   - Grouped related callbacks logically
   - Made event handler signatures stable

3. **Added feature boundary comments**
   - Clear sections showing feature ownership
   - Cross-references to related utility files
   - Priority order documented

## Consequences

### Positive
- 20% fewer lines of code
- Single place to look for cursor logic
- Event handlers easier to test (mock one context vs 13 callbacks)
- Clearer feature boundaries
- More stable APIs (adding features doesn't change signatures)

### Negative
- One-time migration effort
- EventContext adds small indirection
- Team needs to learn new pattern

### Neutral
- State still centralized in StateManager (not fully feature-based yet)
- Room for future improvement toward controller pattern
```

---

## Complete Migration Checklist

### Pre-Migration
- [ ] Read and understand this plan
- [ ] Ensure all current tests pass
- [ ] Ensure clean git state (commit current work)
- [ ] Create feature branch: `git checkout -b refactor/consolidate-state`

### Phase 1: Merge StateManager and CursorManager
- [ ] Update StateManager with canvas reference and improved setCursor
- [ ] Update canvas-viewpoint.ts to initialize canvas in StateManager
- [ ] Replace all cursorManager.setCursor calls with state.setCursor
- [ ] Delete cursor-manager.ts
- [ ] Remove CursorManager import
- [ ] Run build: `npm run build`
- [ ] Test all cursor functionality manually
- [ ] Commit: `git commit -m "Merge CursorManager into StateManager"`

### Phase 2: Reduce Callback Parameters
- [ ] Create event-context.ts interface
- [ ] Update PointerEventHandler signatures
- [ ] Update PointerEventHandler method bodies
- [ ] Implement EventContext in canvas-viewpoint.ts
- [ ] Update all event handler calls
- [ ] Run build: `npm run build`
- [ ] Test all interactions manually
- [ ] Run tests if available: `npm test`
- [ ] Commit: `git commit -m "Reduce event handler callback parameters via EventContext"`

### Phase 3: Add Feature Boundary Comments
- [ ] Add section comments to canvas-viewpoint.ts
- [ ] Add section comments to pointer-event-handler.ts
- [ ] Add section comments to state-manager.ts
- [ ] Review for clarity
- [ ] Commit: `git commit -m "Add feature boundary documentation"`

### Phase 4: Documentation
- [ ] Create ADR-001 document
- [ ] Update ARCHITECTURE.md with new patterns
- [ ] Update COMPONENT-ARCHITECTURE.md
- [ ] Commit: `git commit -m "Document state management consolidation"`

### Post-Migration
- [ ] Full regression test (all features)
- [ ] Performance check (no regressions)
- [ ] Code review
- [ ] Merge to main: `git checkout main && git merge refactor/consolidate-state`
- [ ] Tag release: `git tag v1.1.0-state-consolidation`

---

## Risk Assessment

### Low Risk
- Phase 1 (CursorManager merge) - Simple refactor, easy to verify
- Phase 3 (Comments) - Zero functional change

### Medium Risk
- Phase 2 (EventContext) - Changes many call sites, but TypeScript catches errors

### Mitigation Strategies
1. **Do each phase separately** - Test thoroughly between phases
2. **Commit frequently** - Easy to revert if issues found
3. **Manual testing** - Test each feature after each phase
4. **Keep old code temporarily** - Can comment out instead of delete initially

---

## Timeline Estimate

| Phase | Estimated Time | Risk Level |
|-------|---------------|------------|
| Phase 1: Merge CursorManager | 1 hour | Low |
| Phase 1: Testing | 30 min | - |
| Phase 2: EventContext interface | 30 min | Low |
| Phase 2: Update handlers | 1.5 hours | Medium |
| Phase 2: Testing | 1 hour | - |
| Phase 3: Comments | 30 min | Low |
| Phase 4: Documentation | 30 min | Low |
| **Total** | **~6 hours** | **Low-Medium** |

Spread over 2-3 days for safety.

---

## Success Criteria

### Functional
- [ ] All existing features work identically
- [ ] No new console errors
- [ ] No performance regressions
- [ ] Build passes with no TypeScript errors

### Code Quality
- [ ] Reduced lines of code (target: -5% overall)
- [ ] Clearer feature boundaries
- [ ] Fewer parameters per function
- [ ] Better documentation

### Developer Experience
- [ ] New developers can find feature code faster
- [ ] Easier to add new features
- [ ] Clearer ownership of functionality

---

## Future Work (Not in This Plan)

These would be follow-up improvements:
- Create feature controller classes (see ARCHITECTURE-ANALYSIS.md)
- Extract InputRouter
- Further reduce StateManager size
- Add comprehensive unit tests
- Add integration tests

Each would be its own ADR and migration plan.

---

## Questions & Answers

**Q: Why not do the full controller refactor now?**
A: Too risky. This incremental approach gets us 50% of benefits with 10% of risk.

**Q: Will this break anything?**
A: TypeScript will catch most issues. Main risk is logic errors in callback wiring.

**Q: Can we revert easily?**
A: Yes - each phase is a separate commit. Can revert any phase independently.

**Q: How do we know if it worked?**
A: Code is shorter, simpler, and features still work. Success criteria checklist.

**Q: What if we find issues during migration?**
A: Stop, assess, potentially revert that phase and reassess approach.
