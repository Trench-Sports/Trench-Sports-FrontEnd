// src/hooks/useSeo.ts
// Client-side SEO for the marketing SPA. Sets document.title and upserts the
// meta/OG/Twitter/canonical tags on mount. Restores nothing on unmount — the
// next page that mounts overwrites them, and the base index.html tags cover
// any route that doesn't call this.
//
// This runs at runtime, so on its own only JS-rendering crawlers (Google) would
// see the per-page tags. scripts/prerender.mjs fixes that for the public
// marketing routes: after `vite build` it renders each one in headless Chromium
// and writes the tags this hook set, plus the page text, into
// dist/<route>.html for crawlers and unfurlers that don't run JS (GPTBot,
// ClaudeBot, LinkedIn, Slack). A route not in its ROUTES list still only gets
// index.html's generic tags in static HTML.
import { useEffect } from "react";

export type SeoInput = {
  title: string;
  description: string;
  /** Absolute URL, or a path like "/college" resolved against SITE_ORIGIN. */
  canonical?: string;
  ogImage?: string;
  /** Keep the page out of search results (auth, utility pages). */
  noindex?: boolean;
};

const SITE_NAME = "Trench Sports";
// The apex domain 308-redirects here, so www is the one canonical host.
export const SITE_ORIGIN = "https://www.trenchsports.ai";
const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/trench-sports-og.png`;

function absolute(url: string) {
  return url.startsWith("http") ? url : `${SITE_ORIGIN}${url}`;
}

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

export function useSeo({ title, description, canonical, ogImage, noindex }: SeoInput) {
  useEffect(() => {
    const url = canonical ? absolute(canonical) : undefined;
    const image = ogImage ? absolute(ogImage) : DEFAULT_OG_IMAGE;

    document.title = title;

    upsertMeta("name", "description", description);
    upsertMeta("name", "robots", noindex ? "noindex, nofollow" : "index, follow");

    // Open Graph
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:type", "website");
    upsertMeta("property", "og:site_name", SITE_NAME);
    upsertMeta("property", "og:image", image);
    if (url) upsertMeta("property", "og:url", url);

    // Twitter
    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", description);
    upsertMeta("name", "twitter:image", image);

    if (url) upsertCanonical(url);
  }, [title, description, canonical, ogImage, noindex]);
}
