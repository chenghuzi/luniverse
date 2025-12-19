import { useEffect, useMemo, useRef, useState } from "react";

type SnippetPlayerProps = {
  audioUrl: string;
  startMs: number;
  durationMs: number;
  isActive: boolean;
};

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

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [needsUserGesture, setNeedsUserGesture] = useState(false);
  const [currentSec, setCurrentSec] = useState(startSec);
  const [isReady, setIsReady] = useState(false);

  const progressSec = useMemo(() => clampNumber(currentSec - startSec, 0, durationSec), [currentSec, startSec, durationSec]);
  const progressMs = Math.round(progressSec * 1000);
  const durationMs = Math.round(durationSec * 1000);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const audioEl: HTMLAudioElement = audio;

    function onLoadedMetadata() {
      setIsReady(true);
      if (pendingSeekRef.current != null) {
        try {
          audioEl.currentTime = pendingSeekRef.current;
        } catch {
          // Ignore seek errors; we will try again on canplay.
        }
        pendingSeekRef.current = null;
      }
    }

    function onCanPlay() {
      if (pendingSeekRef.current != null) {
        try {
          audioEl.currentTime = pendingSeekRef.current;
          pendingSeekRef.current = null;
        } catch {
          // Ignore.
        }
      }
    }

    function onTimeUpdate() {
      const t = audioEl.currentTime;
      setCurrentSec(t);
      if (durationSec > 0 && t >= endSec) {
        audioEl.pause();
        setIsPlaying(false);
        try {
          audioEl.currentTime = startSec;
        } catch {
          // Ignore.
        }
      }
    }

    function onPlay() {
      setIsPlaying(true);
    }

    function onPause() {
      setIsPlaying(false);
    }

    audioEl.addEventListener("loadedmetadata", onLoadedMetadata);
    audioEl.addEventListener("canplay", onCanPlay);
    audioEl.addEventListener("timeupdate", onTimeUpdate);
    audioEl.addEventListener("play", onPlay);
    audioEl.addEventListener("pause", onPause);

    return () => {
      audioEl.removeEventListener("loadedmetadata", onLoadedMetadata);
      audioEl.removeEventListener("canplay", onCanPlay);
      audioEl.removeEventListener("timeupdate", onTimeUpdate);
      audioEl.removeEventListener("play", onPlay);
      audioEl.removeEventListener("pause", onPause);
    };
  }, [durationSec, endSec, startSec]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    setNeedsUserGesture(false);
    setIsReady(false);
    setCurrentSec(startSec);

    if (!props.isActive) {
      audio.pause();
      try {
        audio.currentTime = startSec;
      } catch {
        // Ignore.
      }
      return;
    }

    const safeStart = Math.max(0, startSec);
    if (audio.readyState >= 1) {
      try {
        audio.currentTime = safeStart;
      } catch {
        pendingSeekRef.current = safeStart;
      }
    } else {
      pendingSeekRef.current = safeStart;
    }

    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch(() => {
        setNeedsUserGesture(true);
        setIsPlaying(false);
      });
    }
  }, [props.isActive, props.audioUrl, startSec]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;

    setNeedsUserGesture(false);

    if (audio.paused) {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise.catch(() => {
          setNeedsUserGesture(true);
          setIsPlaying(false);
        });
      }
      return;
    }
    audio.pause();
  }

  function onScrub(valueMs: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const next = startSec + clampNumber(valueMs, 0, durationMs) / 1000;
    try {
      audio.currentTime = next;
    } catch {
      // Ignore.
    }
    setCurrentSec(next);
  }

  return (
    <div className="snippetPlayer" data-active={props.isActive ? "true" : "false"}>
      <audio ref={audioRef} src={props.isActive ? props.audioUrl : undefined} preload={props.isActive ? "auto" : "none"} />
      <button className="snippetButton" type="button" onClick={togglePlay} disabled={!props.isActive}>
        {needsUserGesture ? "Tap to play" : isPlaying ? "Pause" : "Play"}
      </button>
      <input
        className="snippetRange"
        type="range"
        min={0}
        max={durationMs}
        value={progressMs}
        disabled={!props.isActive || !isReady || durationMs <= 0}
        onChange={(e) => onScrub(Number(e.target.value))}
      />
      <div className="snippetTime">
        {formatTime(progressSec)} / {formatTime(durationSec)}
      </div>
    </div>
  );
}
