import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useDeckStore } from "@/features/deck/model/deckStore";
import { useRecycleBinUiStore, type DockRect } from "@/features/deck/model/recycleBinUiStore";

const TOOLTIP_TEXT = "订阅可解锁回放功能哦";
const TOOLTIP_HIDE_MS = 1400;

const MAGIC_RADIUS_PX = 140;
const MAGIC_BOOST = 0.48;

type TooltipState = {
  key: string;
  left: number;
  top: number;
};

function toDockRect(r: DOMRect): DockRect {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function computeMagicScale(distancePx: number) {
  const t = clampNumber(1 - distancePx / MAGIC_RADIUS_PX, 0, 1);
  const eased = 1 - Math.pow(1 - t, 3);
  return 1 + eased * MAGIC_BOOST;
}

export function RecycleBinBar() {
  const recycleBin = useDeckStore((s) => s.recycleBin);
  const items = useMemo(() => recycleBin.slice().reverse(), [recycleBin]);

  const dockRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const setDockRect = useRecycleBinUiStore((s) => s.actions.setDockRect);
  const dragActive = useRecycleBinUiStore((s) => s.dragActive);
  const dragCenter = useRecycleBinUiStore((s) => s.dragCenter);
  const dragSide = useRecycleBinUiStore((s) => s.dragSide);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!tooltip) return;

    const onPointerDown = () => setTooltip(null);
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [tooltip]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollLeft = 0;
  }, [items.length]);

  useLayoutEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const dockEl = el;

    function updateDockRect() {
      const r = dockEl.getBoundingClientRect();
      if (!Number.isFinite(r.left) || !Number.isFinite(r.top) || r.width <= 0 || r.height <= 0) {
        setDockRect(null);
        return;
      }
      setDockRect(toDockRect(r));
    }

    updateDockRect();

    const ro = new ResizeObserver(() => updateDockRect());
    ro.observe(dockEl);

    const onScroll = () => updateDockRect();
    window.addEventListener("scroll", onScroll, { passive: true });
    const listEl = listRef.current;
    listEl?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      listEl?.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [setDockRect]);

  const magicScales = useMemo(() => {
    if (!dragActive || !dragCenter || dragSide !== "left") return [];

    return itemRefs.current.map((el) => {
      if (!el) return 1;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = dragCenter.x - cx;
      const dy = dragCenter.y - cy;
      const d = Math.hypot(dx, dy);
      return computeMagicScale(d);
    });
  }, [dragActive, dragCenter, dragSide, items.length]);

  return (
    <div className="recycleBinBar" role="region" aria-label="回收站">
      <div className="recycleBinList" role="list" ref={listRef}>
        {dragActive && (
          <button
            ref={(el) => {
              dockRef.current = el;
              itemRefs.current[0] = el;
            }}
            type="button"
            className="recycleBinItem recycleBinDock"
            aria-label="回收站停靠区"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
              setTooltip(null);
            }}
          >
            <span
              className="recycleBinThumb recycleBinDockThumb"
              aria-hidden="true"
              style={{
                ["--thumbScale" as never]: String(magicScales[0] ?? 1),
              }}
            />
          </button>
        )}
        <AnimatePresence mode="popLayout">
          {items.map((item, i) => {
            const key = `${item.cardInstanceId}-${i}`;
            const isActive = tooltip?.key === key;
            const title = `${item.highlightTitle} • ${item.podcastTitle}`;
            const scale = magicScales[dragActive ? i + 1 : i] ?? 1;

            return (
              <motion.button
                key={key}
                layout
                type="button"
                className="recycleBinItem"
                role="listitem"
                title={title}
                initial={{ opacity: 0, scale: 0.5, x: -20 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                ref={(el) => {
                  itemRefs.current[dragActive ? i + 1 : i] = el;
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();

                  if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
                  if (isActive) {
                    setTooltip(null);
                    return;
                  }

                  const r = e.currentTarget.getBoundingClientRect();
                  const anchorLeft = r.left + r.width / 2;
                  const clampedLeft = clampNumber(anchorLeft, 92, window.innerWidth - 92);
                  const anchorTop = r.top - 10;
                  setTooltip({ key, left: clampedLeft, top: anchorTop });
                  hideTimerRef.current = window.setTimeout(() => setTooltip(null), TOOLTIP_HIDE_MS);
                }}
              >
                <span
                  className="recycleBinThumb"
                  aria-hidden="true"
                  style={{
                    backgroundColor: item.accent,
                    backgroundImage: item.coverUrl ? `url(${item.coverUrl})` : undefined,
                    ["--thumbScale" as never]: String(scale),
                  }}
                />
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
      <div className="attributionText recycleBinAttribution">杭州 Enactflow 出品</div>
      {tooltip && typeof document !== "undefined"
        ? createPortal(
            <div className="recycleBinTooltipPortal" role="tooltip" style={{ left: tooltip.left, top: tooltip.top }}>
              {TOOLTIP_TEXT}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
