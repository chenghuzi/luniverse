import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";

import { VoiceWaveform } from "@/features/chat/components/VoiceWaveform";
import { useMicrophoneSession } from "@/features/chat/hooks/useMicrophoneSession";
import { useTencentRtAsrSession } from "@/features/asr/hooks/useTencentRtAsrSession";
import { createDashscopeLlmClient } from "@/features/llm/dashscope/DashscopeLlmClient";
import type { LlmMessage, LlmStreamHandle } from "@/features/llm/types";
import type { PromptContext } from "@/features/llm/prompts/types";
import { composeSystemPrompt } from "@/features/llm/prompts/injectors";
import { fetchMinimaxTtsConfig, type MinimaxTtsConfig } from "@/features/tts/minimax/config";
import { createMinimaxTtsSession, type MinimaxTtsSession } from "@/features/tts/minimax/session";

export type VoiceChatContext =
  | {
      kind: "podcast";
      podcastId: string;
      podcastTitle: string;
      coverUrl?: string | null;
      ttsConfig?: MinimaxTtsConfig | null;
      promptContext?: PromptContext;
    }
  | {
      kind: "episode";
      podcastId: string;
      podcastTitle: string;
      episodeId: string;
      episodeTitle: string;
      coverUrl?: string | null;
      ttsConfig?: MinimaxTtsConfig | null;
      promptContext?: PromptContext;
    };

type VoiceChatOverlayProps = {
  open: boolean;
  context: VoiceChatContext | null;
  onClose: () => void;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
};

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

const USER_TEXTS = [
  "Give me a quick summary of this episode.",
  "What are the key takeaways?",
  "Who is the guest and why should I care?",
  "Find the most interesting moment.",
  "What should I listen for in the first 5 minutes?",
  "Can you explain this topic like I'm new to it?",
  "What questions should I ask after listening?",
  "Turn this into 3 actionable bullet points.",
  "What did I miss if I skip this episode?",
] as const;

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

const TTS_PUNCTUATION = new Set(["。", "！", "？", "!", "?", "，", ",", "；", ";", "：", ":", "、", ".", "\n"]);

function buildSystemPrompt(context: VoiceChatContext | null): string {
  if (context?.promptContext) return composeSystemPrompt(context.promptContext);
  if (!context) return "You are a helpful voice assistant. Be concise and actionable.";
  if (context.kind === "podcast") {
    return `You are a helpful voice assistant for the podcast "${context.podcastTitle}". Be concise and actionable.`;
  }
  return `You are a helpful voice assistant for the episode "${context.episodeTitle}" from the podcast "${context.podcastTitle}". Be concise and actionable.`;
}

function toLlmMessages(systemPrompt: string, history: ChatMessage[]): LlmMessage[] {
  const trimmed = history.slice(-MAX_CONTEXT_MESSAGES);
  const messages: LlmMessage[] = [{ role: "system", content: systemPrompt }];
  for (const m of trimmed) messages.push({ role: m.role, content: m.text });
  return messages;
}

export function VoiceChatOverlay(props: VoiceChatOverlayProps) {
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
  const messagesRef = useRef<ChatMessage[]>([]);
  const isNearBottomRef = useRef<boolean>(true);
  const scrollRafRef = useRef<number | null>(null);
  const pressTokenRef = useRef<number>(0);
  const isPressingRef = useRef<boolean>(false);
  const pressStartMsRef = useRef<number | null>(null);
  const mic = useMicrophoneSession();
  const { start: startAsr, pushAudio: pushAsrAudio, stop: stopAsr, status: asrStatus, error: asrError } = useTencentRtAsrSession();
  const llmClient = useMemo(() => createDashscopeLlmClient(), []);
  const [ttsConfig, setTtsConfig] = useState<MinimaxTtsConfig | null>(props.context?.ttsConfig ?? null);

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
    void fetchMinimaxTtsConfig(controller.signal)
      .then((cfg) => setTtsConfig(cfg))
      .catch(() => {});
    return () => controller.abort();
  }, [props.open, ttsConfig]);

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
    resetTtsPlayback();
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

  function startAssistantTts() {
    abortTtsStream();
    if (!ttsConfig) return;
    if (!ensureTtsPlaybackInitialized()) return;

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
        },
      },
    );
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

  function sendUserText(text: string) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    const userMessage: ChatMessage = { id: makeId(), role: "user", text: trimmed, createdAt: Date.now() };
    if (!llmClient) {
      setMessages((prev) => [...prev, userMessage]);
      scheduleAssistantReplyFallback();
      return;
    }

    const assistantId = makeId();
    const assistantMessage: ChatMessage = { id: assistantId, role: "assistant", text: "", createdAt: Date.now() };
    setMessages((prev) => [...prev, userMessage, assistantMessage]);

    abortLlmStream();
    startAssistantTts();
    const systemPrompt = buildSystemPrompt(props.context);
    const history = [...messagesRef.current, userMessage];

    llmStreamRef.current = llmClient.streamChat(
      { model: "", messages: toLlmMessages(systemPrompt, history) },
      {
        onDeltaText: (delta) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + delta } : m)));
          pushAssistantTtsText(delta);
          ensureScrollToBottomSoon();
        },
        onDone: (finalText) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: finalText.trim() } : m)));
          finishAssistantTts();
          ensureScrollToBottomSoon();
        },
        onError: () => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, text: "Sorry, the assistant is unavailable right now." } : m)),
          );
          abortTtsStream();
          ensureScrollToBottomSoon();
        },
      },
    );
  }

  function sendVoiceMessage(durationMs: number) {
    const transcript = recognizedRef.current.trim();
    if (transcript.length > 0) {
      sendUserText(transcript);
      return;
    }

    const seconds = Math.max(0, durationMs) / 1000;
    sendUserText(`Voice message (${seconds.toFixed(1)}s)`);
  }

  function codeToTalk() {
    sendUserText(pickOne(USER_TEXTS));
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
    setMessages([
      {
        id: makeId(),
        role: "assistant",
        text: "Hi. Ask me anything about this podcast or episode.",
        createdAt: Date.now(),
      },
    ]);

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
      if (scrollRafRef.current) window.cancelAnimationFrame(scrollRafRef.current);
    };
  }, [mic.stop, props.context, props.onClose, props.open, stopAsr]);

  useEffect(() => {
    if (props.open) return;
    mic.stop();
    void stopAsr();
    abortLlmStream();
    abortTtsStream();
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
        onClick={props.onClose}
      >
        Close
      </button>

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
                  {m.text}
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
          <button className="voiceChatCodeButton" type="button" onClick={codeToTalk}>
            Code to Talk
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
