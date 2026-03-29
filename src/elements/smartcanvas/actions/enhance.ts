// Enhance action — improves drawing quality while keeping the hand-drawn style.
// Uses Gemini 3.1 Flash Image via OpenRouter for image-to-image editing.

import { imageGeneration } from '../../../ai/OpenRouterService';
import type { ChatMessage } from '../../../ai/OpenRouterService';

const IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';

export async function enhanceDrawing(
  compositeImageDataUrl: string,
  instruction: string,
  signal?: AbortSignal,
): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are refining an existing pen sketch, not replacing it. ' +
        'Preserve all original drawn objects, their positions, the composition, and the hand-drawn ink look. ' +
        'Treat handwritten instruction words and pointing arrows as edit annotations, not scene content. ' +
        'Do not erase or redesign the actual drawing. ' +
        'For a generic improve/enhance request, make the upgrade visibly clear by cleaning linework, closing gaps, correcting obvious wobbles, and adding restrained pen-style detail or hatching that fits the existing sketch.',
    },
    {
      role: 'user',
      content: [
        { type: 'image_url', imageUrl: { url: compositeImageDataUrl } },
        {
          type: 'text',
          text:
            `Enhance this hand-drawn sketch with focused instruction: "${instruction}". ` +
            'Preserve the original drawing exactly in spirit: keep the same subject, composition, layout, major shapes, and visible objects. ' +
            'This should feel like the same pen drawing, only cleaner and more developed. ' +
            'Refine the existing line work, structure, and shading in limited ways. ' +
            'If the instruction points to a specific area, concentrate the enhancement there while keeping the rest consistent. ' +
            'Do not crop, zoom, reframe, or simplify away existing parts of the sketch. ' +
            'Do NOT redesign the scene, replace objects, or invent unrelated content. ' +
            'Do NOT make it photorealistic, painterly, or glossy. Keep an ink or pen sketch look with hand-drawn character. ' +
            'You may add subtle detail only when it clearly supports what is already drawn. ' +
            'Keep the background completely flat pure white with no paper texture, tint, shadow, vignette, or color wash. ' +
            'Remove any handwritten text instructions (like "improve" or "enhance") ' +
            'as those are commands, not part of the drawing. ' +
            'Do NOT include arrows or labels in the final image unless they are clearly part of the scene itself. ' +
            'The output should look clearly improved but still recognizably be the same original drawing. ' +
            'Return only the enhanced image.',
        },
      ],
    },
  ];

  const result = await imageGeneration(messages, {
    model: IMAGE_MODEL,
    signal,
    temperature: 0.4,
  });

  return result.imageDataUrl;
}
