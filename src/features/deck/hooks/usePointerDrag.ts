import type React from "react";
import { useMemo, useRef } from "react";

export type PointerPoint = {
  x: number;
  y: number;
  t: number;
};

export type PointerDragCallbacks = {
  onStart?: () => void;
  onMove?: (dx: number, dy: number, point: PointerPoint) => void;
  onEnd?: (dx: number, dy: number, velocityX: number, velocityY: number) => void;
  onCancel?: () => void;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  last: PointerPoint;
  prev: PointerPoint;
};

function nowMs() {
  return performance.now();
}

function getPoint(e: React.PointerEvent): PointerPoint {
  return { x: e.clientX, y: e.clientY, t: nowMs() };
}

function computeVelocity(prev: PointerPoint, last: PointerPoint) {
  const dt = Math.max(1, last.t - prev.t);
  return {
    vx: (last.x - prev.x) / dt,
    vy: (last.y - prev.y) / dt,
  };
}

export function usePointerDrag(callbacks: PointerDragCallbacks) {
  const stateRef = useRef<DragState | null>(null);

  return useMemo(() => {
    return {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        if (stateRef.current) return;
        const point = getPoint(e);
        stateRef.current = {
          pointerId: e.pointerId,
          startX: point.x,
          startY: point.y,
          prev: point,
          last: point,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        callbacks.onStart?.();
      },
      onPointerMove: (e: React.PointerEvent) => {
        const state = stateRef.current;
        if (!state) return;
        if (e.pointerId !== state.pointerId) return;

        const point = getPoint(e);
        state.prev = state.last;
        state.last = point;

        const dx = point.x - state.startX;
        const dy = point.y - state.startY;
        callbacks.onMove?.(dx, dy, point);
      },
      onPointerUp: (e: React.PointerEvent) => {
        const state = stateRef.current;
        if (!state) return;
        if (e.pointerId !== state.pointerId) return;
        stateRef.current = null;

        const point = getPoint(e);
        const dx = point.x - state.startX;
        const dy = point.y - state.startY;
        const { vx, vy } = computeVelocity(state.prev, point);
        callbacks.onEnd?.(dx, dy, vx, vy);
      },
      onPointerCancel: (e: React.PointerEvent) => {
        const state = stateRef.current;
        if (!state) return;
        if (e.pointerId !== state.pointerId) return;
        stateRef.current = null;
        callbacks.onCancel?.();
      },
    };
  }, [callbacks]);
}
