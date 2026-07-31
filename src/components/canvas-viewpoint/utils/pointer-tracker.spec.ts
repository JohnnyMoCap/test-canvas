import { describe, it, expect } from 'vitest';
import { PointerTracker } from './pointer-tracker';

describe('PointerTracker', () => {
  it('has/get return nothing for an untracked id', () => {
    const tracker = new PointerTracker();

    expect(tracker.has(1)).toBe(false);
    expect(tracker.get(1)).toBeUndefined();
    expect(tracker.size).toBe(0);
  });

  it('add tracks a pointer and makes it visible via has/get/size/ids', () => {
    const tracker = new PointerTracker();

    tracker.add(1, { x: 10, y: 20 });

    expect(tracker.has(1)).toBe(true);
    expect(tracker.get(1)).toEqual({ x: 10, y: 20 });
    expect(tracker.size).toBe(1);
    expect(tracker.ids()).toEqual([1]);
  });

  it('add overwrites an existing id in place (no duplicate/size change)', () => {
    const tracker = new PointerTracker();
    tracker.add(1, { x: 0, y: 0 });

    tracker.add(1, { x: 5, y: 5 });

    expect(tracker.get(1)).toEqual({ x: 5, y: 5 });
    expect(tracker.size).toBe(1);
  });

  it('update overwrites the position of a tracked pointer', () => {
    const tracker = new PointerTracker();
    tracker.add(1, { x: 0, y: 0 });

    tracker.update(1, { x: 7, y: 8 });

    expect(tracker.get(1)).toEqual({ x: 7, y: 8 });
  });

  it('update is a no-op for an untracked id (does not add it)', () => {
    const tracker = new PointerTracker();

    tracker.update(1, { x: 7, y: 8 });

    expect(tracker.has(1)).toBe(false);
    expect(tracker.size).toBe(0);
  });

  it('remove drops a tracked pointer', () => {
    const tracker = new PointerTracker();
    tracker.add(1, { x: 0, y: 0 });
    tracker.add(2, { x: 1, y: 1 });

    tracker.remove(1);

    expect(tracker.has(1)).toBe(false);
    expect(tracker.has(2)).toBe(true);
    expect(tracker.size).toBe(1);
    expect(tracker.ids()).toEqual([2]);
  });

  it('ids() reflects current membership after adds and removes, in insertion order', () => {
    const tracker = new PointerTracker();
    tracker.add(3, { x: 0, y: 0 });
    tracker.add(1, { x: 0, y: 0 });
    tracker.add(2, { x: 0, y: 0 });
    tracker.remove(1);

    expect(tracker.ids()).toEqual([3, 2]);
  });

  it('clear removes every tracked pointer', () => {
    const tracker = new PointerTracker();
    tracker.add(1, { x: 0, y: 0 });
    tracker.add(2, { x: 0, y: 0 });

    tracker.clear();

    expect(tracker.size).toBe(0);
    expect(tracker.ids()).toEqual([]);
  });

  it('distance computes the Euclidean distance between two points (3-4-5 triangle)', () => {
    expect(PointerTracker.distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('distance is 0 for identical points', () => {
    expect(PointerTracker.distance({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(0);
  });

  it('midpoint computes the average of two points', () => {
    expect(PointerTracker.midpoint({ x: 0, y: 0 }, { x: 10, y: 4 })).toEqual({ x: 5, y: 2 });
  });

  it('midpoint of a point with itself is that point', () => {
    expect(PointerTracker.midpoint({ x: 7, y: -3 }, { x: 7, y: -3 })).toEqual({ x: 7, y: -3 });
  });
});
