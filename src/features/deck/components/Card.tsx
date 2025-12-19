import type React from "react";
import { motion, type MotionValue } from "framer-motion";
import type { Card as CardType } from "@/features/deck/model/types";

type CardProps = {
  card: CardType;
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

export function Card({ card, style, className, pointerBind }: CardProps) {
  const subtitleParts = [
    card.podcast.title,
    card.episode.title ? `• ${card.episode.title}` : undefined,
  ].filter(Boolean);

  const coverUrl = card.episode.imageUrl ?? card.podcast.imageUrl;
  const coverAlt = card.episode.title
    ? `${card.podcast.title} - ${card.episode.title}`
    : `${card.podcast.title} cover`;

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
      <div className="cardSurface" style={{ background: card.ui.accent }}>
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
        </div>
        <div className="cardHint">Swipe left / right</div>
      </div>
    </motion.div>
  );
}
