import type { PromptContext, PromptInjector } from "@/features/llm/prompts/types";

function safeJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export const basePersonaInjector: PromptInjector = (ctx) => {
  const target =
    ctx.kind === "podcast"
      ? `the podcast "${ctx.podcast.title}"`
      : `the episode "${ctx.episode.title}" from the podcast "${ctx.podcast.title}"`;

  return [
    "You are a helpful voice assistant.",
    `You are talking with the user about ${target}.`,
    "Be concise, specific, and actionable.",
    "If the user asks about details that are not in the context, say what is missing and propose what to look up.",
  ].join("\n");
};

export const podcastJsonContextInjector: PromptInjector = (ctx) => {
  const payload =
    ctx.kind === "podcast"
      ? {
          kind: ctx.kind,
          podcast: ctx.podcast,
          currentEpisode: ctx.currentEpisode,
          recentEpisodes: ctx.recentEpisodes ?? [],
          highlight: ctx.highlight,
        }
      : {
          kind: ctx.kind,
          podcast: ctx.podcast,
          episode: ctx.episode,
          highlight: ctx.highlight,
        };

  return ["Context (JSON):", "```json", safeJson(payload), "```"].join("\n");
};

export function defaultPromptInjectors(): PromptInjector[] {
  return [basePersonaInjector, podcastJsonContextInjector];
}

export function composeSystemPrompt(ctx: PromptContext, injectors: PromptInjector[] = defaultPromptInjectors()): string {
  const parts: string[] = [];
  for (const inject of injectors) {
    const out = inject(ctx);
    if (out && out.trim()) parts.push(out.trim());
  }
  return parts.join("\n\n");
}

