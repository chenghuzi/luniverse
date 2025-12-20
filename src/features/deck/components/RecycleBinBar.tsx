import { useEffect, useMemo, useRef, useState } from "react";
import { useDeckStore } from "@/features/deck/model/deckStore";

const TOOLTIP_TEXT = "订阅可解锁回放功能哦";
const TOOLTIP_HIDE_MS = 1400;

export function RecycleBinBar() {
  const recycleBin = useDeckStore((s) => s.recycleBin);
  const items = useMemo(() => recycleBin.slice().reverse(), [recycleBin]);

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!activeKey) return;

    const onPointerDown = () => setActiveKey(null);
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [activeKey]);

  if (items.length === 0) return null;

  return (
    <div className="recycleBinBar" role="region" aria-label="Recycle bin">
      <div className="recycleBinList" role="list">
        {items.map((item, i) => {
          const key = `${item.cardInstanceId}-${i}`;
          const isActive = activeKey === key;
          const title = `${item.highlightTitle} • ${item.podcastTitle}`;

          return (
            <button
              key={key}
              type="button"
              className="recycleBinItem"
              role="listitem"
              title={title}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();

                if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
                const next = isActive ? null : key;
                setActiveKey(next);

                if (next) {
                  hideTimerRef.current = window.setTimeout(() => setActiveKey(null), TOOLTIP_HIDE_MS);
                }
              }}
            >
              <span
                className="recycleBinThumb"
                aria-hidden="true"
                style={{
                  backgroundColor: item.accent,
                  backgroundImage: item.coverUrl ? `url(${item.coverUrl})` : undefined,
                }}
              />
              {isActive ? (
                <span className="recycleBinTooltip" role="tooltip">
                  {TOOLTIP_TEXT}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

