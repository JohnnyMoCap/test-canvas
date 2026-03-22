# Canvas Viewport — Numbered Issues & Fix Prompts

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