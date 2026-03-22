/**
 * Global test setup: polyfills for browser APIs not supported by jsdom.
 */

// Canvas 2D context mock — jsdom does not implement the Canvas API.
HTMLCanvasElement.prototype.getContext = function (
  contextId: string,
): CanvasRenderingContext2D | null {
  if (contextId === '2d') {
    return {
      scale: () => {},
      clearRect: () => {},
      drawImage: () => {},
      save: () => {},
      restore: () => {},
      setTransform: () => {},
      translate: () => {},
      rotate: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      fillText: () => {},
      measureText: () => ({ width: 0 } as TextMetrics),
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arc: () => {},
      closePath: () => {},
      stroke: () => {},
      fill: () => {},
      imageSmoothingEnabled: false,
    } as unknown as CanvasRenderingContext2D;
  }
  return null;
} as typeof HTMLCanvasElement.prototype.getContext;

// ResizeObserver mock — jsdom does not implement ResizeObserver.
(globalThis as Record<string, unknown>)['ResizeObserver'] = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// matchMedia mock — jsdom does not implement matchMedia.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
