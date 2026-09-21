# Platform Detection Setup

## Files delivered

| File | Where it goes |
|---|---|
| `platform.ts` | `src/platform.ts` |
| `usePlatform.ts` | `src/hooks/usePlatform.ts` |
| `app.tsx` | `src/app.tsx` (replace existing) |
| `AppShell.tsx` | `src/components/AppShell.tsx` |
| `platform-styles.css` | Append to `src/styles.css` |

---

## How detection works

```
Capacitor.getPlatform()
  → "ios"      → data-platform="native-ios"   + .is-native on <html>
  → "android"  → data-platform="native-android" + .is-native on <html>
  → "web"      → phone UA?  → data-platform="mobile-browser"
               → desktop    → data-platform="web"
```

The attribute is set on `<html>` **before the first React render**, so there
is zero flash of wrong layout.

---

## 1. Install @capacitor/core (if not already)

```bash
npm install @capacitor/core
```

---

## 2. Add platform.ts import to app.tsx

Already done in the delivered `app.tsx`. The side-effect import runs once at
startup:

```ts
import "./platform"; // sets data-platform on <html> immediately
```

---

## 3. Append platform-styles.css to your styles.css

```bash
cat platform-styles.css >> src/styles.css
```

Or paste the contents manually at the bottom of `src/styles.css`.

---

## 4. Wrap authenticated routes with AppShell

In your router (e.g. `src/router.tsx`):

```tsx
import AppShell from "./components/AppShell";

// Inside your route config:
{
  element: (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
  children: [ /* your dashboard routes */ ]
}
```

---

## 5. Use the hook anywhere in components

```tsx
import { usePlatform } from "@/hooks/usePlatform";

function MyComponent() {
  const { isNative, isIos, isAndroid, isWeb } = usePlatform();

  return (
    <div>
      {isNative && <p>You're in the app!</p>}
      {isWeb    && <p>You're on the web.</p>}
      {isIos    && <p>Specifically on iOS.</p>}
    </div>
  );
}
```

---

## 6. Use utility CSS classes in JSX/HTML

```tsx
<button className="ts-webOnly">Download CSV</button>   {/* hidden in app */}
<button className="ts-nativeOnly">Share via iOS</button> {/* hidden on web */}
```

---

## 7. Capacitor config — important note

> ⚠️ **This section used to say the opposite.** It previously told you to keep
> `server.url` for TestFlight. That is no longer correct and must not be done.

`capacitor.config.ts` is environment-aware, and **production bundles `dist/`
into the binary** — no `server` key at all, so the app runs from
`capacitor://localhost`.

| Command | `CAP_ENV` | What the app loads |
|---|---|---|
| `npm run cap:dev` | `development` | `http://localhost:5173` (live reload) |
| `npm run cap:preview` | `preview` | the `-puce` Vercel deployment |
| `npm run cap:prod` | *(unset)* | **the bundled `dist/`. This is what you archive.** |

An unrecognised `CAP_ENV` falls through to bundled, so a typo produces a
shippable build rather than a remote-loading one.

**Do not add `server.url` back to the production path.** When the UI is fetched
at runtime, every Vercel deploy changes the reviewed app without review — App
Review Guideline 2.5.2, enforced by removal rather than rejection. `npm run
preflight` fails the build if a remote-loading config reaches the native
project.

`allowNavigation` in particular must not survive into a bundled build. Its job
was to keep an apex→www redirect inside the WKWebView while the app *was* the
website. Bundled, it does the opposite: any in-app link to `trenchsports.ai`
navigates the webview off the bundle and onto the live site, permanently, taking
the native BLE bridge with it. `src/pages/terms.tsx` contains exactly such a
link.

```bash
npm run cap:prod && npm run preflight && npx cap open ios
```

Full procedure: `app-store/RUNBOOK.md`.

---

## 8. Xcode: enable status bar extension (optional but recommended)

In `ios/App/App/Info.plist`, add:
```xml
<key>UIViewControllerBasedStatusBarAppearance</key>
<false/>
<key>UIStatusBarStyle</key>
<string>UIStatusBarStyleLightContent</string>
```

And in `ios/App/App/AppDelegate.swift`, make the webview extend under the
status bar by setting `edgesForExtendedLayout` — Capacitor typically handles
this, but the `env(safe-area-inset-top)` CSS in the delivered styles will
compensate automatically.