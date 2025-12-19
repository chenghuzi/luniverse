import type { AsrCallbacks, AsrEngine, AsrEngineState, AsrStartContext, AsrStopResult, AsrStatus, Unsubscribe } from "@/features/asr/types";
import type { TencentAsrEnvConfig } from "@/features/asr/credentials";
import { LinearResampler } from "@/features/asr/audio/LinearResampler";
import { float32ToPcm16, Pcm16FrameAssembler } from "@/features/asr/audio/pcm16";
import { buildTencentAsrWsUrl } from "@/features/asr/tencent/signature";

type TencentStartOptions = {
  config: TencentAsrEnvConfig;
  targetSampleRate?: number;
};

type TencentAsrResponse = {
  code?: number;
  message?: string;
  voice_id?: string;
  final?: 0 | 1;
  result?: {
    slice_type?: 0 | 1 | 2;
    index?: number;
    voice_text_str?: string;
  };
};

function makeId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function joinStableText(stable: Map<number, string>, unstable: { index: number | null; text: string }) {
  const parts: string[] = [];
  const keys = Array.from(stable.keys()).sort((a, b) => a - b);
  for (const k of keys) {
    const t = stable.get(k);
    if (t) parts.push(t);
  }
  if (unstable.text.trim().length > 0 && (unstable.index == null || !stable.has(unstable.index))) {
    parts.push(unstable.text);
  }
  return parts.join("");
}

export class TencentRtAsrEngine implements AsrEngine {
  private state: AsrEngineState;
  private listeners: Set<(s: AsrEngineState) => void>;
  private callbacks: AsrCallbacks;
  private context: AsrStartContext | null;

  private ws: WebSocket | null;
  private ready: boolean;
  private voiceId: string | null;
  private lastFinalText: string;

  private stableSegments: Map<number, string>;
  private unstableSegment: { index: number | null; text: string };

  private targetSampleRate: number;
  private resampler: LinearResampler | null;
  private resamplerSrcRate: number | null;
  private framer: Pcm16FrameAssembler;
  private frameQueue: Uint8Array[];
  private sendTimer: number | null;

  constructor() {
    this.state = { status: "idle", error: null };
    this.listeners = new Set();
    this.callbacks = {};
    this.context = null;

    this.ws = null;
    this.ready = false;
    this.voiceId = null;
    this.lastFinalText = "";

    this.stableSegments = new Map();
    this.unstableSegment = { index: null, text: "" };

    this.targetSampleRate = 16000;
    this.resampler = null;
    this.resamplerSrcRate = null;
    this.framer = new Pcm16FrameAssembler(640);
    this.frameQueue = [];
    this.sendTimer = null;
  }

  get status(): AsrStatus {
    return this.state.status;
  }

  get error(): string | null {
    return this.state.error;
  }

  subscribe(listener: (state: AsrEngineState) => void): Unsubscribe {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(next: Partial<AsrEngineState>) {
    this.state = { ...this.state, ...next };
    for (const l of this.listeners) l(this.state);
  }

  private onError(message: string) {
    this.setState({ status: "error", error: message });
    this.callbacks.onError?.(message);
  }

  private resetSessionState() {
    this.ready = false;
    this.voiceId = null;
    this.lastFinalText = "";
    this.stableSegments.clear();
    this.unstableSegment = { index: null, text: "" };
    this.framer.reset();
    this.frameQueue = [];
    if (this.resampler) this.resampler.reset();
    this.resampler = null;
    this.resamplerSrcRate = null;
  }

  private clearSendTimer() {
    if (this.sendTimer != null) {
      window.clearInterval(this.sendTimer);
      this.sendTimer = null;
    }
  }

  private closeWs() {
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    if (!ws) return;
    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
    } catch {
      // ignore
    }
  }

  private startSendingLoop() {
    this.clearSendTimer();
    this.sendTimer = window.setInterval(() => {
      const ws = this.ws;
      if (!ws || !this.ready) return;
      const frame = this.frameQueue.shift();
      if (!frame) return;
      try {
        ws.send(frame);
      } catch (e) {
        const msg = typeof e === "object" && e ? String((e as { message?: unknown }).message ?? "Failed to send audio") : "Failed to send audio";
        this.onError(msg);
      }
    }, 40);
  }

  async start(context: AsrStartContext, callbacks: AsrCallbacks, options?: TencentStartOptions): Promise<boolean> {
    if (this.state.status !== "idle") return false;
    this.context = context;
    this.callbacks = callbacks;
    this.resetSessionState();

    const config = options?.config;
    if (!config) {
      this.onError("ASR config is missing");
      return false;
    }

    this.targetSampleRate = options?.targetSampleRate ?? 16000;
    this.framer = new Pcm16FrameAssembler(Math.floor(this.targetSampleRate * 0.04));
    this.resampler = null;
    this.resamplerSrcRate = null;

    const voiceId = makeId();
    this.voiceId = voiceId;

    const now = Math.floor(Date.now() / 1000);
    const timestamp = now;
    const expired = now + 24 * 60 * 60;
    const nonce = Math.floor(Math.random() * 1_000_000_000);

    this.setState({ status: "connecting", error: null });

    let url: string;
    try {
      url = await buildTencentAsrWsUrl(
        config.appId,
        {
          secretid: config.secretId,
          timestamp,
          expired,
          nonce,
          engine_model_type: config.engineModelType,
          voice_id: voiceId,
          voice_format: 1,
          needvad: 1,
        },
        config.secretKey,
      );
    } catch (e) {
      const msg = typeof e === "object" && e ? String((e as { message?: unknown }).message ?? "Failed to build ASR URL") : "Failed to build ASR URL";
      this.onError(msg);
      return false;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      const msg = typeof e === "object" && e ? String((e as { message?: unknown }).message ?? "Failed to open WebSocket") : "Failed to open WebSocket";
      this.onError(msg);
      return false;
    }

    this.ws = ws;
    this.startSendingLoop();

    ws.onopen = () => {
      this.ready = true;
      this.setState({ status: "ready", error: null });
    };

    ws.onerror = () => {
      if (this.state.status === "error") return;
      this.onError("ASR WebSocket error");
    };

    ws.onclose = () => {
      if (this.state.status === "stopping" || this.state.status === "idle") return;
      if (this.state.status !== "error") this.onError("ASR WebSocket closed");
    };

    ws.onmessage = (evt) => {
      if (typeof evt.data !== "string") return;

      let msg: TencentAsrResponse;
      try {
        msg = JSON.parse(evt.data) as TencentAsrResponse;
      } catch {
        return;
      }

      const code = msg.code ?? 0;
      if (code !== 0) {
        this.onError(msg.message ?? `ASR error (code ${code})`);
        return;
      }

      if (this.state.status !== "recognizing") this.setState({ status: "recognizing", error: null });

      const result = msg.result;
      if (result) {
        const index = typeof result.index === "number" ? result.index : null;
        const text = typeof result.voice_text_str === "string" ? result.voice_text_str : "";
        const sliceType = result.slice_type ?? 0;

        if (sliceType === 2 && index != null) {
          this.stableSegments.set(index, text);
          if (this.unstableSegment.index === index) this.unstableSegment = { index: null, text: "" };
        } else {
          this.unstableSegment = { index, text };
        }

        const full = joinStableText(this.stableSegments, this.unstableSegment);
        this.callbacks.onPartialText?.(full);
      }

      if (msg.final === 1) {
        const full = joinStableText(this.stableSegments, this.unstableSegment).trim();
        this.lastFinalText = full;
        this.callbacks.onFinalText?.(full);
      }
    };

    return true;
  }

  pushAudio(chunk: Float32Array, sampleRate: number) {
    if (this.state.status !== "ready" && this.state.status !== "recognizing" && this.state.status !== "connecting") return;
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) return;

    if (sampleRate === this.targetSampleRate) {
      const pcm16 = float32ToPcm16(chunk);
      const frames = this.framer.pushPcm16(pcm16);
      for (const f of frames) this.frameQueue.push(f);
      return;
    }

    if (!this.resampler || this.resamplerSrcRate !== sampleRate) {
      this.resampler = new LinearResampler(sampleRate, this.targetSampleRate);
      this.resamplerSrcRate = sampleRate;
    }

    const resampled = this.resampler.push(chunk);
    if (resampled.length === 0) return;
    const pcm16 = float32ToPcm16(resampled);
    const frames = this.framer.pushPcm16(pcm16);
    for (const f of frames) this.frameQueue.push(f);

    if (this.frameQueue.length > 400) {
      this.frameQueue.splice(0, this.frameQueue.length - 400);
    }
  }

  async stop(): Promise<AsrStopResult> {
    if (this.state.status === "idle") return { finalText: "" };
    this.setState({ status: "stopping", error: null });

    const ws = this.ws;
    this.clearSendTimer();

    if (ws && this.ready) {
      while (this.frameQueue.length > 0) {
        const frame = this.frameQueue.shift();
        if (!frame) break;
        try {
          ws.send(frame);
        } catch {
          break;
        }
        await sleep(1);
      }

      try {
        ws.send(JSON.stringify({ type: "end" }));
      } catch {
        // ignore
      }
    }

    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      if (this.lastFinalText.trim().length > 0) break;
      await sleep(30);
    }

    const finalText = this.lastFinalText.trim();
    this.closeWs();
    this.resetSessionState();
    this.setState({ status: "idle", error: null });
    return { finalText };
  }

  dispose() {
    this.clearSendTimer();
    this.closeWs();
    this.resetSessionState();
    this.setState({ status: "idle", error: null });
  }
}
