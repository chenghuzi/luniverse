export type CardId = string;

export type PodcastInfo = {
  id: string;
  title: string;
  authorName?: string;
  imageUrl?: string;
  language?: string;
  categories?: string[];
};

export type EpisodeAudio = {
  url: string;
  mimeType?: string;
  byteLength?: number;
};

export type EpisodeInfo = {
  id: string;
  title: string;
  link?: string;
  publishedAt?: string;
  durationSeconds?: number;
  imageUrl?: string;
  audio: EpisodeAudio;
};

export type HighlightSnippet = {
  startMs: number;
  durationMs: number;
};

export type HighlightInfo = {
  id: string;
  title: string;
  text?: string;
  snippet?: HighlightSnippet;
};

export type Card = {
  id: CardId;
  instanceId: string;
  podcast: PodcastInfo;
  episode: EpisodeInfo;
  highlight: HighlightInfo;
  ui: {
    accent: string;
  };
};

export type SwipeType = "like" | "nope";

export type SwipeDecision = {
  cardId: CardId;
  cardInstanceId: string;
  type: SwipeType;
  velocityX: number;
  velocityY: number;
};

export type RecycleBinItem = {
  cardId: CardId;
  cardInstanceId: string;
  podcastTitle: string;
  highlightTitle: string;
  coverUrl: string | null;
  accent: string;
};
