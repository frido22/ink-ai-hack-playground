// SmartCanvas interaction — captures ink strokes drawn over the element.
// Strokes arrive in canvas coordinates and are transformed to local
// coordinates (0–512 range) before being appended to overlayStrokes.

import type { Stroke, BoundingBox } from '../../types';
import type { SmartCanvasElement } from './types';
import { SMART_CANVAS_SIZE } from './types';
import type { InteractionResult } from '../registry/ElementPlugin';
import { boundingBoxesIntersect } from '../../types/primitives';
import { debugLog } from '../../debug/DebugLogger';

export function isInterestedIn(
  element: SmartCanvasElement,
  _strokes: Stroke[],
  strokeBounds: BoundingBox,
): boolean {
  const tx = element.transform.values[6];
  const ty = element.transform.values[7];
  const right = tx + SMART_CANVAS_SIZE * element.scaleX;
  const bottom = ty + SMART_CANVAS_SIZE * element.scaleY;
  const elementBounds: BoundingBox = { left: tx, top: ty, right, bottom };

  if (!boundingBoxesIntersect(elementBounds, strokeBounds)) return false;

  // Require stroke centroid inside element bounds
  let sumX = 0, sumY = 0, count = 0;
  for (const stroke of _strokes) {
    for (const input of stroke.inputs.inputs) {
      sumX += input.x;
      sumY += input.y;
      count++;
    }
  }
  if (count === 0) return false;
  const cx = sumX / count;
  const cy = sumY / count;
  return cx >= tx && cx <= right && cy >= ty && cy <= bottom;
}

export async function acceptInk(
  element: SmartCanvasElement,
  strokes: Stroke[],
): Promise<InteractionResult> {
  const tx = element.transform.values[6];
  const ty = element.transform.values[7];
  const { scaleX, scaleY } = element;

  // Transform strokes to local coordinates (0–SMART_CANVAS_SIZE range)
  const localStrokes = strokes.map(stroke => ({
    ...stroke,
    inputs: {
      ...stroke.inputs,
      inputs: stroke.inputs.inputs.map(input => ({
        ...input,
        x: (input.x - tx) / scaleX,
        y: (input.y - ty) / scaleY,
      })),
    },
  }));

  const newElement: SmartCanvasElement = {
    ...element,
    overlayStrokes: [...element.overlayStrokes, ...localStrokes],
  };

  console.log('[SmartCanvas] acceptInk: captured', strokes.length, 'strokes, total now:', newElement.overlayStrokes.length);
  debugLog.info('SmartCanvas: stroke captured', {
    elementId: element.id.slice(0, 8),
    strokesAdded: strokes.length,
    totalOverlayStrokes: newElement.overlayStrokes.length,
  });

  return {
    element: newElement,
    consumed: true,
    strokesConsumed: strokes,
  };
}
