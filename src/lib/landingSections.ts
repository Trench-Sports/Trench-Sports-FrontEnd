// src/lib/landingSections.ts
//
// The landing page's section list, shared by the TopBar (which renders them as
// links while you're on "/") and by landingNav.tsx (the small-screen pill and
// drawer). It lives here rather than in either component so neither has to
// import from the other — same reasoning as sessionModes.ts.

export type NavSection = {
  id: string;
  label: string;
};

export const LANDING_NAV_SECTIONS: NavSection[] = [
  { id: "hero",          label: "Home"         },
  { id: "how-it-works",  label: "How It Works" },
  { id: "platform",      label: "Platform"     },
  { id: "proof",         label: "Results"      },
  { id: "use-cases",     label: "Use Cases"    },
  { id: "testimonials",  label: "Athletes Say" },
];

/**
 * Jump to a section. The sections carry a scroll-margin-top that clears the
 * sticky header, so "start" lands below the bar rather than behind it.
 */
export function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
