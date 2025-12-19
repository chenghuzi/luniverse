import { useEffect, useRef } from "react";
import { getGlobalAudioElement } from "@/shared/audio/globalAudio";
import { getAudioLevel, isAudioAnalysisRunning, resumeAudioAnalysisFromGesture } from "@/shared/audio/audioAnalysis";

function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

type Rgb = { r: number; g: number; b: number };

function makeGradient(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: Rgb, alpha: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`);
  g.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
  return g;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

const COLORS: readonly Rgb[] = [
  { r: 99, g: 102, b: 241 },
  { r: 14, g: 165, b: 233 },
  { r: 236, g: 72, b: 153 },
  { r: 34, g: 197, b: 94 },
] as const;

export function AudioReactiveBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const sizeRef = useRef<{ w: number; h: number; dpr: number }>({ w: 0, h: 0, dpr: 1 });
  const smoothLevelRef = useRef(0);
  const smoothVisibleRef = useRef(0);
  const lastSampleMsRef = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const canvasEl: HTMLCanvasElement = canvas;
    const ctx2d: CanvasRenderingContext2D = ctx;

    const audioEl = getGlobalAudioElement();
    let disposed = false;

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      sizeRef.current = { w, h, dpr };

      canvasEl.width = Math.floor(w * dpr);
      canvasEl.height = Math.floor(h * dpr);
      canvasEl.style.width = `${w}px`;
      canvasEl.style.height = `${h}px`;

      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function ensureAnalysisFromFirstGesture() {
      void resumeAudioAnalysisFromGesture();
      window.removeEventListener("pointerdown", ensureAnalysisFromFirstGesture, true);
      window.removeEventListener("keydown", ensureAnalysisFromFirstGesture, true);
    }

    window.addEventListener("resize", resize);
    window.addEventListener("pointerdown", ensureAnalysisFromFirstGesture, true);
    window.addEventListener("keydown", ensureAnalysisFromFirstGesture, true);
    resize();

    function draw(nowMs: number) {
      if (disposed) return;
      rafRef.current = window.requestAnimationFrame(draw);

      const { w, h } = sizeRef.current;
      if (w <= 0 || h <= 0) return;

      const isPlaying = !audioEl.paused && audioEl.currentSrc.length > 0;
      const targetVisible = isPlaying ? 1 : 0;
      smoothVisibleRef.current = lerp(smoothVisibleRef.current, targetVisible, 0.06);

      if (smoothVisibleRef.current < 0.002) {
        ctx2d.clearRect(0, 0, w, h);
        return;
      }

      if (nowMs - lastSampleMsRef.current > 33) {
        lastSampleMsRef.current = nowMs;
        const level = isPlaying ? getAudioLevel() : 0;
        smoothLevelRef.current = lerp(smoothLevelRef.current, level, 0.14);
      }

      ctx2d.clearRect(0, 0, w, h);
      ctx2d.globalCompositeOperation = "lighter";

      const t = nowMs / 1000;
      const centerX = w * 0.5;
      const centerY = h * 0.56;
      const baseRadius = Math.min(w, h) * 0.22;
      const amp = (0.55 + smoothLevelRef.current * 1.25) * smoothVisibleRef.current;
      const alphaBase = (isAudioAnalysisRunning() ? 0.18 : 0.12) * smoothVisibleRef.current;

      for (let i = 0; i < 6; i++) {
        const c = COLORS[i % COLORS.length];
        const phase = t * (0.55 + i * 0.07) + i * 1.4;
        const x = centerX + Math.sin(phase) * w * (0.10 + i * 0.015);
        const y = centerY + Math.cos(phase * 1.2) * h * (0.08 + i * 0.01);
        const radius = baseRadius * (0.8 + i * 0.14) * (1 + amp * 0.7);

        ctx2d.fillStyle = makeGradient(ctx2d, x, y, radius, c, alphaBase);
        ctx2d.beginPath();
        ctx2d.arc(x, y, radius, 0, Math.PI * 2);
        ctx2d.fill();
      }

      ctx2d.globalCompositeOperation = "source-over";
    }

    rafRef.current = window.requestAnimationFrame(draw);

    return () => {
      disposed = true;
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointerdown", ensureAnalysisFromFirstGesture, true);
      window.removeEventListener("keydown", ensureAnalysisFromFirstGesture, true);
    };
  }, []);

  if (prefersReducedMotion()) return null;

  return (
    <div className="audioReactiveBackground" aria-hidden="true">
      <canvas ref={canvasRef} className="audioReactiveCanvas" />
    </div>
  );
}
