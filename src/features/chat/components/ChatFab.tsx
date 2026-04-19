import { createPortal } from "react-dom";
import { useState, useRef, useCallback, useEffect } from "react";

type ChatFabProps = {
  onClick: () => void;
  visible: boolean;
};

export function ChatFab({ onClick, visible }: ChatFabProps) {
  const [position, setPosition] = useState({ x: 28, y: 32 });
  const [isDragging, setIsDragging] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const hasMovedRef = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    hasMovedRef.current = false;

    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: position.x,
      posY: position.y,
    };
  }, [position]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setIsDragging(true);
    hasMovedRef.current = false;

    const touch = e.touches[0];
    dragStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      posX: position.x,
      posY: position.y,
    };
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();

      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      const deltaX = clientX - dragStartRef.current.x;
      const deltaY = clientY - dragStartRef.current.y;

      if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
        hasMovedRef.current = true;
      }

      const fabSize = 64;
      const padding = 16;

      const maxX = window.innerWidth - fabSize - padding;
      const maxY = window.innerHeight - fabSize - padding;

      const newX = Math.max(padding, Math.min(maxX, dragStartRef.current.posX - deltaX));
      const newY = Math.max(padding, Math.min(maxY, dragStartRef.current.posY - deltaY));

      setPosition({ x: newX, y: newY });
    };

    const handleEnd = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (hasMovedRef.current) {
      e.preventDefault();
      return;
    }
    onClick();
  }, [onClick]);

  if (!visible) return null;

  return createPortal(
    <button
      className="chatFab"
      type="button"
      aria-label="聊聊"
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      style={{
        right: position.x,
        bottom: position.y,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
    >
      <span className="chatFabMediaFrame" aria-hidden="true">
        {!mediaFailed ? (
          <img
            className="chatFabAnimatedIcon"
            src="/chat-fab-button.gif"
            alt=""
            draggable={false}
            onError={() => setMediaFailed(true)}
          />
        ) : (
          <img
            className="chatFabIcon"
            src="/chat-fab-icon.png"
            alt=""
            draggable={false}
          />
        )}
      </span>
    </button>,
    document.body,
  );
}
