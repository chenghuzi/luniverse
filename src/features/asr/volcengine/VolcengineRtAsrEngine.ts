import type { AsrCallbacks, AsrEngine, AsrEngineState, AsrStartContext, AsrStopResult, AsrStatus, Unsubscribe } from "@/features/asr/types";
import type { VolcengineAsrEnvConfig } from "@/features/asr/credentials";
import { LinearResampler } from "@/features/asr/audio/LinearResampler";
import { float32ToPcm16, Pcm16FrameAssembler } from "@/features/asr/audio/pcm16";

type VolcengineStartOptions = {
  config: VolcengineAsrEnvConfig;
  targetSampleRate?: number;
};

type VolcengineProxyMessage = {
  type?: "ready" | "partial" | "final" | "error";
  text?: string;
  message?: string;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export class VolcengineRtAsrEngine implements AsrEngine {
  private state: AsrEngineState;
  private listeners: Set<(s: AsrEngineState) => void>;
  private callbacks: AsrCallbacks;
  private context: AsrStartContext | null;

  private ws: WebSocket | null;
  private ready: boolean;
  private lastPartialText: string;
  private lastFinalText: string;

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
    this.lastPartialText = "";
    this.lastFinalText = "";

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
    this.lastPartialText = "";
    this.lastFinalText = "";
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
      if (!ws || !this.ready || ws.readyState !== WebSocket.OPEN) return;
      const frame = this.frameQueue.shift();
      if (!frame) return;
      try {
        ws.send(frame);
      } catch {
        this.onError("发送音频失败");
      }
    }, 40);
  }

  async start(context: AsrStartContext, callbacks: AsrCallbacks, options?: VolcengineStartOptions): Promise<boolean> {
    if (this.state.status !== "idle") return false;
    this.context = context;
    this.callbacks = callbacks;
    this.resetSessionState();

    const config = options?.config;
    if (!config?.wsPath) {
      this.onError("缺少火山引擎语音识别配置");
      return false;
    }

    this.targetSampleRate = options?.targetSampleRate ?? 16000;
    this.framer = new Pcm16FrameAssembler(Math.floor(this.targetSampleRate * 0.04));
    this.resampler = null;
    this.resamplerSrcRate = null;

    this.setState({ status: "connecting", error: null });

    let ws: WebSocket;
    try {
      ws = new WebSocket(config.wsPath);
    } catch {
      this.onError("打开语音识别连接失败");
      return false;
    }

    ws.binaryType = "arraybuffer";
    this.ws = ws;
    this.startSendingLoop();

    ws.onopen = () => {
      this.setState({ status: "connecting", error: null });
    };

    ws.onerror = () => {
      if (this.state.status === "error") return;
      this.onError("语音识别连接异常");
    };

    ws.onclose = () => {
      if (this.state.status === "stopping" || this.state.status === "idle") return;
      if (this.state.status !== "error") this.onError("语音识别连接已关闭");
    };

    ws.onmessage = (evt) => {
      if (typeof evt.data !== "string") return;

      let msg: VolcengineProxyMessage;
      try {
        msg = JSON.parse(evt.data) as VolcengineProxyMessage;
      } catch {
        return;
      }

      if (msg.type === "ready") {
        this.ready = true;
        this.setState({ status: "ready", error: null });
        return;
      }

      if (msg.type === "error") {
        this.onError(String(msg.message ?? "语音识别服务异常"));
        return;
      }

      const text = String(msg.text ?? "");
      if (msg.type === "partial") {
        if (this.state.status !== "recognizing") this.setState({ status: "recognizing", error: null });
        if (text !== this.lastPartialText) {
          this.lastPartialText = text;
          this.callbacks.onPartialText?.(text);
        }
        return;
      }

      if (msg.type === "final") {
        if (this.state.status !== "recognizing") this.setState({ status: "recognizing", error: null });
        this.lastPartialText = text;
        this.lastFinalText = text.trim();
        this.callbacks.onFinalText?.(this.lastFinalText);
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

    if (ws && ws.readyState === WebSocket.OPEN) {
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
