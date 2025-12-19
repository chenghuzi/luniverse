export class LinearResampler {
  private readonly ratio: number;
  private buffer: Float32Array;
  private pos: number;

  constructor(srcRate: number, dstRate: number) {
    if (!Number.isFinite(srcRate) || !Number.isFinite(dstRate) || srcRate <= 0 || dstRate <= 0) {
      throw new Error("Invalid sample rate");
    }
    this.ratio = srcRate / dstRate;
    this.buffer = new Float32Array(0);
    this.pos = 0;
  }

  reset() {
    this.buffer = new Float32Array(0);
    this.pos = 0;
  }

  push(chunk: Float32Array) {
    if (chunk.length === 0) return new Float32Array(0);
    if (this.buffer.length === 0) {
      this.buffer = chunk;
    } else {
      const merged = new Float32Array(this.buffer.length + chunk.length);
      merged.set(this.buffer, 0);
      merged.set(chunk, this.buffer.length);
      this.buffer = merged;
    }

    const out: number[] = [];
    while (this.pos + 1 < this.buffer.length) {
      const i0 = Math.floor(this.pos);
      const i1 = i0 + 1;
      const frac = this.pos - i0;
      const s0 = this.buffer[i0] ?? 0;
      const s1 = this.buffer[i1] ?? 0;
      out.push(s0 + (s1 - s0) * frac);
      this.pos += this.ratio;
    }

    const consumed = Math.floor(this.pos);
    if (consumed > 0) {
      this.buffer = this.buffer.slice(consumed);
      this.pos -= consumed;
    }

    return new Float32Array(out);
  }
}

