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
    title: "Card One",
    subtitle: "Swipe to decide",
    accent: "linear-gradient(135deg,#0ea5e9,#6366f1)",
  },
  {
    id: "c2",
    title: "Card Two",
    subtitle: "Pointer Events input",
    accent: "linear-gradient(135deg,#22c55e,#14b8a6)",
  },
  {
    id: "c3",
    title: "Card Three",
    subtitle: "MotionValue-driven",
    accent: "linear-gradient(135deg,#f97316,#ef4444)",
  },
  {
    id: "c4",
    title: "Card Four",
    subtitle: "Stacked rendering",
    accent: "linear-gradient(135deg,#a855f7,#ec4899)",
  },
  {
    id: "c5",
    title: "Card Five",
    subtitle: "Circular paging mock",
    accent: "linear-gradient(135deg,#eab308,#f59e0b)",
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
