// src/pages/login.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { authLoginSucceeded, authLoginFailed } from "../lib/telemetryEvents";

import logoDark from "../images/NEW Master TS Logo Enhancement Set 1-03.png";
import logoLight from "../images/NEW Master TS Logo Enhancement Set 1-01.png";

type LoginForm = {
  email: string;
  password: string;
};

function getTheme(): "dark" | "light" {
  const root = document.documentElement;
  const ds = (root.dataset.theme || "").toLowerCase();
  if (ds === "dark" || ds === "light") return ds as "dark" | "light";
  if (root.classList.contains("dark")) return "dark";
  return "light";
}

export default function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();

  const [theme, setTheme] = useState<"dark" | "light">(() => getTheme());
  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => setTheme(getTheme()));
    obs.observe(root, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => obs.disconnect();
  }, []);

  const logoSrc = theme === "dark" ? logoDark : logoLight;

  const redirectTo = useMemo(() => {
    const sp = new URLSearchParams(loc.search);
    return sp.get("redirect") || "/dashboard";
  }, [loc.search]);

  const [form, setForm] = useState<LoginForm>({ email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [showPw, setShowPw] = useState(false);

  function update<K extends keyof LoginForm>(k: K, v: LoginForm[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setNoAccount(false);

    const email = form.email.trim();
    const password = form.password;

    if (!email || !password) {
      setErr("Please enter your email and password.");
      return;
    }
    if (!supabase) {
      setErr("Supabase is not configured.");
      return;
    }

    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        const msg = error.message || "";
        const isInvalidCreds =
          msg.toLowerCase().includes("invalid login credentials") ||
          msg.toLowerCase().includes("invalid credentials") ||
          msg.toLowerCase().includes("user not found") ||
          error.status === 400;

        authLoginFailed(isInvalidCreds ? "invalid_credentials" : (error.status ? `http_${error.status}` : "unknown"));
        if (isInvalidCreds) {
          setNoAccount(true);
          setErr("No account found with that email.");
          setTimeout(() => nav(`/signup?email=${encodeURIComponent(form.email.trim())}`), 2500);
        } else {
          setErr(msg || "Unable to sign in.");
        }
        return;
      }

      if (!data.session) {
        authLoginFailed("no_session");
        setErr("Signed in, but no session was returned.");
        return;
      }

      authLoginSucceeded();
      nav(redirectTo);
    } catch (e: any) {
      setErr(e?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function onForgotPassword() {
    setErr(null);
    const email = form.email.trim();
    if (!email) {
      setErr("Enter your email first, then click Forgot password.");
      return;
    }
    if (!supabase) {
      setErr("Supabase is not configured.");
      return;
    }

    setBusy(true);
    try {
      // You can customize redirectTo to your actual reset page route
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        setErr(error.message || "Could not send reset email.");
        return;
      }
      setErr("Password reset email sent. Check your inbox.");
    } catch (e: any) {
      setErr(e?.message || "Could not send reset email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ts-signupPage">
      <section className="ts-signupWrap">
        <div className="ts-signupCard">
          <div className="ts-signupHeader">
            <img className="ts-signupLogo" src={logoSrc} alt="Trench Sports" />
            <div className="ts-signupTitleRow">
              <h1 className="ts-signupTitle">Welcome back</h1>
              <p className="ts-signupSub">Log in to view your dashboard and sessions.</p>
            </div>
          </div>

          {noAccount ? (
            <div className="ts-error">
              No account found with that email.{" "}
              <Link className="ts-linkish" to={`/signup?email=${encodeURIComponent(form.email.trim())}`}>
                Create one now →
              </Link>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Redirecting you to sign up…</div>
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="ts-signupForm">
            <label className="ts-field">
              <span>Email</span>
              <input
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                type="email"
                autoComplete="email"
                placeholder="you@team.com"
              />
            </label>

            <label className="ts-field">
              <span>Password</span>
              <div className="ts-inputRow">
                <input
                  value={form.password}
                  onChange={(e) => update("password", e.target.value)}
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  className="ts-miniBtn"
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>

              <div className="ts-inputRow" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="ts-miniBtn" onClick={onForgotPassword} disabled={busy}>
                  Forgot password
                </button>
              </div>
            </label>

            {!noAccount && err ? <div className="ts-error">{err}</div> : null}

            <button className="ts-btnPrimaryWide" type="submit" disabled={busy}>
              {busy ? "Logging in…" : "Login"}
            </button>

            <div className="ts-signupFooter">
              <span>New here?</span> <Link to="/signup">Create account</Link>
            </div>

            <div className="ts-backRow">
              <Link to="/" className="ts-backLink">
                ← Back to landing
              </Link>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
