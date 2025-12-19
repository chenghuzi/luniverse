import { useMemo } from "react";
import type { DeckMotionConfig } from "@/features/deck/motion/constants";
import { DEFAULT_DECK_MOTION_CONFIG } from "@/features/deck/motion/constants";
import { getStackTransform } from "@/features/deck/motion/transforms";
import type { Card as CardType, SwipeDecision } from "@/features/deck/model/types";
import { useSwipeController } from "@/features/deck/hooks/useSwipeController";
import { Card } from "@/features/deck/components/Card";

type CardStackProps = {
  cards: CardType[];
  onDecision: (decision: SwipeDecision) => void;
  config?: Partial<DeckMotionConfig>;
};

export function CardStack(props: CardStackProps) {
  const config = useMemo(
    () => ({ ...DEFAULT_DECK_MOTION_CONFIG, ...(props.config ?? {}) }),
    [props.config],
  );

  const top = props.cards[0];
  const hasTop = Boolean(top);
  const controller = useSwipeController({
    card: top ?? { id: "empty", title: "No cards", accent: "#111827" },
    onDecision: props.onDecision,
    config,
  });

  const stack = useMemo(() => props.cards.slice(0, config.stackSize), [props.cards, config.stackSize]);

  return (
    <div className="deckRoot">
      <div className="deckStage">
        {stack.length === 0 ? (
          <div className="emptyState">No cards</div>
        ) : (
          stack
            .map((card, i) => {
            const indexInStack = i;
            const { translateY, scale } = getStackTransform(indexInStack, config);
            const isTop = i === 0;

            return (
              <Card
                key={card.id}
                card={card}
                className={isTop ? "card cardTopLayer" : "card"}
                style={{
                  x: isTop ? controller.motion.x : undefined,
                  y: isTop ? controller.motion.y : undefined,
                  rotate: isTop ? controller.motion.rotate : undefined,
                  translateY,
                  scale,
                }}
                pointerBind={isTop && hasTop ? controller.bind : undefined}
              />
            );
            })
            .reverse()
        )}
      </div>

      <div className="deckControls">
        <button
          className="controlButton controlNope"
          type="button"
          disabled={!hasTop}
          onClick={() => controller.forceDecision("nope")}
        >
          Nope
        </button>
        <button
          className="controlButton controlLike"
          type="button"
          disabled={!hasTop}
          onClick={() => controller.forceDecision("like")}
        >
          Like
        </button>
      </div>
    </div>
  );
}
