import { useEffect, useState } from "react";
import { getCoverGradient } from "@/shared/lib/imageGradient";

export function useImageGradient(url: string | null | undefined) {
  const [gradient, setGradient] = useState<string | null>(null);

  useEffect(() => {
    const key = typeof url === "string" ? url.trim() : "";
    if (key.length === 0) {
      setGradient(null);
      return;
    }

    let canceled = false;
    void getCoverGradient(key).then((g) => {
      if (canceled) return;
      setGradient(g);
    });

    return () => {
      canceled = true;
    };
  }, [url]);

  return gradient;
}

