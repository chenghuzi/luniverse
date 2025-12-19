import type { LlmMessage } from "@/features/llm/types";
import { parseSse } from "@/features/llm/openaiCompatible/sse";

type OpenAiChatCompletionStreamDelta = {
  choices?: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
};

export type StreamChatCompletionParams = {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  signal?: AbortSignal;
};

export async function streamChatCompletion(params: StreamChatCompletionParams, onDelta: (text: string) => void) {
  const url = `${params.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      stream: true,
      messages: params.messages,
      temperature: params.temperature ?? 0.6,
    }),
    signal: params.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM request failed (${res.status}): ${text || res.statusText}`);
  }

  let assembled = "";
  for await (const event of parseSse(res)) {
    const data = event.data.trim();
    if (!data) continue;
    if (data === "[DONE]") break;

    let parsed: OpenAiChatCompletionStreamDelta;
    try {
      parsed = JSON.parse(data) as OpenAiChatCompletionStreamDelta;
    } catch {
      continue;
    }

    const choice = parsed.choices?.[0];
    const delta = choice?.delta?.content;
    if (typeof delta === "string" && delta.length > 0) {
      assembled += delta;
      onDelta(delta);
    }

    if (choice?.finish_reason) break;
  }

  return assembled;
}

