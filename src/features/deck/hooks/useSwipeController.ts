import { animate, useMotionValue, useTransform } from "framer-motion";
import { useCallback, useMemo, useRef } from "react";
import type { DeckMotionConfig } from "@/features/deck/motion/constants";
import { DEFAULT_DECK_MOTION_CONFIG } from "@/features/deck/motion/constants";
import { usePointerDrag } from "@/features/deck/hooks/usePointerDrag";
import { getOffscreenTargetX } from "@/features/deck/motion/transforms";
import type { Card, SwipeDecision, SwipeType } from "@/features/deck/model/types";
import { clamp } from "@/shared/lib/clamp";

type SwipeControllerParams = {
  card: Card;
  onDecision: (decision: SwipeDecision) => void;
  config?: Partial<DeckMotionConfig>;
};

export function useSwipeController(params: SwipeControllerParams) {
  const config = useMemo(
    () => ({ ...DEFAULT_DECK_MOTION_CONFIG, ...(params.config ?? {}) }),
    [params.config],
  );

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, (latestX) => {
    const clamped = clamp(latestX / 240, -1, 1);
    return clamped * config.maxRotateDeg;
  });

  const isSettlingRef = useRef(false);

  const settleToCenter = useCallback(() => {
    isSettlingRef.current = true;
    const ax = animate(x, 0, { type: "spring", stiffness: 340, damping: 28 });
    const ay = animate(y, 0, { type: "spring", stiffness: 340, damping: 28 });
    Promise.all([ax.finished, ay.finished]).finally(() => {
      isSettlingRef.current = false;
    });
  }, [x, y]);

  const settleOffscreen = useCallback(
    (type: SwipeType, velocityX: number, velocityY: number) => {
      isSettlingRef.current = true;
      const direction = type === "like" ? "right" : "left";
      const targetX = getOffscreenTargetX(direction);
      const targetY = y.get() + velocityY * 160;

      const ax = animate(x, targetX, {
        type: "spring",
        stiffness: 220,
        damping: 22,
        velocity: velocityX * 1000,
      });
      const ay = animate(y, targetY, {
        type: "spring",
        stiffness: 220,
        damping: 22,
        velocity: velocityY * 1000,
      });

      Promise.all([ax.finished, ay.finished])
        .then(() => {
          params.onDecision({
            cardId: params.card.id,
            type,
            velocityX,
            velocityY,
          });
        })
        .finally(() => {
          isSettlingRef.current = false;
          x.set(0);
          y.set(0);
        });
    },
    [params, x, y],
  );

  const decideFromGesture = useCallback(
    (dx: number, velocityX: number) => {
      const byDistance = Math.abs(dx) >= config.swipeDistanceThresholdPx;
      const byVelocity = Math.abs(velocityX) >= config.swipeVelocityThreshold;
      if (!byDistance && !byVelocity) return null;
      return dx >= 0 ? ("like" as const) : ("nope" as const);
    },
    [config],
  );

  const pointerBind = usePointerDrag({
    onMove: (dx, dy) => {
      if (isSettlingRef.current) return;
      x.set(dx);
      y.set(dy);
    },
    onEnd: (dx, dy, velocityX, velocityY) => {
      if (isSettlingRef.current) return;
      const decision = decideFromGesture(dx, velocityX);
      if (!decision) {
        settleToCenter();
        return;
      }
      void dy;
      settleOffscreen(decision, velocityX, velocityY);
    },
    onCancel: () => {
      if (isSettlingRef.current) return;
      settleToCenter();
    },
  });

  const api = useMemo(() => {
    return {
      motion: { x, y, rotate },
      bind: pointerBind,
      forceDecision: (type: SwipeType) => {
        if (isSettlingRef.current) return;
        const velocityX = type === "like" ? 0.85 : -0.85;
        settleOffscreen(type, velocityX, 0);
      },
    };
  }, [pointerBind, rotate, settleOffscreen, x, y]);

  return api;
}

