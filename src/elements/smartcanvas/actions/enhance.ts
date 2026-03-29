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
        'You are refining an existing pencil sketch, not replacing it. ' +
        'Treat the input image as a locked reference. Preserve all original drawn objects, their positions, the composition, and the hand-drawn look. ' +
        'Treat handwritten instruction words and pointing arrows as edit annotations, not scene content. ' +
        'Do not erase or redesign the actual drawing. ' +
        'For a generic improve/enhance request, make only a light upgrade by cleaning linework, closing small gaps, correcting obvious wobbles, and adding restrained pencil-style detail or a little hatching that fits the existing sketch.',
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
            'This should feel like the same pencil drawing, only cleaner and more developed. ' +
            'Refine the existing line work, structure, and shading in very limited ways. ' +
            'If the instruction points to a specific area, concentrate the enhancement there while keeping the rest consistent. ' +
            'Do not crop, zoom, reframe, or simplify away existing parts of the sketch. ' +
            'Do NOT redesign the scene, replace objects, invent unrelated content, or reinterpret the drawing. ' +
            'Do NOT make it photorealistic, painterly, or glossy. Keep a monochrome pencil-sketch look with hand-drawn graphite character. ' +
            'Only add a small amount of new stroke detail when it clearly supports what is already drawn. ' +
            'Every area that is blank white in the input should remain blank white in the output. ' +
            'Keep the background completely flat pure white with no paper texture, tint, shadow, vignette, gradient, or color wash. ' +
            'Do not add scenery, atmosphere, floor, sky, shading wash, or background elements. ' +
            'Remove any handwritten text instructions (like "improve" or "enhance") ' +
            'as those are commands, not part of the drawing. ' +
            'Do NOT include arrows or labels in the final image unless they are clearly part of the scene itself. ' +
            'The output should look only slightly improved and still recognizably be the same original drawing. ' +
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
