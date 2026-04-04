# Test Coverage Plan

## Stack

| Tool                                    | Purpose                      | Command             |
| --------------------------------------- | ---------------------------- | ------------------- |
| Vitest (via `@angular/build:unit-test`) | Logic unit/integration tests | `ng test`           |
| Storybook 10 (`@storybook/angular`)     | Visual component testing     | `npm run storybook` |

`tsconfig.spec.json` includes `vitest/globals` — `describe`, `it`, `expect` are global. No imports needed.

---

## Philosophy

- **No mocking** of business logic. Use real Angular services (`HistoryService`, `HotkeyService`).
- If it **computes/transforms**, verify it in a Vitest spec.
- If it **renders**, verify it in a Storybook story.
- Integration over isolation: handler tests use real `HistoryService` + real state managers.

---

## What exists today

### Vitest specs

| File                                                              | Cases    | Status       |
| ----------------------------------------------------------------- | -------- | ------------ |
| `src/components/canvas-viewpoint/utils/measurement-utils.spec.ts` | 22       | ✅ Done      |
| `src/components/canvas-viewpoint/canvas-viewpoint.spec.ts`        | 1 (stub) | ⚠️ Stub only |

### Storybook stories

| File                                                          | Stories                                                   | Status  |
| ------------------------------------------------------------- | --------------------------------------------------------- | ------- |
| `src/components/canvas-viewpoint/canvas-viewpoint.stories.ts` | Default, CreateMode, ReadOnly, MeasurementMode, WithBoxes | ✅ Done |

### Storybook config

- `.storybook/main.ts` — framework `@storybook/angular`, stories glob `../src/**/*.stories.ts`
- `.storybook/preview.ts` — `applicationConfig` with `provideZonelessChangeDetection` + `provideRouter([])`
- `angular.json` — storybook + build-storybook targets, `compodoc: false`

---

## Full Remaining Plan

### Phase 1 — Pure Utils

No Angular deps, no `TestBed`. Plain `describe`/`it` Vitest blocks. Run standalone.

Each spec file pattern:

```typescript
// No imports for describe/it/expect — they're global via vitest/globals
import { MyUtils } from './my-utils';

describe('MyUtils', () => {
  it('describes the expected outcome', () => {
    // given
    const input = ...;
    // when
    const result = MyUtils.someMethod(input);
    // then
    expect(result).toBe(...);
  });
});
```

**All tests must follow the Given/When/Then structure.** Declare inputs as named variables under `// given`, call the method under `// when`, and assert under `// then`. Inline one-liners are not allowed — every test body must have these three sections. When there is no meaningful setup (e.g. calling a factory with no args), `// given` may be omitted but `// when` and `// then` are always required.

Priority order:

1. **`utils/coordinate-transform.spec.ts`**
   - `screenToAbsolute` / `absoluteToScreen` roundtrip
   - `screenDeltaToAbsolute`
   - `pointInBox` — axis-aligned box, rotated box, point on edge, point outside
   - `calculateRotatedAABB` — zero rotation matches input; 90° rotation swaps w/h

2. **`utils/box-utils.spec.ts`**
   - `normalizeBoxToAbsolute` — 0-1 normalized coords → pixel space
   - `absoluteToNormalized` / `absoluteDimensionsToNormalized`

3. **`utils/box-state-utils.spec.ts`**
   - `updateBox` — updates matching box, leaves others unchanged
   - `removeBox` — removes by id, handles missing id gracefully
   - `findBoxById` — found and not-found

4. **`utils/box-manipulator.spec.ts`**
   - `rotateBox` — returned box has updated rotation
   - `resizeBox` — corner-specific resize (nw/ne/sw/se), clamps to minimum
   - `moveBox` — clamped to image bounds
   - `updateBoxInArray` — replaces matching, preserves others

5. **`utils/boundary-utils.spec.ts`**
   - `clampToImageBounds` — box within bounds unchanged; out-of-bounds on all four edges

6. **`utils/box-creation-utils.spec.ts`**
   - `createBoxFromDrag` — normal drag; too-small drag returns `null`; `minSize` threshold
   - `createBoxFromContextMenu` — correct normalized position relative to image
   - `generateTempId` — offsets counter by 100000

7. **`utils/camera-utils.spec.ts`**
   - `clampCamera` — image always fills viewport; cannot pan to show blank space
   - `calculateMinZoom` — portrait/landscape/square image; min never > 1
   - `getViewBoundsInAbsolute` — correct bounds at identity zoom; zoomed in; panned

8. **`utils/context-menu-utils.spec.ts`**
   - `open` — returns state with `visible: true`, correct coords
   - `close` — returns state with `visible: false`
   - `isWithinMenu` — truthy for child element, falsy for unrelated element

9. **`utils/creation-utils.spec.ts`**
   - `createPreviewBox` — correct geometry from any diagonal drag direction (all 4 quadrants)

10. **`core/quadtree.spec.ts`**
    - Insert single item; query returns it
    - Item outside query range not returned
    - Subdivision: insert > capacity forces subdivision
    - Item spanning multiple quadrants stored in parent node

11. **`utils/validation-utils.spec.ts`**
    - `isNullOrUndefined(null)` → true; `(undefined)` → true; `(0)` → false; `('')` → false; `(false)` → false

---

### Phase 2 — Services (use `TestBed`)

```typescript
// Pattern for service specs
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

beforeEach(() => {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
});
```

1. **`services/history.service.spec.ts`**
   - `initialize(boxes)` sets `getBoxes()` and clears stacks
   - `recordAdd(box)` → `getBoxes()` contains box; `undo()` → box removed; `redo()` → box back
   - `recordDelete(id)` → box removed; `undo()` → box back
   - `recordMove(id, before, after)` → after `undo()`, box is at `before` position
   - `recordResize` / `recordRotate` — same delta pattern
   - `canUndo` / `canRedo` computed signals update after each operation
   - Stack limit 100 — 101st record drops oldest from undo stack
   - `getBox(id)` — found and not-found
   - `saveToStorage` / `loadFromStorage` — round-trip via jsdom localStorage
   - `visibleBoxes` — returns empty when `HotkeyService.hideBoxes()` is true

2. **`services/hotkey.service.spec.ts`**
   - `on('UNDO', cb)` — fires on `Ctrl+Z` keydown on `document`
   - `on('REDO', cb)` — fires on `Ctrl+Y` and `Ctrl+Shift+Z`
   - `on('COPY', cb)` — fires on `Ctrl+C`
   - `on('PASTE', cb)` — fires on `Ctrl+V`
   - `on('DELETE', cb)` — fires on `Delete` and `Backspace`
   - `on('ESCAPE', cb)` — fires on `Escape`
   - Focus guard: callback NOT fired when `document.activeElement` is `<input>`
   - `setEnabled(false)` — disables all callbacks
   - Unsubscribe fn returned by `on()` stops future invocations
   - `toggleHide()` / `setHide(bool)` flip `hideBoxes()` signal

---

### Phase 3 — Handlers (integration with real deps)

```typescript
// Pattern: real HistoryService + real LabelingStateManager, no mocks
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { HistoryService } from '../../../services/history.service';
import { LabelingStateManager } from '../utils/labeling-state-manager';
import { ContextMenuUtils } from '../utils/context-menu-utils';

let historyService: HistoryService;
let state: LabelingStateManager;

beforeEach(() => {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  historyService = TestBed.inject(HistoryService);
  historyService.initialize([]);
  state = new LabelingStateManager(ContextMenuUtils.close());
});
```

1. **`handlers/camera.handler.spec.ts`** — all static methods
   - `startPan` returns correct start coords
   - `pan` with clamping at boundaries
   - `zoom` — cursor-centred; clamps at `minZoom` and `maxZoom`
   - `calculateMinZoom` delegates to CameraUtils

2. **`handlers/box-creation.handler.spec.ts`**
   - `startCreate` → state has `isCreating: true`
   - `updatePreview` → `currentPoint` updates
   - `completeCreate` — records ADD in `historyService`; too-small → returns `null` and no history entry
   - `resetCreateState` → clean idle state
   - `createFromContextMenu` → box recorded in `historyService`

3. **`handlers/box-manipulation.handler.spec.ts`**
   - `startRotation` returns initial angle
   - `rotate` — returned box has new `rotation`
   - `resize` for each `ResizeCorner`
   - `startDrag` captures start position
   - `drag` — box moves; clamped at image edge
   - `completeManipulation` — records correct delta type (ROTATE/RESIZE/MOVE) in `historyService`

4. **`handlers/hover.handler.spec.ts`**
   - `detectHoveredBox` returns id when point is inside box
   - Does not return id when point is outside all boxes
   - Returns last box in render order when overlapping
   - `detectRotationKnob` — true at expected screen position

5. **`handlers/clipboard.handler.spec.ts`**
   - `copy` — sets clipboard signal; `historyService` unchanged
   - `cut` — box removed; DELETE recorded in `historyService`
   - `paste` — new box added; ADD recorded in `historyService`
   - `delete` — box removed; DELETE recorded

6. **`handlers/context-menu.handler.spec.ts`**
   - `open` returns visible state
   - `close` returns hidden state
   - `isWithinMenu` DOM check

7. **`handlers/measurement.handler.spec.ts`**
   - First click sets `pointOne`
   - Second click (> threshold from `pointOne`) sets `pointTwo`
   - Click near existing point starts drag
   - `handlePointerMove` with active drag updates point
   - `handlePointerUp` clears drag state

---

### Phase 4 — Worker

`workers/magic-detection.worker.spec.ts`

- Construct synthetic 100×100 `Uint8ClampedArray` with a solid-color 40×40 region at (30,30)
- `postMessage` with buffer (zero-copy `ArrayBuffer` transfer)
- Assert returned bbox roughly covers the solid region
- Auto-tolerance test: uniform region → low tolerance; noisy region → higher tolerance

---

### Phase 5 — Storybook stories to add

- `WithBoxes` — provide a data-URI PNG as `backgroundUrl` so boxes are visible on canvas
- `SelectedBox` — `play()` sets `externalSelectBoxId` to show resize handles
- `MagicMode` — `isMagicModeInput: true`

---

## Key type reference

```typescript
// boxes.interface.ts
type Box =
  | {
      id: number;
      x: number;
      y: number;
      w: number;
      h: number;
      rotation?: number;
      color?: string;
      state?: 'pending' | 'accepted';
    }
  | {
      tempId: number;
      x: number;
      y: number;
      w: number;
      h: number;
      rotation?: number;
      color?: string;
      state?: 'pending' | 'accepted';
    };

function getBoxId(box: Box): number; // throws if neither id nor tempId

// core/types.ts
interface Camera {
  zoom: number;
  x: number;
  y: number;
}
interface MeasurementState {
  isActive: boolean;
  pointOne: { x: number; y: number } | null;
  pointTwo: { x: number; y: number } | null;
  isDraggingPoint: null | 'one' | 'two';
  metricWidth: number;
  metricHeight: number;
}
interface AbsoluteBoxGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
```

---

## Running

```bash
ng test                 # all Vitest specs
npm run storybook       # Storybook dev server on port 6006
npm run build-storybook # static Storybook build
```
