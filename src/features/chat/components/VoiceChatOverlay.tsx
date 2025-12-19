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

function stopEvent(e: SyntheticEvent) {
  e.preventDefault();
  e.stopPropagation();
}

export function VoiceChatOverlay(props: VoiceChatOverlayProps) {
  const [isPressing, setIsPressing] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const title = useMemo(() => {
    if (!props.context) return "Voice chat";
    if (props.context.kind === "podcast") return props.context.podcastTitle;
    return props.context.episodeTitle;
  }, [props.context]);

  const subtitle = useMemo(() => {
    if (!props.context) return "No context";
    if (props.context.kind === "podcast") return `Podcast • ${props.context.podcastId}`;
    return `Episode • ${props.context.podcastTitle}`;
  }, [props.context]);

  useEffect(() => {
    if (!props.open) return;
    setIsPressing(false);

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
    });

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
    };
  }, [props.onClose, props.open]);

  if (!props.open) return null;

  return createPortal(
    <div className="voiceChatBackdrop" role="dialog" aria-modal="true" aria-label="Voice chat">
      <button className="voiceChatBackdropButton" type="button" onClick={props.onClose} aria-label="Close" />

      <div className="voiceChatSheet" onClick={(e) => stopEvent(e)}>
        <div className="voiceChatHeader">
          <div className="voiceChatHeaderText">
            <div className="voiceChatTitle">{title}</div>
            <div className="voiceChatSubtitle">{subtitle}</div>
          </div>
          <button ref={closeRef} className="voiceChatCloseButton" type="button" onClick={props.onClose}>
            Close
          </button>
        </div>

        <div className="voiceChatBody">
          <div className={isPressing ? "voiceChatWave voiceChatWaveActive" : "voiceChatWave"} aria-hidden="true">
            <div className="voiceChatWaveBar" />
            <div className="voiceChatWaveBar" />
            <div className="voiceChatWaveBar" />
            <div className="voiceChatWaveBar" />
            <div className="voiceChatWaveBar" />
          </div>

          <div className="voiceChatHint">
            {isPressing ? "Listening... (UI only)" : "Press and hold to talk (UI only)"}
          </div>

          <button
            className={isPressing ? "voiceChatMicButton voiceChatMicButtonActive" : "voiceChatMicButton"}
            type="button"
            onPointerDown={() => setIsPressing(true)}
            onPointerUp={() => setIsPressing(false)}
            onPointerCancel={() => setIsPressing(false)}
            onPointerLeave={() => setIsPressing(false)}
          >
            <div className="voiceChatMicIcon" aria-hidden="true">
              MIC
            </div>
            <div className="voiceChatMicText">{isPressing ? "Release to send" : "Hold to talk"}</div>
          </button>

          <div className="voiceChatFooter">
            <div className="voiceChatFooterText">Next: wire ASR/TTS + chat backend.</div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
