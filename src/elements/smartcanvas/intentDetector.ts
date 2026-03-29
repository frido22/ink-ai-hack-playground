// Intent detection — sends composite drawing to a vision LLM to determine what
// the user is asking for (enhance, modify, animate, or nothing).

import { chatCompletionJSON } from '../../ai/OpenRouterService';
import type { ChatMessage } from '../../ai/OpenRouterService';
import type { DetectedIntent } from './types';

const SYSTEM_PROMPT = `You are an intent detector for a drawing canvas app.

You receive an image of a hand-drawn sketch. The sketch may contain:
1. A drawing (shapes, scenes, objects)
2. Handwritten text instructions (like "improve", "add sunset", "animate 4s")
3. Control symbols (a play button ▶ triangle means "animate")
4. Arrows drawn on objects (indicate direction of motion for animation)

Your job: determine what the user wants. Respond with JSON only.

Rules:
- If there is NO text instruction, NO play button, and NO arrows → action is "none"
- Text like "improve", "enhance", "make better", "refine" → action is "enhance"
- Text describing a change like "add sunset", "make it night", "add birds" → action is "modify", put the change in "instruction"
- Text like "animate", "animate 4s", "move", or a drawn ▶ play button, or motion arrows on objects → action is "animate"
- Treat obvious misspellings or rough handwriting of command words as intentional if the meaning is still clear
- Arrows that point from instruction text toward a region usually indicate the target area for enhance/modify, not animation
- Do NOT treat a simple pointing arrow as animation unless it clearly shows motion direction on an object or is paired with animate/move language
- For enhance or modify, use "instruction" to describe the intended focus area if arrows indicate one
- For enhance with no specific target area, set "instruction" to "enhance the whole drawing"
- For animate: if arrows are present, describe their direction relative to the objects they're on in "motionDescription"
- For animate: if a duration is mentioned (e.g. "5 seconds", "4s"), use the closest valid value (4, 6, or 8). Default 8.
- Separate the DRAWING CONTENT from the INSTRUCTION TEXT. The instruction describes what to do, not what's drawn.
- Be conservative: if unsure whether something is an instruction, return "none"

Respond with this exact JSON structure:
{
  "action": "enhance" | "modify" | "animate" | "none",
  "instruction": "human-readable summary of what to do",
  "motionDescription": "only for animate: describe the motion",
  "durationSeconds": 4 | 6 | 8
}`;

export async function detectIntent(
  compositeImageDataUrl: string,
  signal?: AbortSignal,
): Promise<DetectedIntent> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'image_url', imageUrl: { url: compositeImageDataUrl } },
        { type: 'text', text: 'What does the user want to do with this drawing? Analyze any handwritten text, symbols, or arrows.' },
      ],
    },
  ];

  console.log('[SmartCanvas] calling intent detection LLM...');
  const result = await chatCompletionJSON<DetectedIntent>(messages, {
    model: 'google/gemini-2.5-flash',
    temperature: 0.1,
    signal,
    responseFormat: 'json',
  });
  console.log('[SmartCanvas] LLM response:', JSON.stringify(result));

  // Validate action field
  const validActions = ['enhance', 'modify', 'animate', 'none'];
  if (!validActions.includes(result.action)) {
    return { action: 'none', instruction: '' };
  }

  return result;
}
