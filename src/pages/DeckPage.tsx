import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CardStack } from "@/features/deck/components/CardStack";
import { useDeckStore } from "@/features/deck/model/deckStore";
import type { SwipeDecision } from "@/features/deck/model/types";
import { getCoverPageBackground } from "@/shared/lib/imageGradient";

const PAGE_SIZE = 8;
const PREFETCH_THRESHOLD = PAGE_SIZE * 2;

export function DeckPage() {
  const navigate = useNavigate();
  const cards = useDeckStore((s) => s.cards);
  const currentIndex = useDeckStore((s) => s.currentIndex);
  const isFetchingNext = useDeckStore((s) => s.isFetchingNext);
  const loadInitial = useDeckStore((s) => s.actions.loadInitial);
  const prefetchIfNeeded = useDeckStore((s) => s.actions.prefetchIfNeeded);
  const commitDecision = useDeckStore((s) => s.actions.commitDecision);

  useEffect(() => {
    void loadInitial(PAGE_SIZE);
  }, [loadInitial]);

  const topCard = cards[currentIndex] ?? null;
  const topCoverUrl = topCard ? (topCard.episode.imageUrl ?? topCard.podcast.imageUrl ?? null) : null;

  useEffect(() => {
    if (typeof document === "undefined") return;
    let canceled = false;

    if (!topCoverUrl) {
      document.documentElement.style.removeProperty("--pageBg");
      return;
    }

    void getCoverPageBackground(topCoverUrl).then((bg) => {
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
  }, [topCoverUrl]);

  useEffect(() => {
    return () => {
      if (typeof document === "undefined") return;
      document.documentElement.style.removeProperty("--pageBg");
    };
  }, []);

  useEffect(() => {
    const remaining = cards.length - currentIndex;
    if (remaining > PREFETCH_THRESHOLD) return;
    void prefetchIfNeeded(PAGE_SIZE, PREFETCH_THRESHOLD);
  }, [cards.length, currentIndex, prefetchIfNeeded]);

  const remainingCards = useMemo(() => cards.slice(currentIndex), [cards, currentIndex]);
  const isLoading = isFetchingNext || cards.length === 0;

  function handleDecision(decision: SwipeDecision) {
    commitDecision(decision);
    if (decision.type === "like") {
      navigate(`/detail/${decision.cardId}`);
    }
  }

  return (
    <div className="page pageNoWindowScroll">
      <img className="deckBrandIcon" src="/voiceland.png" alt="Voiceland" />
      <h1 className="deckTitleOverlay">{"\u58F0\u5C9B"}</h1>

      <main className="content">
        <CardStack cards={remainingCards} isLoading={isLoading} onDecision={handleDecision} />
      </main>
    </div>
  );
}
