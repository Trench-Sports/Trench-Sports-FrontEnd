// src/hooks/useActiveSection.ts
//
// Scroll-spy: returns the id of whichever section is currently nearest the top
// of the viewport. Both the TopBar's section links and the small-screen nav
// pill use this, so the two always agree on what's highlighted.

import { useEffect, useState } from "react";

// Sections sit under the sticky header, so "at the top" really means "at the
// top of the space below the bar". Keep in step with --topbar-h in styles.css.
const TOPBAR_OFFSET = 120;

export function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");

  // The caller almost always builds `ids` inline, so a fresh array arrives on
  // every render. Depend on the contents instead of the identity.
  const key = ids.join("|");

  useEffect(() => {
    const list = key ? key.split("|") : [];
    if (!list.length) return;

    const onScroll = () => {
      let current = list[0];
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= TOPBAR_OFFSET) current = id;
      }
      setActive(current);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll(); // seed on mount, before any scrolling happens
    return () => window.removeEventListener("scroll", onScroll);
  }, [key]);

  return active;
}
