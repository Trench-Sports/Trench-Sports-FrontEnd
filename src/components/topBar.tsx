// topBar.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import ThemeToggle from "./themeToggle"; // (tsx can omit extension)
import { supabase } from "../supabaseClient";
import type { Session } from "@supabase/supabase-js";
import { LANDING_NAV_SECTIONS, scrollToSection } from "../lib/landingSections";
import { useActiveSection } from "../hooks/useActiveSection";

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
    if (!supabase) return;

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
          const { error } = await supabase!.auth.signOut();
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

/**
 * The landing page's section links, shown inline in the bar. Its own component
 * so the scroll-spy hook isn't called conditionally from TopBar.
 * Hidden under 900px by CSS — landingNav.tsx's pill takes over there.
 */
function SectionNav(): JSX.Element {
  const active = useActiveSection(LANDING_NAV_SECTIONS.map((s) => s.id));

  return (
    <nav className="topBarSections" aria-label="Page sections">
      {LANDING_NAV_SECTIONS.map((s) => {
        const isActive = active === s.id;
        return (
          <button
            key={s.id}
            type="button"
            className={`topBarSection ${isActive ? "topBarSection--active" : ""}`}
            onClick={() => scrollToSection(s.id)}
            aria-current={isActive ? "true" : undefined}
          >
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}

export default function TopBar({ theme, onToggleTheme, logoSrc }: TopBarProps): JSX.Element {
  // Section links only make sense on the one page that has those sections.
  const isLanding = useLocation().pathname === "/";

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

      {isLanding && <SectionNav />}

      <div className="topBarRight">
        <AuthActionButton />
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
    </div>
  );
}