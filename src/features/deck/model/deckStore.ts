import { create } from "zustand";
import type { Card, SwipeDecision } from "@/features/deck/model/types";
import { fetchDeckPage } from "@/shared/api/deck";

type DeckActions = {
  replaceCards: (cards: Card[], nextCursor: number) => void;
  appendCards: (cards: Card[], nextCursor: number) => void;
  setIsFetchingNext: (value: boolean) => void;
  loadInitial: (pageSize: number) => Promise<void>;
  prefetchIfNeeded: (pageSize: number, threshold: number) => Promise<void>;
  commitDecision: (decision: SwipeDecision) => void;
  reset: () => void;
};

type DeckState = {
  cards: Card[];
  currentIndex: number;
  nextCursor: number;
  isFetchingNext: boolean;
  hasLoadedInitial: boolean;
  decisions: SwipeDecision[];
  actions: DeckActions;
};

export const useDeckStore = create<DeckState>((set, get) => ({
  cards: [],
  currentIndex: 0,
  nextCursor: 0,
  isFetchingNext: false,
  hasLoadedInitial: false,
  decisions: [],
  actions: {
    replaceCards: (cards, nextCursor) =>
      set({
        cards,
        currentIndex: 0,
        nextCursor,
        isFetchingNext: false,
        hasLoadedInitial: true,
        decisions: [],
      }),
    appendCards: (cards, nextCursor) =>
      set((state) => ({
        cards: [...state.cards, ...cards],
        nextCursor,
      })),
    setIsFetchingNext: (value) => set({ isFetchingNext: value }),
    loadInitial: async (pageSize) => {
      const size = Math.max(1, Math.min(50, Math.floor(pageSize)));
      const state = get();
      if (state.isFetchingNext) return;
      if (state.hasLoadedInitial && state.cards.length > 0) return;

      set({ isFetchingNext: true });
      try {
        const page = await fetchDeckPage({ cursor: 0, limit: size });
        set({
          cards: page.cards,
          currentIndex: 0,
          nextCursor: page.nextCursor,
          hasLoadedInitial: true,
          decisions: [],
        });
      } catch {
        set({
          cards: [],
          currentIndex: 0,
          nextCursor: 0,
          hasLoadedInitial: false,
          decisions: [],
        });
      } finally {
        set({ isFetchingNext: false });
      }
    },
    prefetchIfNeeded: async (pageSize, threshold) => {
      const size = Math.max(1, Math.min(50, Math.floor(pageSize)));
      const minRemaining = Math.max(0, Math.floor(threshold));

      const state = get();
      if (state.isFetchingNext) return;
      if (!state.hasLoadedInitial) return;

      const remaining = state.cards.length - state.currentIndex;
      if (remaining > minRemaining) return;

      set({ isFetchingNext: true });
      try {
        const page = await fetchDeckPage({ cursor: state.nextCursor, limit: size });
        set((s) => ({
          cards: [...s.cards, ...page.cards],
          nextCursor: page.nextCursor,
        }));
      } finally {
        set({ isFetchingNext: false });
      }
    },
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
