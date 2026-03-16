// src/components/createAthlete.jsx
//
// Trench Sports — Create Athlete Modal
//
// Usage:
//   import CreateAthleteModal from "./createAthlete";
//
//   <CreateAthleteModal
//     open={showCreate}
//     onClose={() => setShowCreate(false)}
//     onCreated={(athlete) => console.log("Created:", athlete)}
//   />
//
// Behaviour:
//   • Reads the current user's profile (program_id + role) on open
//   • coach  → core team is auto-resolved from team_members;
//              sub teams scoped to that core team are offered as optional assignment;
//              athletes.core_team_id always = coach's core team
//   • admin  → dropdown lists ALL teams in the program (core + sub);
//              if a sub team is selected, athletes.core_team_id = sub team's parent_team_id;
//              if a core team is selected, athletes.core_team_id = that team's id
//   • sub team assignment  → always written as a team_members row
//                            (athlete is also implicitly on the core team via athletes.core_team_id)

import React, { useEffect, useState, useCallback } from "react";
import Modal from "./modal";
import { supabase } from "../supabaseClient";

// ─── Tiny shared field styles ─────────────────────────────────────────────────

const F = {
  group: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  label: {
    fontSize: "13px",
    fontWeight: 700,
    color: "var(--muted, rgba(255,255,255,0.65))",
    letterSpacing: "0.02em",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 13px",
    borderRadius: "12px",
    border: "1px solid var(--btn-border)",
    background: "var(--btn-bg)",
    color: "var(--text, rgba(255,255,255,0.92))",
    fontSize: "15px",
    outline: "none",
    transition: "border-color 160ms ease, box-shadow 160ms ease",
  },
  inputFocus: {
    borderColor: "var(--accent, #b400ff)",
    boxShadow: "0 0 0 3px rgba(180,0,255,0.14)",
  },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
  },
  error: {
    padding: "10px 13px",
    borderRadius: "12px",
    border: "1px solid rgba(255,80,80,0.30)",
    background: "rgba(255,80,80,0.08)",
    color: "rgba(255,130,130,0.95)",
    fontSize: "13px",
  },
  divider: {
    height: "1px",
    background: "rgba(255,255,255,0.07)",
    margin: "4px 0",
  },
  sectionLabel: {
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--muted, rgba(255,255,255,0.45))",
    marginBottom: "2px",
  },
};

// ─── Controlled input with focus ring ────────────────────────────────────────

function Field({ label, required, ...inputProps }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={F.group}>
      <label style={F.label}>
        {label}
        {required && <span style={{ color: "rgba(180,0,255,0.9)", marginLeft: 3 }}>*</span>}
      </label>
      <input
        style={{ ...F.input, ...(focused ? F.inputFocus : {}) }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...inputProps}
      />
    </div>
  );
}

function SelectField({ label, required, children, ...selectProps }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={F.group}>
      <label style={F.label}>
        {label}
        {required && <span style={{ color: "rgba(180,0,255,0.9)", marginLeft: 3 }}>*</span>}
      </label>
      <select
        style={{
          ...F.input,
          appearance: "none",
          WebkitAppearance: "none",
          cursor: "pointer",
          ...(focused ? F.inputFocus : {}),
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...selectProps}
      >
        {children}
      </select>
    </div>
  );
}

// ─── HeightField — single input with live ft'in" formatting ──────────────────
//
// Typing behaviour:
//   "5"        → "5"
//   "56"       → "5'6"   (auto-inserts ' after first digit when second is typed)
//   "5'6"      → "5'6"
//   "5'11"     → "5'11"
//   Backspace  → removes naturally; strips trailing ' if inches cleared
//   Blur       → appends " if inches are present (e.g. "5'6" → "5'6\"")
//   Validates  → feet 3–8, inches 0–11

function HeightField({ label = "Height", required, value, onChange }) {
  const [focused, setFocused] = React.useState(false);

  // Formats a raw digit string into ft'in" form used for display/storage
  function applyFormat(raw) {
    // Strip everything except digits
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 0) return "";
    if (digits.length === 1) return digits; // just feet so far, no apostrophe yet
    // First digit = feet, rest = inches (max 2 inch digits)
    const ft  = digits[0];
    const ins = digits.slice(1, 3);
    // Clamp inches to 11
    const insNum = parseInt(ins, 10);
    const insClamped = isNaN(insNum) ? ins : Math.min(insNum, 11).toString();
    return `${ft}'${insClamped}`;
  }

  function handleChange(e) {
    const raw = e.target.value;

    // If user is deleting and the result ends with ', strip it too for cleaner UX
    const stripped = raw.endsWith("'") ? raw.slice(0, -1) : raw;
    const formatted = applyFormat(stripped);

    onChange({ target: { value: formatted } });
  }

  function handleBlur() {
    setFocused(false);
    // Append " on blur if we have both feet and inches and it isn't already there
    if (value && value.includes("'") && !value.endsWith('"')) {
      onChange({ target: { value: value + '"' } });
    }
  }

  return (
    <div style={F.group}>
      <label style={F.label}>
        {label}
        {required && <span style={{ color: "rgba(180,0,255,0.9)", marginLeft: 3 }}>*</span>}
      </label>
      <input
        type="text"
        inputMode="numeric"
        placeholder="5'11&quot;"
        value={value}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        maxLength={6}
        style={{ ...F.input, ...(focused ? F.inputFocus : {}) }}
        aria-label={label}
      />
    </div>
  );
}

// ─── Sport options ────────────────────────────────────────────────────────────

const SPORTS = [
  "Football",
  "Basketball",
  "Baseball",
  "Soccer",
  "Lacrosse",
  "Hockey",
  "Wrestling",
  "Boxing",
  "MMA",
  "Rugby",
  "Volleyball",
  "Track & Field",
  "Swimming",
  "Tennis",
  "Golf",
  "Other",
];

// ─── Main component ───────────────────────────────────────────────────────────

const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  height: "",
  weight: "",
  sport: "Football",
  position: "",
  teamId: "", // for admin: any team (core or sub); for coach: a sub team id or "" for core only
};

/**
 * userMeta shape:
 * {
 *   userId:      string,
 *   programId:   string,
 *   role:        "coach" | "admin",
 *   coachTeamId: string | null,   // coach's core team id (coach only)
 * }
 *
 * teams shape (populated differently per role):
 *   coach → sub teams whose parent_team_id === coachTeamId
 *   admin → ALL teams in the program (core + sub), with parent_team_id included
 */

export default function CreateAthleteModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [teams, setTeams] = useState([]);
  const [userMeta, setUserMeta] = useState(null);
  const [coachCoreName, setCoachCoreName] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [error, setError] = useState("");

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  const bootstrap = useCallback(async () => {
    setBootstrapping(true);
    setError("");

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) throw new Error("Not authenticated.");

      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("role, program_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (pErr || !profile) throw new Error("Could not load your profile.");

      const { role, program_id: programId } = profile;
      let coachTeamId = null;

      if (role === "coach") {
        // Resolve the coach's core team
        const { data: membership } = await supabase
          .from("team_members")
          .select("team_id")
          .eq("coach_user_id", userId)
          .eq("program_id", programId)
          .maybeSingle();

        coachTeamId = membership?.team_id ?? null;

        if (coachTeamId) {
          // Fetch sub teams that belong to this coach's core team only
          const { data: subTeams, error: stErr } = await supabase
            .from("teams")
            .select("id, name, team_type, parent_team_id")
            .eq("program_id", programId)
            .eq("parent_team_id", coachTeamId)
            .order("name");

          if (stErr) throw new Error("Could not load sub teams.");
          setTeams(subTeams ?? []);

          // Fetch the core team's name for the UI note
          const { data: coreTeam } = await supabase
            .from("teams")
            .select("name")
            .eq("id", coachTeamId)
            .maybeSingle();
          setCoachCoreName(coreTeam?.name ?? "your core team");
        }
      }

      if (role === "admin") {
        // Admins see all teams: include parent_team_id so we can detect sub teams
        const { data: allTeams, error: tErr } = await supabase
          .from("teams")
          .select("id, name, team_type, parent_team_id")
          .eq("program_id", programId)
          .order("name");

        if (tErr) throw new Error("Could not load teams.");
        setTeams(allTeams ?? []);
      }

      setUserMeta({ userId, programId, role, coachTeamId });
    } catch (err) {
      setError(err.message ?? "Something went wrong.");
    } finally {
      setBootstrapping(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
      setTeams([]);
      setCoachCoreName("");
      setError("");
      bootstrap();
    }
  }, [open, bootstrap]);

  // ── Field helpers ─────────────────────────────────────────────────────────

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setError("");

    if (!form.firstName.trim()) return setError("First name is required.");
    if (!form.lastName.trim())  return setError("Last name is required.");
    if (!form.height.trim())    return setError("Height is required — enter as feet and inches, e.g. 5'11\".");
    if (!form.weight.trim())    return setError("Weight is required.");

    if (!userMeta) return setError("Profile not loaded yet — please wait.");

    const { userId, programId, role, coachTeamId } = userMeta;

    // ── Resolve coreTeamId and optional subTeamId ────────────────────────────
    //
    // athletes.core_team_id must ALWAYS point to a core (parent) team.
    // If a sub team is involved, we also write a team_members row for it.

    let coreTeamId = null;
    let subTeamId  = null; // will get a team_members row if set

    if (role === "coach") {
      if (!coachTeamId) return setError("No core team found for your account. Contact an admin.");

      coreTeamId = coachTeamId;

      if (form.teamId) {
        // Validate the chosen sub team actually belongs to this coach's core team
        const chosen = teams.find((t) => t.id === form.teamId);
        if (!chosen) return setError("Selected team not found.");
        if (chosen.parent_team_id !== coachTeamId) {
          return setError("You can only assign athletes to sub teams within your own core team.");
        }
        subTeamId = form.teamId;
      }
    } else if (role === "admin") {
      if (!form.teamId) return setError("Please select a team for this athlete.");

      const chosen = teams.find((t) => t.id === form.teamId);
      if (!chosen) return setError("Selected team not found.");

      if (chosen.parent_team_id) {
        // Sub team selected — core team is the parent
        coreTeamId = chosen.parent_team_id;
        subTeamId  = chosen.id;
      } else {
        // Core team selected directly
        coreTeamId = chosen.id;
      }
    } else {
      return setError(`Unexpected role "${role}" — cannot create athletes.`);
    }

    setLoading(true);

    try {
      // 1. Insert the athlete (core_team_id always points to the core/parent team)
      const payload = {
        program_id:    programId,
        core_team_id:  coreTeamId,
        coach_user_id: userId,
        created_by:    userId,
        first_name:    form.firstName.trim(),
        last_name:     form.lastName.trim(),
        height:        form.height.trim(),
        weight:        form.weight.trim(),
        sport:         form.sport.trim()    || null,
        position:      form.position.trim() || null,
      };

      const { data: athlete, error: insertErr } = await supabase
        .from("athletes")
        .insert(payload)
        .select()
        .single();

      if (insertErr) throw insertErr;

      // 2. If a sub team was chosen, add a team_members row for it.
      //    The athlete is already implicitly on the core team via core_team_id.
      if (subTeamId) {
        const { error: memberErr } = await supabase
          .from("team_members")
          .insert({
            program_id:  programId,
            team_id:     subTeamId,
            athlete_id:  athlete.id,
            added_by:    userId,
            member_role: "athlete",
          });

        if (memberErr) throw new Error(`Athlete created but sub team assignment failed: ${memberErr.message}`);
      }

      onCreated?.(athlete);
      onClose();
    } catch (err) {
      setError(err.message ?? "Failed to create athlete.");
    } finally {
      setLoading(false);
    }
  }

  // ── Derived display helpers ───────────────────────────────────────────────

  // For admins: separate the flat list into core teams and sub teams for grouped display
  const coreTeams = teams.filter((t) => !t.parent_team_id);
  const subTeams  = teams.filter((t) =>  t.parent_team_id);

  // Selected team object (admin)
  const selectedTeam = teams.find((t) => t.id === form.teamId);
  const selectedIsSubTeam = selectedTeam?.parent_team_id != null;
  const selectedParentName = selectedIsSubTeam
    ? coreTeams.find((t) => t.id === selectedTeam.parent_team_id)?.name
    : null;

  // ── Footer ────────────────────────────────────────────────────────────────

  const footer = (
    <button
      type="button"
      className="ts-btn ts-btnPrimary"
      onClick={handleSubmit}
      disabled={loading || bootstrapping}
      style={loading || bootstrapping ? { opacity: 0.6, cursor: "not-allowed" } : {}}
    >
      {loading ? "Creating…" : "Create Athlete"}
    </button>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add New Athlete"
      size="md"
      footer={footer}
    >
      {bootstrapping ? (
        <div style={{ textAlign: "center", padding: "24px 0", color: "var(--muted)", fontSize: "14px" }}>
          Loading…
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

          {error && <div style={F.error}>{error}</div>}

          {/* ── Identity ── */}
          <div style={F.sectionLabel}>Identity</div>
          <div style={F.row}>
            <Field
              label="First Name"
              required
              type="text"
              placeholder="e.g. Jordan"
              value={form.firstName}
              onChange={set("firstName")}
              autoComplete="given-name"
            />
            <Field
              label="Last Name"
              required
              type="text"
              placeholder="e.g. Lee"
              value={form.lastName}
              onChange={set("lastName")}
              autoComplete="family-name"
            />
          </div>

          <div style={F.divider} />

          {/* ── Physical ── */}
          <div style={F.sectionLabel}>Physical</div>
          <div style={F.row}>
            <HeightField
              label="Height"
              required
              value={form.height}
              onChange={set("height")}
            />
            <Field
              label="Weight"
              required
              type="text"
              placeholder="e.g. 185 lbs"
              value={form.weight}
              onChange={set("weight")}
            />
          </div>

          <div style={F.divider} />

          {/* ── Sport Info ── */}
          <div style={F.sectionLabel}>
            Sport Info{" "}
            <span style={{ opacity: 0.5, fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>
              (optional)
            </span>
          </div>
          <div style={F.row}>
            <SelectField label="Sport" value={form.sport} onChange={set("sport")}>
              {SPORTS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </SelectField>
            <Field
              label="Position"
              type="text"
              placeholder="e.g. Linebacker"
              value={form.position}
              onChange={set("position")}
            />
          </div>

          <div style={F.divider} />

          {/* ── Team Assignment ── */}
          <div style={F.sectionLabel}>Team Assignment</div>

          {/* COACH: optional sub team picker scoped to their core team */}
          {userMeta?.role === "coach" && (
            <>
              {teams.length > 0 ? (
                <>
                  <SelectField
                    label="Sub Team (optional)"
                    value={form.teamId}
                    onChange={set("teamId")}
                  >
                    <option value="">— Core team only ({coachCoreName}) —</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.team_type ? ` (${t.team_type})` : ""}
                      </option>
                    ))}
                  </SelectField>
                  <div style={{ fontSize: "13px", color: "var(--muted)", marginTop: "-4px" }}>
                    {form.teamId
                      ? `Athlete will be added to ${teams.find(t => t.id === form.teamId)?.name} and ${coachCoreName}.`
                      : `Athlete will be added to ${coachCoreName} only.`}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: "13px", color: "var(--muted)" }}>
                  Athlete will be added to <strong style={{ color: "var(--text)" }}>{coachCoreName}</strong>.
                  {" "}No sub teams exist under this team yet.
                </div>
              )}
            </>
          )}

          {/* ADMIN: all teams grouped by core / sub */}
          {userMeta?.role === "admin" && (
            <>
              <SelectField
                label="Team"
                required
                value={form.teamId}
                onChange={set("teamId")}
              >
                <option value="">— Select a team —</option>
                {coreTeams.length > 0 && (
                  <optgroup label="Core Teams">
                    {coreTeams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.team_type ? ` (${t.team_type})` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
                {subTeams.length > 0 && (
                  <optgroup label="Sub Teams">
                    {subTeams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.team_type ? ` (${t.team_type})` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
              </SelectField>

              {/* Contextual hint for admins */}
              {selectedIsSubTeam && selectedParentName && (
                <div style={{ fontSize: "13px", color: "var(--muted)", marginTop: "-4px" }}>
                  Athlete will be added to <strong style={{ color: "var(--text)" }}>{selectedTeam.name}</strong> and
                  their parent core team <strong style={{ color: "var(--text)" }}>{selectedParentName}</strong>.
                </div>
              )}
              {selectedTeam && !selectedIsSubTeam && (
                <div style={{ fontSize: "13px", color: "var(--muted)", marginTop: "-4px" }}>
                  Athlete will be added to core team <strong style={{ color: "var(--text)" }}>{selectedTeam.name}</strong>.
                </div>
              )}
            </>
          )}

        </div>
      )}
    </Modal>
  );
}