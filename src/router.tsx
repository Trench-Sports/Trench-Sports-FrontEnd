// src/router.tsx
import React, { useEffect, useState } from "react";
import { createBrowserRouter, useNavigate } from "react-router-dom";
import AppLayout from "./components/appLayout";
import Landing from "./pages/landing";
import Signup from "./pages/signup";
import Login from "./pages/login";
import Dashboard from "./pages/dashboard";
import Onboarding from "./pages/onboarding";
import Contact from "./pages/contact";
import Privacy from "./pages/privacy";
import Terms from "./pages/terms";
import Session from "./pages/session";           // ← add this import
import { supabase } from "./supabaseClient";

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

function RequireOnboarding({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

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
          navigate("/login", { replace: true });
          return;
        }

        const { data: profile, error } = await supabase
          .from("profiles")
          .select("program_id, first_name, last_name, position, city, state, date_of_birth")
          .eq("user_id", user.id)
          .maybeSingle();

        if (error) throw error;

        if (!isComplete(profile)) {
          navigate("/onboarding", { replace: true });
          return;
        }

        if (alive) setReady(true);
      } catch {
        navigate("/onboarding", { replace: true });
      }
    }

    run();
    return () => { alive = false; };
  }, [navigate]);

  if (!ready) return null;
  return <>{children}</>;
}

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: "/",           element: <Landing /> },
      { path: "/signup",     element: <Signup /> },
      { path: "/login",      element: <Login /> },
      { path: "/onboarding", element: <Onboarding /> },
      { path: "/contact",    element: <Contact /> },
      { path: "/privacy",    element: <Privacy /> },
      { path: "/terms",      element: <Terms /> },
      {
        path: "/dashboard",
        element: <RequireOnboarding><Dashboard /></RequireOnboarding>,
      },
      {
        path: "/session",                          // ← new route
        element: <RequireOnboarding><Session /></RequireOnboarding>,
      },
    ],
  },
]);