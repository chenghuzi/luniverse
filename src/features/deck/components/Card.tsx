import type React from "react";
import { useEffect, useState } from "react";
import { motion, type MotionValue } from "framer-motion";
import type { Card as CardType } from "@/features/deck/model/types";
import { SnippetPlayer, type SnippetPlaybackState } from "@/features/deck/components/SnippetPlayer";
import { useImageGradient } from "@/features/deck/hooks/useImageGradient";
import { toggleActiveWindowPlayback } from "@/shared/audio/globalAudio";

type CardProps = {
  card: CardType;
  isTop?: boolean;
  onAutoAdvance?: () => void;
  mode?: "full" | "visual";
  style?: {
    x?: MotionValue<number>;
    y?: MotionValue<number>;
    rotate?: MotionValue<number>;
    scale?: MotionValue<number> | number;
    translateY?: MotionValue<number> | number;
  };
  className?: string;
  pointerBind?: {
    onPointerDown?: React.PointerEventHandler;
    onPointerMove?: React.PointerEventHandler;
    onPointerUp?: React.PointerEventHandler;
    onPointerCancel?: React.PointerEventHandler;
  };
};

export function Card({ card, isTop, onAutoAdvance, mode = "full", style, className, pointerBind }: CardProps) {
  const [snippetPlaybackState, setSnippetPlaybackState] = useState<SnippetPlaybackState>("idle");
  const subtitleParts = [
    card.podcast.title,
    card.episode.title ? `• ${card.episode.title}` : undefined,
  ].filter(Boolean);

  const coverUrl = card.episode.imageUrl ?? card.podcast.imageUrl;
  const coverAlt = card.episode.title
    ? `${card.podcast.title} - ${card.episode.title}`
    : `${card.podcast.title}封面`;

  const gradient = useImageGradient(coverUrl);
  const background = gradient ?? card.ui.accent;

  const snippet = card.highlight.snippet;
  const hasSnippet = Boolean(snippet && Number.isFinite(snippet.startMs) && Number.isFinite(snippet.durationMs));
  const renderSnippet = mode === "full" && hasSnippet;
  const showPausedOverlay = renderSnippet && Boolean(isTop) && snippetPlaybackState === "paused";

  useEffect(() => {
    if (renderSnippet && isTop) return;
    setSnippetPlaybackState("idle");
  }, [card.instanceId, isTop, renderSnippet]);

  function stopResumeButtonPropagation(e: React.PointerEvent<HTMLButtonElement>) {
    e.stopPropagation();
  }

  function resumeSnippet(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    void toggleActiveWindowPlayback();
  }

  return (
    <motion.div
      className={className ?? "card"}
      style={{
        x: style?.x,
        y: style?.y,
        rotate: style?.rotate,
        scale: style?.scale,
        translateY: style?.translateY,
      }}
      {...(pointerBind ?? {})}
    >
      <div className="cardSurface" style={{ background: background }}>
        <div className="cardTop">
          <div className="cardTitle">{card.highlight.title}</div>
          {subtitleParts.length > 0 ? <div className="cardSubtitle">{subtitleParts.join(" ")}</div> : null}
        </div>
        <div className="cardMedia">
          {coverUrl ? (
            <div className="cardImageFrame">
              <img
                className="cardImage"
                src={coverUrl}
                alt={coverAlt}
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            </div>
          ) : null}
          {renderSnippet ? (
            <SnippetPlayer
              audioUrl={card.episode.audio.url}
              startMs={snippet!.startMs}
              durationMs={snippet!.durationMs}
              isActive={Boolean(isTop)}
              onAutoAdvance={onAutoAdvance}
              onPlaybackStateChange={setSnippetPlaybackState}
            />
          ) : null}
        </div>
        {showPausedOverlay ? (
          <div className="cardPauseOverlay">
            <div className="cardPauseOverlayInner">
              <button
                className="cardPauseOverlayButton"
                type="button"
                aria-label="继续播放"
                onPointerDown={stopResumeButtonPropagation}
                onPointerMove={stopResumeButtonPropagation}
                onPointerUp={stopResumeButtonPropagation}
                onPointerCancel={stopResumeButtonPropagation}
                onClick={resumeSnippet}
              >
                <span className="cardPauseOverlayPlayGlyph" aria-hidden="true" />
              </button>
              <div className="cardPauseOverlayLabel">继续播放</div>
            </div>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}
