import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readTencentAsrEnvConfig } from "@/features/asr/credentials";
import type { AsrCallbacks, AsrEngineState, AsrStartContext, AsrStopResult } from "@/features/asr/types";
import { TencentRtAsrEngine } from "@/features/asr/tencent/TencentRtAsrEngine";

export function useTencentRtAsrSession() {
  const engineRef = useRef<TencentRtAsrEngine | null>(null);
  if (!engineRef.current) engineRef.current = new TencentRtAsrEngine();

  const config = useMemo(() => readTencentAsrEnvConfig(), []);
  const [state, setState] = useState<AsrEngineState>(() => ({
    status: engineRef.current?.status ?? "idle",
    error: engineRef.current?.error ?? null,
  }));

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    return engine.subscribe(setState);
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    return () => engine?.dispose();
  }, []);

  const start = useCallback(
    async (context: AsrStartContext, callbacks: AsrCallbacks, opts?: { needVad?: boolean }) => {
      const engine = engineRef.current;
      if (!engine) return false;
      if (!config) {
        const msg = "Missing Tencent ASR env config";
        setState({ status: "error", error: msg });
        callbacks.onError?.(msg);
        return false;
      }
      return engine.start(context, callbacks, { config, targetSampleRate: 16000, needVad: opts?.needVad });
    },
    [config],
  );

  const pushAudio = useCallback((chunk: Float32Array, sampleRate: number) => {
    engineRef.current?.pushAudio(chunk, sampleRate);
  }, []);

  const stop = useCallback(async (): Promise<AsrStopResult> => {
    const engine = engineRef.current;
    if (!engine) return { finalText: "" };
    return engine.stop();
  }, []);

  return {
    status: state.status,
    error: state.error,
    start,
    pushAudio,
    stop,
  };
}
