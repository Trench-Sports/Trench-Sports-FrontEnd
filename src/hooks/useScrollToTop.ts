// src/hooks/useScrollToTop.ts
// ─────────────────────────────────────────────────────────────────────────────
// Resets the window scroll on route change.
//
// A client-side router swaps the page content without touching the scroll
// position, so following a link from halfway down the landing page (e.g. the
// "Learn more" link on a use-case card) drops you into the middle of the next
// page. This puts every pushed route back at the top.
//
// Usage — call once in the layout that wraps the routes:
//   useScrollToTop();
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

export function useScrollToTop() {
  const { pathname, hash } = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    // Back/forward is the one case where the old position is the right answer,
    // so leave the browser's own restoration alone.
    if (navType === "POP") return;

    // An explicit #target in the URL outranks the top of the page. Nothing
    // links this way today (in-page jumps are done with scrollIntoView against
    // an element id), but honouring it keeps a future `to="/x#section"` working.
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView();
        return;
      }
    }

    // "instant" rather than the default so this can't turn into a visible
    // animated scroll if `scroll-behavior: smooth` is ever set globally.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname, hash, navType]);
}
