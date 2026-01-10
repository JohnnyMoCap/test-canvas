/**
 * Color manipulation utilities
 */
export class ColorUtils {
  /**
   * Converts a color string to hsla/rgba with specified alpha
   * Supports hex, rgb, rgba, hsl, and hsla formats
   */
  static addAlphaToColor(color: string, alpha: number): string {
    // Handle hex colors
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      let r: number = 255,
        g: number = 255,
        b: number = 255;

      if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
      } else if (hex.length === 6 || hex.length === 8) {
        // Parse first 6 chars for RGB, ignore alpha if present
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
      }

      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    // Handle hsl/hsla colors
    if (color.startsWith('hsl')) {
      const match = color.match(/hsla?\(([^,]+),\s*([^,]+),\s*([^)]+)/);
      if (match) {
        return `hsla(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})`;
      }
    }

    // Handle rgb/rgba colors
    if (color.startsWith('rgb')) {
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (match) {
        return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})`;
      }
    }

    // Fallback
    return `rgba(255, 255, 255, ${alpha})`;
  }
}
