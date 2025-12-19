import type { Card } from "@/features/deck/model/types";

export type DeckPage = {
  cards: Card[];
  nextCursor: number;
};

type DeckPageParams = {
  cursor: number;
  limit: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export async function fetchDeckPage(params: DeckPageParams): Promise<DeckPage> {
  const limit = Math.max(1, Math.min(50, Math.floor(params.limit)));
  const cursor = Math.floor(params.cursor);

  const res = await fetch(`/api/deck?cursor=${encodeURIComponent(cursor)}&limit=${encodeURIComponent(limit)}`);
  if (!res.ok) throw new Error(`deck request failed: ${res.status} ${res.statusText}`);

  const data: unknown = await res.json();
  if (!isObject(data) || !Array.isArray(data.cards) || typeof data.nextCursor !== "number") {
    throw new Error("deck response shape is invalid");
  }

  return data as DeckPage;
}
