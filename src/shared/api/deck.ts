import type { Card } from "@/features/deck/model/types";

export async function fetchDeck(): Promise<Card[]> {
  return [
    { id: "c1", title: "Card One", subtitle: "Swipe to decide", accent: "linear-gradient(135deg,#0ea5e9,#6366f1)" },
    { id: "c2", title: "Card Two", subtitle: "Pointer Events input", accent: "linear-gradient(135deg,#22c55e,#14b8a6)" },
    { id: "c3", title: "Card Three", subtitle: "MotionValue-driven", accent: "linear-gradient(135deg,#f97316,#ef4444)" },
    { id: "c4", title: "Card Four", subtitle: "Stacked rendering", accent: "linear-gradient(135deg,#a855f7,#ec4899)" },
    { id: "c5", title: "Card Five", subtitle: "Extend from here", accent: "linear-gradient(135deg,#eab308,#f59e0b)" },
  ];
}

