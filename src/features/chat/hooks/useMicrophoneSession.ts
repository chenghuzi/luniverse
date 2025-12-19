import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type MicStatus = "idle" | "requesting" | "listening" | "denied" | "error";

export type MicrophoneWaveform = {
  level: number;
  bars: number[];
};

export type PcmChunkHandler = (chunk: Float32Array, sampleRate: number) => void;

type StartOptions = {
  onPcmChunk?: PcmChunkHandler;
  barCount?: number;
};

type InternalNodes = {
  stream: MediaStream;
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  processor: ScriptProcessorNode;
  silentGain: GainNode;
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function mapGetUserMediaError(e: unknown): { status: MicStatus; message: string } {
  const name = typeof e === "object" && e ? (e as { name?: unknown }).name : undefined;
  const strName = typeof name === "string" ? name : "UnknownError";

  if (strName === "NotAllowedError" || strName === "SecurityError") {
    return { status: "denied", message: "Microphone permission denied" };
  }
  if (strName === "NotFoundError" || strName === "DevicesNotFoundError") {
    return { status: "error", message: "No microphone device found" };
  }
  if (strName === "NotReadableError" || strName === "TrackStartError") {
    return { status: "error", message: "Microphone is not available" };
  }
  return { status: "error", message: "Failed to access microphone" };
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
  const nodesRef = useRef<InternalNodes | null>(null);
  const rafRef = useRef<number | null>(null);
  const timeDomainRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const prevBarsRef = useRef<number[]>([]);
  const lastUpdateMsRef = useRef<number>(0);
  const onPcmChunkRef = useRef<PcmChunkHandler | null>(null);
  const barCountRef = useRef<number>(18);
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
        nodes.processor.onaudioprocess = null;
      } catch {
        // ignore
      }
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
        nodes.processor.disconnect();
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
    startingRef.current = false;
  }, []);

  const start = useCallback(
    async (options?: StartOptions) => {
      if (nodesRef.current) return true;
      if (startingRef.current) return false;
      startingRef.current = true;

      const nextBarCount = options?.barCount ?? barCountRef.current;
      barCountRef.current = nextBarCount;
      onPcmChunkRef.current = options?.onPcmChunk ?? null;

      setStatus("requesting");
      setError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setError("Microphone API is not supported");
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
        setError("Web Audio API is not supported");
        startingRef.current = false;
        return false;
      }

      const audioContext = new AudioContextCtor();
      try {
        await audioContext.resume();
      } catch {
        // ignore
      }

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;

      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;

      processor.onaudioprocess = (evt) => {
        const handler = onPcmChunkRef.current;
        if (!handler) return;
        const input = evt.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        handler(copy, evt.inputBuffer.sampleRate);
      };

      source.connect(analyser);
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);

      nodesRef.current = { stream, audioContext, source, analyser, processor, silentGain };
      timeDomainRef.current = new Uint8Array(analyser.fftSize) as Uint8Array<ArrayBuffer>;
      prevBarsRef.current = new Array<number>(barCountRef.current).fill(0);
      lastUpdateMsRef.current = 0;

      setStatus("listening");
      setError(null);
      startingRef.current = false;

      const tick = (nowMs: number) => {
        const nodes = nodesRef.current;
        const timeDomain = timeDomainRef.current;
        if (!nodes || !timeDomain) return;

        nodes.analyser.getByteTimeDomainData(timeDomain);

        const shouldUpdate = nowMs - lastUpdateMsRef.current >= 33;
        if (shouldUpdate) {
          lastUpdateMsRef.current = nowMs;

          const computed = computeBarsFromTimeDomain(timeDomain, barCountRef.current);
          const prevBars = prevBarsRef.current;
          const smoothing = 0.66;
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
    [],
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
