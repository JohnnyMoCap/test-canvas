import { BoxCreationUtils } from './box-creation-utils';
import { BoxUtils } from './box-utils';
import type { MagicWorkerResult } from '../workers/magic-detection.types';
import { Box } from '../../../interface/boxes.interface';

export class MagicDetectionUtils {
  static createBoxFromDetection(
    result: Extract<MagicWorkerResult, { success: true }>,
    tempId: number,
    bgWidth: number,
    bgHeight: number,
  ): Box {
    const absX = result.centerX - bgWidth / 2;
    const absY = result.centerY - bgHeight / 2;
    const normalizedPos = BoxUtils.absoluteToNormalized(absX, absY, bgWidth, bgHeight);
    const normalizedDims = BoxUtils.absoluteDimensionsToNormalized(
      result.bboxWidth,
      result.bboxHeight,
      bgWidth,
      bgHeight,
    );
    return {
      tempId: BoxCreationUtils.generateTempId(tempId),
      x: normalizedPos.x,
      y: normalizedPos.y,
      w: normalizedDims.w,
      h: normalizedDims.h,
      rotation: result.rotation,
      color: `hsl(${Math.floor((25 / 50) * 360)}, 70%, 50%)`,
    };
  }
}
