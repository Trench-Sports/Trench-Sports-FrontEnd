// src/router.tsx
import React, { useEffect, useState } from "react";
import { createBrowserRouter, Navigate, useNavigate } from "react-router-dom";
import AppLayout from "./components/appLayout";
import MobileLayout from "./components/mobileLayout";
import Landing from "./pages/landing";
import Signup from "./pages/signup";
import Login from "./pages/login";
import Onboarding from "./pages/onboarding";
import Contact from "./pages/contact";
import UseCasePage from "./pages/useCasePage";
import Invite from "./pages/invite";
import { LoadingScreen } from "./components/brandLoaders";

// Internal-only observability dashboard. Lazy-loaded so its code (and any
// future charting lib) never ships to coaches' bundles. Not linked in nav.
const Admin = React.lazy(() => import("./pages/admin"));

// Heavy app pages (session, dashboard, demo, legal) are split out of the
// landing bundle. A visitor on "/" only downloads them when they navigate.
const Dashboard = React.lazy(() => import("./pages/dashboard"));
const Session = React.lazy(() => import("./pages/session"));
const Dummy = React.lazy(() => import("./pages/dummy"));
const Privacy = React.lazy(() => import("./pages/privacy"));
const Terms = React.lazy(() => import("./pages/terms"));

// ── Mobile (iOS / phone) page variants ──────────────────────────────────────
const MobileLogin = React.lazy(() => import("./pages/mobile/login"));
const MobileHome = React.lazy(() => import("./pages/mobile/home"));
const MobileSwipeDeck = React.lazy(() => import("./components/mobileSwipeDeck"));

// Suspense boundary for a lazy page. Same brand loading screen RequireOnboarding
// shows while it checks the session, so the two waits read as one.
function Lazy({ children }: { children: React.ReactNode }) {
  return <React.Suspense fallback={<LoadingScreen />}>{children}</React.Suspense>;
}

import { supabase } from "./supabaseClient";
import { platform } from "./platform";
import { track } from "./lib/telemetry";
import { isAdultDob } from "./lib/age";

const REQUIRED_FIELDS = ["first_name", "last_name", "position", "city", "state", "date_of_birth"] as const;

function isComplete(p: any) {
  if (!p) return false;
  if (!p.program_id) return false;
  for (const k of REQUIRED_FIELDS) {
    const v = p[k];
    if (v === null || v === undefined) return false;
    if (typeof v === "string" && !v.trim()) return false;
  }
  // Under-18 (or garbage) DOB → back to onboarding, which refuses to proceed.
  return isAdultDob(p.date_of_birth);
}

// ── Onboarding gate. `mobile` controls which path family to redirect to. ────
function RequireOnboarding({
  children,
  mobile = false,
}: {
  children: React.ReactNode;
  mobile?: boolean;
}) {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  const loginPath = mobile ? "/m/login" : "/login";
  const onboardingPath = "/onboarding";

  useEffect(() => {
    let alive = true;

    async function run() {
      if (!supabase) {
        if (alive) setReady(true);
        return;
      }

      // ── Establish the session ──────────────────────────────────────────
      // A thrown getUser() (or a null user) means we couldn't authenticate —
      // that's a login problem, NOT an onboarding drop-off. Send to login.
      let user;
      try {
        const { data: userData, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;
        user = userData.user;
      } catch (e) {
        console.warn("[onboarding-guard] auth check failed → login", e);
        navigate(loginPath, { replace: true });
        return;
      }
      if (!user) {
        navigate(loginPath, { replace: true });
        return;
      }

      // ── Load the profile ───────────────────────────────────────────────
      // Finding F: previously ANY thrown error here (network blip, RLS
      // denial, expired token) was swallowed and redirected to /onboarding —
      // indistinguishable in the funnel from a genuine drop-off, and it traps
      // a fully-onboarded user in the onboarding flow. We now separate the two:
      // a real profile that's incomplete → /onboarding; a fetch error → log it
      // and bounce to login (a stale session is the dominant real cause).
      // (Phase 1 attaches an `onboarding.guard_failed` telemetry event here.)
      try {
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("program_id, first_name, last_name, position, city, state, date_of_birth")
          .eq("user_id", user.id)
          .maybeSingle();

        if (error) throw error;

        if (!isComplete(profile)) {
          navigate(onboardingPath, { replace: true });
          return;
        }

        if (alive) setReady(true);
      } catch (e: any) {
        console.error("[onboarding-guard] profile load failed → login (not a drop-off)", e);
        // Finding F: record this distinctly so the onboarding funnel isn't
        // polluted by errors masquerading as genuine drop-offs.
        track("onboarding.guard_failed", { reason: e?.message ?? String(e), ok: false });
        navigate(loginPath, { replace: true });
      }
    }

    run();
    return () => { alive = false; };
  }, [navigate, loginPath]);

  if (!ready) return <LoadingScreen />;
  return <>{children}</>;
}

// ── Native auto-redirect ────────────────────────────────────────────────────
// When the Capacitor iOS/Android shell loads `/`, send users to the mobile
// dashboard. Same for any desktop URL the shell might end up on.
function NativeAwareLanding() {
  if (platform.isNative) {
    return <Navigate to="/m/home" replace />;
  }
  return <Landing />;
}

function NativeAwareRedirect({ to }: { to: string }) {
  // Used to bounce native users from desktop routes (/dashboard, /session,
  // /login) over to their /m/* equivalents. Web users see this component too,
  // but for them we simply render the desktop page (handled by parent route).
  return <Navigate to={to} replace />;
}

export const router = createBrowserRouter([
  // ── Web / desktop shell ───────────────────────────────────────────────────
  {
    element: <AppLayout />,
    children: [
      { path: "/",           element: <NativeAwareLanding /> },
      { path: "/signup",     element: <Signup /> },
      {
        path: "/login",
        element: platform.isNative
          ? <NativeAwareRedirect to="/m/login" />
          : <Login />,
      },
      // Coach invite links. NOT wrapped in RequireOnboarding — the visitor has
      // no account yet, which is the whole point. Eagerly imported (not lazy):
      // this is a cold-start entry point pasted into a group chat, so it should
      // paint on first frame.
      { path: "/invite/:token", element: <Invite /> },
      { path: "/onboarding", element: <Onboarding /> },
      { path: "/dummy",      element: <Lazy><Dummy /></Lazy> },
      { path: "/contact",    element: <Contact /> },
      // ── Audience use-case pages (one template, one content entry each) ──
      { path: "/college",    element: <UseCasePage slug="college" /> },
      { path: "/pro",        element: <UseCasePage slug="pro" /> },
      { path: "/sports-science", element: <UseCasePage slug="sports-science" /> },
      { path: "/facilities", element: <UseCasePage slug="facilities" /> },
      { path: "/privacy",    element: <Lazy><Privacy /></Lazy> },
      { path: "/terms",      element: <Lazy><Terms /></Lazy> },
      {
        // Internal analytics. Gating happens inside the page (renders a
        // 404-equivalent for non-internal users), so we don't wrap it in
        // RequireOnboarding — an internal admin may not have a full profile.
        path: "/admin",
        element: <Lazy><Admin /></Lazy>,
      },
      {
        path: "/dashboard",
        element: platform.isNative
          ? <NativeAwareRedirect to="/m/dashboard" />
          : <RequireOnboarding><Lazy><Dashboard /></Lazy></RequireOnboarding>,
      },
      {
        path: "/session",
        element: platform.isNative
          ? <NativeAwareRedirect to="/m/session" />
          : <RequireOnboarding><Lazy><Session /></Lazy></RequireOnboarding>,
      },
    ],
  },

  // ── Mobile shell — `/m/*` routes ──────────────────────────────────────────
  // Used by the Capacitor iOS shell and by anyone hitting /m/* in a browser
  // (e.g. http://localhost:5173/m/session,
  //       https://www.trenchsports.ai/m/session).
  //
  // /m/dashboard and /m/session both render the same MobileSwipeDeck instance.
  // They live under a shared parent layout-route so React Router preserves the
  // deck's mount across the two paths — both pages stay alive in the
  // background and the deck just slides between them.
  {
    path: "/m",
    element: <MobileLayout />,
    children: [
      // MVP entry point — single-page, no-login power session. This is the
      // first page the mobile app loads. It lives OUTSIDE the swipe deck and
      // is intentionally NOT wrapped in <RequireOnboarding>, so it's reachable
      // with no account.
      { index: true,   element: <Navigate to="/m/home" replace /> },
      { path: "home",  element: <Lazy><MobileHome /></Lazy> },
      { path: "login", element: <Lazy><MobileLogin /></Lazy> },
      {
        // Layout route — no path of its own. The element keeps mounted as
        // long as one of its children matches.
        element: <RequireOnboarding mobile><Lazy><MobileSwipeDeck /></Lazy></RequireOnboarding>,
        children: [
          // The children are placeholders — the deck itself decides what to
          // render. We give them an empty fragment instead of leaving the
          // element undefined so React Router doesn't log the "Matched leaf
          // route does not have an element or Component" warning. The deck
          // (mounted in the parent layout-route) is what actually renders the
          // page, so any element here would be invisible anyway.
          { path: "dashboard", element: <></> },
          { path: "session",   element: <></> },
        ],
      },
    ],
  },
]);
