import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { fetchCardDetailById, type CardDetail } from "@/shared/api/details";
import { VoiceChatOverlay, type VoiceChatContext } from "@/features/chat/components/VoiceChatOverlay";
import { pauseGlobalAudio } from "@/shared/audio/globalAudio";
import { fetchMinimaxTtsConfig, type MinimaxTtsConfig } from "@/features/tts/minimax/config";
import { getCoverPageBackground } from "@/shared/lib/imageGradient";

function formatDuration(totalSeconds?: number) {
  if (typeof totalSeconds !== "number" || !Number.isFinite(totalSeconds)) return "-";
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) return `${hh}:${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

function formatDate(iso?: string) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function formatSnippet(snippet?: { startMs: number; durationMs: number }) {
  if (!snippet) return "-";
  const startSeconds = Math.max(0, Math.floor(snippet.startMs / 1000));
  const durationSeconds = Math.max(0, Math.floor(snippet.durationMs / 1000));
  return `${formatDuration(startSeconds)} + ${formatDuration(durationSeconds)}`;
}

export function DetailPage() {
  const { cardId } = useParams<{ cardId: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<
    | { status: "idle" | "loading"; card: null; error: null }
    | { status: "ready"; card: CardDetail; error: null }
    | { status: "error"; card: null; error: string }
  >({ status: "idle", card: null, error: null });
  const [chat, setChat] = useState<{ open: boolean; context: VoiceChatContext | null }>({
    open: false,
    context: null,
  });
  const [ttsConfig, setTtsConfig] = useState<MinimaxTtsConfig | null>(null);

  useEffect(() => {
    pauseGlobalAudio();
  }, []);

  useEffect(() => {
    const id = String(cardId ?? "").trim();
    if (id.length === 0) {
      setState({ status: "error", card: null, error: "Missing cardId" });
      return;
    }

    let canceled = false;
    setState({ status: "loading", card: null, error: null });
    void fetchCardDetailById(id)
      .then((card) => {
        if (canceled) return;
        setState({ status: "ready", card, error: null });
      })
      .catch((e: unknown) => {
        if (canceled) return;
        setState({
          status: "error",
          card: null,
          error: e instanceof Error ? e.message : "Failed to load detail",
        });
      });

    return () => {
      canceled = true;
    };
  }, [cardId]);

  const card = state.status === "ready" ? state.card : null;
  const coverUrl = card?.episode.imageUrl ?? card?.podcast.imageUrl ?? null;
  const coverAlt = card?.episode.title
    ? `${card.podcast.title} - ${card.episode.title}`
    : `${card?.podcast.title ?? "Podcast"} cover`;
  const episodes = useMemo(() => (Array.isArray(card?.episodes) ? card!.episodes : []), [card]);
  const podcastSeed = useMemo(() => {
    if (!card?.chat?.podcast?.messages?.length) return null;
    return card.chat.podcast;
  }, [card]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    let canceled = false;

    if (!coverUrl) {
      document.documentElement.style.removeProperty("--pageBg");
      return;
    }

    void getCoverPageBackground(coverUrl).then((bg) => {
      if (canceled) return;
      if (!bg) {
        document.documentElement.style.removeProperty("--pageBg");
        return;
      }
      document.documentElement.style.setProperty("--pageBg", bg);
    });

    return () => {
      canceled = true;
    };
  }, [coverUrl]);

  useEffect(() => {
    return () => {
      if (typeof document === "undefined") return;
      document.documentElement.style.removeProperty("--pageBg");
    };
  }, []);

  useEffect(() => {
    if (!card) {
      setTtsConfig(null);
      return;
    }

    const controller = new AbortController();
    void fetchMinimaxTtsConfig({ cardId: card.id, signal: controller.signal })
      .then((cfg) => setTtsConfig(cfg))
      .catch(() => setTtsConfig(null));

    return () => controller.abort();
  }, [card?.id]);

  useEffect(() => {
    if (!chat.open || !chat.context) return;
    setChat((prev) => {
      if (!prev.open || !prev.context) return prev;
      if (prev.context.ttsConfig === ttsConfig) return prev;
      return { ...prev, context: { ...prev.context, ttsConfig } };
    });
  }, [chat.context, chat.open, ttsConfig]);

  function openPodcastChat() {
    if (!card) return;
    if (!podcastSeed) return;
    setChat({
      open: true,
      context: {
        kind: "podcast",
        cardId: card.id,
        podcastId: card.podcast.id,
        podcastTitle: card.podcast.title,
        coverUrl,
        ttsConfig,
        seedMessages: podcastSeed.messages,
      },
    });
  }

  function openEpisodeChat(episode: { id: string; title: string }) {
    if (!card) return;
    const seed = card.chat?.episodes?.[episode.id];
    if (!seed?.messages?.length) return;
    setChat({
      open: true,
      context: {
        kind: "episode",
        cardId: card.id,
        podcastId: card.podcast.id,
        podcastTitle: card.podcast.title,
        episodeId: episode.id,
        episodeTitle: episode.title,
        coverUrl,
        ttsConfig,
        seedMessages: seed.messages,
      },
    });
  }

  return (
    <div className="page pageNoWindowScroll">
      {!chat.open ? (
        <button
          className="detailBackButton"
          type="button"
          onClick={() => navigate("/")}
          aria-label="Back to deck"
        >
          ‹
        </button>
      ) : null}
      <main className="content">
        <div className="detailCard">
          <div className="detailHeader">
            <div className="detailTitle">{card?.podcast.title ?? "Podcast detail"}</div>
          </div>
          <div className="detailBody">
            {state.status === "loading" ? <div className="detailText">Loading...</div> : null}
            {state.status === "error" ? <div className="detailError">{state.error}</div> : null}

            {card ? (
              <div className="detailLayout">
                <div className="detailTop">
                  {coverUrl ? (
                    <div className="detailCoverFrame">
                      <img className="detailCover" src={coverUrl} alt={coverAlt} loading="lazy" decoding="async" />
                    </div>
                  ) : null}

                  <div className="detailInfo">
                    <div className="detailInfoTitle">{card.podcast.title}</div>
                    <div className="detailInfoMeta">
                      {[
                        card.podcast.authorName ? `by ${card.podcast.authorName}` : null,
                        card.podcast.language ? card.podcast.language : null,
                      ]
                        .filter(Boolean)
                        .join(" • ")}
                    </div>
                    {Array.isArray(card.podcast.categories) && card.podcast.categories.length > 0 ? (
                      <div className="detailChips">
                        {card.podcast.categories.slice(0, 8).map((c) => (
                          <span key={c} className="chip">
                            {c}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <div className="detailInfoActions">
                      <button className="chatButton" type="button" onClick={openPodcastChat} disabled={!podcastSeed}>
                        Chat
                      </button>
                    </div>
                  </div>
                </div>

                <div className="detailSection">
                  <div className="detailSectionTitle">Current</div>
                  <div className="detailKV">
                    <div className="detailK">Episode</div>
                    <div className="detailV">{card.episode.title}</div>
                    <div className="detailK">Published</div>
                    <div className="detailV">{formatDate(card.episode.publishedAt)}</div>
                    <div className="detailK">Duration</div>
                    <div className="detailV">{formatDuration(card.episode.durationSeconds)}</div>
                    <div className="detailK">Snippet</div>
                    <div className="detailV">{formatSnippet(card.highlight.snippet)}</div>
                  </div>

                  {card.highlight.title ? <div className="detailParagraphTitle">{card.highlight.title}</div> : null}
                  {card.highlight.text ? <div className="detailParagraph">{card.highlight.text}</div> : null}
                </div>

                <div className="detailSection">
                  <div className="detailSectionTitle">Episodes</div>
                  {episodes.length === 0 ? (
                    <div className="detailText">No episodes</div>
                  ) : (
                    <ul className="episodeList">
                      {episodes.map((e) => (
                        <li key={e.id} className="episodeRow">
                          <div className="episodeRowMain">
                            <div className="episodeTitle">{e.title}</div>
                            <div className="episodeMeta">
                              {formatDate(e.publishedAt)} • {formatDuration(e.durationSeconds)}
                            </div>
                          </div>
                          <button
                            className="episodeChatButton"
                            type="button"
                            onClick={() => openEpisodeChat(e)}
                            disabled={!card?.chat?.episodes?.[e.id]?.messages?.length}
                          >
                            Chat
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </main>

      <footer className="attributionText pageAttribution">By Enactflow from Hangzhou</footer>

      <VoiceChatOverlay open={chat.open} context={chat.context} onClose={() => setChat({ open: false, context: null })} />
    </div>
  );
}
