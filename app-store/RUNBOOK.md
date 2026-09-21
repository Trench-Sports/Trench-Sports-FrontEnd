# Archive & submit runbook — Trench Sports iOS 1.0

Target: `com.trenchsports.demo` · Team `Z3ULT6LDT8` · Xcode project
`ios/App/App.xcodeproj` · scheme `App`

**The short version:**

```bash
npm run typecheck && npm run audit    # code is sane
npm run cap:prod                      # build dist/ and sync it into the native project
npm run preflight                     # prove the repo is archivable — exit 0 or stop
open ios/App/App.xcodeproj            # then Product ▸ Archive
```

`npm run preflight` is the gate. It fails the build for every mistake listed in
this document, so if it exits 0 you can stop reading and archive. The rest of
this file is why each check exists and what to do when one trips.

---

## What changed for this release

### The binary now bundles the web app

This is the significant one. Production builds used to set
`server.url = https://www.trenchsports.ai`, so the shipped app was a WKWebView
browsing the live website. It now bundles `dist/` and runs from
`capacitor://localhost`.

The reason is Guideline 2.5.2, not 4.2. When the UI is fetched at runtime, every
Vercel deploy changes the reviewed app without review — Apple treats that as
shipping unreviewed code, and the remedy is removal rather than rejection. It
also isn't caught at submission, so it would have sat there looking fine.

`npm run cap:dev` and `npm run cap:preview` are unchanged and still load a remote
URL. Only the production path bundles.

**Three consequences you own from now on:**

1. **Firmware ships inside the IPA.** `public/firmware/**` is part of the binary.
   Bumping an adapter's firmware is an App Store release, not a web deploy. The
   upside is real — OTA updates now work with no network, which matters on a
   practice field — but the release cadence for firmware just changed.
2. **The origin change resets per-origin storage.** `localStorage` and
   `IndexedDB` are scoped to the origin, and `capacitor://localhost` is a
   different origin from the website. Auth sessions, paired-device lists, theme,
   session settings and **any unsynced sessions sitting in the outbox** do not
   carry over. 1.0 is the cheapest possible moment to pay this, because the App
   Store install base is zero — but **tell your TestFlight testers to open the
   app on a network and let the outbox drain before they update.**
3. **Shared and emailed links must be absolute.** `src/lib/publicOrigin.ts` now
   provides `publicUrl()`; the invite-link builder and both password-reset calls
   use it, and preflight fails if `location.origin` reappears in a URL. Invite
   links are fully fixed — `/invite/:token` exists and now resolves against the
   public site instead of `capacitor://localhost`.

   ⚠️ **Password reset is still broken, and was before this change.** Both call
   sites point at `https://www.trenchsports.ai/reset-password`, and **there is no
   `/reset-password` route in `src/router.tsx`** — never has been. The email
   lands on the SPA's 404. This does not block the archive (a reviewer tapping
   "Forgot password" just sees "reset email sent"), but any real coach who
   forgets their password today is stuck. Build the route, or point
   `publicUrl()` at a page that exists.

### Orientation is portrait-only

iPhone and iPad. `home.tsx` and `session.tsx` do have a short-screen branch, but
login, onboarding and the dashboard have no landscape handling and those are the
screens a reviewer hits first. Advertising an orientation the app doesn't support
is a 2.4.x rejection.

### iPad ships with the phone layout — accepted risk

`isMobile()` returns true whenever Capacitor is native (`src/lib/isMobile.ts`),
so an iPad renders the phone UI across a 1024pt screen. There is no iPad
breakpoint anywhere in `src/`.

**This is a live Guideline 4.0 risk and it has not been mitigated, only
narrowed** — restricting iPad to portrait avoids the worst-looking case. If
review comes back on it, the two fast answers are to drop
`TARGETED_DEVICE_FAMILY` to `"1"` and resubmit iPhone-only, or to add a real
tablet breakpoint. Decide which you'd rather do *before* you need to.

### Other fixes already in the repo

| Change | File | Why it was blocking |
|---|---|---|
| `NSLocationWhenInUseUsageDescription` | `Info.plist` | `mobile/home.tsx` calls `getCurrentPosition()` at session start. On iOS a geolocation call with no purpose string **terminates the app**. |
| `PrivacyInfo.xcprivacy`, wired into the target | `ios/App/App/`, `project.pbxproj` | Missing manifest is an automated ITMS-91053 rejection. |
| `ITSAppUsesNonExemptEncryption = false` | `Info.plist` | Stops the export-compliance prompt on every upload. |
| Bluetooth purpose string rewritten | `Info.plist` | The old one named the mechanism, not the user's benefit — the kind of string 5.1.1 rejects. |
| `VITE_APP_VERSION` stamped at build time | `vite.config.ts` | Local builds had no value, so every shipped session reported `app_version: "dev"`. |
| Build junk stripped from `dist/` | `vite.config.ts` | `.DS_Store` and `__pycache__/*.pyc` under `public/firmware/` would otherwise ship inside the IPA. |
| `CFBundleDisplayName` → `Trench Sports` | `Info.plist` | Was "Trench Demo". |

---

## Pre-flight

```bash
cd ~/Trench-Sports-FrontEnd

npm run typecheck     # the pre-push hook runs this anyway; do it now, not at 11pm
npm run audit

npm run cap:prod      # builds dist/ AND syncs it into the native project
npm run preflight     # the gate
```

`npm run cap:prod` is the step people get wrong. `cap:dev` bakes
`localhost:5173` into the native project, and an archive built on top of that
launches to a white screen on every device except the one running your dev
server — while passing your own smoke test, because your dev server is running.
Preflight catches exactly this.

### What preflight checks, and why each one is there

Every check is something that is **invisible at the moment it goes wrong**.

| Check | The failure it prevents |
|---|---|
| Synced config has no `server.url` | Archiving a dev/preview sync. White screen in the field. |
| Synced config has no `allowNavigation` | Bundled, that allowlist lets an in-app link navigate the webview **off** the bundle onto the live site — permanently, taking the BLE bridge with it. `terms.tsx` links to `trenchsports.ai`, so it's a real path. |
| Bundled assets newer than `src/` | You edited code and archived without rebuilding. Ships a working, stale app. |
| No `.DS_Store` / `__pycache__` in the bundle | Junk inside the IPA, reviewed by Apple. |
| Purpose strings present | Missing location string = crash on the primary flow. |
| Privacy manifest present **and in Resources** | The trap: the file sits in the folder, looks right in every diff, and never reaches the bundle. |
| Version/build consistent across configurations | Debug and Release disagreeing about the build number. |
| No `${window.location.origin}` in URLs | Dead invite links and rejected auth redirects, with no error shown to the user. |
| `.env` present; no service-role key | Missing env = an app nobody can sign into. Every `VITE_*` value is inlined in plaintext into the IPA. |

On that last one: **`VITE_OTA_AUTH_SECRET` is compiled into the shipped
JavaScript and is readable by anyone who unzips the IPA.** That is true today,
on the website, and it is not made worse by bundling — but bundling is the
moment it becomes a file sitting on strangers' phones. It is not a blocker for
this submission. It is worth a real look before the install base grows. (The
root `.env` also appears to be tracked in git — `.gitignore` only covers
`tools/.env*`.)

---

## Version and build numbers

Current values are correct for a first submission: `MARKETING_VERSION = 1.0`,
`CURRENT_PROJECT_VERSION = 1`.

**The rule that bites people:** the build number must increase for every upload
to App Store Connect, *including uploads you throw away*. Reject a build, fix a
typo, re-upload — that's build 2, not build 1 again.

```bash
cd ios/App
xcrun agvtool new-version -all 2          # build number
xcrun agvtool new-marketing-version 1.1   # user-facing version
```

---

## Archive

1. `open ios/App/App.xcodeproj`
   This project uses SPM via `CapApp-SPM`, not CocoaPods — there is no
   `.xcworkspace`, which is unusual for Capacitor and trips people up.
2. Wait for **Package Resolution** to finish. Archiving mid-resolution produces
   confusing "no such module Capacitor" errors.
3. Scheme **App**, destination **Any iOS Device (arm64)**. Archive is greyed out
   with a simulator selected — that greyed-out menu item is what most "I can't
   archive" questions turn out to be.
4. Target **App** ▸ Signing & Capabilities:
   - Automatically manage signing: **on**
   - Team: **Z3ULT6LDT8**
   - Bundle Identifier: `com.trenchsports.demo`
   - The provisioning profile row should read **App Store**, not Development.
5. **Product ▸ Archive.**
6. Organizer ▸ **Distribute App** ▸ **App Store Connect** ▸ **Upload**.
7. Keep the defaults: strip symbols on, **upload symbols on**. Symbol upload is
   what makes a crash report readable; skipping it to save a minute costs you a
   week the first time a crash comes in from the field.

Processing takes 5–30 minutes.

### Smoke-test the archive before you upload

New for this release, and worth the ten minutes: the bundled build is a
different app from the one you've been testing.

Install the archive on a real device (Organizer ▸ Distribute ▸ **Ad Hoc** or
**Development**, or run the Release configuration on a connected phone) **with
your Mac's dev server stopped and your Wi-Fi off**, then check:

- The app launches and renders. If it white-screens, `dist/` didn't get bundled.
- The bag grid, session settings and mode rolodex all appear — i.e. assets
  resolved from the bundle.
- Firmware OTA finds its manifest offline.
- Turn networking back on and confirm sign-in works, which proves Supabase
  accepts requests from the `capacitor://localhost` origin.

That last one is the single most likely thing to be wrong and the least likely
to be noticed, because every earlier build made those calls from an https
origin.

---

## Screenshots

```bash
# Terminal 1
npm run dev

# Terminal 2 — the demo login is not optional, see below
DEMO_EMAIL=… DEMO_PASSWORD=… npm run shots:appstore
```

Three of the five shots come from authenticated routes, so without credentials
you get two screenshots, not five. Use the same demo account you give App
Review — then the listing shows the reviewer exactly what they're about to see.

Output: `app-store/screenshots/iphone-6.9/` (1320×2868) and
`app-store/screenshots/ipad-13/` (2048×2732). The iPad set is required because
the target still builds for iPad. Both are JPEG, because Apple rejects images
carrying an alpha channel and a fully-opaque PNG still carries one.

Shots come from real app routes, **not** `/dummy` — that's the public marketing
demo, complete with an "Interactive demo … fictional program … read-only"
banner and a tier toggle. Shipping it would be a Guideline 2.3.3 problem, and it
also renders the word "fatigue", which trips the compliance scan.

**Look at the output before uploading.** The script guarantees dimensions and
compliance; it cannot tell you the dashboard shot is three empty cards because
the demo account had no sessions that week.

---

## App Store Connect

Work down `METADATA.md`:

1. **App Information** — name, subtitle, category (Sports / Health & Fitness),
   content rights, age rating.
2. **Pricing** — free. Program subscriptions are sold under contract, not in-app.
3. **App Privacy** — the table in `METADATA.md`. It must agree with
   `PrivacyInfo.xcprivacy`; App Store Connect cross-checks them.
4. **Version information** — promotional text, description, keywords, URLs,
   screenshots.
5. **Build** — select the processed build.
6. **App Review Information** — demo account, contact details, and the notes
   block from `METADATA.md`. **Fill in the credentials.**
7. **Submit for Review.**

---

## The four things most likely to come back

**1 · Guideline 2.1 — reviewer cannot use the app.**
Most likely by a distance. The app needs hardware the reviewer doesn't have. A
reviewer who opens it, sees "Connect to Bag" and has no bag rejects that
afternoon. The whole defence is the review notes: demo account, built-in
simulator, and an offer to ship an adapter overnight. Do not submit with the
credentials placeholder unfilled.

**2 · Guideline 4.0 — iPad.**
Now the second-likeliest, because you're shipping the phone layout on iPad. See
above. Know your fallback before you need it.

**3 · Guideline 4.2 — minimum functionality.**
Much weaker than it was, now that the app is bundled rather than browsing your
website. The native BLE bridge does something a website cannot — but the
reviewer has to register that, which is why the notes lead with the hardware.

**4 · Guideline 3.1.1 — in-app purchase.**
Tiers are sold B2B under contract, which is legitimate under 3.1.3(b) — but only
while the app contains **no** pricing, no purchase flow, and no link that takes
the user somewhere to buy. `FEATURE_PITCH` copy in `src/lib/entitlements.ts`
renders on locked panels. Describing a locked feature is fine. A button from
there to a checkout page is not.

---

## After it is approved

- Tag it: `git tag ios-1.0 && git push --tags`. You'll want to know exactly what
  shipped when a crash arrives from a phone on a practice field.
- Bump `CURRENT_PROJECT_VERSION` immediately so the next archive can't collide.
- Promotional text is editable without a new build — use it instead of
  resubmitting for a copy change.
- **Firmware is now on the App Store release cadence.** Whatever process you had
  for pushing a firmware bump needs rewriting before the next one.
