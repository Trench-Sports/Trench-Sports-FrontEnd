// src/lib/publicOrigin.ts
//
// The origin of the PUBLIC WEBSITE — always https://www.trenchsports.ai, never
// wherever this code happens to be running.
//
// WHY THIS FILE EXISTS
// Until the iOS app was bundled, `window.location.origin` was the website: the
// native shell loaded https://www.trenchsports.ai directly, so an origin-derived
// URL was accidentally correct everywhere. That stopped being true the moment
// production builds started serving from the app bundle, where the origin is
// `capacitor://localhost`.
//
// Two kinds of URL got silently broken by that change, and both are invisible in
// testing because they only fail once they LEAVE the app:
//
//   1. Anything a user shares. A coach copying an invite link out of the app was
//      handing out `capacitor://localhost/invite/<token>` — a dead link on every
//      device that is not theirs, with no error to tell them.
//   2. Anything an email links back to. Supabase rejects a `redirectTo` that is
//      not on the project's Redirect URL allowlist, and `capacitor://` will never
//      be on it.
//
// So: any URL that will be read outside this WKWebView uses PUBLIC_ORIGIN.
// In-app navigation keeps using router paths and stays origin-relative.
//
// This is a build-time constant rather than an env var on purpose. It is not a
// secret, it does not vary per deploy, and making it configurable would just
// create one more way for a release to ship pointing at a preview domain.

export const PUBLIC_ORIGIN = "https://www.trenchsports.ai";

/** Absolute URL on the public site. `path` may start with or without a slash. */
export function publicUrl(path: string): string {
  return `${PUBLIC_ORIGIN}/${path.replace(/^\/+/, "")}`;
}
