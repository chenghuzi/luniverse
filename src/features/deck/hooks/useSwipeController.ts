import { animate, useMotionValue, type MotionValue, useTransform } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeckMotionConfig } from "@/features/deck/motion/constants";
import { DEFAULT_DECK_MOTION_CONFIG } from "@/features/deck/motion/constants";
import { usePointerDrag } from "@/features/deck/hooks/usePointerDrag";
import { getOffscreenTargetX } from "@/features/deck/motion/transforms";
import type { Card, SwipeDecision, SwipeType } from "@/features/deck/model/types";
import { clamp } from "@/shared/lib/clamp";

type DockTarget = {
  x: number;
  y: number;
  scale?: number;
};

type SettleState = {
  type: SwipeType;
  docked: boolean;
};

type SwipeControllerParams = {
  card: Card;
  onDecision: (decision: SwipeDecision) => void;
  onTap?: () => void;
  config?: Partial<DeckMotionConfig>;
  onMotionActivityChange?: (active: boolean) => void;
  getNopeDockTarget?: (args: { velocityX: number; velocityY: number }) => DockTarget | null;
  motion?: {
    x: MotionValue<number>;
    y: MotionValue<number>;
  };
};

export function useSwipeController(params: SwipeControllerParams) {
  const TAP_MAX_TRAVEL_PX = 10;
  const config = useMemo(
    () => ({ ...DEFAULT_DECK_MOTION_CONFIG, ...(params.config ?? {}) }),
    [params.config],
  );

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const internalX = useMotionValue(0);
  const internalY = useMotionValue(0);
  const internalScale = useMotionValue(1);
  const x = params.motion?.x ?? internalX;
  const y = params.motion?.y ?? internalY;
  const scale = internalScale;
  const rotate = useTransform(x, (latestX) => {
    const clamped = clamp(latestX / 240, -1, 1);
    return clamped * config.maxRotateDeg;
  });

  const [settle, setSettle] = useState<SettleState | null>(null);
  const isSettlingRef = useRef(false);
  const isActiveRef = useRef(false);
  const setActive = useCallback(
    (active: boolean) => {
      if (isActiveRef.current === active) return;
      isActiveRef.current = active;
      params.onMotionActivityChange?.(active);
    },
    [params],
  );

  const settleToCenter = useCallback(() => {
    isSettlingRef.current = true;
    setActive(true);
    const ax = animate(x, 0, { type: "spring", stiffness: 340, damping: 28 });
    const ay = animate(y, 0, { type: "spring", stiffness: 340, damping: 28 });
    const as = animate(scale, 1, { type: "spring", stiffness: 340, damping: 28 });
    Promise.all([ax, ay, as]).finally(() => {
      isSettlingRef.current = false;
      setActive(false);
    });
  }, [scale, setActive, x, y]);

  const settleOffscreen = useCallback(
    (type: SwipeType, velocityX: number, velocityY: number) => {
      isSettlingRef.current = true;
      setActive(true);
      const direction = type === "like" ? "right" : "left";
      const dock = type === "nope" ? params.getNopeDockTarget?.({ velocityX, velocityY }) : null;
      const targetX = dock?.x ?? getOffscreenTargetX(direction);
      const targetY = dock?.y ?? (y.get() + velocityY * 160);
      const targetScale = dock?.scale ?? 1;

      if (mountedRef.current) setSettle({ type, docked: Boolean(dock) });

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
      const as = animate(scale, targetScale, {
        type: "spring",
        stiffness: 260,
        damping: 24,
      });

      Promise.all([ax, ay, as])
        .then(() => {
          params.onDecision({
            cardId: params.card.id,
            cardInstanceId: params.card.instanceId,
            type,
            velocityX,
            velocityY,
          });
        })
        .finally(() => {
          isSettlingRef.current = false;
          setActive(false);
          x.set(0);
          y.set(0);
          scale.set(1);
          if (mountedRef.current) setSettle(null);
        });
    },
    [params, scale, setActive, x, y],
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
    onStart: () => {
      if (isSettlingRef.current) return;
      setActive(true);
    },
    onMove: (dx, dy) => {
      if (isSettlingRef.current) return;
      x.set(dx);
      y.set(dy);
    },
    onEnd: (dx, dy, velocityX, velocityY) => {
      if (isSettlingRef.current) return;
      const decision = decideFromGesture(dx, velocityX);
      if (!decision) {
        if (Math.hypot(dx, dy) <= TAP_MAX_TRAVEL_PX) {
          x.set(0);
          y.set(0);
          scale.set(1);
          setActive(false);
          params.onTap?.();
          return;
        }
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
      motion: { x, y, rotate, scale },
      bind: pointerBind,
      settle,
      forceDecision: (type: SwipeType) => {
        if (isSettlingRef.current) return;
        const velocityX = type === "like" ? 0.85 : -0.85;
        settleOffscreen(type, velocityX, 0);
      },
    };
  }, [pointerBind, rotate, scale, settle, settleOffscreen, x, y]);

  return api;
}
