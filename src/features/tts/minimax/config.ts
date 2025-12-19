export type MinimaxTtsConfig = {
  voiceId: string;
  model: string;
  encoding: "hex" | "base64";
  wsPath: string;
};

type MinimaxTtsConfigResponse = {
  voiceId?: unknown;
  model?: unknown;
  encoding?: unknown;
  wsPath?: unknown;
};

function normalizeEncoding(raw: unknown): MinimaxTtsConfig["encoding"] {
  return String(raw ?? "")
    .trim()
    .toLowerCase() === "base64"
    ? "base64"
    : "hex";
}

function normalizeWsPath(raw: unknown): string {
  const v = String(raw ?? "").trim();
  return v.startsWith("/") ? v : "/api/tts/minimax/ws";
}

export async function fetchMinimaxTtsConfig(signal?: AbortSignal): Promise<MinimaxTtsConfig> {
  const res = await fetch("/api/tts/minimax/config", { method: "GET", signal });
  if (!res.ok) throw new Error(`Failed to fetch TTS config: ${res.status}`);

  const json = (await res.json()) as MinimaxTtsConfigResponse;
  const voiceId = String(json.voiceId ?? "").trim();
  const model = String(json.model ?? "").trim();
  const encoding = normalizeEncoding(json.encoding);
  const wsPath = normalizeWsPath(json.wsPath);

  if (!voiceId) throw new Error("Missing voiceId in TTS config");
  if (!model) throw new Error("Missing model in TTS config");

  return { voiceId, model, encoding, wsPath };
}
