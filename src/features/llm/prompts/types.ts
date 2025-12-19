export type PromptPodcastInfo = {
  id: string;
  title: string;
  authorName?: string;
  language?: string;
  categories?: string[];
  imageUrl?: string;
};

export type PromptEpisodeInfo = {
  id: string;
  title: string;
  publishedAt?: string;
  durationSeconds?: number;
  link?: string;
  imageUrl?: string;
  audioUrl?: string;
  audioMimeType?: string;
};

export type PromptHighlightInfo = {
  id?: string;
  title?: string;
  text?: string;
  snippet?: { startMs: number; durationMs: number };
};

export type PromptContext =
  | {
      kind: "podcast";
      podcast: PromptPodcastInfo;
      recentEpisodes?: PromptEpisodeInfo[];
      highlight?: PromptHighlightInfo;
      currentEpisode?: PromptEpisodeInfo;
    }
  | {
      kind: "episode";
      podcast: PromptPodcastInfo;
      episode: PromptEpisodeInfo;
      highlight?: PromptHighlightInfo;
    };

export type PromptInjector = (ctx: PromptContext) => string | null;

