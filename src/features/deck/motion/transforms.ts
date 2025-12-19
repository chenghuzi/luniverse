import type { DeckMotionConfig } from "@/features/deck/motion/constants";

export function getStackTransform(indexInStack: number, config: DeckMotionConfig) {
  const translateY = indexInStack * config.cardSpacingPx;
  const scale = 1 - indexInStack * config.cardScaleStep;
  return { translateY, scale };
}

export function getOffscreenTargetX(direction: "left" | "right") {
  const width = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
  const target = Math.max(480, Math.floor(width * 1.25));
  return direction === "left" ? -target : target;
}

