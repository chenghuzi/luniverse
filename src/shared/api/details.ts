import type { Card, EpisodeInfo } from "@/features/deck/model/types";

export type CardDetail = Omit<Card, "instanceId"> & {
  episodes?: EpisodeInfo[];
};

type DetailModule = { default: CardDetail };

const detailModules = import.meta.glob<DetailModule>("./mocks/details/*.json");

function sleepMs(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function fetchCardDetailById(cardId: string): Promise<CardDetail> {
  const id = String(cardId ?? "").trim();
  if (id.length === 0) throw new Error("cardId is required");

  await sleepMs(160);

  const key = `./mocks/details/${id}.json`;
  const loader = detailModules[key];
  if (!loader) throw new Error(`detail not found: ${id}`);

  const mod = await loader();
  return mod.default;
}

