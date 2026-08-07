// src/hooks/useVisible.ts
// Shared visibility hook. Reports whether the observed element is currently on
// screen so infinite CSS/JS animations can pause while their card is scrolled
// out of view — keeps idle mockups from burning paint cycles.
//
// Extracted from platformVisuals.tsx so the landing visuals and the use-case
// device mockups share one implementation instead of duplicating it.
import { useEffect, useRef, useState } from "react";

export function useVisible(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}
