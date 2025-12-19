type VoiceWaveformProps = {
  active: boolean;
  bars: number[];
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

export function VoiceWaveform(props: VoiceWaveformProps) {
  const barMin = 0.1;
  const barMax = 2.2;

  return (
    <div className={props.active ? "voiceChatWave voiceChatWaveLive" : "voiceChatWave"} aria-hidden="true">
      {props.bars.map((v, idx) => {
        const scaled = barMin + clamp01(v) * (barMax - barMin);
        return <span key={idx} className="voiceChatWaveBar" style={{ transform: `scaleY(${scaled})` }} />;
      })}
    </div>
  );
}
