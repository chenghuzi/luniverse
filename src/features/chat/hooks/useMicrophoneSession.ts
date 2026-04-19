import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type MicStatus = "idle" | "requesting" | "listening" | "denied" | "error";

export type MicrophoneWaveform = {
  level: number;
  bars: number[];
};

export type PcmChunkHandler = (chunk: Float32Array, sampleRate: number) => void;

type WaveformTuning = {
  noiseFloor: number;
  peakDecay: number;
  boost: number;
  gamma: number;
  smoothing: number;
};

type StartOptions = {
  onPcmChunk?: PcmChunkHandler;
  barCount?: number;
  waveform?: Partial<WaveformTuning>;
};

type InternalNodes = {
  stream: MediaStream;
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  workletNode: AudioWorkletNode | null;
  scriptProcessor: ScriptProcessorNode | null;
  silentGain: GainNode;
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function mapGetUserMediaError(e: unknown): { status: MicStatus; message: string } {
  const name = typeof e === "object" && e ? (e as { name?: unknown }).name : undefined;
  const strName = typeof name === "string" ? name : "UnknownError";

  if (strName === "NotAllowedError" || strName === "SecurityError") {
    return { status: "denied", message: "麦克风权限被拒绝" };
  }
  if (strName === "NotFoundError" || strName === "DevicesNotFoundError") {
    return { status: "error", message: "未找到麦克风设备" };
  }
  if (strName === "NotReadableError" || strName === "TrackStartError") {
    return { status: "error", message: "麦克风当前不可用" };
  }
  return { status: "error", message: "访问麦克风失败" };
}

function computeBarsFromTimeDomain(data: Uint8Array, barCount: number) {
  if (barCount <= 0) return { bars: [], level: 0 };
  const bars = new Array<number>(barCount).fill(0);

  const step = Math.max(1, Math.floor(data.length / barCount));
  for (let i = 0; i < barCount; i++) {
    const start = i * step;
    const end = i === barCount - 1 ? data.length : start + step;
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      const v = (data[j] - 128) / 128;
      sum += Math.abs(v);
      count += 1;
    }
    const avg = count > 0 ? sum / count : 0;
    bars[i] = clamp01(avg * 2.2);
  }

  const level = bars.reduce((m, v) => (v > m ? v : m), 0);
  return { bars, level };
}

export function useMicrophoneSession() {
  const defaultWaveformTuning = useMemo<WaveformTuning>(
    () => ({
      noiseFloor: 0.02,
      peakDecay: 0.965,
      boost: 1.35,
      gamma: 0.55,
      smoothing: 0.52,
    }),
    [],
  );

  const nodesRef = useRef<InternalNodes | null>(null);
  const rafRef = useRef<number | null>(null);
  const timeDomainRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const prevBarsRef = useRef<number[]>([]);
  const lastUpdateMsRef = useRef<number>(0);
  const peakRef = useRef<number>(0);
  const onPcmChunkRef = useRef<PcmChunkHandler | null>(null);
  const barCountRef = useRef<number>(18);
  const waveformTuningRef = useRef<WaveformTuning>(defaultWaveformTuning);
  const startingRef = useRef<boolean>(false);

  const [status, setStatus] = useState<MicStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [waveform, setWaveform] = useState<MicrophoneWaveform>(() => ({
    level: 0,
    bars: new Array<number>(barCountRef.current).fill(0),
  }));

  const stop = useCallback(() => {
    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const nodes = nodesRef.current;
    nodesRef.current = null;
    timeDomainRef.current = null;
    prevBarsRef.current = [];

    if (nodes) {
      try {
        nodes.source.disconnect();
      } catch {
        // ignore
      }
      try {
        nodes.analyser.disconnect();
      } catch {
        // ignore
      }
      try {
        nodes.workletNode?.disconnect();
      } catch {
        // ignore
      }
      try {
        if (nodes.scriptProcessor) {
          nodes.scriptProcessor.onaudioprocess = null;
          nodes.scriptProcessor.disconnect();
        }
      } catch {
        // ignore
      }
      try {
        nodes.silentGain.disconnect();
      } catch {
        // ignore
      }
      try {
        for (const t of nodes.stream.getTracks()) t.stop();
      } catch {
        // ignore
      }
      void nodes.audioContext.close().catch(() => {});
    }

    setWaveform((prev) => ({
      level: 0,
      bars: prev.bars.map(() => 0),
    }));

    setStatus("idle");
    setError(null);
    onPcmChunkRef.current = null;
    waveformTuningRef.current = defaultWaveformTuning;
    peakRef.current = 0;
    startingRef.current = false;
  }, [defaultWaveformTuning]);

  const start = useCallback(
    async (options?: StartOptions) => {
      if (nodesRef.current) return true;
      if (startingRef.current) return false;
      startingRef.current = true;

      const nextBarCount = options?.barCount ?? barCountRef.current;
      barCountRef.current = nextBarCount;
      onPcmChunkRef.current = options?.onPcmChunk ?? null;
      waveformTuningRef.current = { ...defaultWaveformTuning, ...(options?.waveform ?? {}) };

      setStatus("requesting");
      setError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setError("当前浏览器不支持麦克风接口");
        startingRef.current = false;
        return false;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        const mapped = mapGetUserMediaError(e);
        setStatus(mapped.status);
        setError(mapped.message);
        startingRef.current = false;
        return false;
      }

      const AudioContextCtor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
      if (!AudioContextCtor) {
        try {
          for (const t of stream.getTracks()) t.stop();
        } catch {
          // ignore
        }
        setStatus("error");
        setError("当前浏览器不支持 Web Audio");
        startingRef.current = false;
        return false;
      }

      const audioContext = new AudioContextCtor();
      
      if (audioContext.state === 'suspended') {
        try {
          await audioContext.resume();
        } catch (resumeError) {
          console.warn('AudioContext resume failed:', resumeError);
        }
      }

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.45;

      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;

      let workletNode: AudioWorkletNode | null = null;
      let scriptProcessor: ScriptProcessorNode | null = null;

      if (onPcmChunkRef.current) {
        try {
          await audioContext.audioWorklet.addModule("/pcm-processor.js");
          workletNode = new AudioWorkletNode(audioContext, "pcm-processor");
          workletNode.port.onmessage = (evt) => {
            const handler = onPcmChunkRef.current;
            if (!handler) return;
            const { pcm, sampleRate } = evt.data;
            if (pcm && typeof sampleRate === "number") {
              handler(new Float32Array(pcm), sampleRate);
            }
          };
        } catch (workletError) {
          console.warn('AudioWorklet failed, falling back to ScriptProcessorNode:', workletError);
          workletNode = null;
        }

        if (!workletNode) {
          scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
          scriptProcessor.onaudioprocess = (evt) => {
            const handler = onPcmChunkRef.current;
            if (!handler) return;
            const input = evt.inputBuffer.getChannelData(0);
            const copy = new Float32Array(input.length);
            copy.set(input);
            handler(copy, evt.inputBuffer.sampleRate);
          };
        }
      }

      source.connect(analyser);
      if (workletNode) {
        source.connect(workletNode);
        workletNode.connect(silentGain);
      } else if (scriptProcessor) {
        source.connect(scriptProcessor);
        scriptProcessor.connect(silentGain);
      }
      silentGain.connect(audioContext.destination);

      nodesRef.current = { stream, audioContext, source, analyser, workletNode, scriptProcessor, silentGain };
      timeDomainRef.current = new Uint8Array(analyser.fftSize) as Uint8Array<ArrayBuffer>;
      prevBarsRef.current = new Array<number>(barCountRef.current).fill(0);
      lastUpdateMsRef.current = 0;
      peakRef.current = 0.12;

      setStatus("listening");
      setError(null);
      startingRef.current = false;

      const normalize = (computed: { bars: number[]; level: number }) => {
        const tuning = waveformTuningRef.current;
        const eps = 1e-4;
        const floor = Math.max(0, Math.min(0.25, tuning.noiseFloor));

        const prevPeak = peakRef.current;
        const nextPeak = Math.max(computed.level, prevPeak * tuning.peakDecay);
        peakRef.current = nextPeak;

        const denom = Math.max(eps, nextPeak - floor);
        const normalizedBars = computed.bars.map((v) => {
          const gated = (v - floor) / denom;
          const shaped = Math.pow(clamp01(gated), tuning.gamma) * tuning.boost;
          return clamp01(shaped);
        });

        const level = normalizedBars.reduce((m, v) => (v > m ? v : m), 0);
        return { bars: normalizedBars, level };
      };

      const tick = (nowMs: number) => {
        const nodes = nodesRef.current;
        const timeDomain = timeDomainRef.current;
        if (!nodes || !timeDomain) return;

        nodes.analyser.getByteTimeDomainData(timeDomain);

        const shouldUpdate = nowMs - lastUpdateMsRef.current >= 33;
        if (shouldUpdate) {
          lastUpdateMsRef.current = nowMs;

          const computed = normalize(computeBarsFromTimeDomain(timeDomain, barCountRef.current));
          const prevBars = prevBarsRef.current;
          const smoothing = waveformTuningRef.current.smoothing;
          const smoothBars = computed.bars.map((v: number, idx: number) => {
            const prev = prevBars[idx] ?? 0;
            return prev * smoothing + v * (1 - smoothing);
          });
          prevBarsRef.current = smoothBars;

          const level = smoothBars.reduce((m: number, v: number) => (v > m ? v : m), 0);
          setWaveform({ level, bars: smoothBars });
        }

        rafRef.current = window.requestAnimationFrame(tick);
      };

      rafRef.current = window.requestAnimationFrame(tick);
      return true;
    },
    [defaultWaveformTuning],
  );

  const isActive = useMemo(() => status === "requesting" || status === "listening", [status]);

  useEffect(() => stop, [stop]);

  return {
    status,
    error,
    waveform,
    isActive,
    start,
    stop,
  };
}
