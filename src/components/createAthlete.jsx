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
//   • coach  → core_team_id is auto-resolved from team_members
//   • admin  → dropdown lists all teams in the program to pick from

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
  teamId: "",
};

/**
 * @param {{ open: boolean, onClose: () => void, onCreated?: (athlete: object) => void }} props
 */
export default function CreateAthleteModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [teams, setTeams] = useState([]);       // populated for admins
  const [userMeta, setUserMeta] = useState(null); // { userId, programId, role, coachTeamId }
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [error, setError] = useState("");

  // ── Bootstrap: fetch profile + teams when modal opens ──────────────────────
  const bootstrap = useCallback(async () => {
    setBootstrapping(true);
    setError("");

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) throw new Error("Not authenticated.");

      // Fetch profile (role + program_id)
      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("role, program_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (pErr || !profile) throw new Error("Could not load your profile.");

      const { role, program_id: programId } = profile;
      let coachTeamId = null;

      if (role === "coach") {
        // Coaches are tied to a core team via team_members
        const { data: membership } = await supabase
          .from("team_members")
          .select("team_id")
          .eq("coach_user_id", userId)
          .eq("program_id", programId)
          .maybeSingle();

        coachTeamId = membership?.team_id ?? null;
      }

      if (role === "admin") {
        // Admins pick from all teams in the program
        const { data: programTeams, error: tErr } = await supabase
          .from("teams")
          .select("id, name, team_type")
          .eq("program_id", programId)
          .order("name");

        if (tErr) throw new Error("Could not load teams.");
        setTeams(programTeams ?? []);
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
      setError("");
      bootstrap();
    }
  }, [open, bootstrap]);

  // ── Field helpers ────────────────────────────────────────────────────────────

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // ── Submit ────────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setError("");

    if (!form.firstName.trim()) return setError("First name is required.");
    if (!form.lastName.trim())  return setError("Last name is required.");
    if (!form.height.trim())    return setError("Height is required.");
    if (!form.weight.trim())    return setError("Weight is required.");

    if (!userMeta) return setError("Profile not loaded yet — please wait.");

    const { userId, programId, role, coachTeamId } = userMeta;

    // Resolve core_team_id
    let coreTeamId = null;
    if (role === "coach") {
      if (!coachTeamId) return setError("No core team found for your account. Contact an admin.");
      coreTeamId = coachTeamId;
    } else if (role === "admin") {
      if (!form.teamId) return setError("Please select a team for this athlete.");
      coreTeamId = form.teamId;
    } else {
      return setError(`Unexpected role "${role}" — cannot create athletes.`);
    }

    setLoading(true);

    try {
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

      const { data, error: insertErr } = await supabase
        .from("athletes")
        .insert(payload)
        .select()
        .single();

      if (insertErr) throw insertErr;

      onCreated?.(data);
      onClose();
    } catch (err) {
      setError(err.message ?? "Failed to create athlete.");
    } finally {
      setLoading(false);
    }
  }

  // ── Footer buttons ────────────────────────────────────────────────────────────

  const footer = (
    <>
      <button
        type="button"
        className="ts-btn ts-btnPrimary"
        onClick={handleSubmit}
        disabled={loading || bootstrapping}
        style={loading || bootstrapping ? { opacity: 0.6, cursor: "not-allowed" } : {}}
      >
        {loading ? "Creating…" : "Create Athlete"}
      </button>
    </>
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

          {/* Name */}
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

          {/* Physical */}
          <div style={F.sectionLabel}>Physical</div>
          <div style={F.row}>
            <Field
              label="Height"
              required
              type="text"
              placeholder="e.g. 5'11"
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

          {/* Sport / Position */}
          <div style={F.sectionLabel}>Sport Info <span style={{ opacity: 0.5, fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>(optional)</span></div>
          <div style={F.row}>
            <SelectField
              label="Sport"
              value={form.sport}
              onChange={set("sport")}
            >
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

          {/* Team — admins only */}
          {userMeta?.role === "admin" && (
            <>
              <div style={F.divider} />
              <div style={F.sectionLabel}>Team Assignment</div>
              <SelectField
                label="Core Team"
                required
                value={form.teamId}
                onChange={set("teamId")}
              >
                <option value="">— Select a team —</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.team_type ? ` (${t.team_type})` : ""}
                  </option>
                ))}
              </SelectField>
            </>
          )}

          {/* Coaches: show a read-only note */}
          {userMeta?.role === "coach" && (
            <div style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px" }}>
              This athlete will be added to your core team automatically.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}