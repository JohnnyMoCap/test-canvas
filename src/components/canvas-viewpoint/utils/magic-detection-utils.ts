import { Box } from '../../../intefaces/boxes.interface';
import { BoxUtils } from './box-utils';

interface DetectionResult {
  x: number; // Center X in pixels
  y: number; // Center Y in pixels
  width: number; // Total width in pixels
  height: number; // Total height in pixels
  rotation: number;
  points: { x: number; y: number }[]; // All pixels found
}

export class MagicDetectionUtils {
  /**
   * Detect a region around the clicked point based on color similarity
   */
  static detectRegion(
    imageData: ImageData,
    clickX: number,
    clickY: number,
    tolerance: number = 30,
    log: boolean = false,
    maxPixels: number = 500000,
  ): DetectionResult | null {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    // Validate click position
    if (clickX < 0 || clickX >= width || clickY < 0 || clickY >= height) {
      if (log) console.log('❌ Click outside image bounds:', { clickX, clickY, width, height });
      return null;
    }

    // Get center pixel color first
    const centerIdx = (clickY * width + clickX) * 4;
    const centerColor = {
      r: data[centerIdx],
      g: data[centerIdx + 1],
      b: data[centerIdx + 2],
      a: data[centerIdx + 3],
    };

    // Check if center pixel is transparent or invalid
    if (centerColor.a < 10) {
      if (log) console.log('❌ Center pixel is transparent:', centerColor);
      return null;
    }

    // Sample a small area around click to get average color (more robust)
    // Use smaller radius near edges to avoid sampling outside region
    const distToEdge = Math.min(clickX, clickY, width - clickX - 1, height - clickY - 1);
    const sampleRadius = Math.min(2, Math.floor(distToEdge / 2));
    const seedColor = this.getSampleColor(data, width, height, clickX, clickY, sampleRadius);

    if (log) {
      console.log('🎨 Detection params:', {
        clickPos: { x: clickX, y: clickY },
        centerPixel: centerColor,
        seedColor: seedColor,
        sampleRadius: sampleRadius,
        tolerance: tolerance,
        imageSize: { w: width, h: height },
      });
    }

    // Flood fill to find similar region
    const visited = new Set<number>();
    const region: { x: number; y: number }[] = [];
    const queue: { x: number; y: number }[] = [{ x: clickX, y: clickY }];
    const edgePixels: { x: number; y: number; color: any; distance: number }[] = [];
    const rejectedSamples: any[] = [];

    let queueIndex = 0; // Use index instead of shift() for O(1) performance

    while (queueIndex < queue.length && region.length < maxPixels) {
      const { x, y } = queue[queueIndex++];
      const key = y * width + x;

      if (visited.has(key)) continue;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;

      visited.add(key); // Mark visited before checking color to avoid re-queueing

      const idx = key * 4;
      const color = { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
      const distance = this.colorDistance(seedColor, color);

      // Check color similarity
      if (distance > tolerance) {
        edgePixels.push({ x, y, color, distance });
        if (log && rejectedSamples.length < 10) {
          rejectedSamples.push({ x, y, color, distance: distance.toFixed(1) });
        }
        continue;
      }

      region.push({ x, y });

      // Add neighbors (8-connected for smoother boundaries)
      // Only add if not already visited to reduce queue size
      const neighbors = [
        { x: x + 1, y },
        { x: x - 1, y },
        { x, y: y + 1 },
        { x, y: y - 1 },
        { x: x + 1, y: y + 1 },
        { x: x + 1, y: y - 1 },
        { x: x - 1, y: y + 1 },
        { x: x - 1, y: y - 1 },
      ];

      for (const n of neighbors) {
        const nKey = n.y * width + n.x;
        if (!visited.has(nKey)) {
          queue.push(n);
        }
      }
    }

    if (log) {
      console.log('🔍 Flood fill complete:', {
        pixelsFound: region.length,
        maxReached: region.length >= maxPixels,
        visited: visited.size,
        queueSize: queue.length,
        edgePixels: edgePixels.length,
        rejectedSamples: rejectedSamples.slice(0, 5),
      });
    }

    if (region.length < 10) {
      if (log) console.log('❌ Region too small (<10 pixels):', region.length);
      return null;
    }

    return this.calculateBoundingBox(region, log);
  }

  /**
   * Get average color from a sample area (more robust than single pixel)
   */
  private static getSampleColor(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    x: number,
    y: number,
    radius: number = 2,
  ): { r: number; g: number; b: number } {
    let rSum = 0,
      gSum = 0,
      bSum = 0,
      count = 0;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px >= 0 && px < width && py >= 0 && py < height) {
          const idx = (py * width + px) * 4;
          rSum += data[idx];
          gSum += data[idx + 1];
          bSum += data[idx + 2];
          count++;
        }
      }
    }

    return {
      r: Math.round(rSum / count),
      g: Math.round(gSum / count),
      b: Math.round(bSum / count),
    };
  }

  /**
   * Calculate Euclidean color distance
   */
  private static colorDistance(
    c1: { r: number; g: number; b: number },
    c2: { r: number; g: number; b: number },
  ): number {
    const dr = c1.r - c2.r;
    const dg = c1.g - c2.g;
    const db = c1.b - c2.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  /**
   * Check if two colors are similar within tolerance
   */
  private static isColorSimilar(
    c1: { r: number; g: number; b: number },
    c2: { r: number; g: number; b: number },
    tolerance: number,
  ): boolean {
    return this.colorDistance(c1, c2) <= tolerance;
  }

  /**
   * Calculate bounding box with rotation from detected points
   */
  private static calculateBoundingBox(
    points: { x: number; y: number }[],
    log: boolean = false,
  ): DetectionResult {
    // Find axis-aligned bounding box using loops (avoid stack overflow with spread operator)
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    // Calculate base dimensions (no padding for exact fit)
    const width = maxX - minX + 1; // +1 to include the pixels themselves
    const height = maxY - minY + 1;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // Calculate rotation using PCA (Principal Component Analysis)
    const rotation = this.calculateRotationPCA(points);

    if (log) {
      console.log('📦 Bounding box calculated:', {
        bounds: { minX, maxX, minY, maxY },
        center: { x: centerX.toFixed(1), y: centerY.toFixed(1) },
        size: { w: width, h: height },
        aspectRatio: (width / height).toFixed(2),
        rotation: ((rotation * 180) / Math.PI).toFixed(1) + '°',
        pixelCount: points.length,
        density: ((points.length / (width * height)) * 100).toFixed(1) + '%',
      });
    }

    return {
      x: centerX,
      y: centerY,
      width: width,
      height: height,
      rotation,
      points,
    };
  }

  /**
   * Calculate rotation angle using Principal Component Analysis
   */
  private static calculateRotationPCA(points: { x: number; y: number }[]): number {
    if (points.length < 3) return 0;

    // Calculate centroid
    const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;

    // Calculate covariance matrix components
    let cxx = 0,
      cxy = 0,
      cyy = 0;
    for (const p of points) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      cxx += dx * dx;
      cxy += dx * dy;
      cyy += dy * dy;
    }

    // Normalize
    cxx /= points.length;
    cxy /= points.length;
    cyy /= points.length;

    // Find principal axis angle
    // If the region is roughly circular, don't rotate
    if (Math.abs(cxx - cyy) < 0.01 && Math.abs(cxy) < 0.01) {
      return 0;
    }

    const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    return angle;
  }

  /**
   * Create a box from detection result
   */
  static createBoxFromDetection(
    result: DetectionResult,
    tempId: number,
    bgWidth: number,
    bgHeight: number,
    type: string = 'note',
  ): Box {
    // Convert pixel coordinates to world coordinates (centered at origin)
    const worldX = result.x - bgWidth / 2;
    const worldY = result.y - bgHeight / 2;

    // Convert to normalized coordinates
    const normalizedPos = BoxUtils.worldToNormalized(worldX, worldY, bgWidth, bgHeight);
    const normalizedDims = BoxUtils.worldDimensionsToNormalized(
      result.width,
      result.height,
      bgWidth,
      bgHeight,
    );

    return {
      tempId: `temp_${tempId}`,
      x: normalizedPos.x,
      y: normalizedPos.y,
      w: normalizedDims.w,
      h: normalizedDims.h,
      rotation: result.rotation,
      color: `hsl(${Math.floor((25 / 50) * 360)}, 70%, 50%)`,
    };
  }
}
