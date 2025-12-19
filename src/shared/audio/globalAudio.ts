import { fadeInOnPlay, fadeOutBeforePause, prepareForPlay } from "@/shared/audio/volumeFade";

export type GlobalAudioSegment = {
  id: string;
  url: string;
  startSec: number;
  durationSec: number;
};

type SegmentWindow = {
  id: string;
  url: string;
  startSec: number;
  endSec: number;
};

let audioEl: HTMLAudioElement | null = null;
let activeWindow: SegmentWindow | null = null;
let pendingSeekSec: number | null = null;
let lastEndedWindowId: string | null = null;

type SegmentEndedListener = (segmentId: string) => void;
const segmentEndedListeners = new Set<SegmentEndedListener>();

function emitSegmentEnded(segmentId: string) {
  for (const listener of segmentEndedListeners) {
    try {
      listener(segmentId);
    } catch {
      // Ignore listener errors.
    }
  }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function ensureAudioEl() {
  if (audioEl) return audioEl;
  if (typeof document === "undefined") {
    throw new Error("Global audio is not available in this environment");
  }

  const el = document.createElement("audio");
  el.preload = "auto";
  el.controls = false;
  el.muted = false;
  el.volume = 1;

  el.setAttribute("playsinline", "");
  el.setAttribute("webkit-playsinline", "");

  el.style.position = "fixed";
  el.style.left = "-9999px";
  el.style.top = "0";
  el.style.width = "1px";
  el.style.height = "1px";
  el.style.opacity = "0";
  el.style.pointerEvents = "none";

  el.addEventListener("play", () => {
    fadeInOnPlay(el);
  });

  el.addEventListener("loadedmetadata", () => {
    if (pendingSeekSec == null) return;
    try {
      el.currentTime = pendingSeekSec;
      pendingSeekSec = null;
    } catch {
      // Ignore.
    }
  });

  el.addEventListener("canplay", () => {
    if (pendingSeekSec == null) return;
    try {
      el.currentTime = pendingSeekSec;
      pendingSeekSec = null;
    } catch {
      // Ignore.
    }
  });

  el.addEventListener("timeupdate", () => {
    if (!activeWindow) return;
    if (el.src !== activeWindow.url) return;
    const epsilon = 0.03;
    if (el.currentTime >= activeWindow.endSec - epsilon) {
      const windowId = activeWindow.id;
      if (lastEndedWindowId === windowId) return;
      lastEndedWindowId = windowId;

      const wasPlaying = !el.paused;
      if (wasPlaying) emitSegmentEnded(windowId);

      fadeOutBeforePause(
        el,
        () => {
          el.pause();
          try {
            el.currentTime = activeWindow?.startSec ?? 0;
          } catch {
            // Ignore.
          }
        },
        () => activeWindow?.id === windowId,
      );
    }
  });

  document.body.appendChild(el);
  audioEl = el;
  return el;
}

export function getGlobalAudioElement() {
  return ensureAudioEl();
}

export function getActiveWindow() {
  return activeWindow;
}

export function onSegmentEnded(listener: SegmentEndedListener) {
  segmentEndedListeners.add(listener);
  return () => {
    segmentEndedListeners.delete(listener);
  };
}

export function pauseIfActive(id: string) {
  const el = ensureAudioEl();
  if (!activeWindow || activeWindow.id !== id) return;
  el.pause();
}

export function pauseGlobalAudio() {
  if (!audioEl) return;
  try {
    audioEl.pause();
  } catch {
    // Ignore.
  }
}

export function seekWithinActiveWindow(progressSec: number) {
  const el = ensureAudioEl();
  if (!activeWindow) return;
  const windowDuration = Math.max(0, activeWindow.endSec - activeWindow.startSec);
  const next = activeWindow.startSec + clampNumber(progressSec, 0, windowDuration);
  try {
    el.currentTime = next;
  } catch {
    // Ignore.
  }
}

export async function playWindow(segment: GlobalAudioSegment) {
  const el = ensureAudioEl();
  const safeStart = Math.max(0, segment.startSec);
  const safeDuration = Math.max(0, segment.durationSec);
  const endSec = safeStart + safeDuration;
  activeWindow = { id: segment.id, url: segment.url, startSec: safeStart, endSec };
  lastEndedWindowId = null;

  prepareForPlay(el);

  if (el.src !== segment.url) {
    el.src = segment.url;
    try {
      el.load();
    } catch {
      // Ignore.
    }
  }

  if (el.readyState >= 1) {
    try {
      el.currentTime = safeStart;
    } catch {
      pendingSeekSec = safeStart;
    }
  } else {
    pendingSeekSec = safeStart;
  }

  return el.play();
}
