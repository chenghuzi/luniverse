import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { fetchDeckPage } from "@/shared/api/deck";
import { CardStack } from "@/features/deck/components/CardStack";
import { useDeckStore } from "@/features/deck/model/deckStore";
import type { SwipeDecision } from "@/features/deck/model/types";

const PAGE_SIZE = 8;
const PREFETCH_THRESHOLD = PAGE_SIZE * 2;

export function DeckPage() {
  const navigate = useNavigate();
  const cards = useDeckStore((s) => s.cards);
  const currentIndex = useDeckStore((s) => s.currentIndex);
  const nextCursor = useDeckStore((s) => s.nextCursor);
  const isFetchingNext = useDeckStore((s) => s.isFetchingNext);
  const replaceCards = useDeckStore((s) => s.actions.replaceCards);
  const appendCards = useDeckStore((s) => s.actions.appendCards);
  const setIsFetchingNext = useDeckStore((s) => s.actions.setIsFetchingNext);
  const commitDecision = useDeckStore((s) => s.actions.commitDecision);

  useEffect(() => {
    let cancelled = false;
    setIsFetchingNext(true);
    fetchDeckPage({ cursor: 0, limit: PAGE_SIZE })
      .then((page) => {
        if (cancelled) return;
        replaceCards(page.cards, page.nextCursor);
      })
      .catch(() => {
        if (cancelled) return;
        replaceCards([], 0);
      })
      .finally(() => {
        setIsFetchingNext(false);
      });
    return () => {
      cancelled = true;
    };
  }, [replaceCards, setIsFetchingNext]);

  useEffect(() => {
    if (isFetchingNext) return;
    const remaining = cards.length - currentIndex;
    if (remaining > PREFETCH_THRESHOLD) return;

    let cancelled = false;
    setIsFetchingNext(true);
    fetchDeckPage({ cursor: nextCursor, limit: PAGE_SIZE })
      .then((page) => {
        if (cancelled) return;
        appendCards(page.cards, page.nextCursor);
      })
      .catch(() => {
        if (cancelled) return;
      })
      .finally(() => {
        setIsFetchingNext(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appendCards, cards.length, currentIndex, isFetchingNext, nextCursor, setIsFetchingNext]);

  const remainingCards = useMemo(() => cards.slice(currentIndex), [cards, currentIndex]);
  const isLoading = isFetchingNext || cards.length === 0;

  function handleDecision(decision: SwipeDecision) {
    commitDecision(decision);
    if (decision.type === "like") {
      navigate(`/detail/${decision.cardInstanceId}`);
    }
  }

  return (
    <div className="page">
      <header className="header">
        <div className="title">Deck</div>
        <div className="subtitle">
          Swipe left/right or use buttons. Pointer Events are used for input.
        </div>
      </header>

      <main className="content">
        <CardStack cards={remainingCards} isLoading={isLoading} onDecision={handleDecision} />
      </main>
    </div>
  );
}
