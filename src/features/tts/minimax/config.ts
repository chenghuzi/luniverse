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

export type FetchMinimaxTtsConfigArgs = {
  cardId?: string;
  signal?: AbortSignal;
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

function isAbortSignal(value: unknown): value is AbortSignal {
  if (!value) return false;
  return typeof value === "object" && "aborted" in (value as Record<string, unknown>);
}

export async function fetchMinimaxTtsConfig(args?: AbortSignal | FetchMinimaxTtsConfigArgs): Promise<MinimaxTtsConfig> {
  const cardId = isAbortSignal(args) ? undefined : String(args?.cardId ?? "").trim();
  const signal = isAbortSignal(args) ? args : args?.signal;
  const qs = cardId ? `?cardId=${encodeURIComponent(cardId)}` : "";

  const res = await fetch(`/api/tts/minimax/config${qs}`, { method: "GET", signal });
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
