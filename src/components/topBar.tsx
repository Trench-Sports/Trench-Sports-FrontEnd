// topBar.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import ThemeToggle from "./themeToggle"; // (tsx can omit extension)
import { supabase } from "../supabaseClient";
import type { Session } from "@supabase/supabase-js";

type ThemeMode = "light" | "dark" | string;

export type TopBarProps = {
  theme: ThemeMode;
  onToggleTheme: () => void;
  logoSrc?: string;
};

type AuthAction = {
  label: string;
  onClick: () => void | Promise<void>;
};

function AuthActionButton(): JSX.Element {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let alive = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return;
      if (error) {
        console.warn("[auth] getSession error:", error);
        setSession(null);
        return;
      }
      setSession(data?.session ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession ?? null);
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  const action: AuthAction = useMemo(() => {
    const isDashboard = pathname === "/dashboard";
    const isAuthed = !!session;

    if (!isAuthed) {
      return {
        label: "Login",
        onClick: () => nav("/login"),
      };
    }

    if (isDashboard) {
      return {
        label: "Logout",
        onClick: async () => {
          const { error } = await supabase.auth.signOut();
          if (error) console.warn("[auth] signOut error:", error);
          nav("/");
        },
      };
    }

    return {
      label: "View Dashboard",
      onClick: () => nav("/dashboard"),
    };
  }, [pathname, session, nav]);

  return (
    <button type="button" className="btnSecondary topBarAuthBtn" onClick={action.onClick}>
      {action.label}
    </button>
  );
}

export default function TopBar({ theme, onToggleTheme, logoSrc }: TopBarProps): JSX.Element {
  return (
    <div className="topBar">
      <div className="topBarLeft">
        <Link to="/" aria-label="Go to landing page" className="topBarLogoLink">
          {logoSrc ? (
            <img className="topBarLogo" src={logoSrc} alt="Trench Sports logo" />
          ) : (
            <div className="topBarLogoFallback" aria-hidden="true" />
          )}
        </Link>

        <div className="topBarTitle">Trench Sports</div>
      </div>

      <div className="topBarRight">
        <AuthActionButton />
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
    </div>
  );
}