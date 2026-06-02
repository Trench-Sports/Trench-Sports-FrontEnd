// src/router.tsx
import React, { useEffect, useState } from "react";
import { createBrowserRouter, Navigate, useNavigate } from "react-router-dom";
import AppLayout from "./components/appLayout";
import MobileLayout from "./components/mobileLayout";
import Landing from "./pages/landing";
import Signup from "./pages/signup";
import Login from "./pages/login";
import Dashboard from "./pages/dashboard";
import Onboarding from "./pages/onboarding";
import Contact from "./pages/contact";
import Privacy from "./pages/privacy";
import Terms from "./pages/terms";
import Session from "./pages/session";

// ── Mobile (iOS / phone) page variants ──────────────────────────────────────
import MobileLogin from "./pages/mobile/login";
import MobileHome from "./pages/mobile/home";
import MobileSwipeDeck from "./components/mobileSwipeDeck";

import { supabase } from "./supabaseClient";
import { platform } from "./platform";

const REQUIRED_FIELDS = ["first_name", "last_name", "position", "city", "state", "date_of_birth"] as const;

function isComplete(p: any) {
  if (!p) return false;
  if (!p.program_id) return false;
  for (const k of REQUIRED_FIELDS) {
    const v = p[k];
    if (v === null || v === undefined) return false;
    if (typeof v === "string" && !v.trim()) return false;
  }
  return true;
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
      try {
        if (!supabase) {
          if (alive) setReady(true);
          return;
        }

        const { data: userData } = await supabase.auth.getUser();
        const user = userData.user;

        if (!user) {
          navigate(loginPath, { replace: true });
          return;
        }

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
      } catch {
        navigate(onboardingPath, { replace: true });
      }
    }

    run();
    return () => { alive = false; };
  }, [navigate, loginPath]);

  if (!ready) return null;
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
      { path: "/onboarding", element: <Onboarding /> },
      { path: "/contact",    element: <Contact /> },
      { path: "/privacy",    element: <Privacy /> },
      { path: "/terms",      element: <Terms /> },
      {
        path: "/dashboard",
        element: platform.isNative
          ? <NativeAwareRedirect to="/m/dashboard" />
          : <RequireOnboarding><Dashboard /></RequireOnboarding>,
      },
      {
        path: "/session",
        element: platform.isNative
          ? <NativeAwareRedirect to="/m/session" />
          : <RequireOnboarding><Session /></RequireOnboarding>,
      },
    ],
  },

  // ── Mobile shell — `/m/*` routes ──────────────────────────────────────────
  // Used by the Capacitor iOS shell and by anyone hitting /m/* in a browser
  // (e.g. http://localhost:5173/m/session,
  //       https://trench-sports-front-end.vercel.app/m/session).
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
      { path: "home",  element: <MobileHome /> },
      { path: "login", element: <MobileLogin /> },
      {
        // Layout route — no path of its own. The element keeps mounted as
        // long as one of its children matches.
        element: <RequireOnboarding mobile><MobileSwipeDeck /></RequireOnboarding>,
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
