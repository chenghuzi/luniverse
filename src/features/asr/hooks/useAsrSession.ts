import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  readAsrProvider,
  readTencentAsrEnvConfig,
  readVolcengineAsrEnvConfig,
  type AsrProvider,
} from "@/features/asr/credentials";
import type { AsrCallbacks, AsrEngineState, AsrStartContext, AsrStopResult } from "@/features/asr/types";
import { TencentRtAsrEngine } from "@/features/asr/tencent/TencentRtAsrEngine";
import { VolcengineRtAsrEngine } from "@/features/asr/volcengine/VolcengineRtAsrEngine";

export function useAsrSession() {
  const provider = useMemo<AsrProvider>(() => readAsrProvider(), []);
  const engineRef = useRef<TencentRtAsrEngine | VolcengineRtAsrEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = provider === "volcengine" ? new VolcengineRtAsrEngine() : new TencentRtAsrEngine();
  }

  const tencentConfig = useMemo(() => (provider === "tencent" ? readTencentAsrEnvConfig() : null), [provider]);
  const volcengineConfig = useMemo(() => (provider === "volcengine" ? readVolcengineAsrEnvConfig() : null), [provider]);
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

      if (provider === "volcengine") {
        const config = volcengineConfig;
        if (!config) {
          const msg = "缺少火山引擎实时语音识别配置";
          setState({ status: "error", error: msg });
          callbacks.onError?.(msg);
          return false;
        }
        return (engine as VolcengineRtAsrEngine).start(context, callbacks, { config, targetSampleRate: 16000 });
      }

      const config = tencentConfig;
      if (!config) {
        const msg = "缺少腾讯云实时语音识别配置";
        setState({ status: "error", error: msg });
        callbacks.onError?.(msg);
        return false;
      }

      return (engine as TencentRtAsrEngine).start(context, callbacks, {
        config,
        targetSampleRate: 16000,
        needVad: opts?.needVad,
      });
    },
    [provider, tencentConfig, volcengineConfig],
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
