// src/pages/onboarding.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { onboardingStepCompleted, inviteRedeemed, inviteRejected } from "../lib/telemetryEvents";
import { readInvite, clearInvite, tokenPrefix, type StashedInvite } from "../lib/inviteToken";

type Role = "coach" | "admin";
type Step = 0 | 1;

const ADMIN_POSITIONS = [
  "Head Coach",
  "Associate Head Coach",
  "Team Doctor",
  "Athletic Director",
  "Program Director",
  "Team Manager",
] as const;

const COACH_POSITIONS = [
  "Strength Coach",
  "Coach",
  "Athletic Trainer",
  "Assistant Coach",
  "Graduate Assistant",
  "Volunteer Coach",
] as const;

const US_STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"],
  ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"],
  ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"],
  ["WI", "Wisconsin"], ["WY", "Wyoming"],
] as const;

type Program = { id: string; name: string; location: string | null; onboarding_code: string };
type Team = { id: string; name: string; team_type: any };

const REQUIRED_BACKGROUND_FIELDS = [
  "position",
  "city",
  "state",
  "date_of_birth",
] as const;

function isProfileBackgroundComplete(p: any) {
  if (!p) return false;
  for (const key of REQUIRED_BACKGROUND_FIELDS) {
    const v = p[key];
    if (v === null || v === undefined) return false;
    if (typeof v === "string" && !v.trim()) return false;
  }
  return true;
}

function onlyDigits(s: string) {
  return (s || "").replace(/\D/g, "");
}

// Map redeem_coach_invite's RAISE messages onto a coarse class. The messages
// themselves are written to be user-facing and are shown verbatim; this only
// decides what the UI does next, and gives telemetry a low-cardinality reason
// that never contains the token.
type InviteFailure =
  | "expired" | "revoked" | "invalid" | "other_program"
  | "other_core" | "admin" | "cap" | "unknown";

function classifyInviteError(msg: string): InviteFailure {
  const m = (msg || "").toLowerCase();
  if (m.includes("expired")) return "expired";
  if (m.includes("revoked")) return "revoked";
  if (m.includes("invalid invite link")) return "invalid";
  if (m.includes("another program")) return "other_program";
  if (m.includes("different core team")) return "other_core";
  if (m.includes("admin accounts cannot redeem")) return "admin";
  if (m.includes("coach limit")) return "cap";
  return "unknown";
}

// Failures the coach can route around themselves: drop the lock and give them
// the 6-digit code flow back. The rest (seat cap, wrong core, unknown) need an
// admin, so we keep the invite in place and just surface the message.
const RECOVERABLE_BY_CODE: InviteFailure[] = ["expired", "revoked", "invalid", "other_program", "admin"];

function random6() {
  // client-side code generation; if collision happens, insert will fail and user can retry.
  return String(Math.floor(100000 + Math.random() * 900000));
}

export default function Onboarding() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>(0);

  // Background (Step 1)
  const [position, setPosition] = useState("");
  const [city, setCity] = useState("");
  const [stateVal, setStateVal] = useState("");
  const [dob, setDob] = useState(""); // yyyy-mm-dd

  // Training / Access (Step 2)
  const [role, setRole] = useState<Role>("coach");

  // Coach flow — invite link (docs/coach-invite-links-plan.md §4.4). When
  // `inviteLocked`, program + core come from the link and step 1 is read-only.
  const [invite, setInvite] = useState<StashedInvite | null>(null);
  const [inviteLocked, setInviteLocked] = useState(false);

  // Coach flow
  const [programCode, setProgramCode] = useState("");
  const [programHit, setProgramHit] = useState<Program | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [coreTeamId, setCoreTeamId] = useState<string>("");

  // Admin flow (create new program)
  const [adminMode, setAdminMode] = useState<"join" | "create">("create");
  const [adminJoinCode, setAdminJoinCode] = useState("");
  const [programName, setProgramName] = useState("");
  const [programLocation, setProgramLocation] = useState("");
  const [newProgramCode, setNewProgramCode] = useState<string>(random6());
  const [coreTeamName, setCoreTeamName] = useState("");

  const backgroundOk = useMemo(() => {
    return (
      position.trim() &&
      city.trim() &&
      stateVal.trim() &&
      dob.trim()
    );
  }, [position, city, stateVal, dob]);

  const coachTrainingOk = useMemo(() => {
    return programHit?.id && coreTeamId;
  }, [programHit?.id, coreTeamId]);

  const adminTrainingOk = useMemo(() => {
    if (adminMode === "join") return onlyDigits(adminJoinCode).length === 6;
    // create
    return programName.trim() && newProgramCode.trim().length === 6 && coreTeamName.trim();
  }, [adminMode, adminJoinCode, programName, newProgramCode, coreTeamName]);

  // Load current user + prefill if profile exists
  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        if (!supabase) {
          setError("Supabase is not configured (missing env vars).");
          return;
        }

        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;

        const user = authData.user;
        if (!user) {
          navigate("/login", { replace: true });
          return;
        }

        const { data: profile, error: profErr } = await supabase
          .from("profiles")
          .select("user_id, role, program_id, first_name, last_name, position, city, state, date_of_birth")
          .eq("user_id", user.id)
          .maybeSingle();

        if (profErr) throw profErr;

        // Prefill anything we have
        if (alive && profile) {
          if (profile.role) setRole(profile.role);
          if (profile.position) setPosition(profile.position);
          if (profile.city) setCity(profile.city);
          if (profile.state) setStateVal(profile.state);
          if (profile.date_of_birth) setDob(profile.date_of_birth);
        }

        // If background already complete, start on step 2; else step 1.
        if (alive) setStep(profile && isProfileBackgroundComplete(profile) ? 1 : 0);

        // If program already attached, you can skip onboarding entirely.
        if (profile?.program_id && isProfileBackgroundComplete(profile)) {
          // Nothing left to redeem — don't leave a live invite in localStorage
          // to resurface as a stale banner on this browser later.
          clearInvite();
          navigate("/dashboard", { replace: true });
          return;
        }

        // ── Coach invite link ──────────────────────────────────────────────
        // readInvite() self-clears anything expired or malformed, so a stashed
        // invite here is one worth trying.
        const stashed = readInvite();
        if (alive && stashed) {
          if (profile?.role === "admin") {
            // redeem_coach_invite refuses admins outright, and locking here
            // would be worse than useless: saveBackground() writes `role`
            // straight from component state, so forcing role="coach" would
            // demote them one step BEFORE the RPC ever got a chance to refuse.
            clearInvite();
            setError(
              "Admin accounts can't join through a coach invite link. Continue with your normal setup."
            );
          } else {
            // Must land here, not in the step-1 render path: step 0's
            // saveBackground() persists `role` from state, and a stale "admin"
            // written there would make redeem_coach_invite reject outright.
            setRole("coach");
            setInvite(stashed);
            setInviteLocked(true);
            // Satisfies the existing coachTrainingOk memo with no user input.
            // Display-only — redemption re-validates all of it server-side.
            setProgramHit({
              id: stashed.programId,
              name: stashed.programName,
              location: null,
              onboarding_code: "",
            });
            setCoreTeamId(stashed.coreTeamId);
          }
        }
      } catch (e: any) {
        if (alive) setError(e?.message || "Failed to load onboarding.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [navigate]);

  async function saveBackground() {
    setError(null);
    if (!supabase) return setError("Supabase is not configured.");
    if (!backgroundOk) return setError("Please fill in all required fields.");

    setBusy(true);
    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const user = authData.user;
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      const { error: upsertErr } = await supabase
        .from("profiles")
        .upsert(
          {
            user_id: user.id,
            position: position.trim(),
            city: city.trim(),
            state: stateVal.trim(),
            date_of_birth: dob,
            email: user.email ?? null,
            role,
          },
          { onConflict: "user_id" }
        );

      if (upsertErr) throw upsertErr;
      setStep(1);
    } catch (e: any) {
      setError(e?.message || "Failed to save background info.");
    } finally {
      setBusy(false);
    }
  }

  async function searchProgramByCode(codeRaw: string) {
    setError(null);
    if (!supabase) return setError("Supabase is not configured.");

    const code = onlyDigits(codeRaw).slice(0, 6);
    if (code.length !== 6) return setError("Enter a 6-digit program code.");

    setBusy(true);
    try {
      // Look up the program via a SECURITY DEFINER RPC (programs table is no
      // longer publicly readable). The RPC returns only id/name/location for the
      // single program matching this exact code; we echo the typed code locally.
      const { data: programRows, error: pErr } = await supabase
        .rpc("find_program_by_code", { p_code: code });

      if (pErr) throw pErr;
      const program = programRows?.[0]
        ? { ...programRows[0], onboarding_code: code }
        : null;
      if (!program) {
        setProgramHit(null);
        setTeams([]);
        setCoreTeamId("");
        setError("No program found for that code.");
        return;
      }

      setProgramHit(program as Program);

      const { data: teamRows, error: tErr } = await supabase
        .rpc("get_core_teams_for_program", { p_id: program.id });

      if (tErr) throw tErr;

      const list = (teamRows ?? []) as Team[];

      if (!list.length) {
        setTeams([]);
        setCoreTeamId("");
        setError("No core teams found for this program. Contact your admin.");
        return;
      }

      setTeams(list);
      setCoreTeamId(list.length === 1 ? list[0].id : "");
    } catch (e: any) {
      setError(e?.message || "Failed to search program.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Drop out of the invite flow and back to 6-digit code entry. Used by the
   * "Enter a program code instead" escape hatch and by the recoverable
   * redemption failures — cheap insurance when an admin sends the wrong link.
   */
  function unlockInvite() {
    clearInvite();
    setInvite(null);
    setInviteLocked(false);
    setProgramHit(null);
    setTeams([]);
    setCoreTeamId("");
    setProgramCode("");
  }

  async function completeCoachOnboarding() {
    setError(null);
    if (!supabase) return setError("Supabase is not configured.");
    if (!coachTrainingOk) return setError("Pick a core team before continuing.");

    setBusy(true);
    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const user = authData.user;
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      // ── Invite path ──────────────────────────────────────────────────────
      // Everything the coach typed (position/city/state/DOB) was already
      // written by saveBackground() at step 0, which is exactly why
      // redeem_coach_invite deliberately touches only program_id + role. All
      // this needs is the token; the RPC re-validates expiry, revocation, the
      // seat cap, and the core team itself.
      if (inviteLocked && invite) {
        const { data: redeemed, error: redeemErr } = await supabase.rpc("redeem_coach_invite", {
          p_token: invite.token,
        });

        if (redeemErr) {
          const message = redeemErr.message || "This invite link could not be used.";
          const reason = classifyInviteError(message);
          inviteRejected({ reason, token_prefix: tokenPrefix(invite.token) });
          // The RPC's messages are written to be user-facing — show verbatim.
          setError(message);
          if (RECOVERABLE_BY_CODE.includes(reason)) {
            // Deliberately NOT routing to /dashboard here (plan §4.4): the
            // profile is still incomplete, so RequireOnboarding would bounce
            // them straight back and we'd have built a redirect loop. Handing
            // back the code flow is the exit that actually works.
            unlockInvite();
          }
          return;
        }

        const row = (redeemed as any[] | null)?.[0];
        inviteRedeemed({
          program_id: row?.program_id ?? invite.programId,
          core_team_id: row?.core_team_id ?? invite.coreTeamId,
          token_prefix: tokenPrefix(invite.token),
        });

        clearInvite();
        onboardingStepCompleted("complete", "coach-invite");
        navigate("/dashboard", { replace: true });
        return;
      }

      // 1) Attach user to program via direct profile upsert
      if (!programHit?.id) throw new Error("No program selected.");

      const { error: upsertErr } = await supabase
        .from("profiles")
        .upsert(
          {
            user_id: user.id,
            role: "coach",
            program_id: programHit.id,
            position: position.trim(),
            city: city.trim(),
            state: stateVal.trim(),
            date_of_birth: dob,
            email: user.email ?? null,
          },
          { onConflict: "user_id" }
        );

      if (upsertErr) throw upsertErr;

      // 3) Add coach to selected core team
      if (programHit?.id && coreTeamId) {
        const { error: tmErr } = await supabase.from("team_members").insert({
          program_id: programHit.id,
          team_id: coreTeamId,
          coach_user_id: user.id,
          member_role: "coach",
          added_by: user.id,
        });
        if (tmErr) throw tmErr;
      }

      onboardingStepCompleted("complete", "coach");
      navigate("/dashboard", { replace: true });
    } catch (e: any) {
      setError(e?.message || "Failed to complete onboarding.");
    } finally {
      setBusy(false);
    }
  }

  async function completeAdminJoin() {
    setError(null);
    if (!supabase) return setError("Supabase is not configured.");
    const code = onlyDigits(adminJoinCode).slice(0, 6);
    if (code.length !== 6) return setError("Enter a 6-digit program code.");

    setBusy(true);
    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const user = authData.user;
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      // Look up program by code, then attach via direct profile upsert
      const { data: joinRows, error: progErr } = await supabase
        .rpc("find_program_by_code", { p_code: code });
      if (progErr) throw progErr;
      const joinProgram = joinRows?.[0] ?? null;
      if (!joinProgram) throw new Error("No program found for that code.");

      const { error: upsertErr } = await supabase
        .from("profiles")
        .upsert(
          {
            user_id: user.id,
            role: "admin",
            program_id: joinProgram.id,
            position: position.trim(),
            city: city.trim(),
            state: stateVal.trim(),
            date_of_birth: dob,
            email: user.email ?? null,
          },
          { onConflict: "user_id" }
        );

      if (upsertErr) throw upsertErr;

      onboardingStepCompleted("complete", "admin-join");
      navigate("/dashboard", { replace: true });
    } catch (e: any) {
      setError(e?.message || "Failed to join program.");
    } finally {
      setBusy(false);
    }
  }

  async function completeAdminCreate() {
    setError(null);
    if (!supabase) return setError("Supabase is not configured.");
    const code = onlyDigits(newProgramCode).slice(0, 6);
    if (!programName.trim()) return setError("Program name is required.");
    if (code.length !== 6) return setError("Program code must be 6 digits.");
    if (!coreTeamName.trim()) return setError("Create at least one core team.");

    setBusy(true);
    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const user = authData.user;
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      // 1) Create program via SECURITY DEFINER RPC (programs is no longer
      // directly insert+readable under the members-only SELECT policy).
      const { data: createdRows, error: pErr } = await supabase
        .rpc("create_program", {
          p_name: programName.trim(),
          p_location: programLocation.trim() || null,
          p_code: code,
        });

      if (pErr) throw pErr;
      const program = createdRows?.[0];
      if (!program) throw new Error("Failed to create program.");

      // 2) Attach admin profile to program
      const { error: upsertErr } = await supabase
        .from("profiles")
        .upsert(
          {
            user_id: user.id,
            role: "admin",
            program_id: (program as any).id,
            position: position.trim(),
            city: city.trim(),
            state: stateVal.trim(),
            date_of_birth: dob,
            email: user.email ?? null,
          },
          { onConflict: "user_id" }
        );

      if (upsertErr) throw upsertErr;

      // 3) Create a core team and add admin as team member
      const { data: team, error: tErr } = await supabase
        .from("teams")
        .insert({
          program_id: (program as any).id,
          name: coreTeamName.trim(),
          // team_type is user-defined — adjust if your enum differs (e.g. 'core_team')
          team_type: "core",
          created_by: user.id,
        })
        .select("id")
        .single();

      if (tErr) throw tErr;

      const { error: tmErr } = await supabase.from("team_members").insert({
        program_id: (program as any).id,
        team_id: (team as any).id,
        added_by: user.id,
        coach_user_id: user.id,
        member_role: "admin",
      });
      if (tmErr) throw tmErr;

      onboardingStepCompleted("complete", "admin-create");
      navigate("/dashboard", { replace: true });
    } catch (e: any) {
      setError(e?.message || "Failed to create program.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="ts-pageWrap">
        <div className="ts-card" style={{ maxWidth: 520, margin: "40px auto" }}>
          <h2 style={{ marginTop: 0 }}>Onboarding</h2>
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ts-pageWrap">
      <div className="ts-card" style={{ maxWidth: 780, margin: "40px auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h1 style={{ marginTop: 0, marginBottom: 6 }}>Finish setup</h1>
            <p style={{ opacity: 0.8, margin: 0 }}>
              Two quick steps: your background, then connect to your program!
            </p>
          </div>

          <div className="ts-stepper" aria-label="Onboarding steps">
            <div className={"ts-step " + (step === 0 ? "isActive" : step > 0 ? "isDone" : "")}>
              <span className="ts-stepDot" />
              <span className="ts-stepLabel"></span>
            </div>
            <div className={"ts-step " + (step === 1 ? "isActive" : "")}>
              <span className="ts-stepDot" />
              <span className="ts-stepLabel"></span>
            </div>
          </div>
        </div>

        <div className="ts-divider" style={{ margin: "18px 0" }} />

        {step === 0 ? (
          <div style={{ display: "grid", gap: 14 }}>
            <h2 style={{ margin: 0 }}>Background</h2>

            <label className="ts-field">
              <span>Position</span>
              <select value={position} onChange={(e) => setPosition(e.target.value)}>
                <option value="">Select a position…</option>
                {(role === "admin" ? ADMIN_POSITIONS : COACH_POSITIONS).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label className="ts-field">
                <span>City</span>
                <input value={city} onChange={(e) => setCity(e.target.value)} />
              </label>
              <label className="ts-field">
                <span>State</span>
                <select value={stateVal} onChange={(e) => setStateVal(e.target.value)}>
                  <option value="">Select a state…</option>
                  {US_STATES.map(([abbr, name]) => (
                    <option key={abbr} value={abbr}>{name}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="ts-field">
              <span>Date of birth</span>
              <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            </label>

            {error ? <div className="ts-error">{error}</div> : null}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
              <button
                type="button"
                className="ts-btnPrimaryWide"
                disabled={busy || !backgroundOk}
                onClick={saveBackground}
                style={{ maxWidth: 320 }}
              >
                {busy ? "Saving…" : "Next"}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <h2 style={{ margin: 0 }}>Training</h2>

            {role === "coach" ? (
              <>
                {inviteLocked ? (
                  <>
                    <p style={{ marginTop: -2, opacity: 0.8 }}>
                      You were invited by your program admin — nothing to look up.
                    </p>

                    <div style={{ display: "grid", gap: 8 }}>
                      <div className="ts-inviteLockRow">
                        <span className="ts-inviteLockKey">Program</span>
                        <span className="ts-inviteLockVal">{invite?.programName}</span>
                      </div>
                      <div className="ts-inviteLockRow">
                        <span className="ts-inviteLockKey">Core team</span>
                        <span className="ts-inviteLockVal">{invite?.coreTeamName}</span>
                      </div>
                    </div>

                    <div className="ts-note" style={{ fontSize: 12.5, opacity: 0.7 }}>
                      Set by your program admin's invite link.{" "}
                      <button
                        type="button"
                        onClick={unlockInvite}
                        disabled={busy}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          font: "inherit",
                          color: "inherit",
                          textDecoration: "underline",
                          cursor: "pointer",
                        }}
                      >
                        Enter a program code instead
                      </button>
                    </div>
                  </>
                ) : (
                <>
                <p style={{ marginTop: -2, opacity: 0.8 }}>
                  Enter your 6-digit program code.
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
                  <label className="ts-field" style={{ margin: 0 }}>
                    <span>Program code</span>
                    <input
                      value={programCode}
                      onChange={(e) => {
                        const v = onlyDigits(e.target.value).slice(0, 6);
                        setProgramCode(v);
                        setProgramHit(null);
                        setTeams([]);
                        setCoreTeamId("");
                      }}
                      placeholder="123456"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                    />
                  </label>

                  <button
                    type="button"
                    className="ts-btnPrimary"
                    disabled={busy || onlyDigits(programCode).length !== 6}
                    onClick={() => searchProgramByCode(programCode)}
                    style={{ height: 44 }}
                  >
                    {busy ? "Searching…" : "Search"}
                  </button>
                </div>

                {programHit ? (
                  <div className="ts-subCard" style={{ padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 800, letterSpacing: 0.2 }}>{programHit.name}</div>
                        <div style={{ opacity: 0.75, fontSize: 13 }}>{programHit.location || "—"}</div>
                      </div>
                      <div style={{ opacity: 0.8, fontSize: 13 }}>Code: {programHit.onboarding_code}</div>
                    </div>

                    <div style={{ height: 10 }} />

                    <label className="ts-field">
                      <span>Core team</span>
                      <select value={coreTeamId} onChange={(e) => setCoreTeamId(e.target.value)}>
                        <option value="">Select a team…</option>
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}
                </>
                )}

                {error ? <div className="ts-error">{error}</div> : null}

                <div style={{ display: "flex", gap: 10, justifyContent: "space-between", marginTop: 4 }}>
                  <button type="button" className="ts-btnGhost" onClick={() => setStep(0)} disabled={busy}>
                    Back
                  </button>

                  <button
                    type="button"
                    className="ts-btnPrimaryWide"
                    disabled={busy || !coachTrainingOk}
                    onClick={completeCoachOnboarding}
                    style={{ maxWidth: 360 }}
                  >
                    {busy ? "Finishing…" : inviteLocked ? "Join program" : "Complete onboarding"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ marginTop: -2, opacity: 0.8 }}>
                  Admins can create a new program (recommended) or join an existing program code.
                </p>

                <div>
                  <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 8, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase" }}>
                    Program setup
                  </div>
                  <div className="ts-pillRow">
                    <button
                      type="button"
                      className={"ts-pill " + (adminMode === "create" ? "isActive" : "")}
                      onClick={() => setAdminMode("create")}
                      disabled={busy}
                    >
                      Create program
                    </button>
                    <button
                      type="button"
                      className={"ts-pill " + (adminMode === "join" ? "isActive" : "")}
                      onClick={() => setAdminMode("join")}
                      disabled={busy}
                    >
                      Join existing
                    </button>
                  </div>
                </div>

                {adminMode === "join" ? (
                  <>
                    <label className="ts-field">
                      <span>Program code (6 digits)</span>
                      <input
                        value={adminJoinCode}
                        onChange={(e) => setAdminJoinCode(onlyDigits(e.target.value).slice(0, 6))}
                        placeholder="123456"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                      />
                    </label>

                    <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
                      <button type="button" className="ts-btnGhost" onClick={() => setStep(0)} disabled={busy}>
                        Back
                      </button>

                      <button
                        type="button"
                        className="ts-btnPrimaryWide"
                        disabled={busy || !adminTrainingOk}
                        onClick={completeAdminJoin}
                        style={{ maxWidth: 360 }}
                      >
                        {busy ? "Joining…" : "Join program"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <label className="ts-field">
                        <span>Program name</span>
                        <input value={programName} onChange={(e) => setProgramName(e.target.value)} placeholder="Trench Sports" />
                      </label>

                      <label className="ts-field">
                        <span>Location</span>
                        <input value={programLocation} onChange={(e) => setProgramLocation(e.target.value)} placeholder="Durham, NC" />
                      </label>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
                      <label className="ts-field" style={{ margin: 0 }}>
                        <span>6-digit program code</span>
                        <input
                          value={newProgramCode}
                          onChange={(e) => setNewProgramCode(onlyDigits(e.target.value).slice(0, 6))}
                          placeholder="123456"
                          inputMode="numeric"
                        />
                      </label>
                      <button
                        type="button"
                        className="ts-btnPrimary"
                        onClick={() => setNewProgramCode(random6())}
                        disabled={busy}
                        style={{ height: 44 }}
                      >
                        Regenerate
                      </button>
                    </div>

                    <label className="ts-field">
                      <span>Team name</span>
                      <input value={coreTeamName} onChange={(e) => setCoreTeamName(e.target.value)} placeholder="Varsity" />
                    </label>

                    {error ? <div className="ts-error">{error}</div> : null}

                    <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
                      <button type="button" className="ts-btnGhost" onClick={() => setStep(0)} disabled={busy}>
                        Back
                      </button>

                      <button
                        type="button"
                        className="ts-btnPrimaryWide"
                        disabled={busy || !adminTrainingOk}
                        onClick={completeAdminCreate}
                        style={{ maxWidth: 360 }}
                      >
                        {busy ? "Creating…" : "Create program"}
                      </button>
                    </div>

                    <div className="ts-note" style={{ marginTop: 10 }}>
                      After you create the program, you can add more teams from the Teams page. Share the code with coaches.
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}