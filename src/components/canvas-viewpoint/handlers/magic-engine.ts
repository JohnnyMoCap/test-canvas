import { LabelingStateManager as StateManager } from '../utils/labeling-state-manager';

/** Which "magic wand" implementation is currently active - see LabelingStateManager.magicEngine. */
export type MagicEngineKind = 'classical' | 'ai-model';

/**
 * Common shape both magic-wand implementations satisfy, so
 * `PointerEventHandler` can dispatch a click to whichever is active without
 * knowing which one it is: `MagicDetectionHandler` (colour flood-fill,
 * `handlers/magic-detection.handler.ts`) and `SamMagicHandler` (SAM model,
 * `handlers/sam-magic.handler.ts`) both implement this.
 */
export interface MagicEngine {
  handlePointerDown(event: PointerEvent, canvas: HTMLCanvasElement, state: StateManager): void;
  destroy(): void;
}
