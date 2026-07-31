import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GestureRecognizerHandler, GestureCallbacks, PointerCaptureTarget } from './gesture-recognizer.handler';

function makeCaptureTarget() {
  const target: PointerCaptureTarget = {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
  };
  return target as unknown as {
    setPointerCapture: ReturnType<typeof vi.fn>;
    releasePointerCapture: ReturnType<typeof vi.fn>;
    hasPointerCapture: ReturnType<typeof vi.fn>;
  } & PointerCaptureTarget;
}

function makeCallbacks() {
  const callbacks: GestureCallbacks = {
    onPrimaryDown: vi.fn(),
    onPrimaryMove: vi.fn(),
    onPrimaryUp: vi.fn(),
    onPinchStart: vi.fn(),
    onPinchChange: vi.fn(),
    onPinchEnd: vi.fn(),
    onInterrupted: vi.fn(),
  };
  return callbacks as unknown as Record<keyof GestureCallbacks, ReturnType<typeof vi.fn>> &
    GestureCallbacks;
}

function down(pointerId: number, x: number, y: number): PointerEvent {
  return new PointerEvent('pointerdown', { pointerId, clientX: x, clientY: y, bubbles: true });
}
function move(pointerId: number, x: number, y: number): PointerEvent {
  return new PointerEvent('pointermove', { pointerId, clientX: x, clientY: y, bubbles: true });
}
function up(pointerId: number, x: number, y: number): PointerEvent {
  return new PointerEvent('pointerup', { pointerId, clientX: x, clientY: y, bubbles: true });
}
function cancel(pointerId: number, x: number, y: number): PointerEvent {
  return new PointerEvent('pointercancel', { pointerId, clientX: x, clientY: y, bubbles: true });
}

describe('GestureRecognizerHandler', () => {
  let capture: ReturnType<typeof makeCaptureTarget>;
  let callbacks: ReturnType<typeof makeCallbacks>;
  let recognizer: GestureRecognizerHandler;

  beforeEach(() => {
    capture = makeCaptureTarget();
    callbacks = makeCallbacks();
    recognizer = new GestureRecognizerHandler(capture, callbacks);
  });

  afterEach(() => {
    recognizer.destroy();
  });

  it('1. single down -> move -> up fires each primary callback exactly once, with capture requested/released', () => {
    const d = down(1, 0, 0);
    const m = move(1, 5, 5);
    const u = up(1, 10, 10);

    recognizer.handlePointerDown(d);
    recognizer.handlePointerMove(m);
    recognizer.handlePointerUp(u);

    expect(callbacks.onPrimaryDown).toHaveBeenCalledTimes(1);
    expect(callbacks.onPrimaryDown).toHaveBeenCalledWith(d);
    expect(callbacks.onPrimaryMove).toHaveBeenCalledTimes(1);
    expect(callbacks.onPrimaryMove).toHaveBeenCalledWith(m);
    expect(callbacks.onPrimaryUp).toHaveBeenCalledTimes(1);
    expect(callbacks.onPrimaryUp).toHaveBeenCalledWith(u);

    expect(capture.setPointerCapture).toHaveBeenCalledWith(1);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it('2. untracked pointer move (mouse hover, no prior down) always reaches onPrimaryMove, including mid-pinch', () => {
    // Plain hover, no gesture active at all.
    recognizer.handlePointerMove(move(99, 1, 1));
    expect(callbacks.onPrimaryMove).toHaveBeenCalledTimes(1);

    // Start a pinch between two *other* ids, then hover a third, untracked id.
    recognizer.handlePointerDown(down(1, 0, 0));
    recognizer.handlePointerDown(down(2, 10, 0));
    callbacks.onPrimaryMove.mockClear();

    const hoverDuringPinch = move(99, 2, 2);
    recognizer.handlePointerMove(hoverDuringPinch);

    expect(callbacks.onPrimaryMove).toHaveBeenCalledTimes(1);
    expect(callbacks.onPrimaryMove).toHaveBeenCalledWith(hoverDuringPinch);
    // And it must not have been misread as pinch activity.
    expect(callbacks.onPinchChange).not.toHaveBeenCalled();
  });

  it('3. second pointer arriving cleanly ends the primary before starting the pinch (ordering)', () => {
    recognizer.handlePointerDown(down(1, 0, 0));
    expect(callbacks.onPrimaryDown).toHaveBeenCalledTimes(1);

    recognizer.handlePointerDown(down(2, 10, 0));

    expect(callbacks.onPrimaryUp).toHaveBeenCalledTimes(1);
    expect(callbacks.onPinchStart).toHaveBeenCalledTimes(1);

    const primaryUpOrder = callbacks.onPrimaryUp.mock.invocationCallOrder[0];
    const pinchStartOrder = callbacks.onPinchStart.mock.invocationCallOrder[0];
    expect(primaryUpOrder).toBeLessThan(pinchStartOrder);

    // The synthetic up used pointer 1's last known position.
    const syntheticEvent = callbacks.onPrimaryUp.mock.calls[0][0] as PointerEvent;
    expect(syntheticEvent.clientX).toBe(0);
    expect(syntheticEvent.clientY).toBe(0);
  });

  it('4. pinch math is correct across multiple move steps', () => {
    recognizer.handlePointerDown(down(1, 0, 0));
    recognizer.handlePointerDown(down(2, 10, 0)); // dist=10, mid=(5,0)

    // Only pointer 2 moves this step: dist=20 (ratio 2 vs 10), mid=(10,0) -> panDelta (5,0) vs (5,0).
    recognizer.handlePointerMove(move(2, 20, 0));

    expect(callbacks.onPinchChange).toHaveBeenCalledTimes(1);
    let delta = callbacks.onPinchChange.mock.calls[0][0];
    expect(delta.distanceRatio).toBeCloseTo(2);
    expect(delta.midpoint).toEqual({ x: 10, y: 0 });
    expect(delta.panDeltaX).toBeCloseTo(5);
    expect(delta.panDeltaY).toBeCloseTo(0);

    // Pointer 1 alone moves next: p1=(4,0), p2 stays at (20,0) -> dist=16 (ratio 0.8 vs 20), mid=(12,0).
    recognizer.handlePointerMove(move(1, 4, 0));
    expect(callbacks.onPinchChange).toHaveBeenCalledTimes(2);
    delta = callbacks.onPinchChange.mock.calls[1][0];
    expect(delta.distanceRatio).toBeCloseTo(0.8);
    expect(delta.midpoint).toEqual({ x: 12, y: 0 });
    expect(delta.panDeltaX).toBeCloseTo(2);

    // Pointer 2 moves again: p1=(4,0) unchanged, p2=(24,0) -> dist=20 (ratio 1.25 vs 16), mid=(14,0).
    recognizer.handlePointerMove(move(2, 24, 0));
    expect(callbacks.onPinchChange).toHaveBeenCalledTimes(3);
    delta = callbacks.onPinchChange.mock.calls[2][0];
    expect(delta.distanceRatio).toBeCloseTo(1.25);
    expect(delta.midpoint).toEqual({ x: 14, y: 0 });
    expect(delta.panDeltaX).toBeCloseTo(2);
  });

  it('5. a third finger down during a pinch causes no state change / no callback for it', () => {
    recognizer.handlePointerDown(down(1, 0, 0));
    recognizer.handlePointerDown(down(2, 10, 0));
    callbacks.onPinchStart.mockClear();
    callbacks.onPrimaryDown.mockClear();

    recognizer.handlePointerDown(down(3, 5, 5));

    expect(callbacks.onPrimaryDown).not.toHaveBeenCalled();
    expect(callbacks.onPinchStart).not.toHaveBeenCalled();
    expect(callbacks.onPinchEnd).not.toHaveBeenCalled();
  });

  it('6. a third finger moving during a pinch is ignored', () => {
    recognizer.handlePointerDown(down(1, 0, 0));
    recognizer.handlePointerDown(down(2, 10, 0));
    recognizer.handlePointerDown(down(3, 5, 5));
    callbacks.onPinchChange.mockClear();

    recognizer.handlePointerMove(move(3, 6, 6));

    expect(callbacks.onPinchChange).not.toHaveBeenCalled();
    expect(callbacks.onPrimaryMove).not.toHaveBeenCalled();
  });

  it('7. either anchor lifting ends the pinch; the remaining anchor produces no further callback', () => {
    // Case A: first anchor lifts.
    recognizer.handlePointerDown(down(1, 0, 0));
    recognizer.handlePointerDown(down(2, 10, 0));

    recognizer.handlePointerUp(up(1, 0, 0));
    expect(callbacks.onPinchEnd).toHaveBeenCalledTimes(1);

    callbacks.onPinchChange.mockClear();
    callbacks.onPrimaryMove.mockClear();
    recognizer.handlePointerMove(move(2, 12, 0));
    expect(callbacks.onPinchChange).not.toHaveBeenCalled();
    expect(callbacks.onPrimaryMove).not.toHaveBeenCalled();

    recognizer.handlePointerUp(up(2, 12, 0));

    // Case B: second anchor lifts instead.
    const cb2 = makeCallbacks();
    const cap2 = makeCaptureTarget();
    const r2 = new GestureRecognizerHandler(cap2, cb2);
    r2.handlePointerDown(down(10, 0, 0));
    r2.handlePointerDown(down(11, 10, 0));

    r2.handlePointerUp(up(11, 10, 0));
    expect(cb2.onPinchEnd).toHaveBeenCalledTimes(1);
    r2.destroy();
  });

  it('8. original bug scenario: lingering finger + genuinely new touch pairs cleanly, no phantom/crash', () => {
    recognizer.handlePointerDown(down(1, 0, 0));
    recognizer.handlePointerDown(down(2, 10, 0)); // pinch [1,2]

    recognizer.handlePointerUp(up(1, 0, 0)); // pinch ends; pointer 2 lingers, still "down"
    expect(callbacks.onPinchEnd).toHaveBeenCalledTimes(1);
    callbacks.onPinchStart.mockClear();

    // A genuinely new third touch arrives while 2 is still down.
    expect(() => recognizer.handlePointerDown(down(3, 20, 0))).not.toThrow();

    expect(callbacks.onPinchStart).toHaveBeenCalledTimes(1);

    // Subsequent moves of the fresh pair must produce sane, finite pinch math.
    recognizer.handlePointerMove(move(2, 10, 0));
    recognizer.handlePointerMove(move(3, 30, 0));
    expect(callbacks.onPinchChange).toHaveBeenCalled();
    const lastDelta = callbacks.onPinchChange.mock.calls.at(-1)![0];
    expect(Number.isFinite(lastDelta.distanceRatio)).toBe(true);
    expect(Number.isFinite(lastDelta.midpoint.x)).toBe(true);
  });

  it('9. pointercancel for a single pointer behaves identically to pointerup', () => {
    recognizer.handlePointerDown(down(1, 0, 0));
    recognizer.handlePointerCancel(cancel(1, 3, 3));

    expect(callbacks.onPrimaryUp).toHaveBeenCalledTimes(1);
    expect(callbacks.onPrimaryUp).toHaveBeenCalledWith(expect.objectContaining({ pointerId: 1 }));
  });

  it('10. pointercancel for a pinch anchor behaves identically to that anchor\'s pointerup', () => {
    recognizer.handlePointerDown(down(1, 0, 0));
    recognizer.handlePointerDown(down(2, 10, 0));

    recognizer.handlePointerCancel(cancel(2, 10, 0));

    expect(callbacks.onPinchEnd).toHaveBeenCalledTimes(1);
  });

  it('11. forceReset() from idle/single/pinch always clears tracker/state and fires onInterrupted exactly once', () => {
    // From idle.
    recognizer.forceReset();
    expect(callbacks.onInterrupted).toHaveBeenCalledTimes(1);
    expect(callbacks.onPrimaryUp).not.toHaveBeenCalled();
    expect(callbacks.onPinchEnd).not.toHaveBeenCalled();

    // From single.
    callbacks.onInterrupted.mockClear();
    recognizer.handlePointerDown(down(1, 0, 0));
    recognizer.forceReset();
    expect(callbacks.onInterrupted).toHaveBeenCalledTimes(1);

    // From pinch.
    callbacks.onInterrupted.mockClear();
    recognizer.handlePointerDown(down(1, 0, 0));
    recognizer.handlePointerDown(down(2, 10, 0));
    recognizer.forceReset();
    expect(callbacks.onInterrupted).toHaveBeenCalledTimes(1);

    // State is truly idle afterwards: a fresh down starts a clean primary.
    callbacks.onPrimaryDown.mockClear();
    recognizer.handlePointerDown(down(1, 0, 0));
    expect(callbacks.onPrimaryDown).toHaveBeenCalledTimes(1);
  });

  it('12. dispatching real visibilitychange/blur events triggers forceReset via the constructor-registered listeners', () => {
    recognizer.handlePointerDown(down(1, 0, 0));

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(callbacks.onInterrupted).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });

    callbacks.onInterrupted.mockClear();
    recognizer.handlePointerDown(down(2, 0, 0));
    window.dispatchEvent(new Event('blur'));
    expect(callbacks.onInterrupted).toHaveBeenCalledTimes(1);
  });

  it("13. destroy() removes both global listeners", () => {
    recognizer.destroy();

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('blur'));
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });

    expect(callbacks.onInterrupted).not.toHaveBeenCalled();
  });

  it('14. pointerId reuse after a completed down/up cycle starts a clean fresh single', () => {
    recognizer.handlePointerDown(down(5, 0, 0));
    recognizer.handlePointerUp(up(5, 0, 0));

    callbacks.onPrimaryDown.mockClear();
    recognizer.handlePointerDown(down(5, 1, 1));

    expect(callbacks.onPrimaryDown).toHaveBeenCalledTimes(1);
    expect(callbacks.onPinchStart).not.toHaveBeenCalled();
  });

  it('15. setPointerCapture is called for every primary pointerdown; release attempted on every untrack path', () => {
    recognizer.handlePointerDown(down(1, 0, 0));
    expect(capture.setPointerCapture).toHaveBeenCalledWith(1);

    // Pointer 1 becomes a pinch anchor, still down, so its capture stays held.
    recognizer.handlePointerDown(down(2, 10, 0));
    expect(capture.setPointerCapture).toHaveBeenCalledWith(2);
    expect(capture.releasePointerCapture).not.toHaveBeenCalledWith(1);

    recognizer.handlePointerUp(up(1, 0, 0)); // up path
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(1);

    recognizer.handlePointerCancel(cancel(2, 10, 0)); // cancel path
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(2);

    capture.releasePointerCapture.mockClear();
    recognizer.handlePointerDown(down(3, 0, 0));
    recognizer.forceReset(); // forceReset path
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(3);
  });

  it("16. capture is held for BOTH pinch anchors for the gesture's entire duration, not just one", () => {
    recognizer.handlePointerDown(down(1, 0, 0));
    recognizer.handlePointerDown(down(2, 10, 0));
    capture.releasePointerCapture.mockClear();

    // Simulate anchor 1 drifting far outside any canvas bounds mid-pinch -
    // with capture held, its move must still be delivered and processed.
    recognizer.handlePointerMove(move(1, -500, -500));
    expect(callbacks.onPinchChange).toHaveBeenCalled();
    expect(capture.releasePointerCapture).not.toHaveBeenCalled();

    recognizer.handlePointerUp(up(1, -500, -500));
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(1);
    recognizer.handlePointerUp(up(2, 10, 0));
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(2);
  });
});
