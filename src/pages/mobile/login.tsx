// src/pages/mobile/login.tsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

// Adjust this import to match your supabaseClient.ts export
// Common patterns:
//   export const supabase = createClient(...)
//   export default supabase
import { supabase } from "../../supabaseClient";

export default function MobileLogin() {
  const nav = useNavigate();

  const [mode, setMode] = useState<"password" | "magic">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // If already signed in, skip login
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) nav("/m/dashboard", { replace: true });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) nav("/m/dashboard", { replace: true });
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [nav]);

  async function signInPassword() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      // redirect handled by onAuthStateChange
    } catch (e: any) {
      setErr(e?.message ?? "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendMagicLink() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      // IMPORTANT: set this to your Vercel URL or a deep-link handler
      // Example:
      // const redirectTo = "https://YOUR_APP.vercel.app/m/dashboard";
      const redirectTo = `${window.location.origin}/m/dashboard`;

      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: redirectTo,
        },
      });
      if (error) throw error;

      setMsg("Check your email for a sign-in link.");
    } catch (e: any) {
      setErr(e?.message ?? "Couldn’t send magic link");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const redirectTo = `${window.location.origin}/m/login`;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });
      if (error) throw error;
      setMsg("Password reset email sent.");
    } catch (e: any) {
      setErr(e?.message ?? "Couldn’t send reset email");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = email.trim().length > 3 && (!busy);

  return (
    <div style={{ maxWidth: 460, margin: "0 auto" }}>
      <div className="mobileCard">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          {/* Use your existing logo if you want */}
          {/* <img src={logoSrc} alt="TS" style={{ width: 44, height: 44 }} /> */}
          <div>
            <div style={{ fontWeight: 950, fontSize: 20, lineHeight: 1.1 }}>Trench Sports</div>
            <div style={{ opacity: 0.75, marginTop: 4 }}>Sign in to continue</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <button
            className={mode === "password" ? "btnSecondary" : ""}
            style={{ flex: 1, borderRadius: 14 }}
            onClick={() => setMode("password")}
            disabled={busy}
          >
            Password
          </button>
          <button
            className={mode === "magic" ? "btnSecondary" : ""}
            style={{ flex: 1, borderRadius: 14 }}
            onClick={() => setMode("magic")}
            disabled={busy}
          >
            Magic Link
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="email"
            style={{ padding: 14, borderRadius: 14 }}
          />

          {mode === "password" && (
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              type="password"
              style={{ padding: 14, borderRadius: 14 }}
            />
          )}

          {mode === "password" ? (
            <>
              <button
                className="btnSecondary"
                style={{ padding: 14, borderRadius: 14 }}
                onClick={signInPassword}
                disabled={!canSubmit || password.length < 1}
              >
                {busy ? "Signing in…" : "Sign in"}
              </button>

              <button
                style={{ padding: 14, borderRadius: 14 }}
                onClick={resetPassword}
                disabled={!canSubmit}
              >
                Forgot password
              </button>
            </>
          ) : (
            <button
              className="btnSecondary"
              style={{ padding: 14, borderRadius: 14 }}
              onClick={sendMagicLink}
              disabled={!canSubmit}
            >
              {busy ? "Sending…" : "Send magic link"}
            </button>
          )}

          {msg && <div style={{ marginTop: 6, opacity: 0.85 }}>{msg}</div>}
          {err && <div style={{ marginTop: 6, opacity: 0.9 }}>{err}</div>}
        </div>
      </div>
    </div>
  );
}