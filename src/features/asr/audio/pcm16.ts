function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function float32ToPcm16(samples: Float32Array) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = clamp(samples[i] ?? 0, -1, 1);
    out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  return out;
}

export function pcm16ToBytesLE(samples: readonly number[]) {
  const bytes = new Uint8Array(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] ?? 0;
    bytes[i * 2] = v & 0xff;
    bytes[i * 2 + 1] = (v >> 8) & 0xff;
  }
  return bytes;
}

export class Pcm16FrameAssembler {
  private readonly frameSamples: number;
  private pending: number[];
  private readIndex: number;

  constructor(frameSamples: number) {
    if (!Number.isFinite(frameSamples) || frameSamples <= 0) throw new Error("Invalid frame size");
    this.frameSamples = Math.floor(frameSamples);
    this.pending = [];
    this.readIndex = 0;
  }

  reset() {
    this.pending = [];
    this.readIndex = 0;
  }

  pushPcm16(chunk: Int16Array) {
    for (let i = 0; i < chunk.length; i++) this.pending.push(chunk[i] ?? 0);

    const frames: Uint8Array[] = [];
    while (this.pending.length - this.readIndex >= this.frameSamples) {
      const slice = this.pending.slice(this.readIndex, this.readIndex + this.frameSamples);
      this.readIndex += this.frameSamples;
      frames.push(pcm16ToBytesLE(slice));
    }

    if (this.readIndex > 8192) {
      this.pending = this.pending.slice(this.readIndex);
      this.readIndex = 0;
    }

    return frames;
  }
}

