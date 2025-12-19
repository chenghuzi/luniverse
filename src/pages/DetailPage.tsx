import { Link, useParams } from "react-router-dom";
import { useDeckStore } from "@/features/deck/model/deckStore";

export function DetailPage() {
  const { cardInstanceId } = useParams<{ cardInstanceId: string }>();
  const card = useDeckStore((s) => s.cards.find((c) => c.instanceId === cardInstanceId));

  return (
    <div className="page">
      <header className="header">
        <div className="title">Detail</div>
        <div className="subtitle">This is a placeholder for the next interaction stage.</div>
      </header>

      <main className="content">
        <div className="detailCard">
          <div className="detailHeader">
            <div className="detailTitle">{card?.highlight.title ?? "Unknown highlight"}</div>
            <div className="detailMeta">instanceId: {cardInstanceId ?? "-"}</div>
          </div>
          <div className="detailBody">
            <div className="detailText">
              Replace this with your next-step UI. Keep motion-heavy interactions isolated from business
              state.
            </div>
          </div>
          <div className="detailFooter">
            <Link className="linkButton" to="/">
              Back to deck
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
