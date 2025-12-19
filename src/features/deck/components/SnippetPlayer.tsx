import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getActiveWindow, getGlobalAudioElement, pauseIfActive, playWindow } from "@/shared/audio/globalAudio";

type SnippetPlayerProps = {
  audioUrl: string;
  startMs: number;
  durationMs: number;
  isActive: boolean;
};

function isAutoplayBlockedError(err: unknown) {
  const e = err as { name?: unknown; message?: unknown } | null;
  const name = typeof e?.name === "string" ? e.name.toLowerCase() : "";
  const message = typeof e?.message === "string" ? e.message.toLowerCase() : "";

  if (name === "notallowederror") return true;
  if (name === "securityerror") return true;

  if (message.includes("didn't interact with the document")) return true;
  if (message.includes("did not interact with the document")) return true;
  if (message.includes("user didn't interact with the document")) return true;
  if (message.includes("user did not interact with the document")) return true;

  if (message.includes("not allowed by the user agent")) return true;
  if (message.includes("not allowed by the user-agent")) return true;
  if (message.includes("the request is not allowed")) return true;
  if (message.includes("request is not allowed")) return true;
  if (message.includes("the operation is not allowed")) return true;

  return false;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export function SnippetPlayer(props: SnippetPlayerProps) {
  const startSec = props.startMs / 1000;
  const durationSec = Math.max(0, props.durationMs / 1000);
  const endSec = startSec + durationSec;

  const segmentIdRef = useRef<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [needsUserGesture, setNeedsUserGesture] = useState(false);
  const [showUnlockOverlay, setShowUnlockOverlay] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [currentSec, setCurrentSec] = useState(startSec);
  const [isReady, setIsReady] = useState(false);

  const progressSec = useMemo(() => clampNumber(currentSec - startSec, 0, durationSec), [currentSec, startSec, durationSec]);
  const progressMs = Math.round(progressSec * 1000);
  const durationMs = Math.round(durationSec * 1000);
  const showUnlockError = Boolean(unlockError && !isAutoplayBlockedError({ message: unlockError }));

  useEffect(() => {
    segmentIdRef.current = `${props.audioUrl}|${props.startMs}|${props.durationMs}`;
  }, [props.audioUrl, props.durationMs, props.startMs]);

  useEffect(() => {
    const audioEl = getGlobalAudioElement();

    function onLoadedMetadata() {
      const active = getActiveWindow();
      if (!active || active.id !== segmentIdRef.current) return;
      setIsReady(true);
    }

    function onCanPlay() {
      const active = getActiveWindow();
      if (!active || active.id !== segmentIdRef.current) return;
      setIsReady(true);
    }

    function onTimeUpdate() {
      const active = getActiveWindow();
      if (!active || active.id !== segmentIdRef.current) return;
      setCurrentSec(audioEl.currentTime);
    }

    function onPlay() {
      const active = getActiveWindow();
      if (!active || active.id !== segmentIdRef.current) return;
      setIsPlaying(true);
      setNeedsUserGesture(false);
      setIsUnlocking(false);
      setUnlockError(null);
      setShowUnlockOverlay(false);
    }

    function onPause() {
      const active = getActiveWindow();
      if (!active || active.id !== segmentIdRef.current) return;
      setIsPlaying(false);
    }

    function onError() {
      const active = getActiveWindow();
      if (!active || active.id !== segmentIdRef.current) return;
      const code = audioEl.error?.code;
      setIsUnlocking(false);
      setNeedsUserGesture(true);
      setShowUnlockOverlay(true);
      setUnlockError(code ? `Media error (code ${code})` : "Media error");
    }

    audioEl.addEventListener("loadedmetadata", onLoadedMetadata);
    audioEl.addEventListener("canplay", onCanPlay);
    audioEl.addEventListener("timeupdate", onTimeUpdate);
    audioEl.addEventListener("play", onPlay);
    audioEl.addEventListener("pause", onPause);
    audioEl.addEventListener("error", onError);

    return () => {
      audioEl.removeEventListener("loadedmetadata", onLoadedMetadata);
      audioEl.removeEventListener("canplay", onCanPlay);
      audioEl.removeEventListener("timeupdate", onTimeUpdate);
      audioEl.removeEventListener("play", onPlay);
      audioEl.removeEventListener("pause", onPause);
      audioEl.removeEventListener("error", onError);
    };
  }, [durationSec, endSec, startSec]);

  useEffect(() => {
    setNeedsUserGesture(false);
    setShowUnlockOverlay(false);
    setIsUnlocking(false);
    setUnlockError(null);
    setIsReady(false);
    setCurrentSec(startSec);

    if (!props.isActive) {
      pauseIfActive(segmentIdRef.current);
      return;
    }

    void playWindow({
      id: segmentIdRef.current,
      url: props.audioUrl,
      startSec,
      durationSec,
    }).catch((e: unknown) => {
      setNeedsUserGesture(true);
      setShowUnlockOverlay(true);
      setIsUnlocking(false);
      setUnlockError(isAutoplayBlockedError(e) ? null : e instanceof Error ? e.message : null);
      setIsPlaying(false);
    });
  }, [props.isActive, props.audioUrl, startSec]);

  async function unlockAndPlayFromGesture() {
    if (!props.isActive) return;
    if (isUnlocking) return;

    setNeedsUserGesture(false);
    setIsUnlocking(true);
    setUnlockError(null);

    try {
      await playWindow({
        id: segmentIdRef.current,
        url: props.audioUrl,
        startSec,
        durationSec,
      });
      setShowUnlockOverlay(false);
      setNeedsUserGesture(false);
      setIsUnlocking(false);
      setUnlockError(null);
    } catch (e: unknown) {
      setNeedsUserGesture(true);
      setShowUnlockOverlay(true);
      setIsUnlocking(false);
      setUnlockError(isAutoplayBlockedError(e) ? null : "Playback was blocked by the browser");
      setIsPlaying(false);
    }
  }

  return (
    <div className="snippetPlayer" data-active={props.isActive ? "true" : "false"}>
      {props.isActive && showUnlockOverlay && typeof document !== "undefined"
        ? createPortal(
            <div
              className="audioUnlockOverlay"
              role="dialog"
              aria-modal="true"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onPointerMove={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
	              <div className="audioUnlockPanel">
	                <div className="audioUnlockTitle">Unlock audio</div>
	                <div className="audioUnlockSubtitle">A browser permission is required to autoplay audio.</div>
	                {showUnlockError ? <div className="audioUnlockError">{unlockError}</div> : null}
	                <button className="audioUnlockButton" type="button" onClick={unlockAndPlayFromGesture}>
	                  {isUnlocking ? "Unlocking..." : "Unlock and play"}
	                </button>
	              </div>
            </div>,
            document.body,
          )
        : null}
      <input
        className="snippetRange"
        type="range"
        min={0}
        max={durationMs}
        value={progressMs}
        readOnly
        tabIndex={-1}
        disabled={!props.isActive || !isReady || durationMs <= 0}
      />
      <div className="snippetTime">
        {formatTime(progressSec)} / {formatTime(durationSec)}
      </div>
    </div>
  );
}
