import { Box } from '../../../intefaces/boxes.interface';
import { Camera } from '../core/types';
import { CoordinateTransform } from '../utils/coordinate-transform';
import { MagicDetectionUtils } from '../utils/magic-detection-utils';
import { HistoryService } from '../../../services/history.service';
import { BoxCreationUtils } from '../utils/box-creation-utils';

/**
 * Handler for magic detection operations
 * Layer 3: Business Logic
 */
export class MagicDetectionHandler {
  /**
   * Detect and create a box from a clicked region
   */
  static detectAndCreateBox(
    e: PointerEvent,
    canvas: HTMLCanvasElement,
    bgCanvas: HTMLCanvasElement,
    camera: Camera,
    devicePixelRatio: number,
    tolerance: number,
    nextTempId: number,
    historyService: HistoryService,
    debug: boolean = false,
  ): Box | null {
    const startTime = performance.now();

    if (debug) {
      console.log('🎯 Magic detection triggered');
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = (e.clientX - rect.left) * devicePixelRatio;
    const screenY = (e.clientY - rect.top) * devicePixelRatio;

    const worldPos = CoordinateTransform.screenToWorld(
      screenX,
      screenY,
      canvas.width,
      canvas.height,
      camera,
    );

    // Convert world coordinates (centered at 0,0) back to pixel coordinates (0,0 at top-left)
    const pixelX = worldPos.x + bgCanvas.width / 2;
    const pixelY = worldPos.y + bgCanvas.height / 2;

    // Clamp to background bounds
    const clampedX = Math.max(0, Math.min(bgCanvas.width - 1, Math.floor(pixelX)));
    const clampedY = Math.max(0, Math.min(bgCanvas.height - 1, Math.floor(pixelY)));

    if (debug) {
      console.log('📍 Click position:', {
        screen: { x: e.clientX, y: e.clientY },
        world: { x: worldPos.x.toFixed(1), y: worldPos.y.toFixed(1) },
        pixel: { x: pixelX.toFixed(1), y: pixelY.toFixed(1) },
        clamped: { x: clampedX, y: clampedY },
        backgroundSize: { w: bgCanvas.width, h: bgCanvas.height },
        zoom: camera.zoom.toFixed(2),
      });
    }

    // Get image data from background canvas
    const bgCtx = bgCanvas.getContext('2d');
    if (!bgCtx) {
      if (debug) console.log('❌ No background context');
      return null;
    }

    const imageData = bgCtx.getImageData(0, 0, bgCanvas.width, bgCanvas.height);

    // Detect region with tolerance
    const result = MagicDetectionUtils.detectRegion(
      imageData,
      clampedX,
      clampedY,
      tolerance,
      debug,
    );

    const detectionTime = performance.now() - startTime;

    if (result) {
      //TODO: make it use this
      // const newBox = BoxCreationUtils.createBoxFromContextMenu(
      //       'magic',
      //       wp.worldPos.x,
      //       wp.worldPos.y,
      //       this.camera(),
      //       bgc.width,
      //       bgc.height,
      //       BoxCreationUtils.generateTempId(this.state.nextTempId()),
      //     );
      const newBox = MagicDetectionUtils.createBoxFromDetection(
        result,
        nextTempId,
        bgCanvas.width,
        bgCanvas.height,
      );

      if (debug) {
        console.log('✅ Detection successful:', {
          //pixelCount: result.points.length,
          boundingBox: {
            center: { x: result.x.toFixed(1), y: result.y.toFixed(1) },
            size: { w: result.width.toFixed(1), h: result.height.toFixed(1) },
            area: (result.width * result.height).toFixed(0),
          },
          normalized: {
            x: newBox.x.toFixed(4),
            y: newBox.y.toFixed(4),
            w: newBox.w.toFixed(4),
            h: newBox.h.toFixed(4),
          },
          rotation: (result.rotation * (180 / Math.PI)).toFixed(1) + '°',
          detectionTime: detectionTime.toFixed(2) + 'ms',
          tolerance: tolerance,
        });
      }

      historyService.recordAdd(newBox);
      return newBox;
    } else {
      if (debug) {
        console.log('❌ No region detected (time: ' + detectionTime.toFixed(2) + 'ms)');
      }
      return null;
    }
  }
}
