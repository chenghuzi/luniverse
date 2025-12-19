import type { Card, EpisodeInfo } from "@/features/deck/model/types";

export type CardDetail = Omit<Card, "instanceId"> & {
  episodes?: EpisodeInfo[];
};

export async function fetchCardDetailById(cardId: string): Promise<CardDetail> {
  const id = String(cardId ?? "").trim();
  if (id.length === 0) throw new Error("cardId is required");

  const res = await fetch(`/api/cards/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new Error(`detail not found: ${id}`);
  if (!res.ok) throw new Error(`detail request failed: ${res.status} ${res.statusText}`);

  const data: unknown = await res.json();
  return data as CardDetail;
}
