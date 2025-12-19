import type { Card } from "@/features/deck/model/types";

export type DeckPage = {
  cards: Card[];
  nextCursor: number;
};

type DeckPageParams = {
  cursor: number;
  limit: number;
};

const BASE_CARDS: Array<Omit<Card, "instanceId">> = [
  {
    id: "c1",
    podcast: {
      id: "p1",
      title: "The Night Shift",
      authorName: "Luniverse Studio",
      imageUrl: "https://example.com/podcasts/the-night-shift/cover.jpg",
      language: "en",
      categories: ["Technology", "Culture"],
    },
    episode: {
      id: "e1",
      title: "Why We Build Tools",
      link: "https://example.com/podcasts/the-night-shift/episodes/why-we-build-tools",
      publishedAt: "2025-11-08T10:00:00Z",
      durationSeconds: 2875,
      imageUrl: "https://example.com/podcasts/the-night-shift/episodes/e1.jpg",
      audio: {
        url: "https://example.com/audio/the-night-shift/e1.mp3",
        mimeType: "audio/mpeg",
        byteLength: 46278123,
      },
    },
    highlight: {
      id: "h1",
      title: "The fastest route is fewer decisions",
      text: "If you remove choices early, you move faster later.",
      snippet: { startMs: 312_000, durationMs: 18_000 },
    },
    ui: { accent: "linear-gradient(135deg,#0ea5e9,#6366f1)" },
  },
  {
    id: "c2",
    podcast: {
      id: "p2",
      title: "Database Unplugged",
      authorName: "Hz & Friends",
      imageUrl: "https://example.com/podcasts/database-unplugged/cover.jpg",
      language: "zh",
      categories: ["Software", "Databases"],
    },
    episode: {
      id: "e2",
      title: "Indexes, Reality, and Tradeoffs",
      link: "https://example.com/podcasts/database-unplugged/episodes/indexes-reality-tradeoffs",
      publishedAt: "2025-10-21T02:00:00Z",
      durationSeconds: 3652,
      imageUrl: "https://example.com/podcasts/database-unplugged/episodes/e2.jpg",
      audio: {
        url: "https://example.com/audio/database-unplugged/e2.mp3",
        mimeType: "audio/mpeg",
        byteLength: 58123456,
      },
    },
    highlight: {
      id: "h2",
      title: "Cost models are stories you tell yourself",
      text: "Then production reminds you which parts were fiction.",
      snippet: { startMs: 1_042_000, durationMs: 22_000 },
    },
    ui: { accent: "linear-gradient(135deg,#22c55e,#14b8a6)" },
  },
  {
    id: "c3",
    podcast: {
      id: "p3",
      title: "Product Signals",
      authorName: "Signal Works",
      imageUrl: "https://example.com/podcasts/product-signals/cover.jpg",
      language: "en",
      categories: ["Business", "Product"],
    },
    episode: {
      id: "e3",
      title: "Designing for Drift",
      link: "https://example.com/podcasts/product-signals/episodes/designing-for-drift",
      publishedAt: "2025-09-12T18:30:00Z",
      durationSeconds: 2411,
      imageUrl: "https://example.com/podcasts/product-signals/episodes/e3.jpg",
      audio: {
        url: "https://example.com/audio/product-signals/e3.mp3",
        mimeType: "audio/mpeg",
        byteLength: 39876543,
      },
    },
    highlight: {
      id: "h3",
      title: "You are shipping your defaults",
      text: "Every unhandled edge case becomes a product choice.",
      snippet: { startMs: 654_000, durationMs: 16_000 },
    },
    ui: { accent: "linear-gradient(135deg,#f97316,#ef4444)" },
  },
  {
    id: "c4",
    podcast: {
      id: "p4",
      title: "Frontend Mechanics",
      authorName: "Motion Lab",
      imageUrl: "https://example.com/podcasts/frontend-mechanics/cover.jpg",
      language: "en",
      categories: ["Software", "Web"],
    },
    episode: {
      id: "e4",
      title: "Pointer Events in the Real World",
      link: "https://example.com/podcasts/frontend-mechanics/episodes/pointer-events-real-world",
      publishedAt: "2025-08-03T09:15:00Z",
      durationSeconds: 3190,
      imageUrl: "https://example.com/podcasts/frontend-mechanics/episodes/e4.jpg",
      audio: {
        url: "https://example.com/audio/frontend-mechanics/e4.mp3",
        mimeType: "audio/mpeg",
        byteLength: 51234567,
      },
    },
    highlight: {
      id: "h4",
      title: "Drag feels wrong when scroll is uncertain",
      text: "Make touch-action explicit before you tune thresholds.",
      snippet: { startMs: 184_000, durationMs: 20_000 },
    },
    ui: { accent: "linear-gradient(135deg,#a855f7,#ec4899)" },
  },
  {
    id: "c5",
    podcast: {
      id: "p5",
      title: "Startup Minutes",
      authorName: "Minute Media",
      imageUrl: "https://example.com/podcasts/startup-minutes/cover.jpg",
      language: "en",
      categories: ["Business", "Startups"],
    },
    episode: {
      id: "e5",
      title: "When to Prefetch",
      link: "https://example.com/podcasts/startup-minutes/episodes/when-to-prefetch",
      publishedAt: "2025-07-19T12:00:00Z",
      durationSeconds: 1520,
      imageUrl: "https://example.com/podcasts/startup-minutes/episodes/e5.jpg",
      audio: {
        url: "https://example.com/audio/startup-minutes/e5.mp3",
        mimeType: "audio/mpeg",
        byteLength: 24321098,
      },
    },
    highlight: {
      id: "h5",
      title: "Prefetch is a UX promise",
      text: "If you start it, you must be able to finish it.",
      snippet: { startMs: 97_000, durationMs: 14_000 },
    },
    ui: { accent: "linear-gradient(135deg,#eab308,#f59e0b)" },
  },
];

let globalInstanceSeq = 0;

function mod(n: number, m: number) {
  const r = n % m;
  return r < 0 ? r + m : r;
}

function sleepMs(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function fetchDeckPage(params: DeckPageParams): Promise<DeckPage> {
  const limit = Math.max(1, Math.min(50, Math.floor(params.limit)));
  const baseLen = BASE_CARDS.length;
  const start = mod(Math.floor(params.cursor), baseLen);

  await sleepMs(160);

  const cards: Card[] = [];
  for (let i = 0; i < limit; i += 1) {
    const base = BASE_CARDS[(start + i) % baseLen];
    const instanceId = `${base.id}-${globalInstanceSeq++}`;
    cards.push({ ...base, instanceId });
  }

  const nextCursor = mod(start + limit, baseLen);
  return { cards, nextCursor };
}
