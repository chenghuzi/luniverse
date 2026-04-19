import type { Card, EpisodeInfo } from "@/features/deck/model/types";

export type ChatSeedMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatSeedBundle = {
  episodeId?: string;
  messages: ChatSeedMessage[];
};

export type CardChatSeeds = {
  podcast: ChatSeedBundle | null;
  episodes: Record<string, ChatSeedBundle>;
};

export type CardDetail = Omit<Card, "instanceId"> & {
  episodes?: EpisodeInfo[];
  chat?: CardChatSeeds;
};

export async function fetchCardDetailById(cardId: string): Promise<CardDetail> {
  const id = String(cardId ?? "").trim();
  if (id.length === 0) throw new Error("缺少卡片 ID");

  const res = await fetch(`/api/cards/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new Error(`未找到该卡片详情：${id}`);
  if (!res.ok) throw new Error(`详情请求失败（状态码 ${res.status}）`);

  const data: unknown = await res.json();
  return data as CardDetail;
}
