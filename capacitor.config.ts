import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Environment-aware Capacitor config.
 *
 * ┌─ THE IMPORTANT PART ────────────────────────────────────────────────────┐
 * │ PRODUCTION BUILDS BUNDLE `dist/` INTO THE BINARY. They set no            │
 * │ `server.url` at all, so the app runs from `capacitor://localhost` and    │
 * │ serves the web assets that `cap sync` copied into the native project.    │
 * │                                                                          │
 * │ dev and preview still point at a remote URL, because live reload and     │
 * │ on-device smoke testing are the entire reason those modes exist.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * WHY PRODUCTION CHANGED
 * It used to load https://www.trenchsports.ai directly — the shipped binary was
 * a WKWebView browsing the live website. Two problems with that, and the second
 * is the one that matters:
 *
 *   1. App Review Guideline 4.2. An app that is a repackaged website gets
 *      rejected. Our defence is the native BLE bridge, which is real — but it
 *      is a defence we have to make, rather than a question that never arises.
 *
 *   2. Guideline 2.5.2, and this is the serious one. When the UI is fetched at
 *      runtime, every Vercel deploy changes the reviewed app without review.
 *      Apple treats that as shipping unreviewed code. It is not caught at
 *      submission — it is caught later, and the remedy is removal rather than
 *      rejection.
 *
 * WHAT BUNDLING COSTS YOU — know these before switching a build back
 *
 *   • Firmware ships inside the IPA. `public/firmware/**` is now part of the
 *     binary, so bumping an adapter's firmware means an App Store release, not
 *     a web deploy. (It also means OTA updates work with no network, which is
 *     a real gain on a practice field.)
 *   • The origin change resets per-origin storage: localStorage and IndexedDB
 *     are scoped to the origin, and `capacitor://localhost` is a different
 *     origin from `https://www.trenchsports.ai`. Sessions, paired-device lists,
 *     theme, settings and ANY UNSYNCED SESSIONS IN THE OUTBOX do not carry
 *     over. This is a one-time cost and 1.0 is the cheapest possible moment to
 *     pay it, because the App Store install base is zero — but any TestFlight
 *     tester holding unsynced sessions should upload them first.
 *   • Anything the user shares or receives by email must use an absolute public
 *     URL. See src/lib/publicOrigin.ts.
 *
 * Switching environments:
 *
 *   npm run cap:dev      → loads the LOCAL Vite dev server (live reload)
 *   npm run cap:preview  → loads the Vercel preview deployment
 *   npm run cap:prod     → BUNDLES dist/. This is what you archive.
 */
const capEnv = process.env.CAP_ENV ?? 'production';
const isDev = capEnv === 'development';
const isPreview = capEnv === 'preview';
/** The only mode that ships. Everything else is a development convenience. */
const isBundled = !isDev && !isPreview;

const DEV_SERVER_URL = 'http://localhost:5173';

// Vercel deployment URL. Same project/build as production — useful for smoke
// testing a deploy on-device before the apex domain is repointed.
const PREVIEW_SERVER_URL = 'https://trench-sports-front-end-puce.vercel.app';

const serverUrl =
  process.env.CAP_SERVER_URL || (isDev ? DEV_SERVER_URL : PREVIEW_SERVER_URL);

const config: CapacitorConfig = {
  // NOTE: appId stays com.trenchsports.demo — the App Store Connect record is
  // already bound to it. A bundle ID cannot be changed after first upload, so
  // renaming it later means a brand-new app record and losing reviews/installs.
  appId: 'com.trenchsports.demo',
  // Cosmetic on iOS: the home-screen label comes from CFBundleDisplayName in
  // ios/App/App/Info.plist, not from here. Kept in sync so the two never
  // disagree in a way that confuses the next person reading this file.
  appName: 'Trench Sports',
  webDir: 'dist',

  // No `server` key at all in a bundled build. Capacitor then serves `webDir`
  // from the local scheme, which is exactly what we want.
  //
  // `allowNavigation` in particular MUST NOT survive into a bundled build. Its
  // job was to keep an apex→www redirect inside the WKWebView while the app was
  // the website. Bundled, it does the opposite of what you want: it makes any
  // in-app link to trenchsports.ai navigate the webview OFF the bundle and onto
  // the live site — permanently, and taking the native BLE bridge with it.
  // src/pages/terms.tsx links to https://trenchsports.ai, so this is a real
  // path a user can walk down, not a hypothetical.
  ...(isBundled
    ? {}
    : {
        server: {
          url: serverUrl,
          // cleartext allows plain http:// to the local dev server. Dev only.
          cleartext: isDev,
          allowNavigation: [
            'www.trenchsports.ai',
            'trenchsports.ai',
            'trench-sports-front-end-puce.vercel.app',
          ],
        },
      }),
};

export default config;
