type Rgb = { r: number; g: number; b: number };

const gradientCache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rgbToCss(rgb: Rgb) {
  const r = clamp(Math.round(rgb.r), 0, 255);
  const g = clamp(Math.round(rgb.g), 0, 255);
  const b = clamp(Math.round(rgb.b), 0, 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function relativeLuminance(rgb: Rgb) {
  const srgb = [rgb.r, rgb.g, rgb.b].map((v) => clamp(v / 255, 0, 1));
  const lin = srgb.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function darkenIfNeeded(rgb: Rgb) {
  const lum = relativeLuminance(rgb);
  if (lum <= 0.62) return rgb;
  const factor = clamp(0.62 / lum, 0.35, 0.9);
  return { r: rgb.r * factor, g: rgb.g * factor, b: rgb.b * factor };
}

function distance2(a: Rgb, b: Rgb) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

function kmeans2(pixels: Rgb[]) {
  if (pixels.length === 0) return null;

  let c1 = pixels[0];
  let c2 = pixels[0];
  let best = -1;
  for (let i = 0; i < pixels.length; i++) {
    const d = distance2(pixels[i], c1);
    if (d > best) {
      best = d;
      c2 = pixels[i];
    }
  }

  for (let iter = 0; iter < 6; iter++) {
    let s1 = { r: 0, g: 0, b: 0 };
    let s2 = { r: 0, g: 0, b: 0 };
    let n1 = 0;
    let n2 = 0;

    for (const p of pixels) {
      if (distance2(p, c1) <= distance2(p, c2)) {
        s1.r += p.r;
        s1.g += p.g;
        s1.b += p.b;
        n1++;
      } else {
        s2.r += p.r;
        s2.g += p.g;
        s2.b += p.b;
        n2++;
      }
    }

    if (n1 > 0) c1 = { r: s1.r / n1, g: s1.g / n1, b: s1.b / n1 };
    if (n2 > 0) c2 = { r: s2.r / n2, g: s2.g / n2, b: s2.b / n2 };

    if (n2 === 0) {
      let farthest = pixels[0];
      let farthestD = -1;
      for (const p of pixels) {
        const d = distance2(p, c1);
        if (d > farthestD) {
          farthestD = d;
          farthest = p;
        }
      }
      c2 = farthest;
    }
  }

  const d = distance2(c1, c2);
  if (d < 18 * 18) return { a: c1, b: c1 };
  return { a: c1, b: c2 };
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  if (typeof document === "undefined") {
    throw new Error("Image gradient is not available in this environment");
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.loading = "eager";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

function extractPixels(img: HTMLImageElement): Rgb[] {
  const w = Math.max(1, img.naturalWidth || img.width || 1);
  const h = Math.max(1, img.naturalHeight || img.height || 1);
  const scale = Math.max(w, h) / 32;
  const cw = clamp(Math.round(w / scale), 1, 32);
  const ch = clamp(Math.round(h / scale), 1, 32);

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, cw, ch);

  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, cw, ch);
  } catch {
    return [];
  }

  const pixels: Rgb[] = [];
  const step = 4;
  for (let i = 0; i < data.data.length; i += 4 * step) {
    const a = data.data[i + 3];
    if (a < 200) continue;
    pixels.push({ r: data.data[i], g: data.data[i + 1], b: data.data[i + 2] });
    if (pixels.length >= 900) break;
  }
  return pixels;
}

export async function getCoverGradient(url: string): Promise<string | null> {
  const key = url.trim();
  if (key.length === 0) return null;
  if (gradientCache.has(key)) return gradientCache.get(key)!;
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async () => {
    try {
      const img = await loadImage(key);
      const pixels = extractPixels(img);
      const clusters = kmeans2(pixels);
      if (!clusters) return null;
      const a = darkenIfNeeded(clusters.a);
      const b = darkenIfNeeded(clusters.b);

      const base = `linear-gradient(135deg, ${rgbToCss(a)}, ${rgbToCss(b)})`;
      const overlay = "linear-gradient(180deg, rgba(0, 0, 0, 0.14), rgba(0, 0, 0, 0.36))";
      return `${overlay}, ${base}`;
    } catch {
      return null;
    }
  })()
    .then((v) => {
      gradientCache.set(key, v);
      inflight.delete(key);
      return v;
    })
    .catch(() => {
      gradientCache.set(key, null);
      inflight.delete(key);
      return null;
    });

  inflight.set(key, p);
  return p;
}

