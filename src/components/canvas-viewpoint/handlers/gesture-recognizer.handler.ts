import { PointerTracker } from '../utils/pointer-tracker';

/**
 * The only DOM surface `GestureRecognizerHandler` touches on the interactive
 * element — kept narrow (rather than `HTMLCanvasElement`) so it stays
 * trivially fakeable in tests and documents the true (tiny) coupling.
 */
export interface PointerCaptureTarget {
  setPointerCapture(pointerId: number): void;
  releasePointerCapture(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
}

export interface PinchDelta {
  /** Current two-finger midpoint, in the same units as the input events' clientX/Y (CSS px). */
  midpoint: { x: number; y: number };
  /** Multiplicative change in finger distance since the last update (1 = unchanged). */
  distanceRatio: number;
  /** Midpoint movement since the last update, in CSS px. */
  panDeltaX: number;
  panDeltaY: number;
}

/**
 * Semantic gesture callbacks emitted by the recognizer. Deliberately not
 * `PointerHandlerContext` (which bundles `LabelingStateManager`/`Quadtree`/
 * `HistoryService` — Layer 3 concerns): this is Layer 1, and handing it
 * Layer 3 state would invert the codebase's dependency direction and tie it
 * to one particular viewport's business logic.
 */
export interface GestureCallbacks {
  onPrimaryDown(e: PointerEvent): void;
  onPrimaryMove(e: PointerEvent): void;
  onPrimaryUp(e: PointerEvent): void;
  onPinchStart(): void;
  onPinchChange(delta: PinchDelta): void;
  onPinchEnd(): void;
  /** Fired only by a global interruption (page lost focus/visibility) — no single pointer to attribute it to. */
  onInterrupted(): void;
}

/**
 * `idle` — nothing down.
 * `single` — exactly one pointer down (a mouse click, or one finger/pen):
 * routed to `onPrimaryDown/Move/Up` for normal box create/select/drag/resize/
 * rotate/pan handling.
 * `pinch` — exactly two pointers down together: routed to `onPinchStart/
 * Change/End` instead. A third or later simultaneous pointer is tracked but
 * has no effect on `state`.
 */
type GestureState =
  | { kind: 'idle' }
  | { kind: 'single'; pointerId: number }
  | {
      kind: 'pinch';
      pointerIds: [number, number];
      lastDist: number;
      lastMid: { x: number; y: number };
    };

/**
 * Layer 1: turns raw, possibly-multi-finger Pointer Events into a small,
 * unambiguous stream of semantic gesture callbacks (single-pointer
 * down/move/up, or pinch start/change/end), so Layer 2 (`PointerEventHandler`)
 * and Layer 3 business logic never need to know how many fingers are
 * involved.
 *
 * The interaction state is a discriminated union (`GestureState`, above)
 * rather than independent booleans/nullable fields, so "dragging a box and
 * pinching at the same time" is unrepresentable. Every pinch computation is
 * derived from `PointerTracker`'s current positions, never from a value
 * captured earlier that could go stale.
 *
 * Owns its own `visibilitychange`/`blur` listeners so that if the page loses
 * focus mid-gesture (an OS gesture, app switch, or incoming call) — which can
 * happen without the browser ever sending `pointercancel` for every finger —
 * all tracked pointers and gesture state are unconditionally cleared. Call
 * `destroy()` when the owning component is destroyed.
 */
export class GestureRecognizerHandler {
  private readonly tracker = new PointerTracker();
  private state: GestureState = { kind: 'idle' };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) this.forceReset();
  };

  private readonly handleBlur = (): void => {
    this.forceReset();
  };

  constructor(
    private readonly captureTarget: PointerCaptureTarget,
    private readonly callbacks: GestureCallbacks,
  ) {
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('blur', this.handleBlur);
  }

  destroy(): void {
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('blur', this.handleBlur);
  }

  handlePointerDown(e: PointerEvent): void {
    this.tracker.add(e.pointerId, { x: e.clientX, y: e.clientY });
    this.tryCapture(e.pointerId);

    // One pointer down: a mouse click, or the first finger/pen touching down.
    if (this.tracker.size === 1) {
      this.state = { kind: 'single', pointerId: e.pointerId };
      this.callbacks.onPrimaryDown(e);
      return;
    }

    // A second pointer just joined the first: this is now a two-finger pinch.
    if (this.tracker.size === 2) {
      // If the first pointer was mid box-interaction (drag/resize/rotate) or
      // panning, finish that cleanly — as if it had been lifted — before
      // switching interpretation to a pinch. Its capture is left in place:
      // it isn't going away, it becomes one of the two pinch anchors below,
      // and stays down for the rest of the gesture.
      if (this.state.kind === 'single') {
        const otherId = this.state.pointerId;
        const otherPos = this.tracker.get(otherId);
        if (otherPos) {
          this.callbacks.onPrimaryUp(this.syntheticPointerUp(otherPos));
        }
      }

      const [id0, id1] = this.tracker.ids();
      const p0 = this.tracker.get(id0)!;
      const p1 = this.tracker.get(id1)!;
      this.state = {
        kind: 'pinch',
        pointerIds: [id0, id1],
        lastDist: PointerTracker.distance(p0, p1),
        lastMid: PointerTracker.midpoint(p0, p1),
      };
      this.callbacks.onPinchStart();
      return;
    }

    // A third (or later) simultaneous pointer: tracked for position only,
    // ignored for gesture purposes - the existing single/pinch state carries on.
  }

  handlePointerMove(e: PointerEvent): void {
    // A move for a pointer we never saw go down (a hovering mouse, which
    // never fires pointerdown) always reaches onPrimaryMove regardless of
    // any active gesture - there is no gesture to speak of for it.
    if (!this.tracker.has(e.pointerId)) {
      this.callbacks.onPrimaryMove(e);
      return;
    }

    this.tracker.update(e.pointerId, { x: e.clientX, y: e.clientY });

    // One of the two pinch anchors moved: recompute distance/midpoint from
    // both anchors' current tracked positions and report the change.
    if (this.state.kind === 'pinch' && this.state.pointerIds.includes(e.pointerId)) {
      this.updatePinch(this.state);
      return;
    }

    // The single tracked pointer moved: ordinary drag/pan/hover handling.
    if (this.state.kind === 'single' && this.state.pointerId === e.pointerId) {
      this.callbacks.onPrimaryMove(e);
      return;
    }

    // A third+ finger's move, or a pointer left over after its pinch partner
    // already lifted: position is kept up to date above, no callback fires.
  }

  handlePointerUp(e: PointerEvent): void {
    this.tracker.remove(e.pointerId);
    this.tryRelease(e.pointerId);

    // One of the two pinch anchors lifted: the pinch ends outright - the
    // remaining finger (if still down) is not carried forward into a
    // single-pointer pan, it simply becomes an idle tracked pointer.
    if (this.state.kind === 'pinch' && this.state.pointerIds.includes(e.pointerId)) {
      this.state = { kind: 'idle' };
      this.callbacks.onPinchEnd();
      return;
    }

    // The single tracked pointer lifted: ends the drag/pan/click normally.
    if (this.state.kind === 'single' && this.state.pointerId === e.pointerId) {
      this.state = { kind: 'idle' };
      this.callbacks.onPrimaryUp(e);
      return;
    }
  }

  /** Routed through the identical path as `handlePointerUp` - an interrupted single pointer still needs to complete cleanly. */
  handlePointerCancel(e: PointerEvent): void {
    this.handlePointerUp(e);
  }

  /**
   * Unconditional recovery: clears all tracked pointers and interaction
   * state. Called internally on `visibilitychange`/`blur`; exposed publicly
   * in case a host component ever needs to force a clean slate defensively.
   */
  forceReset(): void {
    for (const id of this.tracker.ids()) {
      this.tryRelease(id);
    }
    this.tracker.clear();
    this.state = { kind: 'idle' };
    this.callbacks.onInterrupted();
  }

  private updatePinch(pinchState: Extract<GestureState, { kind: 'pinch' }>): void {
    const [id0, id1] = pinchState.pointerIds;
    const p0 = this.tracker.get(id0)!;
    const p1 = this.tracker.get(id1)!;

    const mid = PointerTracker.midpoint(p0, p1);
    const dist = PointerTracker.distance(p0, p1);

    const delta: PinchDelta = {
      midpoint: mid,
      distanceRatio: dist / pinchState.lastDist,
      panDeltaX: mid.x - pinchState.lastMid.x,
      panDeltaY: mid.y - pinchState.lastMid.y,
    };

    pinchState.lastDist = dist;
    pinchState.lastMid = mid;

    this.callbacks.onPinchChange(delta);
  }

  private syntheticPointerUp(point: { x: number; y: number }): PointerEvent {
    return new PointerEvent('pointerup', {
      clientX: point.x,
      clientY: point.y,
      button: 0,
      bubbles: true,
      cancelable: true,
    });
  }

  /**
   * Requests that all subsequent events for `pointerId` be delivered to
   * `captureTarget` regardless of where the pointer physically moves,
   * including outside its bounds or the browser window entirely. Held for as
   * long as the pointer is tracked - a pinch anchor that drifts to the edge
   * of the screen while the fingers spread apart still needs its move/up
   * events to reach us.
   */
  private tryCapture(pointerId: number): void {
    try {
      this.captureTarget.setPointerCapture(pointerId);
    } catch {
      // Some pointer types/browsers can refuse capture - never let that abort the gesture.
    }
  }

  private tryRelease(pointerId: number): void {
    try {
      if (this.captureTarget.hasPointerCapture(pointerId)) {
        this.captureTarget.releasePointerCapture(pointerId);
      }
    } catch {
      // As above - best-effort only.
    }
  }
}
