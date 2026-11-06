/**
 * Shared AI client for Growlanzo edge functions — powered by OpenRouter
 * (https://openrouter.ai), an OpenAI-compatible model gateway.
 *
 * SECURITY: the API key is read from edge-function secrets ONLY (AI_API_KEY) —
 * it is never exposed to the frontend or committed to git. All AI features
 * (assistant, ticket responder, matching) call the OpenAI-compatible endpoint
 * (`/api/v1/chat/completions`), so the payload shape stays OpenAI-standard
 * and works with any provider that exposes the same contract.
 *
 * LATENCY: replies felt slow because every request asked for a large token
 * ceiling and let the gateway pick any provider. The provider is now sorted by
 * latency (priority) or throughput, the ceiling is small (chat replies are
 * short), and every call has a hard abort budget so a stalled upstream can
 * never leave the user staring at typing dots for 90 seconds.
 */
import { SITE_URL } from './site.ts';

export const AI_BASE_URL = (
  Deno.env.get('AI_BASE_URL') ||
  'https://openrouter.ai/api/v1'
).replace(/\/+$/, '');

export const AI_API_KEY = Deno.env.get('AI_API_KEY') || '';

/** Default chat model. OpenRouter slugs use the `vendor/model` format
 *  (e.g. `deepseek/deepseek-chat-v3-0324`). Override via the AI_MODEL secret. */
export const AI_MODEL = Deno.env.get('AI_MODEL') || 'deepseek/deepseek-chat-v3-0324';

/** Faster model used for priority (Pro) support. Overridable; falls back to
 *  AI_MODEL when unset so a deployment never breaks just because the secret
 *  is missing. */
export const AI_PRIORITY_MODEL =
  Deno.env.get('AI_PRIORITY_MODEL') || AI_MODEL;

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AICallOptions {
  stream?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
  /** Pro / paid lane: route to the lowest-latency provider and use the fast
   *  model. Free traffic keeps the throughput-sorted default. */
  priority?: boolean;
  model?: string;
}

/**
 * Call the OpenAI-compatible chat completions endpoint.
 *
 * Latency matters more than a huge ceiling here: chat replies are short, so the
 * default cap is 800 tokens in the priority lane and 1200 otherwise. A long
 * ceiling only lets a confused model ramble for tens of seconds after the
 * answer was already useful.
 */
export async function callAI(
  messages: AIMessage[],
  options: AICallOptions = {}
): Promise<Response> {
  const priority = options.priority === true;

  const body: Record<string, unknown> = {
    model: options.model || (priority ? AI_PRIORITY_MODEL : AI_MODEL),
    messages,
    temperature: priority ? 0.5 : 0.7,
    max_tokens: options.maxTokens ?? (priority ? 800 : 1200),
    top_p: 0.95,
  };
  // OpenRouter routes the SAME model to whichever provider answers fastest and
  // falls back when one is saturated. Both lanes now ask for the lowest
  // time-to-first-token: a chat answer is short, so steady throughput bought us
  // nothing while it made replies feel slower (the reported "assistant is not
  // replying fast"). Cost is unchanged — this is a routing preference, not a
  // different model or a bigger ceiling.
  body.provider = { sort: 'latency', allow_fallbacks: true };
  if (options.stream) {
    body.stream = true;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${AI_API_KEY}`,
  };
  // OpenRouter best-practice attribution headers (harmless for other gateways)
  if (AI_BASE_URL.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = SITE_URL;
    headers['X-Title'] = priority ? 'Growlanzo AI (Priority)' : 'Growlanzo AI';
  }

  // Fail fast instead of hanging: a stalled upstream used to leave the chat on
  // its typing dots forever. Streaming gets a longer budget because the clock
  // covers the whole body read, not just the headers.
  const timeoutMs =
    options.timeoutMs ?? (options.stream ? (priority ? 60000 : 75000) : 25000);

  return await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}
