import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";

import { VoiceWaveform } from "@/features/chat/components/VoiceWaveform";
import { useMicrophoneSession } from "@/features/chat/hooks/useMicrophoneSession";
import { useTencentRtAsrSession } from "@/features/asr/hooks/useTencentRtAsrSession";

export type VoiceChatContext =
  | {
      kind: "podcast";
      podcastId: string;
      podcastTitle: string;
      coverUrl?: string | null;
    }
  | {
      kind: "episode";
      podcastId: string;
      podcastTitle: string;
      episodeId: string;
      episodeTitle: string;
      coverUrl?: string | null;
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
  const pressTokenRef = useRef<number>(0);
  const isPressingRef = useRef<boolean>(false);
  const pressStartMsRef = useRef<number | null>(null);
  const mic = useMicrophoneSession();
  const { start: startAsr, pushAudio: pushAsrAudio, stop: stopAsr, status: asrStatus, error: asrError } = useTencentRtAsrSession();

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

  function clearReplyTimers() {
    for (const id of replyTimeoutsRef.current) window.clearTimeout(id);
    replyTimeoutsRef.current = [];
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

  function scheduleAssistantReply() {
    const delay = 220 + Math.floor(Math.random() * 420);
    const id = window.setTimeout(() => {
      addMessage("assistant", pickOne(ASSISTANT_TEXTS));
    }, delay);
    replyTimeoutsRef.current.push(id);
  }

  function sendUserText(text: string) {
    addMessage("user", text);
    scheduleAssistantReply();
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
    };
  }, [mic.stop, props.context, props.onClose, props.open, stopAsr]);

  useEffect(() => {
    if (props.open) return;
    mic.stop();
    void stopAsr();
  }, [mic.stop, props.open, stopAsr]);

  useEffect(() => {
    if (!props.open) return;
    if (!isNearBottom) return;
    scrollToBottom("smooth");
  }, [isNearBottom, messages.length, props.open]);

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
