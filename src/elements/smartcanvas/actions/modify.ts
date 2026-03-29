// Modify action — changes the drawing scene based on a user instruction.
// Uses Gemini 3.1 Flash Image via OpenRouter for image-to-image editing.

import { imageGeneration } from '../../../ai/OpenRouterService';
import type { ChatMessage } from '../../../ai/OpenRouterService';

const IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';

export async function modifyDrawing(
  compositeImageDataUrl: string,
  instruction: string,
  signal?: AbortSignal,
): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are editing an existing pen sketch. Keep the original drawing intact except for the specific requested change. ' +
        'Preserve the same composition, object placement, line quality, and hand-drawn ink style. ' +
        'Treat handwritten instructions and pointing arrows as annotations for what to change and where to change it.',
    },
    {
      role: 'user',
      content: [
        { type: 'image_url', imageUrl: { url: compositeImageDataUrl } },
        {
          type: 'text',
          text:
            `Modify this hand-drawn sketch according to this instruction: "${instruction}". ` +
            'Keep the original drawing style, composition, major shapes, and scene structure. ' +
            'Apply only the requested change, and keep all other parts as close to the original as possible. ' +
            'If arrows indicate the target area, localize the change there instead of rewriting the whole image. ' +
            'Do NOT make it photorealistic — maintain the hand-drawn pen sketch aesthetic. ' +
            'Keep the background completely flat pure white with no paper texture, tint, shadow, vignette, or color wash. ' +
            'Remove any handwritten text instructions from the image ' +
            'as those are commands, not part of the drawing. ' +
            'Do NOT replace the scene with a different one or redraw unrelated regions unnecessarily. ' +
            'Return only the modified image.',
        },
      ],
    },
  ];

  const result = await imageGeneration(messages, {
    model: IMAGE_MODEL,
    signal,
    temperature: 0.5,
  });

  return result.imageDataUrl;
}
