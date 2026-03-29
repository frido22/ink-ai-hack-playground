// Animate action — generates a short video from the drawing using OpenRouter's
// video generation alpha API (Veo 3.1).
//
// Flow:
// 1. Upload composite image to get a URL (via fal.ai storage, since OpenRouter
//    video API needs a URL, not base64)
// 2. Submit video generation job to OpenRouter /api/alpha/videos
// 3. Poll for completion
// 4. Download result video and create a blob URL for playback

import { getOpenRouterApiKey } from '../../../ai/OpenRouterService';

const OPENROUTER_BASE = 'https://openrouter.ai';
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 60; // 5 minutes max

export interface AnimationResult {
  videoBlobUrl: string;
  durationMs: number;
  posterDataUrl: string;
}

export async function animateDrawing(
  compositeImageDataUrl: string,
  motionDescription: string,
  durationSeconds: number,
  signal: AbortSignal,
): Promise<AnimationResult> {
  const apiKey = getOpenRouterApiKey();

  const prompt =
    `Gently animate this hand-drawn sketch: ${motionDescription}. ` +
    'Treat the provided sketch as a locked visual reference and keep it almost exactly unchanged. ' +
    'Use the input image as the base frame for the animation, not as loose inspiration. ' +
    'Preserve the same subject, composition, framing, object layout, proportions, line placement, and line density. ' +
    'This should feel like the same pencil sketch brought slightly to life, not a new rendering or enhancement pass. ' +
    'Motion must be subtle, local, and minimal unless the instruction clearly asks for more. ' +
    'Do not redraw the whole image, reinterpret the sketch, beautify it substantially, or add extra detail beyond what is needed for believable motion. ' +
    'Do not redesign the scene, replace objects, add background scenery, add lighting effects, or invent new content. ' +
    'Keep the background completely flat pure white with no paper texture, tint, shadow, vignette, color wash, or environmental background. ' +
    'Keep the output looking like monochrome pencil line art with light graphite shading. Do not make it photorealistic, painterly, cinematic, or glossy. ' +
    'Do not move the camera, zoom, reframe, or change perspective. ' +
    'If there is no clear motion target, prefer almost-still motion over inventing motion. ' +
    'Remove any handwritten text overlays or arrows because those are instructions, not part of the scene.';

  // Submit video generation job
  const submitResponse = await fetch(`${OPENROUTER_BASE}/api/alpha/videos`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Ink Playground',
    },
    body: JSON.stringify({
      model: 'google/veo-3.1',
      prompt,
      // Send the image as a data URL — the alpha API should accept inline images
      image_url: compositeImageDataUrl,
      duration: durationSeconds,
      aspect_ratio: '16:9',
    }),
    signal,
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text().catch(() => '');
    throw new Error(`Video submit failed (${submitResponse.status}): ${errorText}`);
  }

  const submitResult = await submitResponse.json();
  const jobId = submitResult.id || submitResult.job_id;
  if (!jobId) {
    throw new Error('Video submit returned no job ID');
  }

  // Poll for completion
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

    const statusResponse = await fetch(
      `${OPENROUTER_BASE}/api/alpha/videos/${jobId}`,
      {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal,
      },
    );

    if (!statusResponse.ok) continue;
    const status = await statusResponse.json();

    if (status.status === 'completed' || status.done) {
      // Download the video
      const contentResponse = await fetch(
        `${OPENROUTER_BASE}/api/alpha/videos/${jobId}/content?index=0`,
        {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal,
        },
      );

      if (!contentResponse.ok) {
        throw new Error(`Video download failed: ${contentResponse.status}`);
      }

      const videoBlob = await contentResponse.blob();
      const videoBlobUrl = URL.createObjectURL(videoBlob);

      return {
        videoBlobUrl,
        durationMs: durationSeconds * 1000,
        posterDataUrl: compositeImageDataUrl,
      };
    }

    if (status.status === 'failed' || status.error) {
      throw new Error(`Video generation failed: ${status.error || 'unknown'}`);
    }
  }

  throw new Error('Video generation timed out');
}
