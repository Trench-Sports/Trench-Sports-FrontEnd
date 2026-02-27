import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

function getTheme(): "dark" | "light" {
  const root = document.documentElement;
  const ds = (root.dataset.theme || "").toLowerCase();
  if (ds === "dark" || ds === "light") return ds as "dark" | "light";
  if (root.classList.contains("dark")) return "dark";
  return "light";
}

function scorePassword(pw: string) {
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[A-Z]/.test(pw)) score += 1;
  if (/[0-9]/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  return Math.min(score, 5);
}

export default function Signup() {
  const navigate = useNavigate();

  const [theme, setTheme] = useState<"dark" | "light">(() => getTheme());
  useEffect(() => {
    // Track theme changes (dataset/class) using a MutationObserver
    const root = document.documentElement;
    const obs = new MutationObserver(() => setTheme(getTheme()));
    obs.observe(root, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => obs.disconnect();
  }, []);

  const logoSrc = theme === "dark"
    ? "/src/images/TS.png"
    : "/src/images/Trench Sports Logo Power Purple.png";

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pwScore = useMemo(() => scorePassword(pw), [pw]);
  const pwOk = pwScore >= 3;
  const matchOk = pw.length > 0 && pw === pw2;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim()) return setError("Please enter your email.");
    if (!pwOk) return setError("Password is too weak. Try 12+ chars with mixed types.");
    if (!matchOk) return setError("Passwords do not match.");
    if (!agree) return setError("Please accept the terms to continue.");

    setBusy(true);
    try {
      // 🔧 Hook this into your Supabase auth when you're ready.
      // Example later:
      // await supabase.auth.signUp({ email, password: pw, options: { data: { name } } });

      // For now: fake success
      await new Promise((r) => setTimeout(r, 450));
      navigate("/dashboard");
    } catch (err: any) {
      setError(err?.message || "Signup failed. Please try again.");
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
              <h1 className="ts-signupTitle">Create your account</h1>
              <p className="ts-signupSub">AI Driven, Data Dominance.</p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="ts-signupForm">
            <div className="ts-grid2">
              <label className="ts-field">
                <span>Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jaylen"
                  autoComplete="name"
                />
              </label>

              <label className="ts-field">
                <span>Email</span>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@team.com"
                  autoComplete="email"
                />
              </label>
            </div>

            <label className="ts-field">
              <span>Password</span>
              <div className="ts-inputRow">
                <input
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  placeholder="Create a strong password"
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
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

              {pw.length > 0 && (
                <div className="ts-strengthRow">
                  <div className={`ts-strengthBar s${pwScore}`} />
                  <span className="ts-strengthText">
                      {pwScore <= 1
                        ? "Weak"
                        : pwScore === 2
                        ? "Okay"
                        : pwScore === 3
                        ? "Good"
                         : "Strong"}
                  </span>
                </div>
              )}
            </label>

            <label className="ts-field">
              <span>Confirm password</span>
              <input
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                placeholder="Re-enter password"
                type={showPw ? "text" : "password"}
                autoComplete="new-password"
              />
              {pw2.length > 0 && !matchOk ? (
                <div className="ts-hintBad">Passwords don’t match.</div>
              ) : null}
            </label>

            <label className="ts-checkRow">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>
                I agree to the <span className="ts-linkish">Terms</span> and <span className="ts-linkish">Privacy</span>.
              </span>
            </label>

            {error ? <div className="ts-error">{error}</div> : null}

            <button className="ts-btnPrimaryWide" type="submit" disabled={busy}>
              {busy ? "Creating..." : "Create account"}
            </button>

            <div className="ts-divider">
              <span>or</span>
            </div>

            <div className="ts-altRow">
              <button type="button" className="ts-btnAlt" onClick={() => alert("Connect Google later")}>
                Continue with Google
              </button>
              <button type="button" className="ts-btnAlt" onClick={() => alert("Connect Apple later")}>
                Continue with Apple
              </button>
            </div>

            <div className="ts-signupFooter">
              <span>Already have an account?</span> <Link to="/dashboard">Go to dashboard</Link>
            </div>

            <div className="ts-backRow">
              <Link to="/" className="ts-backLink">← Back to landing</Link>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}