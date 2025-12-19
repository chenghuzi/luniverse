export type MinimaxTtsAudioSetting = {
  sampleRate: number;
  bitrate: number;
  format: "mp3";
  channel: number;
};

export type MinimaxTtsVoiceSetting = {
  voiceId: string;
  speed: number;
  volume: number;
  pitch: number;
};

export type MinimaxTtsStartParams = {
  model: string;
  voice: MinimaxTtsVoiceSetting;
  audio: MinimaxTtsAudioSetting;
  encoding: "hex" | "base64";
};

export type MinimaxTtsCallbacks = {
  onAudioChunk?: (chunk: Uint8Array) => void;
  onEvent?: (event: unknown) => void;
  onError?: (error: Error) => void;
};

export type MinimaxTtsSession = {
  pushText: (text: string) => void;
  finish: () => void;
  abort: () => void;
};

type JsonObject = Record<string, unknown>;

function toWebSocketUrl(path: string) {
  const trimmed = path.trim();
  if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) return trimmed;
  if (typeof window === "undefined") return trimmed;
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const normalizedPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${scheme}://${window.location.host}${normalizedPath}`;
}

function safeJsonParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function decodeHexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim();
  const safeLen = normalized.length - (normalized.length % 2);
  const bytes = new Uint8Array(safeLen / 2);
  for (let i = 0; i < safeLen; i += 2) {
    bytes[i / 2] = Number.parseInt(normalized.slice(i, i + 2), 16);
  }
  return bytes;
}

function decodeBase64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeAudioToBytes(audio: unknown, encoding: "hex" | "base64"): Uint8Array | null {
  if (typeof audio !== "string") return null;
  if (!audio) return null;
  if (encoding === "base64") return decodeBase64ToBytes(audio);
  return decodeHexToBytes(audio);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

function getString(obj: JsonObject, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

export function createMinimaxTtsSession(path: string, params: MinimaxTtsStartParams, callbacks: MinimaxTtsCallbacks): MinimaxTtsSession {
  const url = toWebSocketUrl(path);
  const socket = new WebSocket(url);

  let started = false;
  let closed = false;
  const pendingSend: string[] = [];

  const sendJson = (payload: unknown) => {
    if (closed) return;
    const raw = JSON.stringify(payload);
    pendingSend.push(raw);
    flushPending();
  };

  const flushPending = () => {
    if (closed) return;
    if (socket.readyState !== WebSocket.OPEN) return;
    if (!started) return;
    while (pendingSend.length > 0) {
      const raw = pendingSend.shift();
      if (typeof raw === "string") socket.send(raw);
    }
  };

  socket.addEventListener("open", () => {
    const initPayload = {
      event: "task_start",
      model: params.model,
      voice_setting: {
        voice_id: params.voice.voiceId,
        speed: params.voice.speed,
        vol: params.voice.volume,
        pitch: params.voice.pitch,
      },
      audio_setting: {
        sample_rate: params.audio.sampleRate,
        bitrate: params.audio.bitrate,
        format: params.audio.format,
        channel: params.audio.channel,
      },
    };

    socket.send(JSON.stringify(initPayload));
  });

  socket.addEventListener("message", (evt) => {
    if (typeof evt.data !== "string") return;
    const msg = safeJsonParse(evt.data);
    callbacks.onEvent?.(msg);
    if (!isObject(msg)) return;

    const baseResp = msg["base_resp"];
    if (isObject(baseResp)) {
      const statusCode = baseResp["status_code"];
      if (typeof statusCode === "number" && statusCode !== 0) {
        const statusMsg = getString(baseResp, "status_msg") ?? "unknown_error";
        callbacks.onError?.(new Error(`minimax_error: ${statusMsg} (${statusCode})`));
      }
    }

    const event = getString(msg, "event");
    if (event === "task_started") {
      started = true;
      flushPending();
      return;
    }

    if (event === "task_failed") {
      callbacks.onError?.(new Error("minimax_task_failed"));
      socket.close();
      return;
    }

    const data = msg["data"];
    if (isObject(data)) {
      const chunk = decodeAudioToBytes(data["audio"], params.encoding);
      if (chunk) callbacks.onAudioChunk?.(chunk);
    }

    if (event === "task_finished") {
      socket.close();
    }
  });

  socket.addEventListener("error", () => {
    callbacks.onError?.(new Error("tts_ws_error"));
  });

  socket.addEventListener("close", () => {
    closed = true;
  });

  return {
    pushText: (text) => {
      const trimmed = String(text ?? "");
      if (!trimmed.trim()) return;
      sendJson({ event: "task_continue", text: trimmed });
    },
    finish: () => {
      sendJson({ event: "task_finish" });
    },
    abort: () => {
      closed = true;
      try {
        socket.close();
      } catch {
        // ignore
      }
    },
  };
}
