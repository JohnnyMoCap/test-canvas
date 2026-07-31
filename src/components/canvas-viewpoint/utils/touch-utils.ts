/**
 * Shared helpers for touch-friendly hit-target sizing.
 *
 * Visual size of handles/points never changes on touch - only the invisible
 * hit-test radius grows, so touch targets meet standard tap-target guidance
 * without visually cluttering the box.
 */
export class TouchUtils {
  /** How much bigger a touch/pen hit-region is versus its visual size. */
  static readonly HIT_TARGET_MULTIPLIER = 2.5;

  /** True for input types that need enlarged hit-targets (touch and pen). */
  static isCoarsePointer(pointerType: string): boolean {
    return pointerType === 'touch' || pointerType === 'pen';
  }
}
