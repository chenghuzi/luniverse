import { getGlobalAudioElement } from "@/shared/audio/globalAudio";

type AudioContextCtor = typeof AudioContext & {
  new (contextOptions?: AudioContextOptions): AudioContext;
};

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let timeDomainBuffer: Uint8Array<ArrayBuffer> | null = null;

function getAudioContextCtor(): AudioContextCtor | null {
  const w = typeof window !== "undefined" ? (window as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown }) : null;
  const Ctor = (w?.AudioContext ?? w?.webkitAudioContext) as AudioContextCtor | undefined;
  return typeof Ctor === "function" ? Ctor : null;
}

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  return null;
}

function createContext(): AudioContext | null {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    return ctx;
  } catch {
    ctx = null;
    return null;
  }
}

function getCaptureStream(el: HTMLMediaElement): MediaStream | null {
  const anyEl = el as unknown as {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };

  try {
    if (typeof anyEl.captureStream === "function") return anyEl.captureStream();
    if (typeof anyEl.mozCaptureStream === "function") return anyEl.mozCaptureStream();
    return null;
  } catch {
    return null;
  }
}

function connectGraphIfNeeded(runningCtx: AudioContext) {
  if (analyser && sourceNode && timeDomainBuffer) return;
  const audioEl = getGlobalAudioElement();
  const stream = getCaptureStream(audioEl);
  if (!stream) return;
  try {
    sourceNode = runningCtx.createMediaStreamSource(stream);
    analyser = runningCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.85;
    timeDomainBuffer = new Uint8Array(analyser.fftSize) as Uint8Array<ArrayBuffer>;

    sourceNode.connect(analyser);
  } catch {
    analyser = null;
    sourceNode = null;
    timeDomainBuffer = null;
  }
}

export async function resumeAudioAnalysisFromGesture() {
  let c = ensureContext();
  if (!c) {
    c = createContext();
  }
  if (!c) return;
  try {
    if (c.state !== "running") {
      await c.resume();
    }
  } catch {
    return;
  }
  if (c.state !== "running") return;
  connectGraphIfNeeded(c);
}

function getFallbackLevel(audioEl: HTMLAudioElement) {
  if (audioEl.paused) return 0;
  const t = audioEl.currentTime || 0;
  const a = 0.06 + 0.05 * Math.sin(t * 2.7);
  const b = 0.03 + 0.03 * Math.sin(t * 6.2 + 1.4);
  return Math.max(0, Math.min(1, a + b));
}

export function getAudioLevel() {
  const audioEl = getGlobalAudioElement();

  const c = ensureContext();
  if (!c || c.state !== "running" || !analyser || !timeDomainBuffer) {
    return getFallbackLevel(audioEl);
  }

  try {
    analyser.getByteTimeDomainData(timeDomainBuffer);
    let sum = 0;
    for (let i = 0; i < timeDomainBuffer.length; i++) {
      const v = (timeDomainBuffer[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / timeDomainBuffer.length);
    const normalized = (rms - 0.02) / 0.18;
    return Math.max(0, Math.min(1, normalized));
  } catch {
    return getFallbackLevel(audioEl);
  }
}

export function isAudioAnalysisRunning() {
  return Boolean(ctx && ctx.state === "running" && analyser && timeDomainBuffer);
}
