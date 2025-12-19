import type { CardDetail } from "@/shared/api/details";
import type { EpisodeInfo, PodcastInfo } from "@/features/deck/model/types";
import type { PromptContext, PromptEpisodeInfo, PromptHighlightInfo, PromptPodcastInfo } from "@/features/llm/prompts/types";

function toPromptPodcastInfo(p: PodcastInfo): PromptPodcastInfo {
  return {
    id: p.id,
    title: p.title,
    authorName: p.authorName,
    language: p.language,
    categories: Array.isArray(p.categories) ? p.categories : undefined,
    imageUrl: p.imageUrl,
  };
}

function toPromptEpisodeInfo(e: EpisodeInfo): PromptEpisodeInfo {
  return {
    id: e.id,
    title: e.title,
    publishedAt: e.publishedAt,
    durationSeconds: e.durationSeconds,
    link: e.link,
    imageUrl: e.imageUrl,
    audioUrl: e.audio?.url,
    audioMimeType: e.audio?.mimeType,
  };
}

function toPromptHighlightInfo(h: CardDetail["highlight"]): PromptHighlightInfo {
  return {
    id: h?.id,
    title: h?.title,
    text: h?.text,
    snippet: h?.snippet ? { startMs: h.snippet.startMs, durationMs: h.snippet.durationMs } : undefined,
  };
}

function byPublishedAtDesc(a: EpisodeInfo, b: EpisodeInfo) {
  const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
  const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
  return tb - ta;
}

function pickRecentEpisodes(all: EpisodeInfo[] | undefined, count: number): PromptEpisodeInfo[] {
  if (!Array.isArray(all) || all.length === 0) return [];
  const sorted = [...all].sort(byPublishedAtDesc);
  return sorted.slice(0, Math.max(0, count)).map(toPromptEpisodeInfo);
}

export function buildPromptContextForPodcastChat(card: CardDetail): PromptContext {
  return {
    kind: "podcast",
    podcast: toPromptPodcastInfo(card.podcast),
    currentEpisode: toPromptEpisodeInfo(card.episode),
    recentEpisodes: pickRecentEpisodes(card.episodes, 2),
    highlight: toPromptHighlightInfo(card.highlight),
  };
}

export function buildPromptContextForEpisodeChat(card: CardDetail, episodeId: string): PromptContext {
  const id = String(episodeId ?? "").trim();
  const fromList = Array.isArray(card.episodes) ? card.episodes.find((e) => e.id === id) : undefined;
  const episode = fromList ?? card.episode;

  return {
    kind: "episode",
    podcast: toPromptPodcastInfo(card.podcast),
    episode: toPromptEpisodeInfo(episode),
    highlight: toPromptHighlightInfo(card.highlight),
  };
}

