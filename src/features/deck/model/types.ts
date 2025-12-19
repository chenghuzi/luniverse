export type CardId = string;

export type Card = {
  id: CardId;
  title: string;
  subtitle?: string;
  accent: string;
};

export type SwipeType = "like" | "nope";

export type SwipeDecision = {
  cardId: CardId;
  type: SwipeType;
  velocityX: number;
  velocityY: number;
};

