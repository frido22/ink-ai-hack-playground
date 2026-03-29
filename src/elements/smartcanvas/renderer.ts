// SmartCanvas renderer — draws image/video, overlay strokes, status indicators.
//
// Visual states:
// - idle: white canvas + strokes + grey border
// - detecting: blue border + "Understanding..." spinner
// - generating: orange border + "Creating..." spinner
// - done: green flash → grey border, shows AI image or video

import type { BoundingBox, Stroke } from '../../types';
import type { SmartCanvasElement } from './types';
import { SMART_CANVAS_SIZE } from './types';
import { renderStrokes } from '../../canvas/StrokeRenderer';
import type { RenderOptions } from '../registry/ElementPlugin';

// ── Image cache (LRU, same pattern as SketchableImage) ──

const MAX_CACHE = 10;
const imageCache = new Map<string, HTMLImageElement>();

function getOrLoadImage(dataUrl: string): HTMLImageElement | null {
  if (!dataUrl) return null;
  const cached = imageCache.get(dataUrl);
  if (cached?.complete) {
    imageCache.delete(dataUrl);
    imageCache.set(dataUrl, cached);
    return cached;
  }
  if (!cached) {
    if (imageCache.size >= MAX_CACHE) {
      const oldest = imageCache.keys().next().value;
      if (oldest !== undefined) imageCache.delete(oldest);
    }
    const img = new Image();
    img.src = dataUrl;
    imageCache.set(dataUrl, img);
  }
  return null;
}

export async function preloadImage(dataUrl: string): Promise<void> {
  if (!dataUrl) return;
  const existing = imageCache.get(dataUrl);
  if (existing?.complete) return;
  if (imageCache.size >= MAX_CACHE) {
    const oldest = imageCache.keys().next().value;
    if (oldest !== undefined) imageCache.delete(oldest);
  }
  const img = new Image();
  img.src = dataUrl;
  imageCache.set(dataUrl, img);
  await img.decode();
}

export async function composeSmartCanvasImage(
  baseDataUrl: string,
  overlayStrokes: Stroke[],
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = SMART_CANVAS_SIZE;
  canvas.height = SMART_CANVAS_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to create 2D context for Smart Canvas compositing');

  if (baseDataUrl) {
    await preloadImage(baseDataUrl);
    const baseImage = imageCache.get(baseDataUrl);
    if (!baseImage?.complete) {
      throw new Error('Failed to load base image for Smart Canvas compositing');
    }
    ctx.drawImage(baseImage, 0, 0, SMART_CANVAS_SIZE, SMART_CANVAS_SIZE);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SMART_CANVAS_SIZE, SMART_CANVAS_SIZE);
  }

  if (overlayStrokes.length > 0) {
    renderStrokes(ctx, overlayStrokes);
  }

  return canvas.toDataURL('image/png');
}

export async function normalizeSmartCanvasLineArt(dataUrl: string): Promise<string> {
  if (!dataUrl) return dataUrl;

  await preloadImage(dataUrl);
  const img = imageCache.get(dataUrl);
  if (!img?.complete) {
    throw new Error('Failed to load Smart Canvas image for normalization');
  }

  const canvas = document.createElement('canvas');
  canvas.width = SMART_CANVAS_SIZE;
  canvas.height = SMART_CANVAS_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to create 2D context for Smart Canvas normalization');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SMART_CANVAS_SIZE, SMART_CANVAS_SIZE);
  ctx.drawImage(img, 0, 0, SMART_CANVAS_SIZE, SMART_CANVAS_SIZE);

  const imageData = ctx.getImageData(0, 0, SMART_CANVAS_SIZE, SMART_CANVAS_SIZE);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
      continue;
    }

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    let gray: number;
    if (luminance >= 235) {
      gray = 255;
    } else if (luminance >= 205) {
      gray = Math.round(255 - (235 - luminance) * 1.15);
    } else {
      gray = Math.max(0, Math.round(luminance * 0.92));
    }

    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
    data[i + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

// ── Video element cache ──

const videoElements = new Map<string, { video: HTMLVideoElement; src: string }>();

function getOrCreateVideo(elementId: string, videoUrl: string): HTMLVideoElement {
  const existing = videoElements.get(elementId);
  if (existing && existing.src === videoUrl) return existing.video;

  if (existing) {
    releaseSmartCanvasVideo(elementId);
  }

  const video = document.createElement('video');
  video.src = videoUrl;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.play().catch(() => { /* autoplay may need user gesture */ });
  videoElements.set(elementId, { video, src: videoUrl });
  return video;
}

export function releaseSmartCanvasVideo(elementId: string): void {
  const existing = videoElements.get(elementId);
  if (!existing) return;
  existing.video.pause();
  existing.video.removeAttribute('src');
  existing.video.load();
  videoElements.delete(elementId);
}

export function hasActiveSmartCanvasVideos(): boolean {
  for (const { video } of videoElements.values()) {
    if (!video.paused && !video.ended) return true;
  }
  return false;
}

// ── Cross-fade transition ──

const TRANSITION_MS = 800;
const lastBitmap = new Map<string, string>();
const transitions = new Map<string, { from: string; to: string; start: number }>();

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function hasActiveSmartCanvasTransitions(): boolean {
  return transitions.size > 0;
}

// ── Drawing helpers ──

function drawBitmapOrWhite(
  ctx: CanvasRenderingContext2D, dataUrl: string, w: number, h: number,
): void {
  const img = getOrLoadImage(dataUrl);
  if (img) {
    ctx.drawImage(img, 0, 0, w, h);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
}

function drawSpinner(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
  const angle = (performance.now() / 600) % (2 * Math.PI);
  ctx.beginPath();
  ctx.arc(cx, cy, 10, angle, angle + Math.PI * 1.3);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function drawStatusLabel(ctx: CanvasRenderingContext2D, w: number, label: string): void {
  ctx.font = '12px system-ui, sans-serif';
  const metrics = ctx.measureText(label);
  const pad = 6;
  const bw = metrics.width + pad * 2;
  const x = w - bw - 8;
  const y = 28;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.roundRect(x, y, bw, 20, 4);
  ctx.fill();

  ctx.fillStyle = '#333';
  ctx.fillText(label, x + pad, y + 14);
}

function drawPlayIcon(ctx: CanvasRenderingContext2D, h: number): void {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.beginPath();
  ctx.roundRect(8, h - 28, 20, 20, 4);
  ctx.fill();
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.moveTo(14, h - 23);
  ctx.lineTo(14, h - 13);
  ctx.lineTo(23, h - 18);
  ctx.closePath();
  ctx.fill();
}

// ── Main render ──

export function render(
  ctx: CanvasRenderingContext2D,
  element: SmartCanvasElement,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options?: RenderOptions,
): void {
  const tx = element.transform.values[6];
  const ty = element.transform.values[7];
  const { scaleX, scaleY } = element;
  const w = SMART_CANVAS_SIZE * scaleX;
  const h = SMART_CANVAS_SIZE * scaleY;

  ctx.save();
  ctx.translate(tx, ty);

  // Cross-fade detection
  const prev = lastBitmap.get(element.id);
  if (prev !== undefined && element.bitmapDataUrl && prev !== element.bitmapDataUrl) {
    transitions.set(element.id, { from: prev, to: element.bitmapDataUrl, start: performance.now() });
  }
  lastBitmap.set(element.id, element.bitmapDataUrl);

  const trans = transitions.get(element.id);
  let tp = -1;
  if (trans) {
    tp = Math.min((performance.now() - trans.start) / TRANSITION_MS, 1);
    if (tp >= 1) transitions.delete(element.id);
  }

  // Draw content
  if (element.videoUrl) {
    const video = getOrCreateVideo(element.id, element.videoUrl);
    if (video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, w, h);
    } else {
      drawBitmapOrWhite(ctx, element.bitmapDataUrl, w, h);
    }
  } else if (tp >= 0 && tp < 1) {
    const alpha = easeOutCubic(tp);
    ctx.globalAlpha = 1 - alpha;
    drawBitmapOrWhite(ctx, trans!.from, w, h);
    ctx.globalAlpha = alpha;
    drawBitmapOrWhite(ctx, trans!.to, w, h);
    ctx.globalAlpha = 1;
  } else if (element.bitmapDataUrl) {
    drawBitmapOrWhite(ctx, element.bitmapDataUrl, w, h);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }

  // Overlay strokes: show all if no AI content, otherwise only new ones
  const strokeStart = (element.bitmapDataUrl || element.videoUrl)
    ? element.processedStrokeCount
    : 0;
  const strokesToDraw = element.overlayStrokes.slice(strokeStart);
  if (strokesToDraw.length > 0) {
    ctx.save();
    ctx.scale(scaleX, scaleY);
    renderStrokes(ctx, strokesToDraw);
    ctx.restore();
  }

  // Border
  const borderMap: Record<string, { color: string; width: number }> = {
    idle: { color: '#cccccc', width: 1 },
    detecting: { color: '#4a90d9', width: 3 },
    generating: { color: '#ff8c00', width: 3 },
    done: { color: '#4CAF50', width: 2 },
  };
  const border = borderMap[element.status] ?? borderMap.idle;
  ctx.strokeStyle = border.color;
  ctx.lineWidth = border.width;
  ctx.strokeRect(0, 0, w, h);

  // Spinner + status label
  if (element.status === 'detecting') {
    drawSpinner(ctx, w - 16, 16, '#4a90d9');
    drawStatusLabel(ctx, w, 'Understanding...');
  } else if (element.status === 'generating') {
    drawSpinner(ctx, w - 16, 16, '#ff8c00');
    const label = element.lastIntent?.action === 'animate'
      ? 'Animating...'
      : 'Creating...';
    drawStatusLabel(ctx, w, label);
  }

  // Video indicator
  if (element.videoUrl) {
    drawPlayIcon(ctx, h);
  }

  ctx.restore();
}

export function getBounds(element: SmartCanvasElement): BoundingBox | null {
  const tx = element.transform.values[6];
  const ty = element.transform.values[7];
  return {
    left: tx,
    top: ty,
    right: tx + SMART_CANVAS_SIZE * element.scaleX,
    bottom: ty + SMART_CANVAS_SIZE * element.scaleY,
  };
}
