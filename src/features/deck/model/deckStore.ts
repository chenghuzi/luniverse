import { create } from "zustand";
import type { Card, CardId, SwipeDecision } from "@/features/deck/model/types";

type DeckActions = {
  setCards: (cards: Card[]) => void;
  commitDecision: (decision: SwipeDecision) => void;
  reset: () => void;
};

type DeckState = {
  cards: Card[];
  currentIndex: number;
  liked: CardId[];
  noped: CardId[];
  actions: DeckActions;
};

export const useDeckStore = create<DeckState>((set) => ({
  cards: [],
  currentIndex: 0,
  liked: [],
  noped: [],
  actions: {
    setCards: (cards) =>
      set({
        cards,
        currentIndex: 0,
        liked: [],
        noped: [],
      }),
    commitDecision: (decision) =>
      set((state) => {
        const liked = decision.type === "like" ? [...state.liked, decision.cardId] : state.liked;
        const noped = decision.type === "nope" ? [...state.noped, decision.cardId] : state.noped;
        return {
          liked,
          noped,
          currentIndex: Math.min(state.currentIndex + 1, state.cards.length),
        };
      }),
    reset: () =>
      set((state) => ({
        currentIndex: 0,
        liked: [],
        noped: [],
        cards: state.cards,
      })),
  },
}));

