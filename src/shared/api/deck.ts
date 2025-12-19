import type { Card } from "@/features/deck/model/types";
import baseCards from "@/shared/api/mocks/deckCards.json";

export type DeckPage = {
  cards: Card[];
  nextCursor: number;
};

type DeckPageParams = {
  cursor: number;
  limit: number;
};

const BASE_CARDS: Array<Omit<Card, "instanceId">> = baseCards;

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
