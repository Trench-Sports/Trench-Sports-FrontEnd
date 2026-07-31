import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Environment-aware Capacitor config.
 *
 * The `server.url` is baked into the native iOS project at `cap sync` / `cap copy`
 * time. Switch environments by re-running sync with the CAP_ENV flag:
 *
 *   npm run cap:dev    → native shell loads the LOCAL Vite dev server (live reload)
 *   npm run cap:prod   → native shell loads the deployed production build
 *
 * In dev the iOS Simulator shares the Mac's network, so `localhost:5173` resolves
 * directly. Override the dev URL with CAP_SERVER_URL when testing on a physical
 * device (use the Mac's LAN IP, e.g. http://192.168.1.20:5173).
 */
const isDev = process.env.CAP_ENV === 'development';

const devServerUrl = process.env.CAP_SERVER_URL || 'http://localhost:5173';
const prodServerUrl =
  process.env.CAP_SERVER_URL || 'https://trench-sports-front-end.vercel.app';

const config: CapacitorConfig = {
  appId: 'com.trenchsports.demo',
  appName: 'Trench Demo',
  webDir: 'dist',
  server: isDev
    ? {
        // Live local dev: load straight from the running Vite server.
        // cleartext allows plain http:// to localhost.
        url: devServerUrl,
        cleartext: true,
      }
    : {
        url: prodServerUrl,
        cleartext: false,
      },
};

export default config;
