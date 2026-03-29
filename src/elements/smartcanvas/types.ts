import type { TransformableElement } from '../../types/primitives';
import type { Stroke } from '../../types/brush';
import { generateId } from '../../types/primitives';

export const SMART_CANVAS_SIZE = 512;

export interface DetectedIntent {
  action: 'enhance' | 'modify' | 'animate' | 'none';
  instruction: string;
  motionDescription?: string;
  durationSeconds?: number;
}

export type SmartCanvasStatus =
  | 'idle'
  | 'detecting'
  | 'generating'
  | 'done';

export interface SmartCanvasElement extends TransformableElement {
  type: 'smartCanvas';

  overlayStrokes: Stroke[];
  processedStrokeCount: number;

  bitmapDataUrl: string;
  videoUrl: string;
  videoDurationMs: number;

  status: SmartCanvasStatus;
  lastIntent: DetectedIntent | null;

  scaleX: number;
  scaleY: number;
}

export function createSmartCanvasElement(
  canvasX: number,
  canvasY: number,
): SmartCanvasElement {
  return {
    type: 'smartCanvas',
    id: generateId(),
    transform: {
      values: [1, 0, 0, 0, 1, 0, canvasX, canvasY, 1],
    },
    overlayStrokes: [],
    processedStrokeCount: 0,
    bitmapDataUrl: '',
    videoUrl: '',
    videoDurationMs: 0,
    status: 'idle',
    lastIntent: null,
    scaleX: 1,
    scaleY: 1,
  };
}
