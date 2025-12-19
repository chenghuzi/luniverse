import { useEffect, useMemo, useState } from "react";
import { isVolumeFadeEnabled, setVolumeFadeEnabled } from "@/shared/audio/volumeFade";

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

function isTypingTarget(target: EventTarget | null) {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function AudioFadeToggle() {
  const initialEnabled = useMemo(() => readStoredEnabled() ?? isVolumeFadeEnabled(), []);
  const [enabled, setEnabled] = useState<boolean>(initialEnabled);

  useEffect(() => {
    setVolumeFadeEnabled(enabled);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // Ignore.
    }
  }, [enabled]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if (e.repeat) return;
      if (isTypingTarget(e.target)) return;
      if (e.key.toLowerCase() !== "f") return;
      e.preventDefault();
      setEnabled((v) => !v);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <button
      className="audioFadeToggle"
      type="button"
      aria-pressed={enabled}
      onClick={() => setEnabled((v) => !v)}
      title="Toggle volume fade (F)"
    >
      Fade: {enabled ? "On" : "Off"}
    </button>
  );
}

