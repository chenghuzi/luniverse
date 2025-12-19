export type CardId = string;

export type Card = {
  id: CardId;
  instanceId: string;
  title: string;
  subtitle?: string;
  accent: string;
};

export type SwipeType = "like" | "nope";

export type SwipeDecision = {
  cardId: CardId;
  cardInstanceId: string;
  type: SwipeType;
  velocityX: number;
  velocityY: number;
};
