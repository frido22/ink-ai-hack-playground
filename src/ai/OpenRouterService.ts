// OpenRouter service - client for LLM inference via OpenRouter REST API.
//
// WARNING: The API key (INK_OPENROUTER_API_KEY) is embedded into the client
// bundle at build time and visible in browser DevTools. Only use a scoped,
// low-privilege, rate-limited key. For production, route calls through a
// backend proxy that holds the secret server-side.

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Content part types matching the OpenRouter SDK's Zod schema.
// The SDK uses camelCase (imageUrl) NOT OpenAI-style (image_url).
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; imageUrl: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface JsonSchema {
  name: string;
  strict?: boolean;
  schema: Record<string, unknown>;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** JSON mode: 'json' for unstructured JSON, or a json_schema for structured output. */
  responseFormat?: 'json' | { type: 'json_schema'; jsonSchema: JsonSchema };
}

const DEFAULT_MODEL = 'google/gemini-2.5-flash';

type RestContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface RestChatMessage {
  role: ChatMessage['role'];
  content: string | RestContentPart[];
}

type RestResponseFormat =
  | { type: 'json_object' }
  | { type: 'json_schema'; json_schema: JsonSchema };

interface OpenRouterChatPayload {
  model: string;
  messages: RestChatMessage[];
  stream: false;
  temperature?: number;
  max_tokens?: number;
  response_format?: RestResponseFormat;
  modalities?: string[];
}

function getOpenRouterHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getOpenRouterApiKey()}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': import.meta.env.INK_OPENROUTER_SITE_URL || window.location.origin,
    'X-Title': import.meta.env.INK_OPENROUTER_SITE_NAME || 'Ink Playground',
  };
}

function toRestMessages(messages: ChatMessage[]): RestChatMessage[] {
  return messages.map(message => ({
    role: message.role,
    content: typeof message.content === 'string'
      ? message.content
      : message.content.map(part =>
          part.type === 'text'
            ? { type: 'text', text: part.text }
            : { type: 'image_url', image_url: { url: part.imageUrl.url } },
        ),
  }));
}

function toRestResponseFormat(
  responseFormat: ChatOptions['responseFormat'],
): RestResponseFormat | undefined {
  if (responseFormat === 'json') {
    return { type: 'json_object' };
  }
  if (responseFormat) {
    return {
      type: 'json_schema',
      json_schema: responseFormat.jsonSchema,
    };
  }
  return undefined;
}

function summarizeMessagesForLog(messages: RestChatMessage[]): unknown[] {
  return messages.map(message => ({
    role: message.role,
    content: typeof message.content === 'string'
      ? {
          type: 'text',
          length: message.content.length,
          preview: message.content.slice(0, 120),
        }
      : message.content.map(part =>
          part.type === 'text'
            ? {
                type: 'text',
                length: part.text.length,
                preview: part.text.slice(0, 120),
              }
            : {
                type: 'image_url',
                urlPrefix: part.image_url.url.slice(0, 48),
                urlLength: part.image_url.url.length,
              },
        ),
  }));
}

async function postChatCompletion(
  messages: ChatMessage[],
  options: ChatOptions,
  extraPayload: Partial<Pick<OpenRouterChatPayload, 'modalities'>> = {},
): Promise<any> {
  const payload: OpenRouterChatPayload = {
    model: options.model ?? DEFAULT_MODEL,
    messages: toRestMessages(messages),
    stream: false,
    ...extraPayload,
  };

  if (options.temperature !== undefined) {
    payload.temperature = options.temperature;
  }
  if (options.maxTokens !== undefined) {
    payload.max_tokens = options.maxTokens;
  }

  const responseFormat = toRestResponseFormat(options.responseFormat);
  if (responseFormat) {
    payload.response_format = responseFormat;
  }

  console.log('[OpenRouter REST] sending chat completion', {
    model: payload.model,
    modalities: payload.modalities,
    responseFormat: payload.response_format?.type,
    messages: summarizeMessagesForLog(payload.messages),
  });

  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: getOpenRouterHeaders(),
    body: JSON.stringify(payload),
    signal: options.signal,
  });

  const responseText = await response.text();
  let data: any;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error(
      `OpenRouter returned non-JSON (${response.status}): ${responseText.slice(0, 300)}`,
    );
  }

  if (!response.ok) {
    const errorMessage =
      data?.error?.message ??
      data?.error ??
      responseText.slice(0, 300) ??
      'unknown error';
    console.error('[OpenRouter REST] request failed', {
      status: response.status,
      error: errorMessage,
    });
    throw new Error(`OpenRouter request failed (${response.status}): ${errorMessage}`);
  }

  const message = data?.choices?.[0]?.message;
  console.log('[OpenRouter REST] response received', {
    status: response.status,
    choiceCount: data?.choices?.length ?? 0,
    messageKeys: Object.keys(message ?? {}),
  });

  return data;
}

function extractTextContent(message: { content?: unknown } | undefined): string {
  const content = message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (
          typeof part === 'object' &&
          part !== null &&
          'type' in part &&
          part.type === 'text' &&
          'text' in part &&
          typeof part.text === 'string'
        ) {
          return part.text;
        }
        return '';
      })
      .join('');
  }
  return '';
}

/**
 * Send a chat completion request via OpenRouter.
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const completion = await postChatCompletion(messages, options);
  return extractTextContent(completion?.choices?.[0]?.message);
}

/**
 * Convenience: send a chat request and parse the response as JSON.
 */
export async function chatCompletionJSON<T = unknown>(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<T> {
  const raw = await chatCompletion(messages, {
    ...options,
    responseFormat: options.responseFormat ?? 'json',
  });
  return JSON.parse(raw) as T;
}

/**
 * Send an image generation request via OpenRouter.
 * Uses models that support modalities: ['text', 'image'] output.
 * Returns base64 data URL of the generated image.
 */
export async function imageGeneration(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<{ text: string; imageDataUrl: string }> {
  const completion = await postChatCompletion(messages, {
    ...options,
    model: options.model ?? 'google/gemini-3.1-flash-image-preview',
  }, {
    modalities: ['text', 'image'],
  });

  const message = completion?.choices?.[0]?.message;
  const text = extractTextContent(message);

  console.log('[OpenRouter imageGen] response keys:', Object.keys(message ?? {}));
  console.log('[OpenRouter imageGen] has images?', !!(message?.images));
  console.log('[OpenRouter imageGen] text length:', text.length);

  // REST responses return message.images[] as {image_url: {url: "data:image/png;base64,..."}}
  const images = message?.images as Array<{
    image_url?: { url?: string };
    imageUrl?: { url?: string };
  }> | undefined;
  const imageDataUrl = images?.[0]?.image_url?.url ?? images?.[0]?.imageUrl?.url ?? '';

  if (!imageDataUrl) {
    console.error('[OpenRouter imageGen] no image in response. Full message:', JSON.stringify(message).slice(0, 500));
    throw new Error('OpenRouter returned no image data');
  }
  console.log('[OpenRouter imageGen] got image, dataUrl length:', imageDataUrl.length);

  return { text, imageDataUrl };
}

/**
 * Get the raw OpenRouter API key for direct REST calls (e.g., video alpha API).
 */
export function getOpenRouterApiKey(): string {
  const apiKey = import.meta.env.INK_OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('INK_OPENROUTER_API_KEY is not set.');
  }
  return apiKey;
}

/**
 * Check whether the OpenRouter API key is configured.
 */
export function isOpenRouterConfigured(): boolean {
  return !!import.meta.env.INK_OPENROUTER_API_KEY;
}
