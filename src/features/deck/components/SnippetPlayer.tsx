import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { getActiveWindow, getGlobalAudioElement, onSegmentEnded, pauseIfActive, playWindow } from "@/shared/audio/globalAudio";
import { resumeAudioAnalysisFromGesture } from "@/shared/audio/audioAnalysis";

type SnippetPlayerProps = {
  audioUrl: string;
  startMs: number;
  durationMs: number;
  isActive: boolean;
  onAutoAdvance?: () => void;
  onPlaybackStateChange?: (state: SnippetPlaybackState) => void;
};

export type SnippetPlaybackState = "idle" | "playing" | "paused" | "blocked";

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
  const segmentId = `${props.audioUrl}|${props.startMs}|${props.durationMs}`;

  const segmentIdRef = useRef<string>("");
  segmentIdRef.current = segmentId;
  const isActiveRef = useRef<boolean>(props.isActive);
  const autoAdvanceArmedRef = useRef<boolean>(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [needsUserGesture, setNeedsUserGesture] = useState(false);
  const [showUnlockOverlay, setShowUnlockOverlay] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [currentSec, setCurrentSec] = useState(startSec);
  const [isReady, setIsReady] = useState(false);
  const [playbackState, setPlaybackState] = useState<SnippetPlaybackState>("idle");

  const progressSec = useMemo(() => clampNumber(currentSec - startSec, 0, durationSec), [currentSec, startSec, durationSec]);
  const progressMs = Math.round(progressSec * 1000);
  const durationMs = Math.round(durationSec * 1000);
  const progressRatio = durationMs > 0 ? clampNumber(progressMs / durationMs, 0, 1) : 0;
  const progressPct = `${progressRatio * 100}%`;
  const showUnlockError = Boolean(unlockError && !isAutoplayBlockedError({ message: unlockError }));

  useEffect(() => {
    isActiveRef.current = props.isActive;
    if (!props.isActive) autoAdvanceArmedRef.current = false;
  }, [props.isActive]);

  useEffect(() => {
    props.onPlaybackStateChange?.(playbackState);
  }, [playbackState, props.onPlaybackStateChange]);

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
      autoAdvanceArmedRef.current = true;
      setIsPlaying(true);
      setPlaybackState("playing");
      setNeedsUserGesture(false);
      setIsUnlocking(false);
      setUnlockError(null);
      setShowUnlockOverlay(false);
    }

    function onPause() {
      const active = getActiveWindow();
      if (!active || active.id !== segmentIdRef.current) return;
      autoAdvanceArmedRef.current = false;
      setIsPlaying(false);
      if (!isActiveRef.current) {
        setPlaybackState("idle");
        return;
      }
      const isNearSegmentEnd = audioEl.currentTime >= endSec - 0.08;
      setPlaybackState(isNearSegmentEnd ? "idle" : "paused");
    }

    function onError() {
      const active = getActiveWindow();
      if (!active || active.id !== segmentIdRef.current) return;
      autoAdvanceArmedRef.current = false;
      const code = audioEl.error?.code;
      setIsUnlocking(false);
      setNeedsUserGesture(true);
      setShowUnlockOverlay(true);
      setPlaybackState("blocked");
      setUnlockError(code ? `媒体播放错误（代码 ${code}）` : "媒体播放错误");
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
    setPlaybackState("idle");
    autoAdvanceArmedRef.current = false;

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
      autoAdvanceArmedRef.current = false;
      setNeedsUserGesture(true);
      setShowUnlockOverlay(true);
      setIsUnlocking(false);
      setUnlockError(isAutoplayBlockedError(e) ? null : "媒体播放异常");
      setIsPlaying(false);
      setPlaybackState("blocked");
    });
  }, [props.isActive, props.audioUrl, startSec]);

  useEffect(() => {
    if (!props.isActive) return;
    if (!props.onAutoAdvance) return;
    const expectedId = segmentId;

    return onSegmentEnded((endedId) => {
      if (endedId !== expectedId) return;
      if (!isActiveRef.current) return;
      if (!autoAdvanceArmedRef.current) return;
      autoAdvanceArmedRef.current = false;
      props.onAutoAdvance?.();
    });
  }, [props.isActive, props.onAutoAdvance, segmentId]);

  async function unlockAndPlayFromGesture() {
    if (!props.isActive) return;
    if (isUnlocking) return;

    setNeedsUserGesture(false);
    setIsUnlocking(true);
    setUnlockError(null);

    try {
      await resumeAudioAnalysisFromGesture();
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
      autoAdvanceArmedRef.current = false;
      setNeedsUserGesture(true);
      setShowUnlockOverlay(true);
      setIsUnlocking(false);
      setUnlockError(isAutoplayBlockedError(e) ? null : "浏览器阻止了播放");
      setIsPlaying(false);
      setPlaybackState("blocked");
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
                <div className="audioUnlockTitle">{"\u5141\u8bb8\u64ad\u653e\u4ee5\u4eab\u53d7\u5b8c\u6574\u4f53\u9a8c"}</div>
                <div className="audioUnlockSubtitle">{"\u6d4f\u89c8\u5668\u53ef\u80fd\u4f1a\u8981\u6c42\u5a92\u4f53\u64ad\u653e\u6743\u9650"}</div>
                {showUnlockError ? <div className="audioUnlockError">{unlockError}</div> : null}
                <button className="audioUnlockButton" type="button" onClick={unlockAndPlayFromGesture} disabled={isUnlocking}>
                  继续播放
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
      <div
        className="snippetProgress"
        role="progressbar"
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={durationMs}
        aria-valuenow={progressMs}
        data-disabled={!props.isActive || !isReady || durationMs <= 0 ? "true" : "false"}
        style={
          {
            ["--snippet-progress" as any]: progressPct,
          } as CSSProperties
        }
      >
        <div className="snippetProgressFill" />
      </div>
      <div className="snippetTime">
        {formatTime(progressSec)} / {formatTime(durationSec)}
      </div>
    </div>
  );
}
