import type { VolcengineTtsConfig } from "./config";

export type VolcengineTtsSession = {
  pushText: (text: string) => void;
  finish: () => void;
  abort: () => void;
};

export type VolcengineTtsCallbacks = {
  onAudioChunk?: (chunk: Uint8Array) => void;
  onError?: (error: Error) => void;
  onEnd?: () => void;
};

export function createVolcengineTtsSession(
  config: VolcengineTtsConfig,
  callbacks: VolcengineTtsCallbacks
): VolcengineTtsSession {
  let aborted = false;
  let finished = false;
  let textBuffer = "";

  console.log("[VolcengineTTS] Session created with config:", {
    voiceId: config.voiceId,
    cluster: config.cluster,
    apiKey: config.apiKey ? `${config.apiKey.slice(0, 8)}...` : "missing",
  });

  const synthesize = async (text: string) => {
    if (aborted || !text.trim()) return;

    console.log("[VolcengineTTS] Synthesizing via backend proxy:", text.slice(0, 50) + (text.length > 50 ? "..." : ""));

    try {
      const res = await fetch("/api/tts/volcengine/synthesize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: text,
          voice_id: config.voiceId,
          api_key: config.apiKey,
          cluster: config.cluster,
          uid: config.uid,
        }),
      });

      if (aborted) return;

      console.log("[VolcengineTTS] Response status:", res.status);

      if (!res.ok) {
        const errorText = await res.text();
        console.error("[VolcengineTTS] Error response:", errorText);
        callbacks.onError?.(new Error(`火山引擎 TTS 请求失败：${res.status}`));
        return;
      }

      const arrayBuffer = await res.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      if (aborted) return;

      console.log("[VolcengineTTS] Audio bytes:", bytes.length);
      callbacks.onAudioChunk?.(bytes);
    } catch (err) {
      console.error("[VolcengineTTS] Request error:", err);
      if (!aborted) {
        callbacks.onError?.(err instanceof Error ? err : new Error("火山引擎 TTS 请求异常"));
      }
    }
  };

  return {
    pushText: (text) => {
      if (aborted || finished) return;
      console.log("[VolcengineTTS] pushText called, length:", text.length);
      textBuffer += text;
    },
    finish: async () => {
      if (aborted || finished) return;
      finished = true;
      console.log("[VolcengineTTS] finish called, total text length:", textBuffer.length);
      if (textBuffer.trim()) {
        await synthesize(textBuffer);
      }
      callbacks.onEnd?.();
    },
    abort: () => {
      console.log("[VolcengineTTS] abort called");
      aborted = true;
      textBuffer = "";
    },
  };
}
