// src/hooks/useSeo.ts
// Client-side SEO for the marketing SPA. Sets document.title and upserts the
// meta/OG/Twitter/canonical tags on mount. Restores nothing on unmount — the
// next page that mounts overwrites them, and the base index.html tags cover
// any route that doesn't call this.
//
// Known limit: this runs at runtime, so Google (which renders JS) indexes the
// per-page tags fine, but link unfurlers that read static HTML (LinkedIn,
// Slack, Twitter) will see index.html's generic tags until a build-time
// prerender step exists. Tracked as a follow-up in the build plan.
import { useEffect } from "react";

export type SeoInput = {
  title: string;
  description: string;
  canonical?: string;
  ogImage?: string;
};

const SITE_NAME = "Trench Sports";

/** Upsert a <meta> tag keyed by name= or property=. */
function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

/** Upsert <link rel="canonical">. */
function upsertCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

export function useSeo({ title, description, canonical, ogImage }: SeoInput) {
  useEffect(() => {
    document.title = title;

    upsertMeta("name", "description", description);

    // Open Graph
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:type", "website");
    upsertMeta("property", "og:site_name", SITE_NAME);
    if (canonical) upsertMeta("property", "og:url", canonical);
    if (ogImage) upsertMeta("property", "og:image", ogImage);

    // Twitter
    upsertMeta("name", "twitter:card", ogImage ? "summary_large_image" : "summary");
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", description);
    if (ogImage) upsertMeta("name", "twitter:image", ogImage);

    if (canonical) upsertCanonical(canonical);
  }, [title, description, canonical, ogImage]);
}
