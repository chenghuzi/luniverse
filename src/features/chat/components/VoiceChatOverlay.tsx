import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";

import { VoiceWaveform } from "@/features/chat/components/VoiceWaveform";
import { useMicrophoneSession } from "@/features/chat/hooks/useMicrophoneSession";
import { useAsrSession } from "@/features/asr/hooks/useAsrSession";
import { createDashscopeLlmClient } from "@/features/llm/dashscope/DashscopeLlmClient";
import type { LlmMessage, LlmStreamHandle } from "@/features/llm/types";
import { fetchMinimaxTtsConfig, type MinimaxTtsConfig, type VolcengineTtsConfig, type TtsConfig } from "@/features/tts/minimax/config";
import { createMinimaxTtsSession, type MinimaxTtsSession } from "@/features/tts/minimax/session";
import { createVolcengineTtsSession, type VolcengineTtsSession } from "@/features/tts/minimax/volcengineSession";
import type { ChatSeedBundle } from "@/shared/api/details";

export type EpisodeItem = {
  id: string;
  title: string;
};

export type VoiceChatContext =
  | {
      kind: "podcast";
      cardId: string;
      podcastId: string;
      podcastTitle: string;
      coverUrl?: string | null;
      ttsConfig?: MinimaxTtsConfig | null;
      seedMessages?: LlmMessage[];
    }
  | {
      kind: "episode";
      cardId: string;
      podcastId: string;
      podcastTitle: string;
      episodeId: string;
      episodeTitle: string;
      coverUrl?: string | null;
      ttsConfig?: MinimaxTtsConfig | null;
      seedMessages?: LlmMessage[];
    };

type VoiceChatOverlayProps = {
  open: boolean;
  podcastContext: VoiceChatContext | null;
  episodeContext: VoiceChatContext | null;
  defaultKind: "podcast" | "episode";
  episodes?: EpisodeItem[];
  chatEpisodes?: Record<string, ChatSeedBundle>;
  onClose: () => void;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  kind: "text" | "voice";
  text: string;
  durationMs?: number;
  createdAt: number;
};

type OverlayMode = "timeline" | "siri";
type SiriState = "idle" | "listening" | "thinking" | "speaking" | "error";

function parseBooleanFlag(raw: unknown): boolean {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function isVoiceOnlyModeEnabled(): boolean {
  return parseBooleanFlag(import.meta.env.VITE_VOICE_CHAT_VOICE_ONLY);
}

function isSiriModeEnabled(): boolean {
  return parseBooleanFlag(import.meta.env.VITE_VOICE_CHAT_SIRI_MODE);
}

function isSiriAutoListenEnabled(): boolean {
  return parseBooleanFlag(import.meta.env.VITE_VOICE_CHAT_SIRI_AUTO_LISTEN);
}

function stopEvent(e: SyntheticEvent) {
  e.preventDefault();
  e.stopPropagation();
}

function makeId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function pickOne<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const ASSISTANT_TEXTS = [
  "好，我来帮你抓重点：1）…… 2）…… 3）……",
  "如果只记住一件事，就先抓住核心约束和关键取舍。",
  "这期内容的核心很简单：先定义问题，再收窄范围，最后快速验证假设。",
  "我可以帮你整理。你听完之后最想得到什么？",
  "可以先用一个很短的提纲来看：背景、转折、核心观点和实际启发。",
  "我觉得这期最强的地方，是把一个具体例子连到了更一般的原则上。",
  "你可以这样听：先找反复出现的主题，再把它映射到你正在做的判断上。",
  "我会先用 30 秒帮你总结，再展开你最关心的那部分。",
] as const;

const MIN_VOICE_SEND_MS = 450;
const MAX_VOICE_DURATION_MS = 60000;
const VOICE_COUNTDOWN_START_MS = 50000;
const MAX_CONTEXT_MESSAGES = 18;
const TTS_FLUSH_MS = 300;
const TTS_MAX_CHARS = 60;
const TTS_VOICE_WAVE_BARS = 18;
const VOICE_INPUT_RETRY_TEXT = "没听清，再说一遍试试。";

const TTS_PUNCTUATION = new Set([
  "\u3002",
  "\uff01",
  "\uff1f",
  "!",
  "?",
  "\uff0c",
  ",",
  "\uff1b",
  ";",
  "\uff1a",
  ":",
  "\u3001",
  ".",
  "\n",
]);

function encodeWav(chunks: { data: Float32Array; sampleRate: number }[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0);
  
  const sampleRate = chunks[0].sampleRate;
  const totalSamples = chunks.reduce((sum, c) => sum + c.data.length, 0);
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = totalSamples * bitsPerSample / 8;
  const headerSize = 44;
  
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);
  
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  
  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.data.length; i++) {
      const sample = Math.max(-1, Math.min(1, chunk.data[i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }
  
  return new Uint8Array(buffer);
}

function normalizeSeedMessages(messages: LlmMessage[] | undefined): LlmMessage[] | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const normalized = messages
    .map((m) => ({ role: m.role, content: String(m.content ?? "") }))
    .filter((m) => m.content.trim().length > 0);
  return normalized.length > 0 ? normalized : null;
}

function buildSeedMessages(context: VoiceChatContext | null): LlmMessage[] {
  const provided = normalizeSeedMessages(context?.seedMessages);
  if (provided) return provided;

  if (!context) return [{ role: "system", content: "你是一名有帮助的语音助手。请保持简洁、直接、可执行。" }];
  if (context.kind === "podcast") {
    return [
      {
        role: "system",
        content: `你是播客“${context.podcastTitle}”的语音助手。请保持简洁、直接、可执行。`,
      },
    ];
  }

  return [
    {
      role: "system",
      content: `你是播客“${context.podcastTitle}”中单集“${context.episodeTitle}”的语音助手。请保持简洁、直接、可执行。`,
    },
  ];
}

function isVoicePlaceholderText(text: string): boolean {
  return /^Voice message \(\d+(?:\.\d+)?s\)$/.test(text.trim());
}

function toLlmMessages(seedMessages: LlmMessage[], history: ChatMessage[]): LlmMessage[] {
  const trimmed = history.slice(-MAX_CONTEXT_MESSAGES);
  const messages: LlmMessage[] = [...seedMessages];
  for (const m of trimmed) messages.push({ role: m.role, content: m.text });
  return messages;
}

export function VoiceChatOverlay(props: VoiceChatOverlayProps) {
  const voiceOnly = useMemo(() => isVoiceOnlyModeEnabled(), []);
  const overlayMode: OverlayMode = useMemo(() => (isSiriModeEnabled() ? "siri" : "timeline"), []);
  const [isPressing, setIsPressing] = useState(false);
  const [recognizedText, setRecognizedText] = useState("");
  const [lastRecordingMs, setLastRecordingMs] = useState<number | null>(null);
  const [recordingCountdown, setRecordingCountdown] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const recognizedRef = useRef<string>("");
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const replyTimeoutsRef = useRef<number[]>([]);
  const llmStreamRef = useRef<LlmStreamHandle | null>(null);
  const ttsSessionRef = useRef<MinimaxTtsSession | VolcengineTtsSession | null>(null);
  const ttsFlushTimerRef = useRef<number | null>(null);
  const ttsPendingTextRef = useRef<string>("");
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsMediaSourceRef = useRef<MediaSource | null>(null);
  const ttsSourceBufferRef = useRef<SourceBuffer | null>(null);
  const ttsObjectUrlRef = useRef<string | null>(null);
  const ttsChunkQueueRef = useRef<ArrayBuffer[]>([]);
  const ttsEndPendingRef = useRef<boolean>(false);
  const ttsAssistantIdRef = useRef<string | null>(null);
  const [ttsAudioPlaying, setTtsAudioPlaying] = useState(false);
  const ttsPlaybackActiveRef = useRef<boolean>(false);
  const ttsWaveRafRef = useRef<number | null>(null);
  const ttsWavePrevBarsRef = useRef<number[]>(Array.from({ length: TTS_VOICE_WAVE_BARS }, () => 0));
  const [assistantWaveBars, setAssistantWaveBars] = useState<Record<string, number[]>>({});
  const [assistantHasVoice, setAssistantHasVoice] = useState<Record<string, boolean>>({});
  const ttsWaveFakeSeedRef = useRef<number>(Math.random() * 1000);
  const messagesRef = useRef<ChatMessage[]>([]);
  const isNearBottomRef = useRef<boolean>(true);
  const scrollRafRef = useRef<number | null>(null);
  const pressTokenRef = useRef<number>(0);
  const isPressingRef = useRef<boolean>(false);
  const pressStartMsRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const siriTokenRef = useRef<number>(0);
  const siriListeningRef = useRef<boolean>(false);
  const siriAutoRearmRef = useRef<boolean>(true);
  const [siriState, setSiriState] = useState<SiriState>("idle");
  const [assistantLiveText, setAssistantLiveText] = useState<string>("");
  const assistantLiveTextRef = useRef<string>("");
  const [siriError, setSiriError] = useState<string | null>(null);
  const ttsVolcengineChunksRef = useRef<Uint8Array[]>([]);
  const ttsBufferedTextRef = useRef<string>("");
  const ttsRevealTimerRef = useRef<number | null>(null);
  const ttsRevealedLengthRef = useRef<number>(0);
  const ttsCurrentAssistantIdRef = useRef<string | null>(null);
  const [assistantLoadingIds, setAssistantLoadingIds] = useState<Set<string>>(new Set());
  const [expandedTextIds, setExpandedTextIds] = useState<Set<string>>(new Set());
  const [assistantAudioUrls, setAssistantAudioUrls] = useState<Record<string, string>>({});
  const assistantAudioUrlsRef = useRef<Record<string, string>>({});
  const [userAudioUrls, setUserAudioUrls] = useState<Record<string, string>>({});
  const userAudioUrlsRef = useRef<Record<string, string>>({});
  const userPcmChunksRef = useRef<{ data: Float32Array; sampleRate: number }[]>([]);
  const mic = useMicrophoneSession();
  const { start: startAsr, pushAudio: pushAsrAudio, stop: stopAsr, status: asrStatus, error: asrError } = useAsrSession();
  const llmClient = useMemo(() => createDashscopeLlmClient(), []);
  const [chatKind, setChatKind] = useState<"podcast" | "episode">(props.defaultKind);
  const [showEpisodePicker, setShowEpisodePicker] = useState(false);
  const [episodePickerClosing, setEpisodePickerClosing] = useState(false);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(
    props.episodeContext?.kind === "episode" ? props.episodeContext.episodeId : null
  );

  const closeEpisodePicker = () => {
    setEpisodePickerClosing(true);
    setTimeout(() => {
      setShowEpisodePicker(false);
      setEpisodePickerClosing(false);
    }, 200);
  };

  const openEpisodePicker = () => {
    setEpisodePickerClosing(false);
    setShowEpisodePicker(true);
  };

  const toggleEpisodePicker = () => {
    if (showEpisodePicker || episodePickerClosing) {
      closeEpisodePicker();
    } else {
      openEpisodePicker();
    }
  };

  const availableEpisodes = useMemo(() => {
    if (!props.episodes) return [];
    return props.episodes;
  }, [props.episodes]);

  const canChatEpisode = (episodeId: string) => {
    return !!props.chatEpisodes?.[episodeId]?.messages?.length;
  };

  const selectedEpisode = useMemo(() => {
    if (!selectedEpisodeId) return null;
    return availableEpisodes.find((ep) => ep.id === selectedEpisodeId) ?? null;
  }, [availableEpisodes, selectedEpisodeId]);

  const context = useMemo(() => {
    if (chatKind === "podcast") return props.podcastContext;
    if (!selectedEpisodeId || !props.chatEpisodes?.[selectedEpisodeId]?.messages?.length) return null;
    const podcastCtx = props.podcastContext;
    if (!podcastCtx) return null;
    const ep = props.episodes?.find((e) => e.id === selectedEpisodeId);
    if (!ep) return null;
    return {
      kind: "episode" as const,
      cardId: podcastCtx.cardId,
      podcastId: podcastCtx.podcastId,
      podcastTitle: podcastCtx.podcastTitle,
      episodeId: ep.id,
      episodeTitle: ep.title,
      coverUrl: podcastCtx.coverUrl,
      ttsConfig: props.episodeContext?.ttsConfig ?? podcastCtx.ttsConfig,
      seedMessages: props.chatEpisodes[ep.id].messages,
    };
  }, [chatKind, selectedEpisodeId, props.podcastContext, props.episodeContext, props.chatEpisodes, props.episodes]);
  const [ttsConfig, setTtsConfig] = useState<TtsConfig | null>(context?.ttsConfig ?? null);

  function stopTtsWaveLoop() {
    if (ttsWaveRafRef.current == null) return;
    window.cancelAnimationFrame(ttsWaveRafRef.current);
    ttsWaveRafRef.current = null;
  }

  function clamp01(v: number) {
    return Math.max(0, Math.min(1, v));
  }

  function buildStaticVoiceMessageBars(durationMs: number | undefined): number[] {
    const barCount = 18;
    const d = typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 800;
    const seconds = clampNumber(d / 1000, 0.25, 6.5);
    const seed = seconds * 2.3;

    const bars: number[] = [];
    for (let i = 0; i < barCount; i += 1) {
      const x = barCount <= 1 ? 0 : i / (barCount - 1);
      const envelope = Math.pow(Math.sin(Math.PI * x), 0.6);
      const wave1 = 0.5 + 0.5 * Math.sin(seed + x * 4.2 + i * 0.28);
      const wave2 = 0.3 + 0.3 * Math.sin(seed * 1.3 + x * 7.8 + i * 0.42);
      const v = clamp01(0.15 + envelope * (0.5 * wave1 + 0.35 * wave2));
      bars.push(v);
    }
    return bars;
  }

  function generateFakeVoiceBars(nowMs: number): number[] {
    const t = nowMs / 1000;
    const out: number[] = [];
    const seed = ttsWaveFakeSeedRef.current;
    for (let i = 0; i < TTS_VOICE_WAVE_BARS; i += 1) {
      const phase = seed + i * 0.77;
      const a = 0.55 + 0.45 * Math.sin(t * (2.4 + (i % 3) * 0.45) + phase);
      const b = 0.35 + 0.35 * Math.sin(t * (5.1 + (i % 5) * 0.35) + phase * 1.7);
      const c = 0.20 + 0.20 * Math.sin(t * (9.3 + (i % 7) * 0.25) + phase * 0.4);
      const v = clamp01(0.15 + 0.55 * a + 0.35 * b + 0.15 * c);
      out.push(v);
    }
    return out;
  }

  function smoothBars(prev: number[], next: number[], alpha: number): number[] {
    if (prev.length !== next.length) return next.slice();
    const out: number[] = [];
    for (let i = 0; i < next.length; i += 1) {
      out.push(prev[i]! * (1 - alpha) + next[i]! * alpha);
    }
    return out;
  }

  function setBarsForAssistant(assistantId: string, bars: number[]) {
    setAssistantWaveBars((prev) => {
      const current = prev[assistantId];
      if (current && current.length === bars.length) {
        let same = true;
        for (let i = 0; i < bars.length; i += 1) {
          if (Math.abs((current[i] ?? 0) - (bars[i] ?? 0)) > 1e-4) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return { ...prev, [assistantId]: bars };
    });
  }

  function startTtsWaveLoop(assistantId: string) {
    ttsAssistantIdRef.current = assistantId;
    stopTtsWaveLoop();

    const tick = (now: number) => {
      const activeId = ttsAssistantIdRef.current;
      if (!activeId) return;
      if (!ttsPlaybackActiveRef.current) return;

      const raw = generateFakeVoiceBars(now);
      const prev = ttsWavePrevBarsRef.current;
      const smoothed = smoothBars(prev, raw, 0.22);
      ttsWavePrevBarsRef.current = smoothed;
      setBarsForAssistant(activeId, smoothed);
      ttsWaveRafRef.current = window.requestAnimationFrame(tick);
    };

    ttsWaveRafRef.current = window.requestAnimationFrame(tick);
  }

  const targetName = useMemo(() => {
    if (!context) return "语音聊天";
    if (context.kind === "podcast") return context.podcastTitle;
    return context.episodeTitle;
  }, [context]);

  const hudSubtitle = useMemo(() => {
    if (!context) return "暂无上下文";
    if (context.kind === "podcast") return "播客";
    return `播客 · ${context.podcastTitle}`;
  }, [context]);

  useEffect(() => {
    if (!context?.ttsConfig) return;
    setTtsConfig(context.ttsConfig);
  }, [context]);

  useEffect(() => {
    if (!props.open) return;
    if (ttsConfig) return;
    const controller = new AbortController();
    void fetchMinimaxTtsConfig({ cardId: context?.cardId, signal: controller.signal })
      .then((cfg) => setTtsConfig(cfg))
      .catch(() => {});
    return () => controller.abort();
  }, [context?.cardId, props.open, ttsConfig]);

  function clearReplyTimers() {
    for (const id of replyTimeoutsRef.current) window.clearTimeout(id);
    replyTimeoutsRef.current = [];
  }

  function abortLlmStream() {
    llmStreamRef.current?.abort();
    llmStreamRef.current = null;
  }

  function clearTtsFlushTimer() {
    if (ttsFlushTimerRef.current == null) return;
    window.clearTimeout(ttsFlushTimerRef.current);
    ttsFlushTimerRef.current = null;
  }

  function resetTtsPlayback() {
    clearTtsFlushTimer();
    ttsPendingTextRef.current = "";
    ttsChunkQueueRef.current = [];
    ttsEndPendingRef.current = false;
    setTtsAudioPlaying(false);
    ttsPlaybackActiveRef.current = false;
    ttsVolcengineChunksRef.current = [];
    ttsBufferedTextRef.current = "";
    ttsRevealedLengthRef.current = 0;
    ttsCurrentAssistantIdRef.current = null;
    if (ttsRevealTimerRef.current) {
      clearInterval(ttsRevealTimerRef.current);
      ttsRevealTimerRef.current = null;
    }

    const audio = ttsAudioRef.current;
    if (audio) {
      try {
        audio.pause();
      } catch {
        // ignore
      }
    }

    ttsSourceBufferRef.current = null;
    ttsMediaSourceRef.current = null;

    if (ttsObjectUrlRef.current) {
      try {
        URL.revokeObjectURL(ttsObjectUrlRef.current);
      } catch {
        // ignore
      }
      ttsObjectUrlRef.current = null;
    }

    if (audio) audio.removeAttribute("src");
  }

  function abortTtsStream() {
    ttsSessionRef.current?.abort();
    ttsSessionRef.current = null;
    ttsAssistantIdRef.current = null;
    ttsPlaybackActiveRef.current = false;
    stopTtsWaveLoop();
    resetTtsPlayback();
  }

  async function stopSiriListening(reason: "cancel" | "teardown") {
    siriTokenRef.current += 1;
    siriListeningRef.current = false;
    mic.stop();
    try {
      await stopAsr();
    } catch {
      // ignore
    }

    if (overlayMode !== "siri") return;
    if (reason === "teardown") return;
    if (reason === "cancel") setSiriState("idle");
  }

  async function stopSiriListeningAndGetFinalText(): Promise<string> {
    if (overlayMode !== "siri") return "";
    if (!props.open) return "";

    siriTokenRef.current += 1;
    const token = siriTokenRef.current;

    siriListeningRef.current = false;
    mic.stop();

    let res: { finalText: string } = { finalText: "" };
    try {
      res = await stopAsr();
    } catch {
      // ignore
    }

    if (overlayMode !== "siri") return "";
    if (token !== siriTokenRef.current) return "";

    const finalText = String(res.finalText ?? "").trim();
    recognizedRef.current = finalText;
    setRecognizedText(finalText);
    return finalText;
  }

  async function startSiriListening(trigger: "user" | "auto") {
    if (overlayMode !== "siri") return;
    if (!props.open) return;
    if (trigger === "auto" && !isSiriAutoListenEnabled()) return;
    if (trigger === "auto" && !siriAutoRearmRef.current) return;
    if (siriListeningRef.current) return;

    siriTokenRef.current += 1;
    const token = siriTokenRef.current;

    setSiriError(null);
    setSiriState("listening");
    setRecognizedText("");
    recognizedRef.current = "";
    siriListeningRef.current = true;

    const asrStartedPromise = startAsr(
      { targetName },
      {
        onPartialText: (text) => {
          if (overlayMode !== "siri") return;
          if (token !== siriTokenRef.current) return;
          setRecognizedText(String(text ?? ""));
        },
        onFinalText: (text) => {
          if (overlayMode !== "siri") return;
          if (token !== siriTokenRef.current) return;
          setRecognizedText(String(text ?? ""));
        },
        onError: (msg) => {
          if (overlayMode !== "siri") return;
          if (token !== siriTokenRef.current) return;
          siriListeningRef.current = false;
          setSiriState("error");
          setSiriError(String(msg ?? "语音识别异常"));
          setRecognizedText("");
        },
      },
      { needVad: false },
    );

    const micStartedPromise = mic.start({ onPcmChunk: pushAsrAudio });
    const [asrStarted, micStarted] = await Promise.all([asrStartedPromise, micStartedPromise]);
    void asrStarted;

    if (token !== siriTokenRef.current) {
      if (micStarted) mic.stop();
      await stopAsr().catch(() => {});
      return;
    }

    if (!micStarted) {
      siriListeningRef.current = false;
      setSiriState("error");
      setSiriError(mic.error ?? "麦克风不可用");
      setRecognizedText("");
      await stopAsr().catch(() => {});
      return;
    }
  }

  async function siriInterruptAndListen() {
    if (overlayMode !== "siri") return;
    siriAutoRearmRef.current = isSiriAutoListenEnabled();
    abortLlmStream();
    abortTtsStream();
    await stopSiriListening("teardown");
    await startSiriListening("user");
  }

  function ensureTtsPlaybackInitialized(): boolean {
    const audio = ttsAudioRef.current;
    if (!audio) return false;
    if (typeof MediaSource === "undefined") return false;
    if (!MediaSource.isTypeSupported("audio/mpeg")) return false;

    resetTtsPlayback();

    const mediaSource = new MediaSource();
    ttsMediaSourceRef.current = mediaSource;
    const objectUrl = URL.createObjectURL(mediaSource);
    ttsObjectUrlRef.current = objectUrl;
    audio.src = objectUrl;

    mediaSource.addEventListener("sourceopen", () => {
      if (ttsMediaSourceRef.current !== mediaSource) return;
      let sourceBuffer: SourceBuffer;
      try {
        sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
      } catch {
        return;
      }

      sourceBuffer.mode = "sequence";
      ttsSourceBufferRef.current = sourceBuffer;

      const pump = () => {
        if (ttsSourceBufferRef.current !== sourceBuffer) return;
        if (sourceBuffer.updating) return;

        const next = ttsChunkQueueRef.current.shift();
        if (next) {
          try {
            sourceBuffer.appendBuffer(next);
          } catch {
            // ignore
          }
          return;
        }

        if (ttsEndPendingRef.current && mediaSource.readyState === "open") {
          try {
            mediaSource.endOfStream();
          } catch {
            // ignore
          }
        }
      };

      sourceBuffer.addEventListener("updateend", pump);
      pump();
    });

    return true;
  }

  function pushTtsAudioChunk(chunk: Uint8Array) {
    console.log("[TTS] pushTtsAudioChunk called, size:", chunk.byteLength);
    const sourceBuffer = ttsSourceBufferRef.current;
    const mediaSource = ttsMediaSourceRef.current;
    if (!sourceBuffer || !mediaSource) {
      console.log("[TTS] No sourceBuffer or mediaSource");
      return;
    }
    if (mediaSource.readyState !== "open") {
      console.log("[TTS] MediaSource not open, state:", mediaSource.readyState);
      return;
    }

    const copy = new Uint8Array(chunk.byteLength);
    copy.set(chunk);
    const arrayBuffer = copy.buffer;

    if (sourceBuffer.updating || ttsChunkQueueRef.current.length > 0) {
      ttsChunkQueueRef.current.push(arrayBuffer);
      console.log("[TTS] Queued chunk, queue length:", ttsChunkQueueRef.current.length);
      return;
    }

    try {
      sourceBuffer.appendBuffer(arrayBuffer);
      console.log("[TTS] Appended buffer to sourceBuffer");
    } catch {
      // ignore
    }
  }

  function markTtsAudioEnd() {
    ttsEndPendingRef.current = true;
    const sourceBuffer = ttsSourceBufferRef.current;
    const mediaSource = ttsMediaSourceRef.current;
    if (!sourceBuffer || !mediaSource) return;
    if (sourceBuffer.updating) return;
    if (ttsChunkQueueRef.current.length > 0) return;
    if (mediaSource.readyState !== "open") return;
    try {
      mediaSource.endOfStream();
    } catch {
      // ignore
    }

    const audio = ttsAudioRef.current;
    if (audio && audio.paused) {
      ttsPlaybackActiveRef.current = false;
      stopTtsWaveLoop();
    }
  }

  function findLastTtsPunctuation(textBuffer: string): number {
    for (let i = textBuffer.length - 1; i >= 0; i -= 1) {
      if (TTS_PUNCTUATION.has(textBuffer[i] ?? "")) return i + 1;
    }
    return -1;
  }

  function findTtsFlushIndex(textBuffer: string, limit: number): number {
    if (textBuffer.length <= limit) return findLastTtsPunctuation(textBuffer);
    const window = textBuffer.slice(0, limit);
    const idx = findLastTtsPunctuation(window);
    return idx > 0 ? idx : limit;
  }

  function flushTtsPending(force: boolean) {
    const session = ttsSessionRef.current;
    if (!session) return;
    const pending = ttsPendingTextRef.current;
    if (!pending.trim()) return;

    if (!force && pending.length < TTS_MAX_CHARS) return;

    const cutoff = findTtsFlushIndex(pending, TTS_MAX_CHARS);
    if (cutoff <= 0 && !force) return;

    const chunk = pending.slice(0, cutoff > 0 ? cutoff : pending.length);
    ttsPendingTextRef.current = pending.slice(chunk.length);
    session.pushText(chunk);
  }

  function scheduleTtsFlush() {
    if (ttsFlushTimerRef.current != null) return;
    ttsFlushTimerRef.current = window.setTimeout(() => {
      ttsFlushTimerRef.current = null;
      flushTtsPending(true);
    }, TTS_FLUSH_MS);
  }

  function startTextRevealAnimation(durationMs: number) {
    const assistantId = ttsCurrentAssistantIdRef.current;
    if (!assistantId) return;

    const fullText = ttsBufferedTextRef.current;
    if (!fullText) return;

    if (ttsRevealTimerRef.current) {
      clearInterval(ttsRevealTimerRef.current);
      ttsRevealTimerRef.current = null;
    }

    ttsRevealedLengthRef.current = 0;
    const totalChars = fullText.length;
    const interval = Math.max(30, Math.min(80, durationMs / totalChars));
    const charsPerTick = Math.max(1, Math.ceil(totalChars / (durationMs / interval)));

    console.log("[TTS] Starting text reveal animation, totalChars:", totalChars, "duration:", durationMs, "interval:", interval);

    ttsRevealTimerRef.current = window.setInterval(() => {
      const currentLen = ttsRevealedLengthRef.current;
      const nextLen = Math.min(currentLen + charsPerTick, totalChars);
      
      if (nextLen > currentLen) {
        ttsRevealedLengthRef.current = nextLen;
        const revealedText = fullText.slice(0, nextLen);
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: revealedText } : m)));
        ensureScrollToBottomSoon();
      }

      if (nextLen >= totalChars) {
        if (ttsRevealTimerRef.current) {
          clearInterval(ttsRevealTimerRef.current);
          ttsRevealTimerRef.current = null;
        }
      }
    }, interval);
  }

  function playVolcengineAudioBlob() {
    const chunks = ttsVolcengineChunksRef.current;
    const assistantId = ttsCurrentAssistantIdRef.current;
    
    if (chunks.length === 0) {
      console.log("[TTS] No volcengine audio chunks to play");
      if (assistantId) {
        setAssistantLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(assistantId);
          return next;
        });
      }
      return;
    }

    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    const blob = new Blob([combined], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);

    if (assistantId) {
      setAssistantAudioUrls((prev) => {
        if (prev[assistantId]) {
          URL.revokeObjectURL(prev[assistantId]);
        }
        const next = { ...prev, [assistantId]: url };
        assistantAudioUrlsRef.current = next;
        return next;
      });
    }

    const audio = ttsAudioRef.current;
    if (!audio) {
      console.log("[TTS] No audio element");
      return;
    }

    if (ttsObjectUrlRef.current) {
      URL.revokeObjectURL(ttsObjectUrlRef.current);
    }
    ttsObjectUrlRef.current = url;

    console.log("[TTS] Playing volcengine audio blob, size:", combined.length);
    audio.src = url;
    audio.volume = 1;

    audio.onloadedmetadata = () => {
      const durationMs = audio.duration * 1000;
      console.log("[TTS] Audio duration:", durationMs, "ms");
      if (assistantId) {
        setAssistantLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(assistantId);
          return next;
        });
      }
      startTextRevealAnimation(durationMs);
    };

    audio.play().catch((err) => {
      console.error("[TTS] Failed to play volcengine audio:", err);
      if (assistantId) {
        setAssistantLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(assistantId);
          return next;
        });
      }
    });
  }

  function playAssistantAudio(assistantId: string) {
    const audioUrl = assistantAudioUrlsRef.current[assistantId];
    if (!audioUrl) {
      console.log("[TTS] No cached audio for message:", assistantId);
      return;
    }

    const audio = ttsAudioRef.current;
    if (!audio) return;

    ttsAssistantIdRef.current = assistantId;
    audio.src = audioUrl;
    audio.volume = 1;
    audio.currentTime = 0;
    audio.play().catch((err) => {
      console.error("[TTS] Failed to play cached audio:", err);
    });
  }

  function playUserAudio(messageId: string) {
    const audioUrl = userAudioUrlsRef.current[messageId];
    if (!audioUrl) {
      console.log("[Voice] No cached audio for user message:", messageId);
      return;
    }

    const audio = ttsAudioRef.current;
    if (!audio) return;

    console.log("[Voice] Playing cached audio for user message:", messageId);

    audio.src = audioUrl;
    audio.volume = 1;
    audio.currentTime = 0;
    audio.play().catch((err) => {
      console.error("[Voice] Failed to play user audio:", err);
    });
  }

  function startAssistantTts(assistantId: string): boolean {
    abortTtsStream();
    console.log("[TTS] startAssistantTts called, ttsConfig:", ttsConfig);
    if (!ttsConfig) {
      console.log("[TTS] No ttsConfig available");
      return false;
    }

    console.log("[TTS] Starting with config:", {
      provider: ttsConfig.provider,
      voiceId: ttsConfig.voiceId,
    });

    ttsPlaybackActiveRef.current = true;
    ttsCurrentAssistantIdRef.current = assistantId;
    ttsBufferedTextRef.current = "";
    ttsRevealedLengthRef.current = 0;
    setAssistantHasVoice((prev) => ({ ...prev, [assistantId]: true }));
    setBarsForAssistant(assistantId, buildStaticVoiceMessageBars(800));
    startTtsWaveLoop(assistantId);

    if (ttsConfig.provider === "volcengine") {
      console.log("[TTS] Using Volcengine TTS (Blob URL mode)");
      setAssistantLoadingIds((prev) => new Set(prev).add(assistantId));
      ttsVolcengineChunksRef.current = [];
      ttsSessionRef.current = createVolcengineTtsSession(ttsConfig as VolcengineTtsConfig, {
        onAudioChunk: (chunk) => {
          console.log("[TTS] Volcengine audio chunk received, size:", chunk.byteLength);
          ttsVolcengineChunksRef.current.push(chunk);
        },
        onError: (err) => {
          console.error("[TTS] Volcengine error:", err);
          ttsPlaybackActiveRef.current = false;
          stopTtsWaveLoop();
          setAssistantHasVoice((prev) => ({ ...prev, [assistantId]: false }));
          setAssistantLoadingIds((prev) => {
            const next = new Set(prev);
            next.delete(assistantId);
            return next;
          });
          if (ttsBufferedTextRef.current) {
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: ttsBufferedTextRef.current } : m)));
          }
        },
        onEnd: () => {
          console.log("[TTS] Volcengine finished, playing audio");
          playVolcengineAudioBlob();
        },
      });
    } else {
      if (!ensureTtsPlaybackInitialized()) {
        console.log("[TTS] Failed to initialize playback");
        return false;
      }
      console.log("[TTS] Using Minimax TTS");
      const audio = ttsAudioRef.current;
      if (audio) {
        audio.volume = 1;
        void audio.play().catch(() => {});
      }
      ttsSessionRef.current = createMinimaxTtsSession(
        ttsConfig.wsPath,
        {
          model: ttsConfig.model,
          encoding: ttsConfig.encoding,
          voice: { voiceId: ttsConfig.voiceId, speed: 1, volume: 1, pitch: 0 },
          audio: { sampleRate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
        },
        {
          onAudioChunk: pushTtsAudioChunk,
          onEvent: (evt) => {
            if (typeof evt !== "object" || evt === null) return;
            const e = (evt as Record<string, unknown>)["event"];
            if (e === "task_finished") markTtsAudioEnd();
            if (e === "task_failed") markTtsAudioEnd();
          },
          onError: () => {
            markTtsAudioEnd();
            ttsPlaybackActiveRef.current = false;
            stopTtsWaveLoop();
            setAssistantHasVoice((prev) => ({ ...prev, [assistantId]: false }));
          },
        },
      );
    }
    return true;
  }

  function pushAssistantTtsText(delta: string) {
    const session = ttsSessionRef.current;
    if (!session) return;
    ttsPendingTextRef.current += delta;
    flushTtsPending(false);
    scheduleTtsFlush();
  }

  async function finishAssistantTts() {
    const session = ttsSessionRef.current;
    if (!session) return;
    clearTtsFlushTimer();
    flushTtsPending(true);
    await session.finish();
  }

  function scrollToBottom(behavior: ScrollBehavior) {
    const el = timelineRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }

  function addMessage(role: ChatMessage["role"], text: string) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    setMessages((prev) => [
      ...prev,
      {
        id: makeId(),
        role,
        kind: "text",
        text: trimmed,
        createdAt: Date.now(),
      },
    ]);
  }

  function ensureScrollToBottomSoon() {
    if (!isNearBottomRef.current) return;
    if (scrollRafRef.current) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      scrollToBottom("auto");
    });
  }

  function scheduleAssistantReplyFallback() {
    const delay = 220 + Math.floor(Math.random() * 420);
    const id = window.setTimeout(() => {
      addMessage("assistant", pickOne(ASSISTANT_TEXTS));
    }, delay);
    replyTimeoutsRef.current.push(id);
  }

  function sendUserText(text: string, opts?: { kind?: ChatMessage["kind"]; durationMs?: number; messageId?: string }) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    console.log("[Chat] sendUserText called, ttsConfig:", ttsConfig ? { provider: ttsConfig.provider, voiceId: ttsConfig.voiceId } : null);

    const userMessage: ChatMessage = {
      id: opts?.messageId ?? makeId(),
      role: "user",
      kind: opts?.kind ?? "text",
      durationMs: typeof opts?.durationMs === "number" ? opts.durationMs : undefined,
      text: trimmed,
      createdAt: Date.now(),
    };
    if (!llmClient) {
      setMessages((prev) => [...prev, userMessage]);
      scheduleAssistantReplyFallback();
      return;
    }

    const assistantId = makeId();
    const assistantMessage: ChatMessage = { id: assistantId, role: "assistant", kind: "text", text: "", createdAt: Date.now() };
    setMessages((prev) => [...prev, userMessage, assistantMessage]);

    abortLlmStream();
    const ttsStarted = startAssistantTts(assistantId);
    if (overlayMode === "siri") {
      setSiriError(null);
      setSiriState("thinking");
      assistantLiveTextRef.current = "";
      setAssistantLiveText("");
    }
    const seedMessages = buildSeedMessages(context);
    const history = [...messagesRef.current, userMessage];

    llmStreamRef.current = llmClient.streamChat(
      { model: "", messages: toLlmMessages(seedMessages, history) },
      {
        onDeltaText: (delta) => {
          pushAssistantTtsText(delta);
          if (ttsConfig?.provider === "volcengine") {
            ttsBufferedTextRef.current += delta;
          } else {
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + delta } : m)));
          }
          if (overlayMode === "siri") {
            const next = (assistantLiveTextRef.current + delta).slice(-1800);
            assistantLiveTextRef.current = next;
            setAssistantLiveText(next);
            if (!ttsStarted) setSiriState("speaking");
          }
          ensureScrollToBottomSoon();
        },
        onDone: (finalText) => {
          if (ttsConfig?.provider === "volcengine") {
            ttsBufferedTextRef.current = finalText.trim();
          } else {
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: finalText.trim() } : m)));
          }
          void finishAssistantTts();
          if (overlayMode === "siri") {
            const next = String(finalText ?? "").trim();
            assistantLiveTextRef.current = next;
            setAssistantLiveText(next);
            if (!ttsStarted) setSiriState("speaking");
            if (!ttsStarted) {
              setSiriState("idle");
              void startSiriListening("auto");
            }
          }
          ensureScrollToBottomSoon();
        },
        onError: () => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, text: "抱歉，助手暂时不可用。" } : m)),
          );
          abortTtsStream();
          if (overlayMode === "siri") {
            setSiriState("error");
            setSiriError("助手暂时不可用");
            if (!ttsStarted) {
              setSiriState("idle");
              void startSiriListening("auto");
            }
          }
          ensureScrollToBottomSoon();
        },
      },
    );
  }

  function sendVoiceMessage(durationMs: number) {
    const transcript = recognizedRef.current.trim();
    if (transcript.length === 0) {
      setRecognizedText(VOICE_INPUT_RETRY_TEXT);
      return;
    }

    const userMessageId = makeId();
    
    const chunks = userPcmChunksRef.current;
    if (chunks.length > 0) {
      try {
        const wavData = encodeWav(chunks);
        const blob = new Blob([wavData.buffer as ArrayBuffer], { type: "audio/wav" });
        const url = URL.createObjectURL(blob);
        setUserAudioUrls((prev) => {
          const next = { ...prev, [userMessageId]: url };
          userAudioUrlsRef.current = next;
          return next;
        });
      } catch (err) {
        console.error("[Voice] Failed to encode WAV:", err);
      }
    }
    userPcmChunksRef.current = [];

    sendUserText(transcript, { kind: "voice", durationMs, messageId: userMessageId });
  }

  async function startTapToTalk() {
    if (isPressingRef.current) return;

    pressTokenRef.current += 1;
    const token = pressTokenRef.current;
    isPressingRef.current = true;
    setIsPressing(true);
    setLastRecordingMs(null);
    setRecordingCountdown(null);
    pressStartMsRef.current = Date.now();
    recognizedRef.current = "";
    setRecognizedText("");

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    recordingTimerRef.current = window.setInterval(() => {
      if (token !== pressTokenRef.current || !isPressingRef.current) {
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        return;
      }

      const elapsed = Date.now() - (pressStartMsRef.current ?? 0);
      
      if (elapsed >= MAX_VOICE_DURATION_MS) {
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        void stopTapToTalk();
        return;
      }

      if (elapsed >= VOICE_COUNTDOWN_START_MS) {
        const remaining = Math.ceil((MAX_VOICE_DURATION_MS - elapsed) / 1000);
        setRecordingCountdown(remaining);
      }
    }, 100);

    const asrStartedPromise = startAsr(
      { targetName },
      {
        onPartialText: (text) => {
          if (token !== pressTokenRef.current) return;
          setRecognizedText(text);
        },
        onFinalText: (text) => {
          if (token !== pressTokenRef.current) return;
          recognizedRef.current = text;
          setRecognizedText(text);
        },
        onError: () => {
          if (token !== pressTokenRef.current) return;
          setRecognizedText("");
        },
      },
    );

    userPcmChunksRef.current = [];
    const micStartedPromise = mic.start({
      onPcmChunk: (pcm, sampleRate) => {
        pushAsrAudio(pcm, sampleRate);
        if (token === pressTokenRef.current) {
          userPcmChunksRef.current.push({ data: new Float32Array(pcm), sampleRate });
        }
      },
    });
    const [asrStarted, micStarted] = await Promise.all([asrStartedPromise, micStartedPromise]);
    void asrStarted;

    if (!micStarted) {
      if (token !== pressTokenRef.current) return;
      isPressingRef.current = false;
      setIsPressing(false);
      pressStartMsRef.current = null;
      setRecordingCountdown(null);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      await stopAsr();
      return;
    }

    if (token !== pressTokenRef.current || !isPressingRef.current) {
      mic.stop();
      await stopAsr();
    }
  }

  async function stopTapToTalk() {
    if (!isPressingRef.current) return;

    pressTokenRef.current += 1;
    const token = pressTokenRef.current;
    isPressingRef.current = false;
    setIsPressing(false);
    setRecordingCountdown(null);
    
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    
    mic.stop();

    const startedAt = pressStartMsRef.current;
    pressStartMsRef.current = null;
    if (typeof startedAt === "number") {
      const durationMs = Math.max(0, Date.now() - startedAt);
      setLastRecordingMs(durationMs);

      const res = await stopAsr();
      if (token !== pressTokenRef.current) return;
      if (res.finalText.trim().length > 0) {
        recognizedRef.current = res.finalText;
        setRecognizedText(res.finalText);
      }

      if (durationMs >= MIN_VOICE_SEND_MS) sendVoiceMessage(Math.min(durationMs, MAX_VOICE_DURATION_MS));
    }
  }

  async function onTimelineMicTap() {
    if (isPressingRef.current) {
      await stopTapToTalk();
      return;
    }
    await startTapToTalk();
  }

  useEffect(() => {
    if (!props.open) return;
    setIsPressing(false);
    isPressingRef.current = false;
    setRecognizedText("");
    recognizedRef.current = "";
    setLastRecordingMs(null);
    setRecordingCountdown(null);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    abortLlmStream();
    abortTtsStream();
    clearReplyTimers();
    setMessages([]);
    setAssistantWaveBars({});
    setAssistantHasVoice({});
    assistantLiveTextRef.current = "";
    setAssistantLiveText("");
    setSiriError(null);
    setSiriState("idle");
    siriAutoRearmRef.current = isSiriAutoListenEnabled();
    siriListeningRef.current = false;

    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    queueMicrotask(() => {
      closeRef.current?.focus();
      scrollToBottom("auto");
    });

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      clearReplyTimers();
      mic.stop();
      void stopAsr();
      abortLlmStream();
      abortTtsStream();
      void stopSiriListening("teardown");
      if (scrollRafRef.current) window.cancelAnimationFrame(scrollRafRef.current);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, [mic.stop, context, props.onClose, props.open, stopAsr]);

  useEffect(() => {
    if (!props.open) return;
    const audio = ttsAudioRef.current;
    if (!audio) return;

    const onPlaying = () => {
      setTtsAudioPlaying(true);
      if (overlayMode === "siri") setSiriState((prev) => (prev === "thinking" ? "speaking" : prev));
    };
    const onPause = () => setTtsAudioPlaying(false);
    const onEnded = () => {
      setTtsAudioPlaying(false);
      ttsPlaybackActiveRef.current = false;
      stopTtsWaveLoop();
      if (ttsRevealTimerRef.current) {
        clearInterval(ttsRevealTimerRef.current);
        ttsRevealTimerRef.current = null;
      }
      const assistantId = ttsCurrentAssistantIdRef.current;
      const fullText = ttsBufferedTextRef.current;
      if (assistantId && fullText) {
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: fullText } : m)));
      }
      if (overlayMode === "siri") {
        setSiriState("idle");
        void startSiriListening("auto");
      }
    };
    const onError = () => {
      setTtsAudioPlaying(false);
      ttsPlaybackActiveRef.current = false;
      stopTtsWaveLoop();
      if (overlayMode === "siri") setSiriState("idle");
    };

    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [overlayMode, props.open]);

  useEffect(() => {
    if (props.open) return;
    mic.stop();
    void stopAsr();
    abortLlmStream();
    abortTtsStream();
    void stopSiriListening("teardown");
  }, [mic.stop, props.open, stopAsr]);

  useEffect(() => {
    if (!props.open) return;
    if (!isNearBottom) return;
    scrollToBottom("smooth");
  }, [isNearBottom, messages.length, props.open]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    isNearBottomRef.current = isNearBottom;
  }, [isNearBottom]);

  if (!props.open) return null;

  const recognizedLine = (() => {
    if (mic.status === "requesting") return "正在请求麦克风权限...";
    if (mic.status === "denied") return mic.error ?? "麦克风权限被拒绝";
    if (mic.status === "error") return mic.error ?? "麦克风不可用";
    if (asrStatus === "connecting") return "正在连接语音识别...";
    if (asrStatus === "error") return asrError ?? "语音识别异常";
    if (isPressing && mic.status === "listening") {
      if (recordingCountdown !== null) {
        return recognizedText ? `识别中：${recognizedText} (${recordingCountdown}s)` : `正在聆听... (${recordingCountdown}s)`;
      }
      return recognizedText ? `识别中：${recognizedText}` : "正在聆听...";
    }
    if (recognizedText === VOICE_INPUT_RETRY_TEXT) return recognizedText;
    if (recognizedText) return `已识别：${recognizedText}`;
    if (typeof lastRecordingMs === "number") return `已录制：${(lastRecordingMs / 1000).toFixed(1)} 秒`;
    return "";
  })();

	  const siriStatusLine = (() => {
	    if (overlayMode !== "siri") return "";
	    if (siriError) return siriError;
	    if (mic.status === "denied") return mic.error ?? "麦克风权限被拒绝";
	    if (mic.status === "error") return mic.error ?? "麦克风不可用";
	    if (asrStatus === "error") return asrError ?? "语音识别异常";
	    if (siriState === "listening") return recognizedText ? recognizedText : "正在聆听...";
	    if (siriState === "thinking") return "正在思考...";
	    if (siriState === "speaking") return voiceOnly ? "正在说话..." : (assistantLiveText || "正在说话...");
	    return "点击开始说话";
	  })();

	  const siriTapLabel =
	    siriState === "listening"
	      ? "点击发送"
	      : siriState === "speaking" || siriState === "thinking"
	        ? "点击打断"
	        : "点击开始说话";

	  const siriOrbClassName =
	    siriState === "listening"
	      ? "voiceChatSiriOrbButton voiceChatSiriOrbButtonListening"
	      : siriState === "speaking" || siriState === "thinking"
	        ? "voiceChatSiriOrbButton voiceChatSiriOrbButtonInterrupt"
	        : "voiceChatSiriOrbButton";

	  const siriWave = (() => {
	    const activeAssistantId = ttsAssistantIdRef.current;
	    const assistantBars = (activeAssistantId ? assistantWaveBars[activeAssistantId] : null) ?? ttsWavePrevBarsRef.current;
	    if (siriState === "listening") return { active: true, bars: mic.waveform.bars, animate: false };
	    if (siriState === "speaking") return { active: ttsAudioPlaying, bars: assistantBars, animate: false };
    if (siriState === "thinking") return { active: false, bars: new Array<number>(5).fill(1), animate: true };
    return { active: false, bars: new Array<number>(5).fill(1), animate: false };
  })();

  async function onSiriMicTap() {
    if (overlayMode !== "siri") return;
    if (siriState === "speaking" || siriState === "thinking") {
      await siriInterruptAndListen();
      return;
    }
    if (siriState === "listening") {
      setSiriError(null);
      setSiriState("thinking");
      const utterance = await stopSiriListeningAndGetFinalText();
      if (!utterance) {
        setSiriState("idle");
        return;
      }
      sendUserText(utterance, { kind: "voice" });
      return;
    }
    siriAutoRearmRef.current = isSiriAutoListenEnabled();
    await startSiriListening("user");
  }

  return createPortal(
    <div className="voiceChatBackdrop" role="dialog" aria-modal="true" aria-label="语音聊天">
      <div className="voiceChatPanel" onClick={(e) => stopEvent(e)}>
        <div className="voiceChatPanelHeader">
          <div className="voiceChatPanelTitle">
            {chatKind === "episode" && selectedEpisode ? `聊聊《${selectedEpisode.title}》` : `和 ${targetName} 聊聊`}
          </div>
          <button
            ref={closeRef}
            className="voiceChatCloseButton"
            type="button"
            aria-label="关闭"
            onClick={props.onClose}
          >
            ×
          </button>
        </div>

        <audio
          ref={ttsAudioRef}
          playsInline
          preload="auto"
          style={{ position: "fixed", left: "-9999px", top: "0", width: "1px", height: "1px", opacity: 0 }}
        />

        {overlayMode === "timeline" ? (
          <>
            <div
              ref={timelineRef}
              className="voiceChatTimeline"
              onScroll={() => {
                const el = timelineRef.current;
                if (!el) return;
                const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
                setIsNearBottom(distance < 48);
              }}
            >
              <div className="voiceChatTimelineInner">
                <div className="voiceChatMessageList">
                  {messages.map((m) => {
                    const isExpanded = expandedTextIds.has(m.id);
                    const hasAudio = m.role === "assistant" ? !!assistantAudioUrls[m.id] : !!userAudioUrls[m.id];
                    const isLoading = m.role === "assistant" && assistantLoadingIds.has(m.id);
                    const toggleExpand = () => {
                      setExpandedTextIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(m.id)) {
                          next.delete(m.id);
                        } else {
                          next.add(m.id);
                        }
                        return next;
                      });
                    };
                    const handleWaveClick = () => {
                      if (m.role === "assistant" && assistantAudioUrlsRef.current[m.id]) {
                        playAssistantAudio(m.id);
                      } else if (m.role === "user" && userAudioUrlsRef.current[m.id]) {
                        playUserAudio(m.id);
                      }
                    };
                    return (
                      <div key={m.id} className={m.role === "user" ? "voiceChatRow voiceChatRowUser" : "voiceChatRow"}>
                        <div className={m.role === "user" ? "voiceChatBubble voiceChatBubbleUser" : "voiceChatBubble"}>
                            <div className="voiceChatMessageContent">
                              <div className={m.role === "user" ? "voiceChatVoiceRow voiceChatVoiceRowUser" : "voiceChatVoiceRow"}>
                                <div
                                  className={hasAudio ? "voiceChatWaveWrapper voiceChatWaveWrapperClickable" : "voiceChatWaveWrapper"}
                                  onClick={handleWaveClick}
                                >
                                  {isLoading ? (
                                    <div className="voiceChatLoadingDots">
                                      <span className="voiceChatLoadingDot" />
                                      <span className="voiceChatLoadingDot" />
                                      <span className="voiceChatLoadingDot" />
                                    </div>
                                  ) : m.role === "assistant" ? (
                                    <VoiceWaveform
                                      active={ttsAudioPlaying && ttsAssistantIdRef.current === m.id}
                                      bars={assistantWaveBars[m.id] ?? buildStaticVoiceMessageBars(Math.max(m.text.length * 80, 800))}
                                    />
                                  ) : (
                                    <VoiceWaveform
                                      active={false}
                                      bars={buildStaticVoiceMessageBars(
                                        m.kind === "voice" ? m.durationMs : Math.min(m.text.length * 80, 4000)
                                      )}
                                    />
                                  )}
                                </div>
                                {m.text && !isVoicePlaceholderText(m.text) && (
                                  <button
                                    type="button"
                                    className="voiceChatExpandBtn"
                                    onClick={toggleExpand}
                                    aria-label={isExpanded ? "收起文字" : "展开文字"}
                                  >
                                    <span className={isExpanded ? "voiceChatExpandArrow voiceChatExpandArrowUp" : "voiceChatExpandArrow"}>▶</span>
                                  </button>
                                )}
                              </div>
                              {isExpanded && m.text && !isVoicePlaceholderText(m.text) && (
                                <div className="voiceChatExpandedText">{m.text}</div>
                              )}
                            </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="voiceChatSheet">
              <div className="voiceChatTabBar">
                <button
                  className={chatKind === "podcast" ? "voiceChatTab voiceChatTabActive" : "voiceChatTab"}
                  type="button"
                  onClick={() => {
                    setChatKind("podcast");
                    if (showEpisodePicker || episodePickerClosing) {
                      closeEpisodePicker();
                    }
                  }}
                  disabled={!props.podcastContext}
                >
                  聊聊栏目
                </button>
                <button
                  className={chatKind === "episode" ? "voiceChatTab voiceChatTabActive" : "voiceChatTab"}
                  type="button"
                  onClick={() => {
                    if (chatKind !== "episode") {
                      setChatKind("episode");
                    }
                    toggleEpisodePicker();
                  }}
                  disabled={availableEpisodes.length === 0}
                >
                  <span>{selectedEpisode ? `聊聊《${selectedEpisode.title.slice(0, 8)}${selectedEpisode.title.length > 8 ? "…" : ""}》` : "聊聊单集"}</span>
                  <span className="voiceChatTabArrow">{showEpisodePicker || episodePickerClosing ? "▼" : "▲"}</span>
                </button>
              </div>

              {(showEpisodePicker || episodePickerClosing) && (
                <div className={episodePickerClosing ? "voiceChatEpisodePicker voiceChatEpisodePickerClosing" : "voiceChatEpisodePicker"}>
                  <div className="voiceChatEpisodePickerHeader">
                    <span>选择单集</span>
                    <button
                      type="button"
                      className="voiceChatEpisodePickerClose"
                      onClick={() => closeEpisodePicker()}
                    >
                      ×
                    </button>
                  </div>
                  <ul className="voiceChatEpisodeList">
                    {availableEpisodes.map((ep) => {
                      const canChat = canChatEpisode(ep.id);
                      return (
                        <li key={ep.id}>
                          <button
                            type="button"
                            className={
                              selectedEpisodeId === ep.id
                                ? "voiceChatEpisodeItem voiceChatEpisodeItemActive"
                                : canChat
                                  ? "voiceChatEpisodeItem"
                                  : "voiceChatEpisodeItem voiceChatEpisodeItemDisabled"
                            }
                            onClick={() => {
                              if (!canChat) return;
                              setSelectedEpisodeId(ep.id);
                              closeEpisodePicker();
                            }}
                          >
                            {ep.title}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <div className="voiceChatBottomRecognized">
                {recognizedLine}
              </div>

              <VoiceWaveform active={isPressing && mic.status === "listening"} bars={mic.waveform.bars} />

              <div className="voiceChatBottomControls">
                <button
                  className={isPressing ? "voiceChatMicButton voiceChatMicButtonActive" : "voiceChatMicButton"}
                  type="button"
                  onClick={() => void onTimelineMicTap()}
                >
                  {isPressing ? "再次点击发送" : "点击开始说话"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="voiceChatSiriPanel">
            <div className="voiceChatSiriCenter">
              <div className="voiceChatSiriStatus">{siriStatusLine}</div>
              <div className="voiceChatSiriWave">
                <VoiceWaveform active={siriWave.active} animate={siriWave.animate} bars={siriWave.bars} />
              </div>
            </div>

            <button
              className={siriOrbClassName}
              type="button"
              aria-label={siriTapLabel}
              onClick={() => void onSiriMicTap()}
            >
              <svg
                className="voiceChatSiriOrbIcon"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
                <path d="M19 11a7 7 0 0 1-14 0h2a5 5 0 0 0 10 0h2Z" />
                <path d="M13 21v-3h-2v3h2Z" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
