export type MinimaxTtsConfig = {
  provider?: "minimax" | "volcengine";
  voiceId: string;
  model: string;
  encoding: "hex" | "base64";
  wsPath: string;
};

export type VolcengineTtsConfig = {
  provider: "volcengine";
  voiceId: string;
  apiKey: string;
  cluster: string;
  uid: string;
};

export type TtsConfig = MinimaxTtsConfig | VolcengineTtsConfig;

type TtsConfigResponse = {
  provider?: unknown;
  voiceId?: unknown;
  model?: unknown;
  encoding?: unknown;
  wsPath?: unknown;
  apiKey?: unknown;
  cluster?: unknown;
  uid?: unknown;
};

export type FetchTtsConfigArgs = {
  cardId?: string;
  signal?: AbortSignal;
};

function normalizeEncoding(raw: unknown): "hex" | "base64" {
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

export async function fetchMinimaxTtsConfig(args?: AbortSignal | FetchTtsConfigArgs): Promise<TtsConfig> {
  const cardId = isAbortSignal(args) ? undefined : String(args?.cardId ?? "").trim();
  const signal = isAbortSignal(args) ? args : args?.signal;
  const qs = cardId ? `?cardId=${encodeURIComponent(cardId)}` : "";

  const res = await fetch(`/api/tts/minimax/config${qs}`, { method: "GET", signal });
  if (!res.ok) throw new Error(`获取语音配置失败：${res.status}`);

  const json = (await res.json()) as TtsConfigResponse;
  const provider = String(json.provider ?? "minimax").trim() as "minimax" | "volcengine";

  if (provider === "volcengine") {
    const voiceId = String(json.voiceId ?? "").trim();
    const apiKey = String(json.apiKey ?? "").trim();
    const cluster = String(json.cluster ?? "volcano_icl").trim();
    const uid = String(json.uid ?? "声岛").trim();

    if (!voiceId) throw new Error("语音配置缺少 voiceId");
    if (!apiKey) throw new Error("语音配置缺少 apiKey");

    return { provider: "volcengine", voiceId, apiKey, cluster, uid };
  }

  const voiceId = String(json.voiceId ?? "").trim();
  const model = String(json.model ?? "").trim();
  const encoding = normalizeEncoding(json.encoding);
  const wsPath = normalizeWsPath(json.wsPath);

  if (!voiceId) throw new Error("语音配置缺少 voiceId");
  if (!model) throw new Error("语音配置缺少 model");

  return { provider: "minimax", voiceId, model, encoding, wsPath };
}
