type VoiceWaveformProps = {
  active: boolean;
  animate?: boolean;
  bars: number[];
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

export function VoiceWaveform(props: VoiceWaveformProps) {
  const barMin = 0.25;
  const barMax = 1.0;
  const animate = Boolean(props.animate);

  return (
    <div
      className={[
        "voiceChatWave",
        props.active ? "voiceChatWaveLive" : null,
        animate ? "voiceChatWaveActive" : null,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
    >
      {props.bars.map((v, idx) => {
        const scaled = barMin + clamp01(v) * (barMax - barMin);
        return <span key={idx} className="voiceChatWaveBar" style={{ transform: `scaleY(${scaled})` }} />;
      })}
    </div>
  );
}
