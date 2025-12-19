type FadeOptions = {
  fadeInMs: number;
  fadeOutMs: number;
  targetVolume: number;
};

const DEFAULT_OPTIONS: FadeOptions = {
  fadeInMs: 220,
  fadeOutMs: 220,
  targetVolume: 1,
};

let enabled = true;
let options: FadeOptions = DEFAULT_OPTIONS;
let rafId: number | null = null;
let activeToken = 0;
let lastStableVolume = DEFAULT_OPTIONS.targetVolume;
let lastEl: HTMLAudioElement | null = null;

const STORAGE_KEY = "audioVolumeFadeEnabled";

function readStoredEnabled(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return null;
    if (raw === "true") return true;
    if (raw === "false") return false;
    return null;
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cancelAnimation() {
  activeToken++;
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function animateVolume(el: HTMLAudioElement, to: number, durationMs: number, onDone?: () => void) {
  cancelAnimation();
  const token = activeToken;

  const from = clamp(el.volume, 0, 1);
  const target = clamp(to, 0, 1);
  const duration = Math.max(0, Math.floor(durationMs));

  if (duration === 0 || from === target) {
    el.volume = target;
    onDone?.();
    return;
  }

  const startAt = performance.now();
  const tick = () => {
    if (token !== activeToken) return;
    const t = clamp((performance.now() - startAt) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.volume = from + (target - from) * eased;
    if (t >= 1) {
      rafId = null;
      onDone?.();
      return;
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

export function isVolumeFadeEnabled() {
  return enabled;
}

export function setVolumeFadeEnabled(next: boolean) {
  enabled = Boolean(next);
  if (!enabled) {
    cancelAnimation();
    if (lastEl) {
      try {
        lastEl.volume = clamp(lastStableVolume || options.targetVolume, 0, 1);
      } catch {
        // Ignore.
      }
    }
  }
}

export function configureVolumeFade(partial: Partial<FadeOptions>) {
  options = {
    ...options,
    ...partial,
  };
  options.fadeInMs = Math.max(0, Math.floor(options.fadeInMs));
  options.fadeOutMs = Math.max(0, Math.floor(options.fadeOutMs));
  options.targetVolume = clamp(options.targetVolume, 0, 1);
}

export function prepareForPlay(el: HTMLAudioElement) {
  lastEl = el;
  if (!Number.isFinite(el.volume) || el.volume <= 0) {
    el.volume = clamp(lastStableVolume || options.targetVolume, 0, 1);
  }
}

export function fadeInOnPlay(el: HTMLAudioElement) {
  lastEl = el;
  if (!enabled) return;
  const target = clamp(options.targetVolume, 0, 1);
  lastStableVolume = clamp(el.volume || target, 0, 1);
  el.volume = 0;
  animateVolume(el, target, options.fadeInMs);
}

export function fadeOutBeforePause(
  el: HTMLAudioElement,
  onComplete: () => void,
  shouldComplete?: () => boolean,
) {
  lastEl = el;
  if (!enabled) {
    onComplete();
    return;
  }

  const target = clamp(options.targetVolume, 0, 1);
  lastStableVolume = clamp(el.volume || target, 0, 1);
  animateVolume(el, 0, options.fadeOutMs, () => {
    if (shouldComplete && !shouldComplete()) return;
    try {
      onComplete();
    } finally {
      el.volume = target;
    }
  });
}

const storedEnabled = readStoredEnabled();
if (storedEnabled != null) {
  enabled = storedEnabled;
}
