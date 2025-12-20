import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useTransform, type MotionValue } from "framer-motion";
import type { DeckMotionConfig } from "@/features/deck/motion/constants";
import { DEFAULT_DECK_MOTION_CONFIG } from "@/features/deck/motion/constants";
import { getStackTransform } from "@/features/deck/motion/transforms";
import type { Card as CardType, SwipeDecision } from "@/features/deck/model/types";
import { useSwipeController } from "@/features/deck/hooks/useSwipeController";
import { Card } from "@/features/deck/components/Card";
import { clamp } from "@/shared/lib/clamp";

type CardStackProps = {
  cards: CardType[];
  isLoading?: boolean;
  onDecision: (decision: SwipeDecision) => void;
  config?: Partial<DeckMotionConfig>;
};

export function CardStack(props: CardStackProps) {
  const config = useMemo(
    () => ({ ...DEFAULT_DECK_MOTION_CONFIG, ...(props.config ?? {}) }),
    [props.config],
  );

  const top = props.cards[0];
  const hasTop = Boolean(top);
  const mountedRef = useRef(true);
  const [reduceEffects, setReduceEffects] = useState(false);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const onMotionActivityChange = useCallback((active: boolean) => {
    if (!mountedRef.current) return;
    setReduceEffects(active);
  }, []);

  const controller = useSwipeController({
    card: top ?? {
      id: "empty",
      instanceId: "empty-0",
      podcast: { id: "empty", title: "No cards" },
      episode: { id: "empty", title: "", audio: { url: "" } },
      highlight: { id: "empty", title: "No cards" },
      ui: { accent: "#111827" },
    },
    onDecision: props.onDecision,
    config,
    onMotionActivityChange,
  });

  const stack = useMemo(() => props.cards.slice(0, config.stackSize), [props.cards, config.stackSize]);

  const absX = useTransform(controller.motion.x, (v) => Math.abs(v));
  const stackProgress = useTransform(absX, (v) => {
    const p = clamp(v / config.swipeDistanceThresholdPx, 0, 1);
    return 1 - Math.pow(1 - p, 3);
  });
  const secondScale = useTransform(stackProgress, (p) => (1 - config.cardScaleStep) + p * config.cardScaleStep);
  const secondTranslateY = useTransform(stackProgress, (p) => config.cardSpacingPx * (1 - p));

  const hintZonePx = Math.min(72, Math.max(24, config.swipeDistanceThresholdPx * 0.35));
  const hintShowStartPx = 14;
  const hintScaleMax = 1.18;
  const leftHintScale = useTransform(controller.motion.x, (x) => {
    const abs = Math.abs(x);
    if (abs <= hintShowStartPx) return 0.98;
    const showT = clamp((abs - hintShowStartPx) / Math.max(1, hintZonePx - hintShowStartPx), 0, 1);
    const showEased = 1 - Math.pow(1 - showT, 3);
    const base = 0.98 + 0.02 * showEased;

    if (x >= 0) return base;
    if (abs <= hintZonePx) return base;
    const t = clamp((abs - hintZonePx) / Math.max(1, config.swipeDistanceThresholdPx - hintZonePx), 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    return base + (hintScaleMax - base) * eased;
  });
  const rightHintScale = useTransform(controller.motion.x, (x) => {
    const abs = Math.abs(x);
    if (abs <= hintShowStartPx) return 0.98;
    const showT = clamp((abs - hintShowStartPx) / Math.max(1, hintZonePx - hintShowStartPx), 0, 1);
    const showEased = 1 - Math.pow(1 - showT, 3);
    const base = 0.98 + 0.02 * showEased;

    if (x <= 0) return base;
    if (abs <= hintZonePx) return base;
    const t = clamp((abs - hintZonePx) / Math.max(1, config.swipeDistanceThresholdPx - hintZonePx), 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    return base + (hintScaleMax - base) * eased;
  });
  const leftHintOpacity = useTransform(controller.motion.x, (x) => {
    const abs = Math.abs(x);
    if (abs <= hintShowStartPx) return 0;
    const t = clamp((abs - hintShowStartPx) / Math.max(1, hintZonePx - hintShowStartPx), 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const side = x < 0 ? 1 : 0.28;
    return eased * side;
  });
  const rightHintOpacity = useTransform(controller.motion.x, (x) => {
    const abs = Math.abs(x);
    if (abs <= hintShowStartPx) return 0;
    const t = clamp((abs - hintShowStartPx) / Math.max(1, hintZonePx - hintShowStartPx), 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const side = x > 0 ? 1 : 0.28;
    return eased * side;
  });
  const rightHintText = hasTop ? `和${top.podcast.title}聊聊吧` : "开始聊聊吧";

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      if (!target || !(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }

    function onKeyDown(e: KeyboardEvent) {
      if (!hasTop) return;
      if (e.defaultPrevented) return;
      if (e.repeat) return;
      if (isTypingTarget(e.target)) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        controller.forceDecision("nope");
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        controller.forceDecision("like");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [controller, hasTop]);

  return (
    <div className="deckRoot">
      <div className={reduceEffects ? "deckStage deckStageReducedFx" : "deckStage"}>
        {hasTop ? (
          <div className="deckHints" aria-hidden="true">
            <motion.div className="deckHint deckHintLeft" style={{ opacity: leftHintOpacity, scale: leftHintScale }}>
              {"\u6362\u4E0B\u4E00\u671F"}
            </motion.div>
            <motion.div className="deckHint deckHintRight" style={{ opacity: rightHintOpacity, scale: rightHintScale }}>
              {rightHintText}
            </motion.div>
          </div>
        ) : null}
        {stack.length === 0 ? (
          <div className="emptyState">{props.isLoading ? "Loading..." : "No cards"}</div>
        ) : (
          stack
            .map((card, i) => {
              const indexInStack = i;
              const base = getStackTransform(indexInStack, config);
              let translateY: number | MotionValue<number> = base.translateY;
              let scale: number | MotionValue<number> = base.scale;
              if (indexInStack === 1) {
                translateY = secondTranslateY;
                scale = secondScale;
              }
              const isTop = i === 0;

              return (
                <Card
                  key={card.instanceId}
                  card={card}
                  isTop={isTop}
                  onAutoAdvance={isTop && hasTop ? () => controller.forceDecision("nope") : undefined}
                  className={isTop ? "card cardTopLayer" : "card"}
                  style={{
                    x: isTop ? controller.motion.x : undefined,
                    y: isTop ? controller.motion.y : undefined,
                    rotate: isTop ? controller.motion.rotate : undefined,
                    translateY,
                    scale,
                  }}
                  pointerBind={isTop && hasTop ? controller.bind : undefined}
                />
              );
            })
            .reverse()
        )}
      </div>
    </div>
  );
}
