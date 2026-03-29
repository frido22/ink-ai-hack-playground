# Smart Canvas Plugin — Implementation Plan

## Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| `types.ts` | Done | Element interface, factory, status types |
| `intentDetector.ts` | Done | Gemini 2.5 Flash vision, JSON intent output |
| `actions/enhance.ts` | Done | Image-to-image via Gemini 3.1 Flash Image |
| `actions/modify.ts` | Done | Image-to-image with user instruction |
| `actions/animate.ts` | Done | Video alpha API with Veo 3.1 |
| `interaction.ts` | Done | Stroke capture + local coord transform |
| `renderer.ts` | Done | 4-state visual feedback, cross-fade, video |
| `icon.tsx` | Done | SVG palette icon |
| `index.ts` | Done | Plugin + palette registration |
| `useSmartCanvasGeneration.ts` | Done | 4s debounce hook, full pipeline |
| `OpenRouterService.ts` | Done | `imageGeneration()`, `getOpenRouterApiKey()` |
| Core wiring (`App.tsx`, `InkCanvas.tsx`, `types/elements.ts`, `elements/index.ts`) | Done | |

### Bug Fixes Applied
- **OpenRouter transport**: Smart Canvas now sends chat/image requests via direct REST to `/api/v1/chat/completions`. Callers still use camelCase `imageUrl`, and `OpenRouterService.ts` maps that to REST `image_url` on the wire.
- **Image generation**: Uses `modalities: ['text', 'image']` and reads returned images from `message.images[].image_url.url` (with a compatibility fallback for camelCase).
- **Iterative workflow**: Follow-up requests are built from the current AI bitmap plus only the still-visible new strokes, so hidden old command text is not replayed into later generations.

### Known Limitations
- Video generation (animate action) uses OpenRouter alpha API — may be unstable
- API key is embedded in client bundle (acceptable for hackathon, not production)

> **Note**: Code samples below may be slightly outdated — always refer to the actual source files for the current implementation. Key difference: all SDK calls use `{ imageUrl: { url } }` not `{ type: 'image_url', image_url: { url } }`.

---

## The Idea

**Smart Canvas** is a new element plugin for Ink Playground that turns any drawing into an AI-powered canvas. You draw freely — a beach, a tree, anything — and the system stays passive. But the moment you write an instruction on the canvas (like "improve this", "add sunset", "4 second animation") or draw a recognizable control symbol (like a ▶ play button), the AI kicks in and executes your command.

### User Experience Examples

| You draw / write | What happens |
|-----------------|-------------|
| Beach scene + write "improve" | AI enhances drawing, keeps your sketch style |
| Beach + write "add sunset colors" | AI modifies scene with warm tones |
| Beach + write "animate 4s" | AI generates a 4-second video loop |
| Beach + draw ▶ play button | Same as "animate" — triggers animation |
| Beach + draw arrows on waves | AI animates with directional motion hints |
| Just draw, nothing else | Nothing happens — stays as your drawing |

### Why This Design

- **High agency**: the canvas understands natural intent — no menus, no buttons
- **One plugin, many actions**: enhance, modify, animate — all from the same element
- **Fits the ink philosophy**: instructions are drawn/written, not clicked
- **Impressive demo**: "the canvas understands me" is a much stronger story than a single-trick animation plugin

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Smart Canvas                      │
│                  (Element Plugin)                    │
│                                                     │
│  ┌──────────┐    ┌──────────────┐    ┌───────────┐ │
│  │ Renderer  │    │  Interaction │    │  Creator   │ │
│  │ - image   │    │  - captures  │    │ - palette  │ │
│  │ - video   │    │    strokes   │    │   entry    │ │
│  │ - spinner │    │  - debounce  │    │ - rect+X   │ │
│  │ - handles │    │    triggers  │    │   gesture  │ │
│  └──────────┘    │    intent    │    └───���───────┘ │
│                  │    detection │                    │
│                  └──────┬───────┘                    │
│                         │                            │
│              ┌──────────▼───────────┐                │
│              │   Intent Detector    │                │
│              │  (OpenRouter LLM)    │                │
│              │                      │                │
│              │  Sends composite     │                │
│              │  image to vision     │                │
│              │  model, gets back    ���                │
│              │  structured JSON     │                │
│              └���─────────┬───────────┘                │
│                         │                            │
│              ┌──────────▼───────────┐                │
│              │   Action Router      │                │
│              │                      │                │
│              │  "enhance" ──► Gemini image edit      │
│              │  "modify"  ──► Gemini image edit      │
│              │  "animate" ──► fal.ai Veo 3.1        │
│              │  "none"    ──► do nothing             │
│              └──────────────────────┘                │
└───────────────────────────────────────────��─────────┘
```

### Models Used

| Purpose | Model | Via | Why |
|---------|-------|-----|-----|
| **Intent detection** (read drawing + text, decide action) | `google/gemini-2.5-flash` | OpenRouter (already integrated) | Fast, cheap, great vision — understands handwritten text + drawings in one shot |
| **Image enhancement/modification** | `google/gemini-3.1-flash-image-preview` | OpenRouter | Best image-to-image editing at flash speed, keeps sketch style |
| **Video animation** | `fal-ai/veo3.1/image-to-video` | fal.ai (already integrated) | State of the art image-to-video, 4-8 second clips |

### How It Fits the Existing Repo

- **Plugin pattern**: follows `docs/New element HOWTO.md` exactly — self-contained in `src/elements/smartcanvas/`
- **No core changes**: uses `registerPlugin()` + `registerPaletteEntry()` — zero edits to App.tsx or dispatch logic
- **Reuses existing services**: `OpenRouterService.chatCompletionJSON()` for intent detection, `FalAiService` for video (extended), `compositing.ts` for image preparation
- **Reuses existing patterns**: image caching from SketchableImage renderer, cross-fade transitions, spinner animation, handle-based resizing
- **Hook pattern**: new `useSmartCanvasGeneration` hook following `useSketchableImageGeneration` pattern for debounced AI triggers

---

## File Structure

```
src/elements/smartcanvas/
├── types.ts              # SmartCanvasElement interface + factory
├── renderer.ts           # Render image/video, spinner, transitions
├── creator.ts            # (empty — creation via palette only)
├── interaction.ts        # Capture strokes, debounce, trigger intent detection
├── intentDetector.ts     # LLM call: composite image → structured action JSON
├── actions/
│   ├── enhance.ts        # Gemini image-to-image: enhance drawing
│   ���── modify.ts         # Gemini image-to-image: apply user instruction
│   └── animate.ts        # fal.ai Veo 3.1: image → video
├── icon.tsx              # Palette menu icon
└��─ index.ts              # Plugin wiring + registration

src/hooks/
└── useSmartCanvasGeneration.ts   # Debounced intent detection + action execution

src/services/
└── FalAiVideoService.ts          # NEW: fal.ai Veo 3.1 video generation client
```

Files to edit (1 line each):
- `src/elements/index.ts` — add `import './smartcanvas'`
- `src/types/elements.ts` — add `SmartCanvasElement` to union

---

## Detailed Implementation

### Step 1: Element Type (`types.ts`)

```typescript
import type { TransformableElement } from '../../types/primitives';
import type { Stroke } from '../../types/brush';
import { generateId } from '../../types/primitives';

export const SMART_CANVAS_SIZE = 512;

// The action the LLM detected from the user's strokes
export interface DetectedIntent {
  action: 'enhance' | 'modify' | 'animate' | 'none';
  instruction: string;      // human-readable description of what to do
  motionDescription?: string; // for animate: describes the motion
  durationSeconds?: number;   // for animate: requested duration (4, 6, or 8)
}

export type SmartCanvasStatus =
  | 'idle'           // just a drawing, no AI action happening
  | 'detecting'      // LLM is analyzing intent
  | 'generating'     // AI is producing image/video
  | 'done';          // has AI-generated content

export interface SmartCanvasElement extends TransformableElement {
  type: 'smartCanvas';

  // Drawing state
  overlayStrokes: Stroke[];        // all strokes drawn on canvas
  processedStrokeCount: number;    // strokes already sent to intent detection

  // AI output
  bitmapDataUrl: string;           // current image (enhanced/modified result)
  videoDataUrl: string;            // video blob URL (if animated)
  videoDurationMs: number;         // video duration in ms

  // UI state
  status: SmartCanvasStatus;
  lastIntent: DetectedIntent | null;

  // Layout
  scaleX: number;
  scaleY: number;
}

export function createSmartCanvasElement(
  canvasX: number,
  canvasY: number
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
    videoDataUrl: '',
    videoDurationMs: 0,
    status: 'idle',
    lastIntent: null,
    scaleX: 1,
    scaleY: 1,
  };
}
```

### Step 2: Intent Detector (`intentDetector.ts`)

This is the brain. It takes the composite drawing image and asks the LLM to decide what to do.

```typescript
import { chatCompletionJSON } from '../../ai/OpenRouterService';
import type { ChatMessage, JsonSchema } from '../../ai/OpenRouterService';
import type { DetectedIntent } from './types';

const INTENT_SCHEMA: { type: 'json_schema'; jsonSchema: JsonSchema } = {
  type: 'json_schema',
  jsonSchema: {
    name: 'smart_canvas_intent',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['enhance', 'modify', 'animate', 'none'],
          description:
            'enhance = improve quality/detail of the drawing. ' +
            'modify = change the scene based on a written instruction. ' +
            'animate = create a short video animation. ' +
            'none = no instruction detected, just a drawing.',
        },
        instruction: {
          type: 'string',
          description: 'Human-readable summary of what the user wants.',
        },
        motionDescription: {
          type: 'string',
          description:
            'Only for animate: describe the motion. Include arrow directions ' +
            'if arrows are drawn. E.g. "waves moving left to right, palm tree swaying"',
        },
        durationSeconds: {
          type: 'number',
          enum: [4, 6, 8],
          description: 'Only for animate: requested duration. Default 4.',
        },
      },
      required: ['action', 'instruction'],
      additionalProperties: false,
    },
  },
};

const SYSTEM_PROMPT = `You are an intent detector for a drawing canvas app.

You receive an image of a hand-drawn sketch. The sketch may contain:
1. A drawing (shapes, scenes, objects)
2. Handwritten text instructions (like "improve", "add sunset", "animate 4s")
3. Control symbols (a play button ▶ triangle means "animate")
4. Arrows drawn on objects (indicate direction of motion for animation)

Your job: determine what the user wants.

Rules:
- If there is NO text instruction, NO play button, and NO arrows → action is "none"
- Text like "improve", "enhance", "make better" → action is "enhance"
- Text describing a change like "add sunset", "make it night", "add birds" → action is "modify"
- Text like "animate", "animate 4s", "move", or a drawn ▶ play button, or arrows on objects → action is "animate"
- For animate: if arrows are present, describe their direction relative to the objects they're on
- For animate: if a duration is mentioned (e.g. "5 seconds", "4s"), use the closest valid value (4, 6, or 8)
- For animate: default duration is 4 seconds
- Separate the DRAWING CONTENT from the INSTRUCTION. The instruction describes what to do, not what's drawn.
- Be conservative: if you're not sure there's an instruction, return "none"`;

export async function detectIntent(
  compositeImageDataUrl: string
): Promise<DetectedIntent> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: compositeImageDataUrl },
        },
        {
          type: 'text',
          text: 'What does the user want to do with this drawing? Analyze any handwritten text, symbols, or arrows.',
        },
      ],
    },
  ];

  const result = await chatCompletionJSON<DetectedIntent>(messages, {
    model: 'google/gemini-2.5-flash',
    temperature: 0.1,
    responseFormat: INTENT_SCHEMA,
  });

  return result;
}
```

**Key design decisions:**
- Uses `google/gemini-2.5-flash` via OpenRouter — fast, cheap, excellent vision
- Structured JSON output via `json_schema` — no fragile parsing
- Temperature 0.1 — deterministic, conservative intent detection
- The system prompt explicitly separates drawing content from instructions
- Conservative: returns "none" when unsure (prevents unwanted AI actions)

### Step 3: Action Handlers (`actions/`)

#### `actions/enhance.ts` — Improve the drawing

```typescript
import { chatCompletion } from '../../../ai/OpenRouterService';
import type { ChatMessage } from '../../../ai/OpenRouterService';

// Uses Gemini 3.1 Flash Image via OpenRouter for image-to-image editing.
// This model accepts image input + text prompt and returns a modified image.
const IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';

export async function enhanceDrawing(
  compositeImageDataUrl: string,
): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: compositeImageDataUrl },
        },
        {
          type: 'text',
          text:
            'Enhance this hand-drawn sketch. Add detail, depth, and polish ' +
            'while preserving the original composition and hand-drawn character. ' +
            'Do NOT make it photorealistic — keep it looking like an improved sketch. ' +
            'Do NOT add new objects. Only improve what is already there. ' +
            'Remove any handwritten text instructions (like "improve" or "enhance") ' +
            'as those are commands, not part of the drawing.',
        },
      ],
    },
  ];

  // Gemini image models return the image as base64 in the response.
  // OpenRouter passes through the response including image data.
  const result = await chatCompletion(messages, {
    model: IMAGE_MODEL,
    temperature: 0.4,
  });

  // The response from Gemini image model via OpenRouter contains
  // the image as a base64 data URL in a markdown image tag or
  // as inline data. Parse accordingly.
  return extractImageFromResponse(result);
}

// Extracts base64 image data URL from the model response.
// Gemini image models return images as base64 inline data.
// The exact format depends on how OpenRouter proxies the response.
//
// IMPORTANT: This function needs testing against the actual OpenRouter
// response format for Gemini image models. The response may come as:
// 1. A markdown image: ![](data:image/png;base64,...)
// 2. Raw base64 with a content type header
// 3. A JSON object with inlineData
//
// Test with a real API call and adapt parsing accordingly.
function extractImageFromResponse(response: string): string {
  // Try markdown image pattern
  const markdownMatch = response.match(/!\[.*?\]\((data:image\/[^)]+)\)/);
  if (markdownMatch) return markdownMatch[1];

  // Try raw base64 (if response is just the base64 string)
  if (response.startsWith('data:image/')) return response;

  // Try JSON with inlineData
  try {
    const parsed = JSON.parse(response);
    if (parsed.inlineData?.data) {
      const mime = parsed.inlineData.mimeType || 'image/png';
      return `data:${mime};base64,${parsed.inlineData.data}`;
    }
  } catch {
    // Not JSON, continue
  }

  throw new Error('Could not extract image from Gemini response');
}
```

#### `actions/modify.ts` — Change the scene

```typescript
import { chatCompletion } from '../../../ai/OpenRouterService';
import type { ChatMessage } from '../../../ai/OpenRouterService';

const IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';

export async function modifyDrawing(
  compositeImageDataUrl: string,
  instruction: string,
): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: compositeImageDataUrl },
        },
        {
          type: 'text',
          text:
            `Modify this hand-drawn sketch according to this instruction: "${instruction}". ` +
            'Keep the original drawing style and composition. ' +
            'Do NOT make it photorealistic — maintain the hand-drawn aesthetic. ' +
            'Remove any handwritten text instructions from the image ' +
            'as those are commands, not part of the drawing.',
        },
      ],
    },
  ];

  const result = await chatCompletion(messages, {
    model: IMAGE_MODEL,
    temperature: 0.5,
  });

  return extractImageFromResponse(result);
}

// Same extraction logic as enhance.ts — shared utility (see Step 7)
function extractImageFromResponse(response: string): string {
  const markdownMatch = response.match(/!\[.*?\]\((data:image\/[^)]+)\)/);
  if (markdownMatch) return markdownMatch[1];
  if (response.startsWith('data:image/')) return response;
  try {
    const parsed = JSON.parse(response);
    if (parsed.inlineData?.data) {
      const mime = parsed.inlineData.mimeType || 'image/png';
      return `data:${mime};base64,${parsed.inlineData.data}`;
    }
  } catch { /* not JSON */ }
  throw new Error('Could not extract image from Gemini response');
}
```

#### `actions/animate.ts` — Generate video

```typescript
import { getFalAiVideoService } from '../../../services/FalAiVideoService';

export interface AnimationResult {
  videoDataUrl: string;      // blob URL for <video> playback
  durationMs: number;
  // Also save a poster frame (first frame) as static fallback
  posterDataUrl: string;
}

export async function animateDrawing(
  compositeImageDataUrl: string,
  motionDescription: string,
  durationSeconds: number,
  signal: AbortSignal,
): Promise<AnimationResult> {
  // Build a prompt that preserves the sketch style
  const prompt =
    `Gently animate this hand-drawn sketch: ${motionDescription}. ` +
    'Keep the hand-drawn aesthetic. Subtle, natural motion only. ' +
    'Do not transform the art style. The sketch should look alive but still sketchy. ' +
    'Remove any handwritten text overlays — those are instructions, not part of the scene.';

  const validDurations = [4, 6, 8] as const;
  type ValidDuration = typeof validDurations[number];
  const duration: ValidDuration = validDurations.includes(durationSeconds as ValidDuration)
    ? (durationSeconds as ValidDuration)
    : 4;

  const service = getFalAiVideoService();
  const result = await service.generateVideo(
    {
      imageDataUrl: compositeImageDataUrl,
      prompt,
      duration: `${duration}s` as '4s' | '6s' | '8s',
    },
    signal,
  );

  return {
    videoDataUrl: result.videoDataUrl,
    durationMs: duration * 1000,
    posterDataUrl: compositeImageDataUrl, // use the input drawing as poster
  };
}
```

### Step 4: Video Service (`src/services/FalAiVideoService.ts`)

New service file, follows the same singleton + fake pattern as `FalAiService.ts`:

```typescript
/*
 * fal.ai video generation service (Veo 3.1 image-to-video)
 *
 * Real implementation calls fal-ai/veo3.1/image-to-video endpoint.
 * Fake implementation returns a static poster for local development.
 *
 * WARNING: The API key (INK_FAL_AI_API_KEY) is embedded into the client
 * bundle at build time. Only use a scoped, low-privilege, rate-limited key.
 */

export interface GenerateVideoRequest {
  imageDataUrl: string;
  prompt: string;
  duration: '4s' | '6s' | '8s';
}

export interface GenerateVideoResult {
  videoDataUrl: string;  // blob URL for local playback
}

export interface FalAiVideoServiceInterface {
  generateVideo(
    request: GenerateVideoRequest,
    signal: AbortSignal,
  ): Promise<GenerateVideoResult>;
}

class FalAiVideoService implements FalAiVideoServiceInterface {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateVideo(
    request: GenerateVideoRequest,
    signal: AbortSignal,
  ): Promise<GenerateVideoResult> {
    // Step 1: Upload the image to fal.ai storage (they need a URL, not base64)
    const imageUrl = await this.uploadImage(request.imageDataUrl, signal);

    // Step 2: Submit video generation job
    const submitResponse = await fetch(
      'https://queue.fal.run/fal-ai/veo3.1/image-to-video',
      {
        method: 'POST',
        headers: {
          Authorization: `Key ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: request.prompt,
          image_url: imageUrl,
          duration: request.duration,
          resolution: '720p',
          generate_audio: false,
          safety_tolerance: '4',
        }),
        signal,
      },
    );

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text().catch(() => '');
      throw new Error(`fal.ai video submit failed (${submitResponse.status}): ${errorText}`);
    }

    const { request_id } = await submitResponse.json();

    // Step 3: Poll for completion
    const videoUrl = await this.pollForResult(request_id, signal);

    // Step 4: Download video and create blob URL for local playback
    const videoResponse = await fetch(videoUrl, { signal });
    if (!videoResponse.ok) {
      throw new Error(`Failed to download video: ${videoResponse.status}`);
    }
    const videoBlob = await videoResponse.blob();
    const videoBlobUrl = URL.createObjectURL(videoBlob);

    return { videoDataUrl: videoBlobUrl };
  }

  private async uploadImage(dataUrl: string, signal: AbortSignal): Promise<string> {
    // Convert data URL to blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    // Upload to fal.ai storage
    const formData = new FormData();
    formData.append('file', blob, 'input.png');

    const uploadResponse = await fetch('https://fal.ai/api/storage/upload', {
      method: 'POST',
      headers: { Authorization: `Key ${this.apiKey}` },
      body: formData,
      signal,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Image upload failed: ${uploadResponse.status}`);
    }

    const result = await uploadResponse.json();
    return result.url;
  }

  private async pollForResult(
    requestId: string,
    signal: AbortSignal,
  ): Promise<string> {
    const maxAttempts = 120; // 2 minutes max (video gen can take ~30-60s)
    const pollIntervalMs = 2000;

    for (let i = 0; i < maxAttempts; i++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

      const statusResponse = await fetch(
        `https://queue.fal.run/fal-ai/veo3.1/image-to-video/requests/${requestId}/status`,
        {
          headers: { Authorization: `Key ${this.apiKey}` },
          signal,
        },
      );

      if (!statusResponse.ok) continue;
      const status = await statusResponse.json();

      if (status.status === 'COMPLETED') {
        const resultResponse = await fetch(
          `https://queue.fal.run/fal-ai/veo3.1/image-to-video/requests/${requestId}`,
          {
            headers: { Authorization: `Key ${this.apiKey}` },
            signal,
          },
        );
        const result = await resultResponse.json();
        const videoUrl = result.video?.url;
        if (!videoUrl) throw new Error('fal.ai returned no video URL');
        return videoUrl;
      }

      if (status.status === 'FAILED') {
        throw new Error(`Video generation failed: ${status.error || 'unknown'}`);
      }
    }

    throw new Error('Video generation timed out');
  }
}

// Fake service: returns a 1-second blank "video" as a canvas-rendered GIF-like poster
class FakeFalAiVideoService implements FalAiVideoServiceInterface {
  async generateVideo(
    request: GenerateVideoRequest,
    signal: AbortSignal,
  ): Promise<GenerateVideoResult> {
    // Simulate delay
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      const onAbort = () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); };
      const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, 2000);
      signal.addEventListener('abort', onAbort, { once: true });
    });

    // Return the input image as a "video" poster (no real video in dev mode)
    return { videoDataUrl: request.imageDataUrl };
  }
}

let instance: FalAiVideoServiceInterface | null = null;

export function getFalAiVideoService(): FalAiVideoServiceInterface {
  if (!instance) {
    const apiKey = import.meta.env.INK_FAL_AI_API_KEY as string | undefined;
    if (apiKey) {
      instance = new FalAiVideoService(apiKey);
    } else {
      instance = new FakeFalAiVideoService();
    }
  }
  return instance;
}
```

### Step 5: Renderer (`renderer.ts`)

The renderer handles 3 visual states: drawing-only, static image, and video playback.

```typescript
import type { BoundingBox } from '../../types';
import type { SmartCanvasElement } from './types';
import { SMART_CANVAS_SIZE } from './types';
import { renderStrokes } from '../../canvas/StrokeRenderer';
import type { RenderOptions } from '../registry/ElementPlugin';

// ── Image cache (reuse pattern from SketchableImage) ──

const MAX_IMAGE_CACHE_SIZE = 10;
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
    if (imageCache.size >= MAX_IMAGE_CACHE_SIZE) {
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
  if (imageCache.size >= MAX_IMAGE_CACHE_SIZE) {
    const oldest = imageCache.keys().next().value;
    if (oldest !== undefined) imageCache.delete(oldest);
  }
  const img = new Image();
  img.src = dataUrl;
  imageCache.set(dataUrl, img);
  await img.decode();
}

// ── Video element cache ──

const videoElements = new Map<string, HTMLVideoElement>();

function getOrCreateVideo(elementId: string, videoDataUrl: string): HTMLVideoElement {
  const existing = videoElements.get(elementId);
  if (existing && existing.src === videoDataUrl) return existing;

  // Clean up old video
  if (existing) {
    existing.pause();
    existing.src = '';
  }

  const video = document.createElement('video');
  video.src = videoDataUrl;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.play().catch(() => { /* autoplay may be blocked */ });
  videoElements.set(elementId, video);
  return video;
}

// ── Transition state (cross-fade when new image arrives) ──

const TRANSITION_DURATION_MS = 800;
const lastKnownBitmap = new Map<string, string>();
const activeTransitions = new Map<string, { from: string; to: string; start: number }>();

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function hasActiveSmartCanvasTransitions(): boolean {
  return activeTransitions.size > 0;
}

export function hasActiveSmartCanvasVideos(): boolean {
  return videoElements.size > 0;
}

// ── Spinner ──

function drawSpinner(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
  const angle = (performance.now() / 600) % (2 * Math.PI);
  ctx.beginPath();
  ctx.arc(cx, cy, 10, angle, angle + Math.PI * 1.3);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.stroke();
}

// ── Status label ──

function drawStatusLabel(
  ctx: CanvasRenderingContext2D,
  width: number,
  label: string,
): void {
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  const metrics = ctx.measureText(label);
  const padding = 6;
  const x = width - metrics.width - padding * 2 - 8;
  const y = 8;
  const bgWidth = metrics.width + padding * 2;
  const bgHeight = 20;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.beginPath();
  ctx.roundRect(x, y, bgWidth, bgHeight, 4);
  ctx.fill();

  ctx.fillStyle = '#333';
  ctx.fillText(label, x + padding, y + 14);
}

// ── Main render ──

export function render(
  ctx: CanvasRenderingContext2D,
  element: SmartCanvasElement,
  _options?: RenderOptions,
): void {
  const tx = element.transform.values[6];
  const ty = element.transform.values[7];
  const { scaleX, scaleY } = element;
  const width = SMART_CANVAS_SIZE * scaleX;
  const height = SMART_CANVAS_SIZE * scaleY;

  ctx.save();
  ctx.translate(tx, ty);

  // ── Cross-fade transition logic ──
  const prevBitmap = lastKnownBitmap.get(element.id);
  if (prevBitmap !== undefined && element.bitmapDataUrl && prevBitmap !== element.bitmapDataUrl) {
    activeTransitions.set(element.id, {
      from: prevBitmap,
      to: element.bitmapDataUrl,
      start: performance.now(),
    });
  }
  lastKnownBitmap.set(element.id, element.bitmapDataUrl);

  const transition = activeTransitions.get(element.id);
  let transProgress = -1;
  if (transition) {
    transProgress = Math.min((performance.now() - transition.start) / TRANSITION_DURATION_MS, 1);
    if (transProgress >= 1) activeTransitions.delete(element.id);
  }

  // ── Draw content ──

  if (element.videoDataUrl) {
    // VIDEO MODE: draw video frame
    const video = getOrCreateVideo(element.id, element.videoDataUrl);
    if (video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, width, height);
    } else {
      // Video not ready yet — draw poster (the bitmap)
      drawBitmapOrWhite(ctx, element.bitmapDataUrl, width, height);
    }
  } else if (transProgress >= 0 && transProgress < 1) {
    // TRANSITION MODE: cross-fade between old and new image
    const alpha = easeOutCubic(transProgress);
    ctx.globalAlpha = 1 - alpha;
    drawBitmapOrWhite(ctx, transition!.from, width, height);
    ctx.globalAlpha = alpha;
    drawBitmapOrWhite(ctx, transition!.to, width, height);
    ctx.globalAlpha = 1;
  } else if (element.bitmapDataUrl) {
    // STATIC IMAGE MODE
    drawBitmapOrWhite(ctx, element.bitmapDataUrl, width, height);
  } else {
    // BLANK CANVAS MODE
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }

  // ── Draw overlay strokes (only unprocessed ones when we have AI content) ──
  const strokesToDraw = element.bitmapDataUrl || element.videoDataUrl
    ? element.overlayStrokes.slice(element.processedStrokeCount)
    : element.overlayStrokes;

  if (strokesToDraw.length > 0) {
    ctx.save();
    ctx.scale(scaleX, scaleY);
    renderStrokes(ctx, strokesToDraw);
    ctx.restore();
  }

  // ── Border ──
  const borderColors: Record<string, string> = {
    idle: '#cccccc',
    detecting: '#4a90d9',   // blue while thinking
    generating: '#ff8c00',  // orange while generating
    done: '#4CAF50',        // green when done
  };
  ctx.strokeStyle = borderColors[element.status] || '#cccccc';
  ctx.lineWidth = element.status === 'idle' ? 1 : 3;
  ctx.strokeRect(0, 0, width, height);

  // ── Spinner + status label ──
  if (element.status === 'detecting') {
    drawSpinner(ctx, width - 16, 16, '#4a90d9');
    drawStatusLabel(ctx, width, 'Understanding...');
  } else if (element.status === 'generating') {
    drawSpinner(ctx, width - 16, 16, '#ff8c00');
    drawStatusLabel(ctx, width, 'Creating...');
  }

  // ── Video playback indicator ──
  if (element.videoDataUrl) {
    // Small ▶ icon in bottom-left to indicate it's a video
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.roundRect(8, height - 28, 20, 20, 4);
    ctx.fill();
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(14, height - 23);
    ctx.lineTo(14, height - 13);
    ctx.lineTo(23, height - 18);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawBitmapOrWhite(
  ctx: CanvasRenderingContext2D,
  dataUrl: string,
  width: number,
  height: number,
): void {
  const img = getOrLoadImage(dataUrl);
  if (img) {
    ctx.drawImage(img, 0, 0, width, height);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
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
```

### Step 6: Interaction (`interaction.ts`)

Captures strokes drawn within the canvas bounds — identical pattern to SketchableImage:

```typescript
import type { Stroke, BoundingBox } from '../../types';
import type { SmartCanvasElement } from './types';
import { SMART_CANVAS_SIZE } from './types';
import type { InteractionResult } from '../registry/ElementPlugin';
import { boundingBoxesIntersect } from '../../types/primitives';

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

  // Require stroke centroid inside element
  let sumX = 0, sumY = 0, count = 0;
  for (const stroke of _strokes) {
    for (const input of stroke.inputs.inputs) {
      sumX += input.x;
      sumY += input.y;
      count++;
    }
  }
  if (count === 0) return false;
  return sumX / count >= tx && sumX / count <= right
      && sumY / count >= ty && sumY / count <= bottom;
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

  return {
    element: newElement,
    consumed: true,
    strokesConsumed: strokes,
  };
}
```

### Step 7: Generation Hook (`src/hooks/useSmartCanvasGeneration.ts`)

Follows the exact same debounce + abort pattern as `useSketchableImageGeneration.ts`:

```typescript
/**
 * Hook that watches SmartCanvasElements for new strokes and triggers
 * intent detection + action execution after a debounce.
 *
 * Debounce is longer than SketchableImage (4s vs 3s) because the user
 * may be writing text instructions which take longer than drawing.
 */

import { useEffect, useRef, useCallback, useMemo } from 'react';
import type { NoteElements } from '../types';
import type { SmartCanvasElement } from '../elements/smartcanvas/types';
import { detectIntent } from '../elements/smartcanvas/intentDetector';
import { enhanceDrawing } from '../elements/smartcanvas/actions/enhance';
import { modifyDrawing } from '../elements/smartcanvas/actions/modify';
import { animateDrawing } from '../elements/smartcanvas/actions/animate';
import { compositeStrokesOnWhite } from '../services/compositing';
import { preloadImage } from '../elements/smartcanvas/renderer';
import { showToast } from '../toast/Toast';

const DEBOUNCE_MS = 4000;

export function useSmartCanvasGeneration(
  currentNote: NoteElements,
  setCurrentNote: (value: NoteElements) => void,
): void {
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const controllersRef = useRef(new Map<string, AbortController>());
  const lastAttemptedStrokeCountRef = useRef(new Map<string, number>());
  const latestNoteRef = useRef(currentNote);
  latestNoteRef.current = currentNote;

  const syncSetCurrentNote = useCallback((note: NoteElements) => {
    latestNoteRef.current = note;
    setCurrentNote(note);
  }, [setCurrentNote]);

  const updateElement = useCallback(
    (elementId: string, updater: (el: SmartCanvasElement) => SmartCanvasElement) => {
      const note = latestNoteRef.current;
      if (!note.elements.some(el => el.id === elementId && el.type === 'smartCanvas')) return;
      syncSetCurrentNote({
        ...note,
        elements: note.elements.map(el =>
          el.id === elementId && el.type === 'smartCanvas'
            ? updater(el as SmartCanvasElement)
            : el,
        ),
      });
    },
    [syncSetCurrentNote],
  );

  const triggerProcessing = useCallback(async (elementId: string) => {
    const note = latestNoteRef.current;
    const element = note.elements.find(
      (el): el is SmartCanvasElement => el.type === 'smartCanvas' && el.id === elementId,
    );
    if (!element || element.overlayStrokes.length === 0) return;

    const strokeCount = element.overlayStrokes.length;
    lastAttemptedStrokeCountRef.current.set(elementId, strokeCount);

    // Abort any in-flight request for this element
    controllersRef.current.get(elementId)?.abort();
    const controller = new AbortController();
    controllersRef.current.set(elementId, controller);

    // Phase 1: Composite strokes into image for LLM vision
    const compositeImage = compositeStrokesOnWhite(element.overlayStrokes);

    // Phase 2: Detect intent
    updateElement(elementId, el => ({ ...el, status: 'detecting' }));

    try {
      const intent = await detectIntent(compositeImage);

      if (intent.action === 'none') {
        updateElement(elementId, el => ({
          ...el,
          status: 'idle',
          lastIntent: intent,
          processedStrokeCount: strokeCount,
        }));
        return;
      }

      // Phase 3: Execute action
      updateElement(elementId, el => ({
        ...el,
        status: 'generating',
        lastIntent: intent,
      }));

      if (intent.action === 'enhance') {
        const resultImage = await enhanceDrawing(compositeImage);
        await preloadImage(resultImage);
        updateElement(elementId, el => ({
          ...el,
          bitmapDataUrl: resultImage,
          processedStrokeCount: strokeCount,
          status: 'done',
        }));
      } else if (intent.action === 'modify') {
        const resultImage = await modifyDrawing(compositeImage, intent.instruction);
        await preloadImage(resultImage);
        updateElement(elementId, el => ({
          ...el,
          bitmapDataUrl: resultImage,
          processedStrokeCount: strokeCount,
          status: 'done',
        }));
      } else if (intent.action === 'animate') {
        const result = await animateDrawing(
          compositeImage,
          intent.motionDescription || intent.instruction,
          intent.durationSeconds || 4,
          controller.signal,
        );
        await preloadImage(result.posterDataUrl);
        updateElement(elementId, el => ({
          ...el,
          bitmapDataUrl: result.posterDataUrl,
          videoDataUrl: result.videoDataUrl,
          videoDurationMs: result.durationMs,
          processedStrokeCount: strokeCount,
          status: 'done',
        }));
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        updateElement(elementId, el => ({ ...el, status: 'idle' }));
        return;
      }
      console.error('SmartCanvas processing failed:', err);
      showToast(`Smart Canvas failed: ${err instanceof Error ? err.message : String(err)}`);
      updateElement(elementId, el => ({ ...el, status: 'idle' }));
    } finally {
      controllersRef.current.delete(elementId);
    }
  }, [updateElement]);

  // Fingerprint: only re-evaluate when stroke counts change
  const fingerprint = useMemo(() => {
    return currentNote.elements
      .filter((el): el is SmartCanvasElement => el.type === 'smartCanvas')
      .map(el => `${el.id}:${el.overlayStrokes.length}`)
      .join(',');
  }, [currentNote.elements]);

  useEffect(() => {
    for (const element of latestNoteRef.current.elements) {
      if (element.type !== 'smartCanvas') continue;
      if (element.status === 'detecting' || element.status === 'generating') continue;

      const lastAttempted = lastAttemptedStrokeCountRef.current.get(element.id) ?? 0;
      if (element.overlayStrokes.length <= lastAttempted) continue;

      const existing = timersRef.current.get(element.id);
      if (existing) clearTimeout(existing);

      controllersRef.current.get(element.id)?.abort();
      controllersRef.current.delete(element.id);

      const timer = setTimeout(() => {
        timersRef.current.delete(element.id);
        triggerProcessing(element.id);
      }, DEBOUNCE_MS);
      timersRef.current.set(element.id, timer);
    }
  }, [fingerprint, triggerProcessing]);

  // Cleanup on unmount
  useEffect(() => {
    const timers = timersRef.current;
    const controllers = controllersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const c of controllers.values()) c.abort();
      controllers.clear();
    };
  }, []);
}
```

### Step 8: Plugin Registration (`index.ts`)

```typescript
import type { SmartCanvasElement } from './types';
import { createSmartCanvasElement, SMART_CANVAS_SIZE } from './types';
import type { ElementPlugin } from '../registry/ElementPlugin';
import { registerPlugin } from '../registry/ElementRegistry';
import { isInterestedIn, acceptInk } from './interaction';
import { render, getBounds } from './renderer';
import { registerPaletteEntry } from '../../palette/PaletteRegistry';
import { SmartCanvasIcon } from './icon';

const smartCanvasPlugin: ElementPlugin<SmartCanvasElement> = {
  elementType: 'smartCanvas',
  name: 'Smart Canvas',
  isInterestedIn,
  acceptInk,
  render,
  getBounds,
};

registerPlugin(smartCanvasPlugin);

registerPaletteEntry({
  id: 'smartCanvas',
  label: 'Smart Canvas',
  Icon: SmartCanvasIcon,
  category: 'content',
  onSelect: async (bounds, consumeStrokes) => {
    const rectWidth = bounds.right - bounds.left;
    const rectHeight = bounds.bottom - bounds.top;
    const size = Math.max(rectWidth, rectHeight, SMART_CANVAS_SIZE);
    const scale = size / SMART_CANVAS_SIZE;

    const element = createSmartCanvasElement(bounds.left, bounds.top);
    consumeStrokes();

    return { ...element, scaleX: scale, scaleY: scale };
  },
});

export { smartCanvasPlugin };
```

### Step 9: Icon (`icon.tsx`)

```tsx
export function SmartCanvasIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
      {/* Canvas frame */}
      <rect x="3" y="3" width="18" height="18" rx="2" />
      {/* Sparkle/AI indicator */}
      <path d="M12 7v2m0 6v2m-5-5h2m6 0h2" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}
```

### Step 10: Wire into the app

#### `src/elements/index.ts` — add 1 line:
```typescript
import './smartcanvas';
```

#### `src/types/elements.ts` — add to union:
```typescript
import type { SmartCanvasElement } from '../elements/smartcanvas/types';

export type Element =
  | StrokeElement
  // ...existing...
  | SmartCanvasElement;
```

#### `src/App.tsx` — add the hook (one line in the hooks section):

Find where `useSketchableImageGeneration(...)` is called and add below it:

```typescript
useSmartCanvasGeneration(currentNote, setCurrentNote);
```

#### `src/canvas/InkCanvas.tsx` — add video animation trigger:

In the render loop where it checks for active animations, add:

```typescript
import { hasActiveSmartCanvasTransitions, hasActiveSmartCanvasVideos } from '../elements/smartcanvas/renderer';

// In the shouldAnimate check:
const shouldAnimate = animatingElements.size > 0
  || isGenerating
  || hasActiveImageTransitions()
  || hasActiveTicTacToeAnimations()
  || hasActiveSmartCanvasTransitions()  // ← add
  || hasActiveSmartCanvasVideos();      // ← add (keeps render loop going for video frames)
```

---

## Implementation Order

| Phase | What | Files | Effort |
|-------|------|-------|--------|
| **1** | Types + empty plugin shell + palette entry | `types.ts`, `index.ts`, `icon.tsx`, edits to `elements.ts` + `elements/index.ts` | Small |
| **2** | Interaction (capture strokes) | `interaction.ts` | Small — copy from SketchableImage |
| **3** | Renderer (draw strokes on white canvas, border, spinner) | `renderer.ts` | Medium — start without video, add cross-fade |
| **4** | Intent detector (LLM vision call) | `intentDetector.ts` | Medium — the core innovation |
| **5** | Generation hook (debounce + orchestration) | `useSmartCanvasGeneration.ts` + App.tsx edit | Medium — copy pattern from SketchableImage |
| **6** | Enhance action | `actions/enhance.ts` | Small |
| **7** | Modify action | `actions/modify.ts` | Small |
| **8** | Video service | `FalAiVideoService.ts` | Medium |
| **9** | Animate action + video rendering | `actions/animate.ts` + renderer video mode | Medium |
| **10** | InkCanvas animation loop integration | InkCanvas.tsx edit | Small — 2 lines |

**Phases 1-7 give you a working demo** with enhance + modify. Video (8-9) can be added after.

---

## Demo Script (for showing off)

1. Draw rectangle+X → palette → "Smart Canvas" → blank white canvas appears
2. Draw a beach scene (waves, palm tree, sun) — nothing happens, just drawing
3. Write "improve" in the corner → blue border + "Understanding..." → orange border + "Creating..." → cross-fade to enhanced beach drawing
4. Draw more: add a bird, write "make it sunset" → AI modifies scene to sunset colors
5. Draw arrows on the waves, write "animate 4s" → generates 4-second video → video loops in-place
6. Audience sees: the canvas understood handwritten text, drawing intent, and motion arrows — all from one unified plugin

---

## Key Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| OpenRouter doesn't support Gemini image output | Fall back to direct Gemini API call (service already exists). Test early in Phase 6. |
| Intent detection false positives | Conservative system prompt ("if unsure, return none"). Temperature 0.1. |
| Video generation slow (30-60s) | Show spinner with status. User can keep drawing elsewhere while waiting. |
| Style drift on enhance/modify | Prompt engineering: "keep hand-drawn aesthetic, do not make photorealistic" |
| fal.ai image upload format | Test upload flow in Phase 8. May need to use their SDK instead of raw fetch. |
| Gemini response image format via OpenRouter | `extractImageFromResponse` handles multiple formats. Test and adapt in Phase 6. |
