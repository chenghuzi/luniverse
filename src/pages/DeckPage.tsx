import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CardStack } from "@/features/deck/components/CardStack";
import { useDeckStore } from "@/features/deck/model/deckStore";
import type { SwipeDecision } from "@/features/deck/model/types";

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
