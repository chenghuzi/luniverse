import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { fetchDeck } from "@/shared/api/deck";
import { CardStack } from "@/features/deck/components/CardStack";
import { useDeckStore } from "@/features/deck/model/deckStore";
import type { SwipeDecision } from "@/features/deck/model/types";

export function DeckPage() {
  const navigate = useNavigate();
  const cards = useDeckStore((s) => s.cards);
  const currentIndex = useDeckStore((s) => s.currentIndex);
  const setCards = useDeckStore((s) => s.actions.setCards);
  const commitDecision = useDeckStore((s) => s.actions.commitDecision);

  useEffect(() => {
    let cancelled = false;
    fetchDeck()
      .then((deck) => {
        if (cancelled) return;
        setCards(deck);
      })
      .catch(() => {
        if (cancelled) return;
        setCards([]);
      });
    return () => {
      cancelled = true;
    };
  }, [setCards]);

  const remainingCards = useMemo(() => cards.slice(currentIndex), [cards, currentIndex]);

  function handleDecision(decision: SwipeDecision) {
    commitDecision(decision);
    if (decision.type === "like") {
      navigate(`/detail/${decision.cardId}`);
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
        <CardStack cards={remainingCards} onDecision={handleDecision} />
      </main>
    </div>
  );
}

