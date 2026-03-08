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

Your current `capacitor.config.ts` points at your Vercel URL:

```ts
server: {
  url: 'https://trench-sports-front-end.vercel.app',
  cleartext: false
}
```

**For TestFlight**, keep this. The app loads your live Vercel deploy.
For a **fully offline/bundled build**, remove the `server` block and run:
```bash
npm run build && npx cap sync ios
```
Then open in Xcode and archive for TestFlight.

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