import type React from "react";
import { motion, type MotionValue } from "framer-motion";
import type { Card as CardType } from "@/features/deck/model/types";

type CardProps = {
  card: CardType;
  style?: {
    x?: MotionValue<number>;
    y?: MotionValue<number>;
    rotate?: MotionValue<number>;
    scale?: number;
    translateY?: number;
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
      <div className="cardSurface" style={{ background: card.accent }}>
        <div className="cardTop">
          <div className="cardTitle">{card.title}</div>
          {card.subtitle ? <div className="cardSubtitle">{card.subtitle}</div> : null}
        </div>
        <div className="cardHint">Swipe left / right</div>
      </div>
    </motion.div>
  );
}
