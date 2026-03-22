# Canvas Viewport — Numbered Issues & Fix Prompts

## CODE QUALITY

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