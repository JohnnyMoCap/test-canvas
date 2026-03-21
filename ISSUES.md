# Canvas Viewport — Numbered Issues & Fix Prompts

Each item is self-contained. Pass it directly to Claude with the relevant file(s) open or attached.

---

## CRITICAL / BUG

---

### 3. `externalSelectBoxId` input setter silently ignores `null`, cannot clear selection from parent

**File:** `src/components/canvas-viewpoint/canvas-viewpoint.ts` — `set externalSelectBoxId`

**Problem:** The setter starts with `if (value !== null && ...)`, which means a parent setting this input to `null` to deselect a box has no effect. The selection can only be cleared internally.

**Prompt:**

> In `canvas-viewpoint.ts`, fix the `set externalSelectBoxId(value)` setter. Currently the guard `if (value !== null && ...)` prevents null from being processed. Change the logic so that when `value` is `null`, it clears the selection: call `this.state.updateSelectedBox(null)` and `this.scheduleRender()`. Keep the existing zoom-to-box behavior only when `value` is non-null.

---

### 4. `loadPlaceholder` and `loadBackground` errors are silently swallowed

**File:** `src/components/canvas-viewpoint/canvas-viewpoint.ts` — `loadPlaceholder`, `loadBackground`
**File:** `src/components/canvas-viewpoint/utils/background-utils.ts` — `loadPlaceholder`, `loadBackground`

**Problem:** Both methods are `async` and call `BackgroundUtils` methods that can reject (on 404 or network failure). The callers in the component have no `.catch()` and no `try/catch`. A failed image load leaves the component in a broken blank state with no feedback.

**Prompt:**

> In `canvas-viewpoint.ts`, wrap the calls to `await this.loadPlaceholder()` and `await BackgroundUtils.loadBackground(...)` in try/catch blocks. On error, log a warning with `console.warn('Failed to load background:', err)` and ensure the component remains usable (e.g., keep the previous background or show an error state signal). Also check `background-utils.ts` — both `loadPlaceholder` and `loadBackground` reject via `image.onerror` but the rejection payload is the raw event which is not very useful; change `image.onerror = (err) => reject(err)` to `image.onerror = () => reject(new Error(\`Failed to load image: \${image.src}\`))`.

---

## ARCHITECTURE

---

### 11. Duplicate `queryVisible` logic — component and `QuadtreeUtils` both implement it

**File:** `src/components/canvas-viewpoint/canvas-viewpoint.ts` — `queryVisible` (private method)
**File:** `src/components/canvas-viewpoint/utils/quadtree-utils.ts` — `QuadtreeUtils.queryVisible`

**Problem:** The component has a private `queryVisible()` method that reimplements stale-quadtree fallback logic. `QuadtreeUtils.queryVisible()` does the same thing more completely (includes nametag bounds, AABB intersection). One of them is dead code. The component version also handles the "include selected box during drag" edge case that `QuadtreeUtils` doesn't.

**Prompt:**

> In `canvas-viewpoint.ts`, delete the private `queryVisible()` method entirely. In `renderFrame()`, replace the call to `this.queryVisible(viewBounds)` with a call to `QuadtreeUtils.queryVisible(...)`, passing `this.localBoxes()`, `this.quadtree`, `viewBounds`, `this.state.isDraggingOrInteracting()`, `bgc.width`, `bgc.height`, `this.state.showNametags()`. Add the missing "include selected box during drag" logic to `QuadtreeUtils.queryVisible` as an optional `selectedBoxId` parameter: if `isDraggingOrInteracting` is true and `selectedBoxId` is provided, ensure that box is always included in the results.

---

### 12. `camera` and `localBoxes` signals live on the component, not in `StateManager` — split ownership

**File:** `src/components/canvas-viewpoint/canvas-viewpoint.ts`
**File:** `src/components/canvas-viewpoint/utils/state-manager.ts`

**Problem:** Every handler receives `camera` and `boxes` as arguments and returns new values via callbacks because they are not in `StateManager`. Half the state is centralized, half isn't. This is why `handlePointerUp` needs both a `(boxes) => void` callback and a `() => void` rebuild callback as extra parameters.

**Prompt:**

> Move `camera` and `localBoxes` signals from `CanvasViewportComponent` into `StateManager`. Add them following the same pattern as the existing signals (private writable + readonly accessor + update method). Remove the corresponding callback parameters from `PointerEventHandler.handlePointerUp` and `PointerEventHandler.handlePointerMove` — handlers should call `state.updateCamera(...)` and `state.updateLocalBoxes(...)` directly. Update `canvas-viewpoint.ts` to read camera and boxes from `this.state` instead of local signals. The `zoomChange` output emit still happens in the component, watching the state signal via an effect.

---

### 13. Static handler classes with 13+ parameter signatures — extract a context object

**File:** `src/components/canvas-viewpoint/handlers/pointer-event-handler.ts`
**File:** `src/components/canvas-viewpoint/canvas-viewpoint.ts` — all `PointerEventHandler.handleXxx` call sites

**Problem:** Every `PointerEventHandler` call passes `canvas`, `canvasWidth`, `canvasHeight`, `imageWidth`, `imageHeight`, `camera`, `boxes`, `state`, `quadtree`, `nametagMetricsCache`, `ctx`, `historyService`. This signature is repeated 3 times in the component and is effectively un-reviewable.

**Prompt:**

> Create a new interface `PointerHandlerContext` in `pointer-event-handler.ts` (or a new file `handler-context.ts`):
>
> ```typescript
> export interface PointerHandlerContext {
>   canvas: HTMLCanvasElement;
>   camera: Camera;
>   boxes: Box[];
>   state: StateManager;
>   quadtree: Quadtree<Box> | undefined;
>   nametagMetricsCache: Map<string, TextMetrics>;
>   ctx: CanvasRenderingContext2D | undefined;
>   historyService: HistoryService;
> }
> ```
>
> Update `handlePointerDown`, `handlePointerMove`, `handlePointerUp`, and `handleWheel` to accept `(event: PointerEvent | WheelEvent, ctx: PointerHandlerContext)` instead of the current flat argument list. Update the three call sites in `canvas-viewpoint.ts` to build and pass a context object. `canvasWidth/Height` and `imageWidth/Height` can be derived from `context.canvas` and `context.state.bgCanvas()` inside the handlers.

---

### 14. `StateManager` is a bag of signal triads with no logic — simplify the boilerplate

**File:** `src/components/canvas-viewpoint/utils/state-manager.ts`

**Problem:** Every single piece of state follows the identical pattern:

```typescript
private _x = signal(defaultValue);
readonly x = this._x.asReadonly();
updateX(v: T): void { this._x.set(v); }
```

There are ~30 of these. The `asReadonly()` wrapper provides no real encapsulation because every caller already has a `StateManager` reference. The `update*` methods add no validation or side effects. This is ~150 lines of pure boilerplate.

**Prompt:**

> In `state-manager.ts`, decide on one of two paths:
> **Option A (simplify):** Replace the private/readonly/update triads with plain `public` writable signals for state that has no validation logic. Remove the `update*` methods and access the signal directly. Keep `asReadonly()` only for signals that are computed or should genuinely never be written from outside (e.g. `ctx`, `canvasElement`).
> **Option B (add value):** Keep the encapsulation but add actual validation in the `update*` methods — e.g. `updateMinZoom` should clamp to `> 0`, `updateDevicePixelRatio` should clamp to `>= 1`, `updateBrightness/Contrast` should clamp to valid CSS filter ranges. This makes the triads earn their existence.

---

### 15. `LifecycleManager.startRenderLoop` uses mutable ref objects to work around signals

**File:** `src/components/canvas-viewpoint/utils/lifecycle-manager.ts` — `startRenderLoop`
**File:** `src/components/canvas-viewpoint/canvas-viewpoint.ts` — `startRenderLoop`

**Problem:**

```typescript
static startRenderLoop(
  rafRef: { value: number },
  lastFrameTimeRef: { value: number },
  ...
```

`rafRef` and `lastFrameTimeRef` are plain mutable objects passed in because the `raf` and `lastFrameTime` signals can't be written from inside the RAF callback without an injection context. This is a workaround for a design problem.

**Prompt:**

> Refactor `startRenderLoop` in `lifecycle-manager.ts`. Instead of taking ref objects, have it return the RAF id so the caller can store it. For `lastFrameTime`, keep it as a local `let` variable inside the closure (it doesn't need to be observable outside the loop). New signature:
>
> ```typescript
> static startRenderLoop(
>   dirtySignal: Signal<boolean>,
>   renderCallback: () => void,
> ): number  // returns the initial RAF id
> ```
>
> Inside the loop, use a closure-local `let lastFrameTime = 0`. The returned id is stored by the component. For stopping, `cancelAnimationFrame` on the stored id still works because the loop always replaces the id. Update `canvas-viewpoint.ts` to store the returned id and use it in `ngOnDestroy`.

---

## TYPE SAFETY

---

### 16. `Box` can have neither `id` nor `tempId` — both are optional, should be a discriminated union

**File:** `src/intefaces/boxes.interface.ts`

**Problem:** The interface has `id?: number` and `tempId?: string`. Both are optional, so TypeScript allows `{}` as a valid `Box`. `getBoxId()` uses a non-null assertion as a workaround. Every comparison uses `==` instead of `===` because the return type is `string | number`.

**Prompt:**

> Refactor `boxes.interface.ts` to use a discriminated union:
>
> ```typescript
> interface BoxBase {
>   x: number;
>   y: number;
>   w: number;
>   h: number;
>   rotation?: number;
>   color?: string;
> }
> export type Box =
>   | (BoxBase & { id: number; tempId?: never })
>   | (BoxBase & { tempId: string; id?: never });
> ```
>
> Update `getBoxId` to return `number | string` based on which branch is active. This lets TypeScript enforce that every Box has a valid ID. Update all comparison sites to use `===` instead of `==`. The `historyService` `BoxDelta.boxId` type can stay as `string | number` for record-keeping.

---

### 17. `styleId` field used in test data but absent from `Box` interface

**File:** `src/app/app.ts` — `exampleBoxes`
**File:** `src/intefaces/boxes.interface.ts`

**Problem:**

```typescript
styleId: `style-${1 + (i % 5)}`,
```

`styleId` is set on every example box but doesn't exist on the `Box` interface. TypeScript may not catch this depending on how the array is typed. When `styleId` is eventually used in rendering logic, it will appear to work in tests and fail in production.

**Prompt:**

> Add `styleId?: string` to the `Box` interface in `boxes.interface.ts`. This field is used in the test data in `app.ts` and will likely be needed for production rendering (box categorization/styling). Adding it to the interface now ensures it flows through the type system correctly and is preserved through copy/paste/undo operations.

---

### 18. `BoxType` values are lorem ipsum placeholder strings

**File:** `src/components/canvas-viewpoint/core/creation-state.ts`

**Problem:**

```typescript
export type BoxType = 'you tellin' | 'me a' | 'shrimp fried' | 'this rice' | 'magic';
```

These are clearly placeholder names from an internet meme. Any real integration (API calls, database storage, analytics) will break when these get renamed, because they are used as literal string keys in `BOX_TYPES`, as the context menu display labels, and stored in box state.

**Prompt:**

> In `creation-state.ts`, rename the `BoxType` union values to meaningful semantic names that reflect the actual use case (e.g., `'type-a' | 'type-b' | 'type-c' | 'type-d' | 'magic'` as a placeholder until real names are decided, or use the actual domain names). Update the `BOX_TYPES` record keys, the `label` fields, and all usages in `context-menu.handler.ts`, `box-context-menu.component.ts`, `box-creation.handler.ts`, and `frame-renderer.ts`. The `label` field (human-readable display string) is separate from the type key — the key should be stable and slug-like.

---

### 19. `FrameRenderer.renderFrame` accepts `hoveredBoxId: string | null` but `StateManager` stores it as `string | null` while IDs can be `number`

**File:** `src/components/canvas-viewpoint/utils/frame-renderer.ts` — `renderFrame` signature
**File:** `src/components/canvas-viewpoint/canvas-viewpoint.ts` — `renderFrame` call site

**Problem:** The render function signature takes `hoveredBoxId: string | null` and `selectedBoxId: string | null`, but IDs can be `number` (for saved boxes). The comparison inside is `String(getBoxId(b.raw)) === hoveredBoxId` — manually stringifying on every box every frame to compensate for the type mismatch.

**Prompt:**

> In `frame-renderer.ts`, change the `hoveredBoxId` and `selectedBoxId` parameters from `string | null` to `string | number | null`. Remove the `String(getBoxId(b.raw)) ===` coercions inside the render loop — use `getBoxId(b.raw) === hoveredBoxId` directly. Update the call site in `canvas-viewpoint.ts` to pass `this.state.hoveredBoxId()` and `this.state.selectedBoxId()` without any String() wrapping. This removes per-box string allocation on every frame.

---

## PERFORMANCE

---

### 20. Quadtree rebuilt from scratch on every single-box operation

**File:** `src/components/canvas-viewpoint/canvas-viewpoint.ts` — `rebuildIndex` calls
**File:** `src/components/canvas-viewpoint/utils/lifecycle-manager.ts` — `rebuildIndex`

**Problem:** `rebuildIndex()` is called after every add, paste, delete, and pointer-up. The quadtree is built in O(n log n). For 4000 boxes, rebuilding after pasting one box is expensive. The `Quadtree` class already supports `insert()`.

**Prompt:**

> Add `insertBox(box: Box)` and `removeBox(boxId: string | number)` methods to `QuadtreeUtils`. These should use the existing `quadtree.insert()` for additions, and for removals rebuild only if the quadtree exists but the box to remove was in it (or accept a full rebuild for removes as a first step — even just skipping the rebuild on add is a win). In `canvas-viewpoint.ts`, change `handleCopy` (no rebuild needed), `handlePaste` (insert the new box), and `recordAdd` follow-ups to call `this.quadtree = QuadtreeUtils.insertBox(...)` instead of full `rebuildIndex()`. Keep full rebuilds for initial load, undo/redo, and hide-toggle.

---

### 21. `nametagMetricsCache` is never evicted — grows unboundedly as boxes are deleted

**File:** `src/components/canvas-viewpoint/canvas-viewpoint.ts` — `nametagMetricsCache`
**File:** `src/components/canvas-viewpoint/utils/nametag-utils.ts` — `drawNametag`

**Problem:** The `nametagMetricsCache` (a `Map<string, TextMetrics>`) caches text measurements for box nametags but never removes entries when boxes are deleted. With the 4000-box test dataset and repeated add/delete operations, this map grows indefinitely.

**Prompt:**

> In `canvas-viewpoint.ts`, in the `handleDelete` method and in the undo effect (when boxes are removed), evict the corresponding entry from `nametagMetricsCache`. Add a helper:
>
> ```typescript
> private evictNametagCache(boxId: string | number): void {
>   this.nametagMetricsCache.delete(String(boxId));
> }
> ```
>
> Call it in `handleDelete` after `historyService.recordDelete(selected)`. Also call it inside the boxes-sync effect when detecting that a box present in the cache is no longer in the new boxes array. For the sync effect, you can diff the old IDs vs new IDs: `const removed = oldIds.filter(id => !newIds.has(id))`.

---

### 22. All boxes scanned linearly during every drag/resize/rotate frame

**File:** `src/components/canvas-viewpoint/utils/quadtree-utils.ts` — `queryVisible`

**Problem:** During any interaction (`isDraggingOrInteracting = true`), the quadtree is bypassed entirely and all N boxes are AABB-tested against the viewport every frame. This is intentional to handle stale quadtree entries, but for 4000 boxes at 60fps it's 240k AABB checks/sec.

**Prompt:**

> In `quadtree-utils.ts`, change the interaction fallback in `queryVisible` to only bypass the quadtree for the boxes directly involved in the interaction (the selected box). Keep using the (stale) quadtree for all other boxes. The selected box should always be included regardless. Logic:
>
> ```typescript
> if (!isDraggingOrInteracting && quadtree) {
>   // normal quadtree path
> } else if (quadtree) {
>   // partially stale: query quadtree for background boxes, always include selected
>   results = quadtree.queryRange(...) as Box[];
>   if (selectedBoxId) {
>     const sel = boxes.find(b => getBoxId(b) == selectedBoxId);
>     if (sel && !results.includes(sel)) results.push(sel);
>   }
> } else {
>   results = boxes; // no quadtree at all
> }
> ```
>
> Accept `selectedBoxId: string | number | null` as a new parameter. The quadtree entry for the selected box may be stale, but since we always include it explicitly, the only artifact is that it stays in the quadtree at its old position — which is acceptable.

---

### 23. Subpixel boxes not culled during rendering — thousands of invisible draws per frame

**File:** `src/components/canvas-viewpoint/utils/frame-renderer.ts` — `renderFrame`

**Problem:** The test app generates boxes with `w: Math.random() / 100` — many are effectively subpixel at normal zoom. They still go through the full `drawBox` path (transform + strokeRect + fill). No minimum screen-size cull exists.

**Prompt:**

> In `frame-renderer.ts`, before calling `RenderUtils.drawBox(ctx, b, camera, ...)`, check if the box's screen-space size is worth rendering. Add a minimum size threshold (e.g., 1 pixel):
>
> ```typescript
> const screenW = b.w * camera.zoom;
> const screenH = b.h * camera.zoom;
> if (screenW < 1 && screenH < 1) continue;
> ```
>
> This check happens in world/pixel space so `b.w` and `b.h` are already in pixels (`WorldBox`). Adjust the threshold as needed — 0.5px is probably the right cutoff before a box is visually meaningless.

---

## CODE QUALITY

---

### 24. Typo: directory named `intefaces` instead of `interfaces`

**File:** `src/intefaces/boxes.interface.ts` and all imports referencing it

**Problem:** The directory `src/intefaces/` is missing an `r`. Every import across the codebase imports from `'../../intefaces/boxes.interface'`. This is a cosmetic issue but looks unprofessional and may cause confusion.

**Prompt:**

> Rename the directory `src/intefaces/` to `src/interfaces/`. Then do a project-wide find-and-replace of `'../intefaces/` and `'../../intefaces/` with the corrected path. Files to update include: `canvas-viewpoint.ts`, `box-utils.ts`, `box-state-utils.ts`, `box-manipulator.ts`, `clipboard-manager.ts`, `box-creation-utils.ts`, `boundary-utils.ts`, `quadtree-utils.ts`, `history.service.ts`, `app.ts`, and any others importing from that path. Run the build after to confirm no missed references.

---

### 25. `resetCamera()` in `app.ts` is empty — `resetCameraRequest` output is wired to nothing

**File:** `src/app/app.ts` — `resetCamera()`
**File:** `src/app/app.html` — wherever `resetCameraRequest` is bound

**Problem:**

```typescript
resetCamera() {}
```

The button that triggers camera reset emits `resetCameraRequest` from the component, but the handler in the parent is an empty method. The feature is completely non-functional.

**Prompt:**

> In `app.ts`, implement `resetCamera()` to call a method on the canvas viewport component. Add a `@ViewChild` reference to `CanvasViewportComponent` in `app.ts`: `@ViewChild(CanvasViewportComponent) canvasViewport?: CanvasViewportComponent`. Then implement: `resetCamera() { this.canvasViewport?.resetCamera(); }`. The `resetCamera()` method already exists and is implemented in `canvas-viewpoint.ts`.

---

### 26. Commented-out code left in production files

**Files:** `src/intefaces/boxes.interface.ts`, `src/services/history.service.ts`, `src/components/canvas-viewpoint/canvas-viewpoint.ts`, `src/components/canvas-viewpoint/utils/clipboard-manager.ts`

**Problem:** Multiple files contain blocks of commented-out alternative implementations and debug notes. Examples: the alternative `getBoxId` implementation, the `externalSelectBoxId` type comment, the `//TODO: not working, fix.` in clipboard-manager.

**Prompt:**

> Do a cleanup pass across these files:
>
> - `boxes.interface.ts`: Remove the three commented-out lines in `getBoxId()` (the alternative implementation).
> - `history.service.ts`: The `clearStorage()`/`loadFromStorage()` pair will be handled in issue #5. Remove the `// yo mama filter` joke comment from `visibleBoxes`.
> - `canvas-viewpoint.ts`: Remove the commented-out type annotation on `externalSelectBoxId` (`//{ boxId: string | number; timestamp: number } | undefined`). Consolidate the TODO list at the bottom into a proper tracking system (GitHub issues, etc.) or keep only the most critical unresolved ones.
> - `clipboard-manager.ts`: The `// TODO: not working, fix.` comment refers to the no-mouse-position fallback — this will remain until fixed (see issue #27), so leave it but make it actionable.

---

### 27. Paste with no tracked mouse position uses a hardcoded 5% offset regardless of viewport

**File:** `src/components/canvas-viewpoint/utils/clipboard-manager.ts` — `createPastedBox`

**Problem:** When the mouse isn't over the canvas at paste time, the box is placed at `clipboard.x + 0.05 / clipboard.y + 0.05`. The 5% offset is in normalized coordinates and may place the box outside the image bounds at the edges, or be invisible at high zoom if the current viewport doesn't include that area.

**Prompt:**

> In `clipboard-manager.ts`, improve the fallback paste position. Instead of a fixed 5% offset, paste the box at the center of the current viewport. The method already receives `camera` and `canvas` — use `CoordinateTransform.screenToWorld(canvas.width / 2, canvas.height / 2, canvas.width, canvas.height, camera)` to get the world center, then convert to normalized coordinates with `BoxUtils.worldToNormalized(...)`. Apply this as the paste position for both the no-mouse and out-of-canvas cases.

---

### 28. `Camera` type includes `rotation` field but camera rotation has no UI and is untested

**File:** `src/components/canvas-viewpoint/core/types.ts` — `Camera`
**File:** `src/components/canvas-viewpoint/utils/camera-utils.ts`
**File:** `src/components/canvas-viewpoint/utils/render-utils.ts` — `applyCameraTransform`

**Problem:** `Camera.rotation` is stored and applied in `applyCameraTransform`, but there is no UI to change it, no handler that modifies it, and it defaults to `0` everywhere. This is dead complexity — the rotation math is threaded through coordinate transforms and pan clamping but never exercised. It either needs an implementation or needs to be removed to reduce surface area.

**Prompt:**

> Make a decision on camera rotation: if it is not planned for the near term, remove `rotation` from the `Camera` interface and all related code. Specifically: remove the `rotation` parameter from `RenderUtils.applyCameraTransform`, `CameraHandler.pan` (the rotation compensation in the pan vector), `CameraHandler.calculateMinZoom`, and `CoordinateTransform.screenToWorld` and `screenDeltaToWorld`. Replace `camera.rotation` references with `0`. This simplifies the transform math significantly. If camera rotation IS planned, create a GitHub issue/TODO and document the expected UX (e.g., pinch-rotate gesture).

---

### 29. `WorldBox` duplicates the `color` field that is already accessible on `raw`

**File:** `src/components/canvas-viewpoint/core/types.ts` — `WorldBox`

**Problem:**

```typescript
export interface WorldBox extends WorldBoxGeometry {
  raw: Box;
  color: string; // already accessible via raw.color
}
```

`color` is set during `normalizeBoxToWorld` and mirrors `raw.color`. Any code that changes `raw.color` must also remember to update `WorldBox.color`, creating a potential desync. Accessing `b.raw.color` is slightly more verbose but eliminates the duplication.

**Prompt:**

> In `types.ts`, remove the `color` field from `WorldBox`. In `box-utils.ts` (`normalizeBoxToWorld`), remove the `color` assignment from the returned object. Update all render code that reads `b.color` to read `b.raw.color` instead — primarily in `frame-renderer.ts` (the `groups` map by color) and `render-utils.ts` (`drawBox`). This is a small change that eliminates a potential stale-color bug.

---

### 30. `isNullOrUndefined` utility is a single-line wrapper in its own file, used in only 2 places

**File:** `src/components/canvas-viewpoint/utils/validation-utils.ts`

**Problem:** The entire file is:

```typescript
export function isNullOrUndefined<T>(value: T | null | undefined): value is null | undefined {
  return value === null || value === undefined;
}
```

This is equivalent to `value == null` (a standard JS pattern). It has its own file, is imported in `canvas-viewpoint.ts` and `pointer-event-handler.ts`, and the two call sites use it to check a single variable. The file adds import overhead for no meaningful abstraction.

**Prompt:**

> Delete `validation-utils.ts`. Replace the two usages of `isNullOrUndefined(x)` with `x == null` (which is idiomatic TypeScript for null-or-undefined checks and is understood by the type narrowing system). In `canvas-viewpoint.ts`, remove the import. In `pointer-event-handler.ts`, remove the import. Run the build to confirm no other usages exist.

---

### 31. `box-list.component` uses `mouseenter`/`mouseleave` while the rest of the app uses pointer events

**File:** `src/components/box-list/box-list.component.html`

**Problem:** The box list component uses `(mouseenter)` and `(mouseleave)` for hover tracking. The canvas viewport uses pointer events throughout. On touch devices, mouse events don't fire, so the box list hover won't work on mobile even once mobile support is added.

**Prompt:**

> In `box-list.component.html`, replace `(mouseenter)="onBoxMouseEnter(getBoxId(box))"` with `(pointerenter)="onBoxMouseEnter(getBoxId(box))"` and `(mouseleave)="onBoxMouseLeave()"` with `(pointerleave)="onBoxMouseLeave()"`. In `box-list.component.ts`, update the method signatures if needed (the parameter types won't change — `pointerenter` provides the same element target). This makes hover tracking consistent and touch-compatible.

---

### 32. `history.service.ts` — initial box state has no undo baseline entry

**File:** `src/services/history.service.ts` — `initialize()`, `saveToStorage()`

**Problem:**

```typescript
//TODO: add initial all boxes?
```

`initialize(boxes)` sets the box state but records nothing in the undo stack. This means undo can go back to an empty-boxes state (undoing the first ADD gets you to `[]`), but there's no way to represent "undo all the way back to how the data was when the app loaded." The localStorage snapshot also doesn't include the initial boxes.

**Prompt:**

> In `history.service.ts`, after `initialize(boxes)` sets `this._boxes.set(boxes)`, save a snapshot to localStorage that includes the initial boxes alongside the empty stacks. In `loadFromStorage()`, restore the initial boxes from this snapshot if the stacks are empty. This way a page refresh restores the data. The undo stack itself doesn't need an entry for the initial state — undo should simply stop when the stack is empty (current behavior), but the boxes themselves should persist across refreshes. Update `saveToStorage` to always include `boxes: this._boxes()` in the stored JSON.

---

## FUTURE / PLANNED

These are the TODOs from the source reorganized with context and suggested approach.

---

### 33. Canvas sizing leaves extra space (TODO in canvas-viewpoint.ts line 406)

**File:** `src/components/canvas-viewpoint/canvas-viewpoint.ts` — `onResize`

**Prompt:**

> Investigate the `onResize()` method in `canvas-viewpoint.ts`. The canvas is sized based on `containerWidth` and the aspect ratio. Check if the parent element has padding, border, or if flexbox is adding space. Add `box-sizing: border-box` and `overflow: hidden` to `.viewport-root` in `canvas-viewpoint.css`. Log `containerWidth`, `canvas.width`, and `canvas.getBoundingClientRect()` at resize time to identify where the discrepancy originates.

---

### 34. Pending box state (opacity) not implemented (TODO in canvas-viewpoint.ts line 410)

**File:** `src/components/canvas-viewpoint/utils/frame-renderer.ts` — `renderFrame`
**File:** `src/intefaces/boxes.interface.ts` — `Box`

**Prompt:**

> Add a `pending?: boolean` field to the `Box` interface. In `frame-renderer.ts`, in the render loop before `RenderUtils.drawBox(...)`, check `b.raw.pending` and if true, set `ctx.globalAlpha = 0.4` before drawing, then reset it to `1.0` after. Boxes created via `recordAdd` in the history service should optionally receive `pending: true` from the caller. When a box transitions from pending to accepted (an API call confirms it), call `historyService.recordChangeClass` or a new `recordConfirm` delta type.

---

### 35. Filters on `visibleBoxes` are stubbed — pending/accepted/class filters not implemented

**File:** `src/services/history.service.ts` — `visibleBoxes` computed

**Prompt:**

> In `history.service.ts`, flesh out the `visibleBoxes` computed signal. Add injectable filter state: an array of active `styleId` values to show, and a `showPending: boolean` flag. These can be signals on the service itself. Inside `visibleBoxes`, apply: filter by `shouldHide` (existing), filter by pending status if `!showPending`, filter by `styleId` if the active filter list is non-empty. Expose `setStyleFilter(ids: string[])` and `setShowPending(v: boolean)` as public methods. Wire them up from the parent `app.ts` toolbar.

---

### 36. Lasso / rectangle select tool not implemented (TODO in canvas-viewpoint.ts)

**Prompt:**

> Implement a rectangle selection tool. When no box is selected and the user drags in non-create mode (without Ctrl), draw a selection rectangle (dashed border, 10% fill) from drag start to current pointer position. On pointer up, collect all boxes whose AABBs intersect the selection rectangle using the quadtree. Store the result as a `selectedBoxIds: Set<string | number>` signal on `StateManager` (replacing the single `selectedBoxId`). Update `drawSelectionUI` in `render-utils.ts` to draw selection handles for all selected boxes. Update manipulation handlers to apply rotation/resize/drag to all selected boxes simultaneously.

---

### 37. Mobile / touch interaction not implemented (TODO in canvas-viewpoint.ts)

**Prompt:**

> Add two-finger pinch-to-zoom and one-finger pan on touch devices. In `canvas-viewpoint.ts` (or a new `touch.handler.ts`), listen for `touchstart`, `touchmove`, `touchend` on the viewport root. For two-touch `touchmove`, calculate the change in distance between the two touch points and apply it as a zoom delta (same math as `CameraHandler.zoom` but driven by pinch distance ratio). For one-touch, route to `CameraHandler.pan`. Prevent default on all touch events to stop page scroll. Do not remove the existing pointer event handlers — they continue to handle mouse/stylus.

---

### 38. Copy-paste when mouse is outside canvas pastes at stale offset, not viewport center

_(See also issue #27 — this is the underlying cause.)_

**File:** `src/components/canvas-viewpoint/utils/clipboard-manager.ts`
**File:** `src/components/canvas-viewpoint/handlers/pointer-event-handler.ts`

**Prompt:**

> `lastMouseScreen` is only updated during `pointermove` inside the canvas. When the user presses Ctrl+C and then Ctrl+V without moving the mouse back into the canvas, `lastMouseScreen` holds the last in-canvas position (which may be stale) or null. Fix: track `lastMouseScreen` on `window` `mousemove` in addition to canvas `pointermove`, so the most recent global cursor position is always available. In `hotkey.service.ts` or `canvas-viewpoint.ts`, add a `window.addEventListener('mousemove', ...)` that updates `state.lastMouseScreen` with the raw screen position. The canvas boundary check in `createPastedBox` already handles the out-of-canvas case correctly once the position is up-to-date.

---

### 39. World coordinate system should be absolute pixels, not centered-origin (TODO in canvas-viewpoint.ts)

**File:** `src/components/canvas-viewpoint/utils/coordinate-transform.ts`
**File:** `src/components/canvas-viewpoint/utils/box-utils.ts`
**File:** `src/components/canvas-viewpoint/utils/camera-utils.ts`

**Prompt:**

> Currently the world coordinate system is centered at the image center (origin = image center). This is the source of several confusing `-bgCanvas.width / 2` offsets throughout rendering and transform code. Decide whether to migrate to top-left origin (origin = top-left of image). If migrating: update `CoordinateTransform.screenToWorld` and `worldToScreen` (remove the `- canvasWidth/2` + `camera offset` and instead use a top-left to screen transform), update `box-utils.ts` `normalizeBoxToWorld` to output top-left origin world coordinates, update `frame-renderer.ts` `drawImage` call (remove the `-w/2, -h/2` offset), and update `camera-utils.ts` `clampCamera`. This is a significant refactor — do it in a branch and verify against the full render pipeline.
