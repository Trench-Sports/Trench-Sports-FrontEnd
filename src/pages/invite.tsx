// src/pages/invite.tsx
// ─────────────────────────────────────────────────────────────────────────────
// /invite/:token — the entry point for a coach opening an invite link.
//
// Shows what they're joining BEFORE any account gets created (deliberately an
// explicit button, not an auto-redirect), stashes the token for the rest of the
// journey, and hands off to signup / login / onboarding depending on session
// state.
//
// Not wrapped in RequireOnboarding: the whole point is that the visitor has no
// account yet. preview_coach_invite is granted to `anon` for the same reason.
// See docs/coach-invite-links-plan.md §4.2.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { stashInvite, tokenPrefix } from "../lib/inviteToken";
import { inviteOpened } from "../lib/telemetryEvents";

import logoDark from "../images/NEW Master TS Logo Enhancement Set 1-03.png";
import logoLight from "../images/NEW Master TS Logo Enhancement Set 1-01.png";

type Preview = {
  program_id: string;
  program_name: string;
  core_team_id: string;
  core_team_name: string;
  expires_at: string;
};

function getTheme(): "dark" | "light" {
  const root = document.documentElement;
  const ds = (root.dataset.theme || "").toLowerCase();
  if (ds === "dark" || ds === "light") return ds as "dark" | "light";
  if (root.classList.contains("dark")) return "dark";
  return "light";
}

export function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Invite() {
  const navigate = useNavigate();
  const { token = "" } = useParams();

  const [theme, setTheme] = useState<"dark" | "light">(() => getTheme());
  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => setTheme(getTheme()));
    obs.observe(root, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => obs.disconnect();
  }, []);
  const logoSrc = theme === "dark" ? logoDark : logoLight;

  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let alive = true;

    async function run() {
      if (!supabase) {
        if (alive) {
          setError("Trench Sports isn't configured on this device (missing env vars).");
          setLoading(false);
        }
        return;
      }

      try {
        // Session state decides where the primary button goes. A failure here
        // is not fatal — it just means we treat them as logged out.
        let hasSession = false;
        try {
          const { data } = await supabase.auth.getUser();
          hasSession = !!data.user;
        } catch {
          hasSession = false;
        }

        const { data, error: rpcErr } = await supabase.rpc("preview_coach_invite", {
          p_token: token,
        });
        if (rpcErr) throw rpcErr;

        if (!alive) return;

        const row = (data as Preview[] | null)?.[0] ?? null;
        setSignedIn(hasSession);
        setPreview(row);
        inviteOpened({ valid: !!row, token_prefix: tokenPrefix(token), signed_in: hasSession });

        // Stash immediately: the coach may sign up, hit an email confirmation,
        // and come back through a link that has no token in it at all.
        if (row) {
          stashInvite({
            token,
            programId: row.program_id,
            programName: row.program_name,
            coreTeamId: row.core_team_id,
            coreTeamName: row.core_team_name,
            expiresAt: row.expires_at,
          });
        }
      } catch (e: any) {
        // Never echo the token back in an error string.
        if (alive) setError(e?.message || "Couldn't check this invite link.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [token]);

  function onAccept() {
    if (signedIn) navigate("/onboarding", { replace: true });
    else navigate("/signup?invite=1");
  }

  return (
    <div className="ts-signupPage">
      <section className="ts-signupWrap">
        <div className="ts-signupCard">
          <div className="ts-signupHeader">
            <img className="ts-signupLogo" src={logoSrc} alt="Trench Sports" />
            <div className="ts-signupTitleRow">
              <h1 className="ts-signupTitle">Coach invite</h1>
              <p className="ts-signupSub">AI Driven, Data Dominance.</p>
            </div>
          </div>

          {loading ? (
            <p style={{ padding: "18px 6px", opacity: 0.8 }}>Checking this invite…</p>
          ) : error ? (
            <div className="ts-signupForm">
              <div className="ts-error">{error}</div>
              <Link to="/signup" className="ts-btnPrimaryWide" style={{ textAlign: "center" }}>
                Continue to signup
              </Link>
            </div>
          ) : !preview ? (
            <div className="ts-signupForm">
              <div className="ts-error">
                This invite link has expired or been revoked. Ask your program admin for a new one.
              </div>
              <p style={{ margin: 0, opacity: 0.78, fontSize: 14 }}>
                You can still join with your program's 6-digit code during signup.
              </p>
              <Link to="/signup" className="ts-btnPrimaryWide" style={{ textAlign: "center" }}>
                Continue to signup
              </Link>
              <div className="ts-signupFooter">
                <span>Already have an account?</span> <Link to="/login">Go to login</Link>
              </div>
            </div>
          ) : (
            <div className="ts-signupForm">
              <div className="ts-inviteHero">
                <div style={{ fontSize: 13, opacity: 0.75 }}>You've been invited to join</div>
                <div className="ts-inviteHeroProgram">{preview.program_name}</div>
                <div className="ts-inviteHeroTeam">{preview.core_team_name}</div>
              </div>

              <div className="ts-inviteExpiry">Expires {formatExpiry(preview.expires_at)}</div>

              <button type="button" className="ts-btnPrimaryWide" onClick={onAccept}>
                {signedIn ? "Continue to setup" : "Create your account"}
              </button>

              {!signedIn && (
                <Link
                  to="/login?redirect=/onboarding"
                  className="ts-btnGhost ts-btnGhostWide"
                  style={{ textAlign: "center" }}
                >
                  I already have an account
                </Link>
              )}

              <div className="ts-note" style={{ fontSize: 12.5, opacity: 0.7, textAlign: "center" }}>
                Your program and team are set by this link — you'll only need to fill in your own
                details.
              </div>
            </div>
          )}

          <div className="ts-backRow">
            <Link to="/" className="ts-backLink">
              ← Back to landing
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
