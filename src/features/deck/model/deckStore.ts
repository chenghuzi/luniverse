import { create } from "zustand";
import type { Card, SwipeDecision } from "@/features/deck/model/types";

type DeckActions = {
  replaceCards: (cards: Card[], nextCursor: number) => void;
  appendCards: (cards: Card[], nextCursor: number) => void;
  setIsFetchingNext: (value: boolean) => void;
  commitDecision: (decision: SwipeDecision) => void;
  reset: () => void;
};

type DeckState = {
  cards: Card[];
  currentIndex: number;
  nextCursor: number;
  isFetchingNext: boolean;
  decisions: SwipeDecision[];
  actions: DeckActions;
};

export const useDeckStore = create<DeckState>((set) => ({
  cards: [],
  currentIndex: 0,
  nextCursor: 0,
  isFetchingNext: false,
  decisions: [],
  actions: {
    replaceCards: (cards, nextCursor) =>
      set({
        cards,
        currentIndex: 0,
        nextCursor,
        isFetchingNext: false,
        decisions: [],
      }),
    appendCards: (cards, nextCursor) =>
      set((state) => ({
        cards: [...state.cards, ...cards],
        nextCursor,
      })),
    setIsFetchingNext: (value) => set({ isFetchingNext: value }),
    commitDecision: (decision) =>
      set((state) => {
        return {
          decisions: [...state.decisions, decision],
          currentIndex: Math.min(state.currentIndex + 1, state.cards.length),
        };
      }),
    reset: () =>
      set((state) => ({
        currentIndex: 0,
        decisions: [],
        cards: state.cards,
        nextCursor: state.nextCursor,
        isFetchingNext: false,
      })),
  },
}));
