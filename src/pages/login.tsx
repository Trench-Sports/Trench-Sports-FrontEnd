// src/pages/login.tsx
import React, { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";

type LoginForm = {
  email: string;
  password: string;
};

export default function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();

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
        setErr("Signed in, but no session was returned.");
        return;
      }

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
    <div className="ts-publicGlow">
      <div style={{ width: "min(520px, 100%)" }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 950, fontSize: 28, letterSpacing: "-0.02em" }}>Welcome back</div>
          <div style={{ opacity: 0.75, marginTop: 6 }}>Log in to view your dashboard and sessions.</div>
        </div>

        {noAccount ? (
          <div className="ts-error">
            No account found with that email.{" "}
            <Link className="ts-linkish" to={`/signup?email=${encodeURIComponent(form.email.trim())}`}>
              Create one now →
            </Link>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Redirecting you to sign up…</div>
          </div>
        ) : err ? (
          <div className="ts-error">{err}</div>
        ) : null}

        <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontWeight: 900, fontSize: 13, opacity: 0.9 }}>Email</label>
            <input
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
              type="email"
              autoComplete="email"
              placeholder="you@team.com"
              style={{
                padding: "12px 14px",
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.06)",
                color: "inherit",
                outline: "none",
              }}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontWeight: 900, fontSize: 13, opacity: 0.9 }}>Password</label>

            <div className="ts-inputRow">
              <input
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                style={{
                  flex: 1,
                  padding: "12px 14px",
                  borderRadius: 16,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.06)",
                  color: "inherit",
                  outline: "none",
                }}
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

            <div className="ts-inputRow" style={{ justifyContent: "space-between" }}>
              <button type="button" className="ts-miniBtn" onClick={onForgotPassword} disabled={busy}>
                Forgot password
              </button>

              <div style={{ display: "flex", gap: 10, alignItems: "center", opacity: 0.9, fontSize: 13 }}>
                <span>New here?</span>
                <Link className="ts-linkish" to="/signup">
                  Create account
                </Link>
              </div>
            </div>
          </div>

          <button className="ts-btnPrimaryWide" type="submit" disabled={busy}>
            {busy ? "Logging in…" : "Login"}
          </button>

          <div style={{ textAlign: "center", opacity: 0.8, fontSize: 13 }}>
            <Link className="ts-linkish" to="/">
              Back to landing
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}