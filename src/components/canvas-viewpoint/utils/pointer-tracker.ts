/**
 * Tracks the latest known position of every currently-down pointer, keyed by
 * pointerId. Pure data structure — no DOM, no Angular, no gesture semantics.
 */
export class PointerTracker {
  private readonly pointers = new Map<number, { x: number; y: number }>();

  /** Adds or overwrites the tracked position for `id`. */
  add(id: number, point: { x: number; y: number }): void {
    this.pointers.set(id, point);
  }

  /** Overwrites the tracked position for `id`. No-op if `id` isn't tracked. */
  update(id: number, point: { x: number; y: number }): void {
    if (this.pointers.has(id)) {
      this.pointers.set(id, point);
    }
  }

  remove(id: number): void {
    this.pointers.delete(id);
  }

  has(id: number): boolean {
    return this.pointers.has(id);
  }

  get(id: number): { x: number; y: number } | undefined {
    return this.pointers.get(id);
  }

  get size(): number {
    return this.pointers.size;
  }

  /** Currently-tracked pointer ids, in insertion order. */
  ids(): number[] {
    return [...this.pointers.keys()];
  }

  clear(): void {
    this.pointers.clear();
  }

  /** Euclidean distance between two points. */
  static distance(p0: { x: number; y: number }, p1: { x: number; y: number }): number {
    return Math.hypot(p1.x - p0.x, p1.y - p0.y);
  }

  /** Midpoint between two points. */
  static midpoint(
    p0: { x: number; y: number },
    p1: { x: number; y: number },
  ): { x: number; y: number } {
    return { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  }
}
