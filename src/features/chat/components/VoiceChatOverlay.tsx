import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";

import { VoiceWaveform } from "@/features/chat/components/VoiceWaveform";
import { useMicrophoneSession } from "@/features/chat/hooks/useMicrophoneSession";
import { useTencentRtAsrSession } from "@/features/asr/hooks/useTencentRtAsrSession";
import { createDashscopeLlmClient } from "@/features/llm/dashscope/DashscopeLlmClient";
import type { LlmMessage, LlmStreamHandle } from "@/features/llm/types";
import { fetchMinimaxTtsConfig, type MinimaxTtsConfig } from "@/features/tts/minimax/config";
import { createMinimaxTtsSession, type MinimaxTtsSession } from "@/features/tts/minimax/session";

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
  context: VoiceChatContext | null;
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
  "Got it. Here are the highlights: 1) ... 2) ... 3) ...",
  "If you only remember one thing: focus on the main constraint and the trade-off.",
  "The core idea is simple: define the problem, narrow the scope, and test assumptions fast.",
  "I can help. First, what outcome do you want after listening?",
  "Here is a short outline: context, turning point, key argument, and the practical takeaway.",
  "My take: the episode is strongest when it connects a concrete example to a general principle.",
  "Try this: listen for the recurring theme, then map it to a decision you are making.",
  "I would start with a 30-second recap, then go deeper on the part you care about.",
] as const;

const MIN_VOICE_SEND_MS = 450;
const MAX_CONTEXT_MESSAGES = 18;
const TTS_FLUSH_MS = 300;
const TTS_MAX_CHARS = 60;
const TTS_VOICE_WAVE_BARS = 18;

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

  if (!context) return [{ role: "system", content: "You are a helpful voice assistant. Be concise and actionable." }];
  if (context.kind === "podcast") {
    return [
      {
        role: "system",
        content: `You are a helpful voice assistant for the podcast "${context.podcastTitle}". Be concise and actionable.`,
      },
    ];
  }

  return [
    {
      role: "system",
      content: `You are a helpful voice assistant for the episode "${context.episodeTitle}" from the podcast "${context.podcastTitle}". Be concise and actionable.`,
    },
  ];
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const recognizedRef = useRef<string>("");
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const replyTimeoutsRef = useRef<number[]>([]);
  const llmStreamRef = useRef<LlmStreamHandle | null>(null);
  const ttsSessionRef = useRef<MinimaxTtsSession | null>(null);
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
  const siriTokenRef = useRef<number>(0);
  const siriListeningRef = useRef<boolean>(false);
  const siriAutoRearmRef = useRef<boolean>(true);
  const [siriState, setSiriState] = useState<SiriState>("idle");
  const [assistantLiveText, setAssistantLiveText] = useState<string>("");
  const assistantLiveTextRef = useRef<string>("");
  const [siriError, setSiriError] = useState<string | null>(null);
  const mic = useMicrophoneSession();
  const { start: startAsr, pushAudio: pushAsrAudio, stop: stopAsr, status: asrStatus, error: asrError } = useTencentRtAsrSession();
  const llmClient = useMemo(() => createDashscopeLlmClient(), []);
  const [ttsConfig, setTtsConfig] = useState<MinimaxTtsConfig | null>(props.context?.ttsConfig ?? null);

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
    const d = typeof durationMs === "number" && Number.isFinite(durationMs) ? durationMs : 800;
    const seconds = clampNumber(d / 1000, 0.25, 6.5);
    const seed = seconds * 1.7;

    const bars: number[] = [];
    for (let i = 0; i < barCount; i += 1) {
      const x = barCount <= 1 ? 0 : i / (barCount - 1);
      const envelope = Math.pow(Math.sin(Math.PI * x), 0.85);
      const mod = 0.62 + 0.38 * Math.sin(seed + x * (6.4 + seconds * 0.6) + i * 0.35);
      const v = clamp01(0.08 + envelope * mod);
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
    if (!voiceOnly) return;
    ttsAssistantIdRef.current = assistantId;
    stopTtsWaveLoop();

    const tick = (now: number) => {
      if (!voiceOnly) return;
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
    if (!props.context) return "Voice chat";
    if (props.context.kind === "podcast") return props.context.podcastTitle;
    return props.context.episodeTitle;
  }, [props.context]);

  const hudSubtitle = useMemo(() => {
    if (!props.context) return "No context";
    if (props.context.kind === "podcast") return "Podcast";
    return `Podcast • ${props.context.podcastTitle}`;
  }, [props.context]);

  useEffect(() => {
    if (!props.context?.ttsConfig) return;
    setTtsConfig(props.context.ttsConfig);
  }, [props.context]);

  useEffect(() => {
    if (!props.open) return;
    if (ttsConfig) return;
    const controller = new AbortController();
    void fetchMinimaxTtsConfig({ cardId: props.context?.cardId, signal: controller.signal })
      .then((cfg) => setTtsConfig(cfg))
      .catch(() => {});
    return () => controller.abort();
  }, [props.context?.cardId, props.open, ttsConfig]);

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
          setSiriError(String(msg ?? "ASR error"));
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
      setSiriError(mic.error ?? "Microphone unavailable");
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
    const sourceBuffer = ttsSourceBufferRef.current;
    const mediaSource = ttsMediaSourceRef.current;
    if (!sourceBuffer || !mediaSource) return;
    if (mediaSource.readyState !== "open") return;

    if (overlayMode === "siri") setSiriState((prev) => (prev === "thinking" ? "speaking" : prev));

    const copy = new Uint8Array(chunk.byteLength);
    copy.set(chunk);
    const arrayBuffer = copy.buffer;

    if (sourceBuffer.updating || ttsChunkQueueRef.current.length > 0) {
      ttsChunkQueueRef.current.push(arrayBuffer);
      return;
    }

    try {
      sourceBuffer.appendBuffer(arrayBuffer);
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

  function startAssistantTts(assistantId: string): boolean {
    abortTtsStream();
    if (!ttsConfig) return false;
    if (!ensureTtsPlaybackInitialized()) return false;

    ttsPlaybackActiveRef.current = true;
    setAssistantHasVoice((prev) => ({ ...prev, [assistantId]: true }));
    setBarsForAssistant(assistantId, Array.from({ length: TTS_VOICE_WAVE_BARS }, () => 0));

    const audio = ttsAudioRef.current;
    if (audio) {
      audio.volume = 1;
      void audio.play().catch(() => {});
    }
    startTtsWaveLoop(assistantId);

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
    return true;
  }

  function pushAssistantTtsText(delta: string) {
    const session = ttsSessionRef.current;
    if (!session) return;
    ttsPendingTextRef.current += delta;
    flushTtsPending(false);
    scheduleTtsFlush();
  }

  function finishAssistantTts() {
    const session = ttsSessionRef.current;
    if (!session) return;
    clearTtsFlushTimer();
    flushTtsPending(true);
    session.finish();
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

  function sendUserText(text: string, opts?: { kind?: ChatMessage["kind"]; durationMs?: number }) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    const userMessage: ChatMessage = {
      id: makeId(),
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
    const seedMessages = buildSeedMessages(props.context);
    const history = [...messagesRef.current, userMessage];

    llmStreamRef.current = llmClient.streamChat(
      { model: "", messages: toLlmMessages(seedMessages, history) },
      {
        onDeltaText: (delta) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + delta } : m)));
          pushAssistantTtsText(delta);
          if (overlayMode === "siri") {
            const next = (assistantLiveTextRef.current + delta).slice(-1800);
            assistantLiveTextRef.current = next;
            setAssistantLiveText(next);
            if (!ttsStarted) setSiriState("speaking");
          }
          ensureScrollToBottomSoon();
        },
        onDone: (finalText) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: finalText.trim() } : m)));
          finishAssistantTts();
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
            prev.map((m) => (m.id === assistantId ? { ...m, text: "Sorry, the assistant is unavailable right now." } : m)),
          );
          abortTtsStream();
          if (overlayMode === "siri") {
            setSiriState("error");
            setSiriError("Assistant unavailable");
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
    if (transcript.length > 0) {
      sendUserText(transcript, { kind: "voice", durationMs });
      return;
    }

    const seconds = Math.max(0, durationMs) / 1000;
    sendUserText(`Voice message (${seconds.toFixed(1)}s)`, { kind: "voice", durationMs });
  }

  async function startHoldToTalk(e: ReactPointerEvent<HTMLButtonElement>) {
    stopEvent(e);
    if (isPressingRef.current) return;
    if (e.button !== 0) return;

    pressTokenRef.current += 1;
    const token = pressTokenRef.current;
    isPressingRef.current = true;
    setIsPressing(true);
    setLastRecordingMs(null);
    pressStartMsRef.current = Date.now();
    recognizedRef.current = "";
    setRecognizedText("");

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

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

    const micStartedPromise = mic.start({ onPcmChunk: pushAsrAudio });
    const [asrStarted, micStarted] = await Promise.all([asrStartedPromise, micStartedPromise]);
    void asrStarted;

    if (!micStarted) {
      if (token !== pressTokenRef.current) return;
      isPressingRef.current = false;
      setIsPressing(false);
      pressStartMsRef.current = null;
      await stopAsr();
      return;
    }

    if (token !== pressTokenRef.current || !isPressingRef.current) {
      mic.stop();
      await stopAsr();
    }
  }

  async function stopHoldToTalk(e: ReactPointerEvent<HTMLButtonElement>) {
    stopEvent(e);
    if (!isPressingRef.current) return;

    pressTokenRef.current += 1;
    const token = pressTokenRef.current;
    isPressingRef.current = false;
    setIsPressing(false);
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

      if (durationMs >= MIN_VOICE_SEND_MS) sendVoiceMessage(durationMs);
    }
  }

  function cancelHoldToTalk(e: ReactPointerEvent<HTMLButtonElement>) {
    stopHoldToTalk(e);
  }

  useEffect(() => {
    if (!props.open) return;
    setIsPressing(false);
    isPressingRef.current = false;
    setRecognizedText("");
    recognizedRef.current = "";
    setLastRecordingMs(null);
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
    };
  }, [mic.stop, props.context, props.onClose, props.open, stopAsr]);

  useEffect(() => {
    if (!props.open) return;
    const audio = ttsAudioRef.current;
    if (!audio) return;

    const onPlay = () => {
      setTtsAudioPlaying(true);
      if (overlayMode === "siri") setSiriState((prev) => (prev === "thinking" ? "speaking" : prev));
    };
    const onPause = () => setTtsAudioPlaying(false);
    const onEnded = () => {
      setTtsAudioPlaying(false);
      ttsPlaybackActiveRef.current = false;
      stopTtsWaveLoop();
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

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("play", onPlay);
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
    if (mic.status === "requesting") return "Requesting microphone access...";
    if (mic.status === "denied") return mic.error ?? "Microphone permission denied";
    if (mic.status === "error") return mic.error ?? "Microphone unavailable";
    if (asrStatus === "connecting") return "Connecting ASR...";
    if (asrStatus === "error") return asrError ?? "ASR error";
    if (isPressing && mic.status === "listening") return recognizedText ? `Recognizing: ${recognizedText}` : "Listening...";
    if (recognizedText) return `Recognized: ${recognizedText}`;
    if (typeof lastRecordingMs === "number") return `Recorded: ${(lastRecordingMs / 1000).toFixed(1)}s`;
    return "Ready";
  })();

	  const siriStatusLine = (() => {
	    if (overlayMode !== "siri") return "";
	    if (siriError) return siriError;
	    if (mic.status === "denied") return mic.error ?? "Microphone permission denied";
	    if (mic.status === "error") return mic.error ?? "Microphone unavailable";
	    if (asrStatus === "error") return asrError ?? "ASR error";
	    if (siriState === "listening") return recognizedText ? recognizedText : "Listening...";
	    if (siriState === "thinking") return "Thinking...";
	    if (siriState === "speaking") return voiceOnly ? "Speaking..." : (assistantLiveText || "Speaking...");
	    return "Tap to talk";
	  })();

	  const siriTapLabel =
	    siriState === "listening"
	      ? "Tap to send"
	      : siriState === "speaking" || siriState === "thinking"
	        ? "Tap to interrupt"
	        : "Tap to talk";

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
    <div className="voiceChatBackdrop" role="dialog" aria-modal="true" aria-label="Voice chat">
      <div className="voiceChatHud" onClick={(e) => stopEvent(e)}>
        <div className="voiceChatHeaderText">
          <div className="voiceChatTitle">{`Talking with: ${targetName}`}</div>
          <div className="voiceChatSubtitle">{hudSubtitle}</div>
        </div>
      </div>

      <audio
        ref={ttsAudioRef}
        playsInline
        preload="auto"
        style={{ position: "fixed", left: "-9999px", top: "0", width: "1px", height: "1px", opacity: 0 }}
      />

      <button
        ref={closeRef}
        className="voiceChatCloseButton voiceChatTopCloseButton"
        type="button"
        aria-label="Close"
        onClick={props.onClose}
      >
        ×
      </button>

      {overlayMode === "timeline" ? (
        <>
          <div
            ref={timelineRef}
            className="voiceChatTimeline"
            onClick={(e) => stopEvent(e)}
            onScroll={() => {
              const el = timelineRef.current;
              if (!el) return;
              const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
              setIsNearBottom(distance < 48);
            }}
          >
            <div className="voiceChatTimelineInner">
              <div className="voiceChatMessageList">
                {messages.map((m) => (
                  <div key={m.id} className={m.role === "user" ? "voiceChatRow voiceChatRowUser" : "voiceChatRow"}>
                    <div className={m.role === "user" ? "voiceChatBubble voiceChatBubbleUser" : "voiceChatBubble"}>
                      {voiceOnly && m.role === "assistant"
                        ? assistantHasVoice[m.id]
                          ? (
                              <VoiceWaveform
                                active={ttsAudioPlaying && ttsAssistantIdRef.current === m.id}
                                bars={assistantWaveBars[m.id] ?? ttsWavePrevBarsRef.current}
                              />
                            )
                          : m.text
                        : null}
                      {voiceOnly && m.role === "user"
                        ? m.kind === "voice"
                          ? <VoiceWaveform active={false} bars={buildStaticVoiceMessageBars(m.durationMs)} />
                          : m.text
                        : null}
                      {!voiceOnly ? m.text : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="voiceChatSheet" onClick={(e) => stopEvent(e)}>
            <div className="voiceChatBottomRecognized">
              {recognizedLine}
            </div>

            <VoiceWaveform active={isPressing && mic.status === "listening"} bars={mic.waveform.bars} />

            <div className="voiceChatBottomControls">
              <button
                className={isPressing ? "voiceChatMicButton voiceChatMicButtonActive" : "voiceChatMicButton"}
                type="button"
                onPointerDown={startHoldToTalk}
                onPointerUp={stopHoldToTalk}
                onPointerCancel={cancelHoldToTalk}
              >
                {isPressing ? "Release to send" : "Hold to talk"}
              </button>
            </div>
          </div>
        </>
	      ) : (
	        <div className="voiceChatSiriPanel" onClick={(e) => stopEvent(e)}>
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
	    </div>,
	    document.body,
	  );
}
