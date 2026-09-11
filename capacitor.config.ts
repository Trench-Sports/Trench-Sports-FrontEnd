import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Environment-aware Capacitor config.
 *
 * The `server.url` is baked into the native iOS project at `cap sync` / `cap copy`
 * time. Switch environments by re-running sync with the CAP_ENV flag:
 *
 *   npm run cap:dev      → native shell loads the LOCAL Vite dev server (live reload)
 *   npm run cap:preview  → native shell loads the Vercel preview deployment
 *   npm run cap:prod     → native shell loads the production domain (archive with this)
 *
 * In dev the iOS Simulator shares the Mac's network, so `localhost:5173` resolves
 * directly. Override the dev URL with CAP_SERVER_URL when testing on a physical
 * device (use the Mac's LAN IP, e.g. http://192.168.1.20:5173).
 */
const capEnv = process.env.CAP_ENV ?? 'production';
const isDev = capEnv === 'development';

const DEV_SERVER_URL = 'http://localhost:5173';

// Vercel deployment URL. Same project/build as production — useful for smoke
// testing a deploy on-device before the apex domain is repointed.
const PREVIEW_SERVER_URL = 'https://trench-sports-front-end-puce.vercel.app';

// Production domain. This is what ships in the archive.
const PROD_SERVER_URL = 'https://www.trenchsports.ai';

const defaultServerUrl = isDev
  ? DEV_SERVER_URL
  : capEnv === 'preview'
    ? PREVIEW_SERVER_URL
    : PROD_SERVER_URL;

const serverUrl = process.env.CAP_SERVER_URL || defaultServerUrl;

const config: CapacitorConfig = {
  appId: 'com.trenchsports.demo',
  appName: 'Trench Demo',
  webDir: 'dist',
  server: {
    url: serverUrl,
    // cleartext allows plain http:// to the local dev server. Never in prod.
    cleartext: isDev,
    // Keep every origin the app legitimately serves itself from inside the
    // WKWebView. Without this an apex→www redirect (or a hop to the Vercel
    // URL) kicks the user out to Safari, which loses the native BLE bridge.
    allowNavigation: [
      'www.trenchsports.ai',
      'trenchsports.ai',
      'trench-sports-front-end-puce.vercel.app',
    ],
  },
};

export default config;
