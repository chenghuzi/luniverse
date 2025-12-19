import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";

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

export function VoiceChatOverlay(props: VoiceChatOverlayProps) {
  const [isPressing, setIsPressing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const draftRef = useRef<string>("");
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const replyTimeoutsRef = useRef<number[]>([]);

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

  function codeToTalk() {
    sendUserText(pickOne(USER_TEXTS));
  }

  function startHoldToTalk() {
    const text = pickOne(USER_TEXTS);
    setIsPressing(true);
    draftRef.current = text;
    setDraftText(text);
  }

  function cancelHoldToTalk() {
    setIsPressing(false);
    draftRef.current = "";
    setDraftText("");
  }

  function finishHoldToTalk() {
    setIsPressing(false);
    const text = draftRef.current.trim();
    draftRef.current = "";
    setDraftText("");
    if (text.length === 0) return;
    sendUserText(text);
  }

  useEffect(() => {
    if (!props.open) return;
    setIsPressing(false);
    setDraftText("");
    draftRef.current = "";
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
    };
  }, [props.context, props.onClose, props.open]);

  useEffect(() => {
    if (!props.open) return;
    if (!isNearBottom) return;
    scrollToBottom("smooth");
  }, [isNearBottom, messages.length, props.open]);

  if (!props.open) return null;

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
          {isPressing ? `Recognizing: ${draftText || "..."}` : draftText ? `Recognized: ${draftText}` : "Ready"}
        </div>

        <div className="voiceChatBottomControls">
          <button
            className={isPressing ? "voiceChatMicButton voiceChatMicButtonActive" : "voiceChatMicButton"}
            type="button"
            onPointerDown={startHoldToTalk}
            onPointerUp={finishHoldToTalk}
            onPointerCancel={cancelHoldToTalk}
            onPointerLeave={cancelHoldToTalk}
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
