export type DeckMotionConfig = {
  stackSize: number;
  cardSpacingPx: number;
  cardScaleStep: number;
  swipeDistanceThresholdPx: number;
  swipeVelocityThreshold: number;
  maxRotateDeg: number;
};

export const DEFAULT_DECK_MOTION_CONFIG: DeckMotionConfig = {
  stackSize: 4,
  cardSpacingPx: 10,
  cardScaleStep: 0.03,
  swipeDistanceThresholdPx: 120,
  swipeVelocityThreshold: 0.7,
  maxRotateDeg: 18,
};

