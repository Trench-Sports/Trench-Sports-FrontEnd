# Trench Sports — Frontend

The web and iOS client for the Trench Sports smart heavy-bag platform. It connects to a Trench Sports impact sensor over **Bluetooth Low Energy (BLE)**, streams strike data in real time, computes live force/pressure metrics on-device, and syncs completed training sessions to **Supabase**.

The same React codebase ships three ways:

- **Web** (desktop + mobile browser) — deployed to **Vercel**.
- **iOS app** — the web build wrapped in a **Capacitor** native shell.
- **Legacy server host** — an Express static server (`server.js`) for AWS Elastic Beanstalk. Vercel is now the primary web target.

---

## Tech stack

| Concern | Choice |
|---|---|
| UI | React 18 + TypeScript |
| Build tool | Vite 6 |
| Routing | React Router 7 (`createBrowserRouter`) |
| Backend / auth / DB | Supabase (Postgres + Auth + RLS) |
| Device I/O | Web Bluetooth (browser) / `@capacitor-community/bluetooth-le` (native) |
| Native shell | Capacitor 8 (iOS) |
| Web server | Express + compression (`server.js`) |
| On-device storage | IndexedDB |

Node **24.x** is required (see `engines` in `package.json`).

---

## Quick start

```bash
npm install
npm run dev            # Vite dev server → http://localhost:5173
```

Create a `.env` file in the repo root (see [Environment variables](#environment-variables)). The app renders even if Supabase or BLE vars are missing — those features simply disable themselves and log a warning.

**Scripts** (`package.json`):

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload (port 5173) |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve the built `dist/` locally (port 4173) |
| `npm start` | Run the Express production server (`server.js`, port 8080) |

---

## How it works

### Startup and routing

`src/main.tsx` is the entry point. It initializes the theme, then mounts the React Router tree defined in `src/router.tsx`.

Routing is split into two shells:

- **Web/desktop routes** (`/`, `/login`, `/dashboard`, `/session`, …) render inside `AppLayout`.
- **Mobile routes** (`/m/*`) render inside `MobileLayout` and are used by both the Capacitor iOS shell and phone browsers.

`src/platform.ts` is the single source of truth for "where are we running." It reads Capacitor's platform APIs at startup and sets a `data-platform` attribute on `<html>` (`native-ios`, `native-android`, `mobile-browser`, or `web`) *before* the first render, so there is no flash of the wrong layout. The router uses `platform.isNative` to bounce native users from desktop routes (`/dashboard`) to their `/m/*` equivalents.

`RequireOnboarding` guards authenticated routes: it checks the Supabase session, loads the user's `profiles` row, and redirects to `/login` (no session) or `/onboarding` (incomplete profile). The `/m/home` route is intentionally *unguarded* — it's the MVP no-login "power session" entry point that records anonymously against a per-device id.

### The BLE → metrics → storage pipeline

This is the core of the app. A training session flows through four layers:

1. **Bluetooth (`src/bluetooth/`)** — `adapter.ts` is a façade that dispatches to `adapter_web.ts` (Web Bluetooth) or `adapter_native.ts` (Capacitor BLE) depending on platform. The sensor speaks the Nordic UART Service (NUS): the app writes commands on the RX characteristic and receives newline-delimited NDJSON on the TX (notify) characteristic. `protocol.ts` reassembles notification chunks into complete lines; `commands.ts` sends sanitized commands.

2. **Processing (`src/processing/`)** — incoming NDJSON is parsed by `normalize.ts` into typed messages (`session_start`, `sample`, `ack`, …). `calibration.ts` converts raw sensor voltage into pressure (kPa) and force (N) using a linear or piecewise model plus sensor geometry. `liveMetrics.ts` maintains a live per-cell grid (peak force, hit counts) for real-time UI feedback. `eventBuilder.ts` segments the sample stream into discrete strike "events" with duration, impulse, rise/decay time, and angle.

3. **Storage (`src/storage/`)** — `rawRecorder.ts` writes the raw NDJSON stream to IndexedDB in chunks as it arrives, so nothing is lost if the app closes mid-session. `sessionOutbox.ts` is an offline upload queue: if a completed session can't reach Supabase (no connectivity), the full payload is persisted to IndexedDB and replayed automatically when the device comes back online.

4. **Sync (`src/supabaseClient.ts`)** — completed sessions and their derived events are uploaded to Supabase. The client is exported as nullable so the app still runs without credentials.

### Data model (Supabase)

Defined in `supabase/schema.sql`. Key tables: `programs` (the billing/tenant root), `profiles` (user accounts, linked to `auth.users`), `teams`, `athletes`, `team_members`, `sessions` (one training session, with `raw` NDJSON plus grid/calibration metadata), `events` and `event_cells` (derived per-strike data), `session_summaries`, and `devices`. Access is enforced with Row-Level Security — policies live in `supabase/rls_policies.sql` and the other SQL files in that folder.

---

## Repository layout

```
.
├── src/                      # Application source (only this is bundled — see tsconfig "include")
│   ├── main.tsx              # Entry point: theme init + RouterProvider
│   ├── router.tsx            # React Router route tree (web + /m mobile shells)
│   ├── platform.ts           # Runtime platform detection (native/web/mobile)
│   ├── supabaseClient.ts     # Nullable Supabase client
│   ├── app.tsx               # Root app component
│   ├── bluetooth/            # BLE adapters (web + native), NUS protocol, commands
│   ├── processing/           # NDJSON normalize → calibration → live metrics → events
│   ├── storage/              # IndexedDB raw recorder + offline upload outbox
│   ├── pages/                # Route pages; pages/mobile/* are the /m variants
│   ├── components/           # Shared UI (layouts, grids, modals, session controls)
│   ├── hooks/                # usePlatform, signalAudio
│   ├── lib/                  # sessionModes, sessionSettings, themeManager, isMobile
│   ├── images/               # Logos + native app icons
│   └── styles.css            # Global styles
├── tools/                    # SERVER-SIDE ONLY scripts (service-role key — never bundled)
├── supabase/                 # SQL schema + RLS policies + migrations
├── firmware-src/             # ESP32 device firmware (model_IV, C)
├── public/                   # Static assets served as-is (incl. OTA firmware bundles)
├── ios/                      # Capacitor iOS project (Xcode)
├── server.js                 # Express static host for the built dist/ (EB)
├── capacitor.config.ts       # Capacitor config (prod BUNDLES dist/; dev/preview load a remote URL)
├── vite.config.ts            # Vite config
├── vercel.json               # Vercel SPA rewrites + Bluetooth Permissions-Policy header
└── .ebextensions/            # Elastic Beanstalk build config (legacy)
```

> ⚠️ **`tools/` is server-side only.** `tools/processSession.ts` uses the Supabase **service-role key**, which bypasses all RLS. Never import from `tools/` into `src/`, and never put the service-role key behind a `VITE_` name. See `tools/README.md`.

---

## Environment variables

All browser-exposed vars must be prefixed with `VITE_`. Add them to `.env` in the repo root (gitignored).

```bash
# Bluetooth (optional — falls back to built-in Nordic UART Service UUIDs)
VITE_BLE_SERVICE_UUID=YOUR_SERVICE_UUID
VITE_BLE_CHAR_UUID_RX=YOUR_WRITE_CHARACTERISTIC_UUID     # app → device
VITE_BLE_CHAR_UUID_TX=YOUR_NOTIFY_CHARACTERISTIC_UUID    # device → app
VITE_BLE_NAME_PREFIX=TS                                  # device name filter (e.g. "TS-001")

# Supabase (public anon credentials)
VITE_SUPABASE_URL=YOUR_SUPABASE_URL
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY

# Firmware OTA auth gate (32-byte hex; access control only)
VITE_OTA_AUTH_SECRET=YOUR_OTA_SECRET

# Optional
VITE_DEMO_MODE=false
```

Server-side scripts in `tools/` read `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `tools/.env` (never committed).

> **Web Bluetooth requires a secure context (HTTPS).** It works on `localhost` for development, but any deployed environment must serve over HTTPS. The `Permissions-Policy: bluetooth=(self)` header is set in both `vercel.json` and `server.js`.

---

## Building and deploying

### Vercel (primary web target)

Vercel runs `vite build` (`vercel-build` script) and serves `dist/`. `vercel.json` rewrites all routes to `index.html` for SPA routing and sets the Bluetooth permissions header. Pushing to the connected branch deploys automatically.

### iOS (Capacitor + TestFlight)

**Production builds bundle `dist/` into the binary.** They set no `server.url`, so the app runs from `capacitor://localhost` and serves the assets `cap sync` copied into the native project.

```bash
npm run cap:prod      # build dist/ + sync it into the native project
npm run preflight     # prove the repo is archivable — exit 0 or stop
npx cap open ios      # then Product ▸ Archive
```

`npm run cap:dev` and `npm run cap:preview` still load a remote URL — live reload and on-device smoke testing are the reason those modes exist. **Only those two modes set `server.url`. Do not add it back to the production path**: when the UI is fetched at runtime, every deploy changes the reviewed app without review, which is App Review Guideline 2.5.2 and is enforced by removal rather than rejection.

Two consequences of bundling: firmware under `public/firmware/**` now ships inside the IPA, so a firmware bump is an App Store release; and because `capacitor://localhost` is a different origin from the website, any URL that leaves the app must be absolute — use `publicUrl()` from `src/lib/publicOrigin.ts`.

Full archive and submission procedure: `app-store/RUNBOOK.md`. See `Platform.md` for platform-detection details and Xcode status-bar notes.

### Elastic Beanstalk (legacy)

```bash
npm run build          # produce dist/
npm start              # or: node server.js  → http://localhost:8080
```

`server.js` is an Express server that serves `dist/` with compression, an SPA fallback, and a `GET /health` endpoint (returns `ok`) for load-balancer checks. `.ebextensions/01_env.config` sets `NPM_USE_PRODUCTION=false` so EB installs devDependencies and can run the Vite build on-instance. Because Web Bluetooth needs HTTPS, attach an ACM certificate to the EB load balancer and force HTTPS redirects.

---

## Related components

- **`firmware-src/`** — ESP32 device firmware (`model_IV`, C / ESP-IDF). Emits the NDJSON stream the app consumes. Has its own build tooling (`flash.sh`, CMake).
- **`supabase/`** — database schema and RLS policies. Apply via the Supabase SQL editor or CLI.
- **`tools/processSession.ts`** — offline/backend session post-processing using the service-role key:

```bash
npx tsx tools/processSession.ts <path/to/session.ndjson>
```
