import type { LlmClient, LlmMessage, LlmStreamCallbacks, LlmStreamHandle } from "@/features/llm/types";
import { getDashscopeConfig } from "@/features/llm/dashscope/config";
import { streamChatCompletion } from "@/features/llm/openaiCompatible/chatCompletions";

function normalizeMessages(messages: LlmMessage[]): LlmMessage[] {
  return messages
    .map((m) => ({ role: m.role, content: String(m.content ?? "") }))
    .filter((m) => m.content.trim().length > 0);
}

export function createDashscopeLlmClient(): LlmClient | null {
  const cfg = getDashscopeConfig();
  if (!cfg) return null;

  return {
    streamChat: (params, callbacks) => {
      const controller = new AbortController();
      const model = params.model?.trim() ? params.model : cfg.model;
      const messages = normalizeMessages(params.messages);

      void (async () => {
        try {
          let finalText = "";
          finalText = await streamChatCompletion(
            {
              baseUrl: cfg.baseUrl,
              apiKey: cfg.apiKey,
              model,
              messages,
              signal: controller.signal,
            },
            (delta) => callbacks.onDeltaText?.(delta),
          );
          callbacks.onDone?.(finalText);
        } catch (e) {
          if (controller.signal.aborted) return;
          callbacks.onError?.(e instanceof Error ? e : new Error("LLM error"));
        }
      })();

      const handle: LlmStreamHandle = { abort: () => controller.abort() };
      return handle;
    },
  };
}

