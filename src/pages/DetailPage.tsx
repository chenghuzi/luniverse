import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { fetchCardDetailById, type CardDetail } from "@/shared/api/details";
import { VoiceChatOverlay, type VoiceChatContext } from "@/features/chat/components/VoiceChatOverlay";
import { ChatFab } from "@/features/chat/components/ChatFab";
import { pauseGlobalAudio } from "@/shared/audio/globalAudio";
import { fetchMinimaxTtsConfig, type TtsConfig } from "@/features/tts/minimax/config";
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

type ChatState = {
  open: boolean;
  podcastContext: VoiceChatContext | null;
  episodeContext: VoiceChatContext | null;
  defaultKind: "podcast" | "episode";
};

export function DetailPage() {
  const { cardId } = useParams<{ cardId: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<
    | { status: "idle" | "loading"; card: null; error: null }
    | { status: "ready"; card: CardDetail; error: null }
    | { status: "error"; card: null; error: string }
  >({ status: "idle", card: null, error: null });
  const [chat, setChat] = useState<ChatState>({
    open: false,
    podcastContext: null,
    episodeContext: null,
    defaultKind: "podcast",
  });
  const [ttsConfig, setTtsConfig] = useState<TtsConfig | null>(null);

  useEffect(() => {
    pauseGlobalAudio();
  }, []);

  useEffect(() => {
    const id = String(cardId ?? "").trim();
    if (id.length === 0) {
      setState({ status: "error", card: null, error: "缺少卡片 ID" });
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
          error: e instanceof Error ? e.message : "加载详情失败",
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
    : `${card?.podcast.title ?? "节目"}封面`;
  const episodes = useMemo(() => (Array.isArray(card?.episodes) ? card!.episodes : []), [card]);

  const podcastSeed = useMemo(() => {
    if (!card?.chat?.podcast?.messages?.length) return null;
    return card.chat.podcast;
  }, [card]);

  const episodeSeed = useMemo(() => {
    if (!card?.chat?.episodes) return null;
    const currentEpisode = card.episode;
    const seed = card.chat.episodes[currentEpisode.id];
    if (!seed?.messages?.length) return null;
    return seed;
  }, [card]);

  const hasAnyChatContext = !!(podcastSeed || episodeSeed);

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
    if (!chat.open) return;
    setChat((prev) => {
      if (!prev.open) return prev;
      const updatedPodcast = prev.podcastContext
        ? { ...prev.podcastContext, ttsConfig }
        : prev.podcastContext;
      const updatedEpisode = prev.episodeContext
        ? { ...prev.episodeContext, ttsConfig }
        : prev.episodeContext;
      if (
        prev.podcastContext?.ttsConfig === ttsConfig &&
        prev.episodeContext?.ttsConfig === ttsConfig
      ) {
        return prev;
      }
      return { ...prev, podcastContext: updatedPodcast, episodeContext: updatedEpisode };
    });
  }, [chat.open, ttsConfig]);

  function openChat() {
    if (!card) return;

    const podcastContext: VoiceChatContext | null = podcastSeed
      ? {
          kind: "podcast",
          cardId: card.id,
          podcastId: card.podcast.id,
          podcastTitle: card.podcast.title,
          coverUrl,
          ttsConfig,
          seedMessages: podcastSeed.messages,
        }
      : null;

    const episodeContext: VoiceChatContext | null = episodeSeed
      ? {
          kind: "episode",
          cardId: card.id,
          podcastId: card.podcast.id,
          podcastTitle: card.podcast.title,
          episodeId: card.episode.id,
          episodeTitle: card.episode.title,
          coverUrl,
          ttsConfig,
          seedMessages: episodeSeed.messages,
        }
      : null;

    const defaultKind: "podcast" | "episode" = episodeContext ? "episode" : "podcast";

    setChat({
      open: true,
      podcastContext,
      episodeContext,
      defaultKind,
    });
  }

  return (
    <div className="page pageNoWindowScroll">
      <main className="content">
        <div className="detailCard">
          <div className="detailHeader">
            <div className="detailHeaderRow">
              {!chat.open ? (
                <button
                  className="detailBackButton"
                  type="button"
                  onClick={() => navigate("/")}
                  aria-label="返回卡片页"
                >
                  ‹
                </button>
              ) : null}
              <div className="detailTitle">{card?.podcast.title ?? "节目详情"}</div>
            </div>
          </div>
          <div className="detailBody">
            {state.status === "loading" ? <div className="detailText">加载中...</div> : null}
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
                        card.podcast.authorName ? `作者 ${card.podcast.authorName}` : null,
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
                  </div>
                </div>

                <div className="detailSection">
                  <div className="detailSectionTitle">当前内容</div>
                  <div className="detailKV">
                    <div className="detailK">单集</div>
                    <div className="detailV">{card.episode.title}</div>
                    <div className="detailK">发布时间</div>
                    <div className="detailV">{formatDate(card.episode.publishedAt)}</div>
                    <div className="detailK">时长</div>
                    <div className="detailV">{formatDuration(card.episode.durationSeconds)}</div>
                    <div className="detailK">高光片段</div>
                    <div className="detailV">{formatSnippet(card.highlight.snippet)}</div>
                  </div>

                  {card.highlight.title ? <div className="detailParagraphTitle">{card.highlight.title}</div> : null}
                  {card.highlight.text ? <div className="detailParagraph">{card.highlight.text}</div> : null}
                </div>

                <div className="detailSection">
                  <div className="detailSectionTitle">往期单集</div>
                  {episodes.length === 0 ? (
                    <div className="detailText">暂无单集</div>
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

      <footer className="attributionText pageAttribution">杭州 Enactflow 出品</footer>

      <ChatFab onClick={openChat} visible={!chat.open && hasAnyChatContext} />

      <VoiceChatOverlay
        open={chat.open}
        podcastContext={chat.podcastContext}
        episodeContext={chat.episodeContext}
        defaultKind={chat.episodeContext ? "episode" : "podcast"}
        episodes={episodes.map((e) => ({ id: e.id, title: e.title }))}
        chatEpisodes={card?.chat?.episodes}
        onClose={() => setChat({ open: false, podcastContext: null, episodeContext: null, defaultKind: chat.defaultKind })}
      />
    </div>
  );
}
