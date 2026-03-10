// src/components/manageTeam.jsx
//
// Trench Sports — Manage Team Modal
//
// Usage:
//   import ManageTeamModal from "./manageTeam";
//
//   {/* Create mode */}
//   <ManageTeamModal
//     open={showCreate}
//     onClose={() => setShowCreate(false)}
//     onSaved={(team) => console.log("Created:", team)}
//   />
//
//   {/* Edit mode — pass an existing team object */}
//   <ManageTeamModal
//     open={showEdit}
//     onClose={() => setShowEdit(false)}
//     team={selectedTeam}           // { id, name, team_type, created_by, program_id }
//     onSaved={(team) => console.log("Updated:", team)}
//     onDeleted={(id) => console.log("Deleted:", id)}
//   />
//
// Behaviour:
//   • Create mode  — name + type; admins pick core or sub, coaches locked to sub
//   • Edit mode    — name editable only by team creator; all users manage roster
//   • Roster       — search all program athletes, add / remove with instant feedback

import React, { useEffect, useState, useCallback, useRef } from "react";
import Modal from "./modal";
import { supabase } from "../supabaseClient";

// ─── Shared field styles (mirrors createAthlete.jsx) ─────────────────────────

const F = {
  group: { display: "flex", flexDirection: "column", gap: "6px" },
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
  inputDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
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

// ─── Controlled field components ─────────────────────────────────────────────

function Field({ label, required, hint, ...inputProps }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={F.group}>
      <label style={F.label}>
        {label}
        {required && <span style={{ color: "rgba(180,0,255,0.9)", marginLeft: 3 }}>*</span>}
      </label>
      <input
        style={{
          ...F.input,
          ...(focused ? F.inputFocus : {}),
          ...(inputProps.disabled ? F.inputDisabled : {}),
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...inputProps}
      />
      {hint && (
        <div style={{ fontSize: "12px", opacity: 0.45, marginTop: "2px" }}>{hint}</div>
      )}
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
          ...(selectProps.disabled ? F.inputDisabled : {}),
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

// ─── Small avatar helper ──────────────────────────────────────────────────────

function Initials({ first, last, size = 36 }) {
  const text = [first, last]
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <div
      aria-hidden="true"
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: "50%",
        background: "linear-gradient(135deg, rgba(180,0,255,0.25), rgba(180,0,255,0.10))",
        border: "1px solid rgba(180,0,255,0.30)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.34,
        fontWeight: 700,
        color: "rgba(200,120,255,0.95)",
        letterSpacing: "0.02em",
      }}
    >
      {text || "?"}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   team?: { id: string, name: string, team_type: string, created_by: string, program_id: string } | null,
 *   onSaved?: (team: object) => void,
 *   onDeleted?: (id: string) => void,
 * }} props
 */
export default function ManageTeamModal({ open, onClose, team = null, onSaved, onDeleted }) {
  const isEdit = Boolean(team?.id);

  // ── Auth / user meta ────────────────────────────────────────────────────────
  const [userMeta, setUserMeta] = useState(null); // { userId, programId, role }
  const [bootstrapping, setBootstrapping] = useState(false);

  // ── Create-mode form ────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [teamType, setTeamType] = useState("sub");

  // ── Roster state ────────────────────────────────────────────────────────────
  const [roster, setRoster] = useState([]);          // current members: [{ member_id, athlete }]
  const [rosterLoading, setRosterLoading] = useState(false);

  const [allAthletes, setAllAthletes] = useState([]); // every athlete in program
  const [athletesLoading, setAthletesLoading] = useState(false);

  const [rosterSearch, setRosterSearch] = useState("");
  const [addSearch, setAddSearch] = useState("");

  // ── Saving / error ─────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

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

      setUserMeta({ userId, programId: profile.program_id, role: profile.role });

      // Pre-fill form when editing
      if (isEdit) {
        setName(team.name ?? "");
        setTeamType(team.team_type ?? "sub");
      } else {
        setName("");
        setTeamType("sub");
      }

      // Load all athletes in program for the roster picker
      const { data: athletes, error: aErr } = await supabase
        .from("athletes")
        .select("id, first_name, last_name, sport, position")
        .eq("program_id", profile.program_id)
        .order("last_name");

      if (aErr) throw new Error("Could not load athletes.");
      setAllAthletes(athletes ?? []);

      // Load existing roster when editing
      if (isEdit) {
        await loadRoster(team.id);
      } else {
        setRoster([]);
      }
    } catch (err) {
      setError(err.message ?? "Something went wrong.");
    } finally {
      setBootstrapping(false);
    }
  }, [isEdit, team]);

  async function loadRoster(teamId) {
    setRosterLoading(true);
    try {
      const { data, error: rErr } = await supabase
        .from("team_members")
        .select("id, athlete_id, athletes(id, first_name, last_name, sport, position)")
        .eq("team_id", teamId)
        .not("athlete_id", "is", null);

      if (rErr) throw rErr;
      // Flatten: { member_id, athlete }
      const members = (data ?? [])
        .filter((m) => m.athletes)
        .map((m) => ({ member_id: m.id, athlete: m.athletes }));
      setRoster(members);
    } catch (err) {
      setError(err.message ?? "Could not load roster.");
    } finally {
      setRosterLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      setError("");
      setSuccessMsg("");
      setRosterSearch("");
      setAddSearch("");
      bootstrap();
    }
  }, [open, bootstrap]);

  // ── Derived helpers ─────────────────────────────────────────────────────────
  const isCreator = userMeta && team && userMeta.userId === team.created_by;
  const canEditName = !isEdit || isCreator;
  const canCreateCore = userMeta?.role === "admin";

  // Athletes not yet in the roster
  const rosterIds = new Set(roster.map((m) => m.athlete.id));
  const availableAthletes = allAthletes.filter((a) => !rosterIds.has(a.id));

  // Filtered views
  const filteredRoster = rosterSearch.trim()
    ? roster.filter((m) => {
        const q = rosterSearch.toLowerCase();
        const a = m.athlete;
        return (
          `${a.first_name} ${a.last_name}`.toLowerCase().includes(q) ||
          (a.sport ?? "").toLowerCase().includes(q) ||
          (a.position ?? "").toLowerCase().includes(q)
        );
      })
    : roster;

  const filteredAvailable = addSearch.trim()
    ? availableAthletes.filter((a) => {
        const q = addSearch.toLowerCase();
        return (
          `${a.first_name} ${a.last_name}`.toLowerCase().includes(q) ||
          (a.sport ?? "").toLowerCase().includes(q) ||
          (a.position ?? "").toLowerCase().includes(q)
        );
      })
    : availableAthletes;

  // ── Flash success helper ────────────────────────────────────────────────────
  const flashSuccess = (msg) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(""), 2200);
  };

  // ── Create team ─────────────────────────────────────────────────────────────
  async function handleCreate() {
    setError("");
    if (!name.trim()) return setError("Team name is required.");
    if (!userMeta) return setError("Profile not loaded — please wait.");
    if (teamType === "core" && !canCreateCore)
      return setError("Only admins can create core teams.");

    setSaving(true);
    try {
      const { data, error: iErr } = await supabase
        .from("teams")
        .insert({
          program_id: userMeta.programId,
          created_by: userMeta.userId,
          name: name.trim(),
          team_type: teamType,
        })
        .select()
        .single();

      if (iErr) throw iErr;
      onSaved?.(data);
      onClose();
    } catch (err) {
      setError(err.message ?? "Failed to create team.");
    } finally {
      setSaving(false);
    }
  }

  // ── Save team name ──────────────────────────────────────────────────────────
  async function handleSaveName() {
    setError("");
    if (!name.trim()) return setError("Team name cannot be empty.");
    if (!isCreator) return setError("Only the team creator can rename this team.");

    setSaving(true);
    try {
      const { data, error: uErr } = await supabase
        .from("teams")
        .update({ name: name.trim() })
        .eq("id", team.id)
        .eq("created_by", userMeta.userId)
        .select()
        .single();

      if (uErr) throw uErr;
      onSaved?.(data);
      flashSuccess("Team name updated.");
    } catch (err) {
      setError(err.message ?? "Failed to update team.");
    } finally {
      setSaving(false);
    }
  }

  // ── Roster: add athlete ─────────────────────────────────────────────────────
  async function handleAddAthlete(athlete) {
    setError("");
    try {
      const { data, error: iErr } = await supabase
        .from("team_members")
        .insert({
          program_id: userMeta.programId,
          team_id: team.id,
          athlete_id: athlete.id,
          added_by: userMeta.userId,
        })
        .select("id")
        .single();

      if (iErr) throw iErr;
      setRoster((prev) => [...prev, { member_id: data.id, athlete }]);
      flashSuccess(`${athlete.first_name} added to roster.`);
    } catch (err) {
      setError(err.message ?? "Failed to add athlete.");
    }
  }

  // ── Roster: remove athlete ──────────────────────────────────────────────────
  async function handleRemoveAthlete(member_id, athleteName) {
    setError("");
    try {
      const { error: dErr } = await supabase
        .from("team_members")
        .delete()
        .eq("id", member_id);

      if (dErr) throw dErr;
      setRoster((prev) => prev.filter((m) => m.member_id !== member_id));
      flashSuccess(`${athleteName} removed from roster.`);
    } catch (err) {
      setError(err.message ?? "Failed to remove athlete.");
    }
  }

  // ── Footer ──────────────────────────────────────────────────────────────────
  const footer = isEdit ? (
    canEditName ? (
      <button
        type="button"
        className="ts-btn ts-btnPrimary"
        onClick={handleSaveName}
        disabled={saving || bootstrapping}
        style={saving || bootstrapping ? { opacity: 0.6, cursor: "not-allowed" } : {}}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    ) : null
  ) : (
    <button
      type="button"
      className="ts-btn ts-btnPrimary"
      onClick={handleCreate}
      disabled={saving || bootstrapping}
      style={saving || bootstrapping ? { opacity: 0.6, cursor: "not-allowed" } : {}}
    >
      {saving ? "Creating…" : "Create Team"}
    </button>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Manage — ${team.name}` : "Create New Team"}
      size="md"
      footer={footer}
    >
      {bootstrapping ? (
        <div style={{ textAlign: "center", padding: "28px 0", color: "var(--muted)", fontSize: "14px" }}>
          Loading…
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

          {error && <div style={F.error}>{error}</div>}

          {successMsg && (
            <div style={{
              padding: "10px 13px",
              borderRadius: "12px",
              border: "1px solid rgba(60,210,120,0.28)",
              background: "rgba(60,210,120,0.08)",
              color: "rgba(100,220,150,0.95)",
              fontSize: "13px",
            }}>
              {successMsg}
            </div>
          )}

          {/* ── Team identity ─────────────────────────────────────────── */}
          <div style={F.sectionLabel}>Team Info</div>

          <Field
            label="Team Name"
            required
            type="text"
            placeholder="e.g. Varsity Offense"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEditName}
            hint={!canEditName ? "Only the team creator can rename this team." : undefined}
          />

          {/* Team type — only shown when creating */}
          {!isEdit && (
            <SelectField
              label="Team Type"
              required
              value={teamType}
              onChange={(e) => setTeamType(e.target.value)}
              disabled={!canCreateCore && teamType === "sub"}
            >
              {canCreateCore && <option value="core">Core</option>}
              <option value="sub">Sub</option>
            </SelectField>
          )}

          {/* Type badge when editing (read-only) */}
          {isEdit && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={F.sectionLabel}>Type</span>
              <span style={{
                fontSize: "10px",
                fontWeight: 800,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                padding: "3px 10px",
                borderRadius: "999px",
                background: team.team_type === "core" ? "rgba(180,0,255,0.14)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${team.team_type === "core" ? "rgba(180,0,255,0.30)" : "rgba(255,255,255,0.12)"}`,
                color: team.team_type === "core" ? "rgba(210,130,255,0.95)" : "rgba(255,255,255,0.55)",
              }}>
                {team.team_type}
              </span>
            </div>
          )}

          {/* ── Roster — edit mode only ───────────────────────────────── */}
          {isEdit && (
            <>
              <div style={F.divider} />

              {/* Current roster */}
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <div style={F.sectionLabel}>Roster</div>
                <div style={{ fontSize: "12px", opacity: 0.45 }}>
                  {roster.length} member{roster.length !== 1 ? "s" : ""}
                </div>
              </div>

              {rosterLoading ? (
                <div style={{ fontSize: "13px", opacity: 0.45, textAlign: "center", padding: "12px 0" }}>
                  Loading roster…
                </div>
              ) : roster.length === 0 ? (
                <div style={{ fontSize: "13px", opacity: 0.45, textAlign: "center", padding: "12px 0" }}>
                  No athletes on this team yet.
                </div>
              ) : (
                <>
                  {/* Roster filter */}
                  <SearchBar
                    value={rosterSearch}
                    onChange={setRosterSearch}
                    placeholder="Search roster…"
                  />
                  <div style={rosterListStyle}>
                    {filteredRoster.length === 0 ? (
                      <div style={{ fontSize: "13px", opacity: 0.45, padding: "10px 0", textAlign: "center" }}>
                        No matches.
                      </div>
                    ) : (
                      filteredRoster.map(({ member_id, athlete }) => (
                        <RosterRow
                          key={member_id}
                          athlete={athlete}
                          action="remove"
                          onAction={() =>
                            handleRemoveAthlete(member_id, `${athlete.first_name} ${athlete.last_name}`)
                          }
                        />
                      ))
                    )}
                  </div>
                </>
              )}

              <div style={F.divider} />

              {/* Add athletes */}
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <div style={F.sectionLabel}>Add Athletes</div>
                <div style={{ fontSize: "12px", opacity: 0.45 }}>
                  {availableAthletes.length} available
                </div>
              </div>

              {athletesLoading ? (
                <div style={{ fontSize: "13px", opacity: 0.45, textAlign: "center", padding: "12px 0" }}>
                  Loading…
                </div>
              ) : availableAthletes.length === 0 ? (
                <div style={{ fontSize: "13px", opacity: 0.45, textAlign: "center", padding: "12px 0" }}>
                  All program athletes are already on this team.
                </div>
              ) : (
                <>
                  <SearchBar
                    value={addSearch}
                    onChange={setAddSearch}
                    placeholder="Search athletes to add…"
                  />
                  <div style={rosterListStyle}>
                    {filteredAvailable.length === 0 ? (
                      <div style={{ fontSize: "13px", opacity: 0.45, padding: "10px 0", textAlign: "center" }}>
                        No matches.
                      </div>
                    ) : (
                      filteredAvailable.map((athlete) => (
                        <RosterRow
                          key={athlete.id}
                          athlete={athlete}
                          action="add"
                          onAction={() => handleAddAthlete(athlete)}
                        />
                      ))
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

// ─── Shared roster list container style ──────────────────────────────────────

const rosterListStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  maxHeight: "220px",
  overflowY: "auto",
  paddingRight: "2px",
};

// ─── Search bar ───────────────────────────────────────────────────────────────

function SearchBar({ value, onChange, placeholder }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "8px 12px",
      borderRadius: "12px",
      border: `1px solid ${focused ? "rgba(180,0,255,0.45)" : "rgba(255,255,255,0.10)"}`,
      background: "rgba(255,255,255,0.04)",
      boxShadow: focused ? "0 0 0 3px rgba(180,0,255,0.10)" : "none",
      transition: "border-color 160ms ease, box-shadow 160ms ease",
    }}>
      <SearchIcon />
      <input
        style={{
          flex: 1,
          background: "none",
          border: "none",
          outline: "none",
          color: "inherit",
          font: "inherit",
          fontSize: "13px",
          minWidth: 0,
        }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear"
          style={{
            appearance: "none",
            border: "none",
            background: "none",
            color: "inherit",
            opacity: 0.4,
            cursor: "pointer",
            fontSize: "12px",
            padding: "2px 4px",
            lineHeight: 1,
          }}
        >✕</button>
      )}
    </div>
  );
}

// ─── Roster row ───────────────────────────────────────────────────────────────

function RosterRow({ athlete, action, onAction }) {
  const [hovered, setHovered] = useState(false);
  const isRemove = action === "remove";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "9px 10px",
        borderRadius: "11px",
        border: "1px solid rgba(255,255,255,0.06)",
        background: hovered ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.015)",
        transition: "background 130ms ease",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Initials first={athlete.first_name} last={athlete.last_name} size={34} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: "14px" }}>
          {athlete.first_name} {athlete.last_name}
        </div>
        {(athlete.sport || athlete.position) && (
          <div style={{ fontSize: "11px", opacity: 0.50, marginTop: "1px" }}>
            {[athlete.sport, athlete.position].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onAction}
        aria-label={isRemove ? "Remove from roster" : "Add to roster"}
        style={{
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "30px",
          height: "30px",
          borderRadius: "8px",
          border: isRemove
            ? "1px solid rgba(255,80,80,0.25)"
            : "1px solid rgba(60,210,120,0.28)",
          background: isRemove
            ? "rgba(255,80,80,0.08)"
            : "rgba(60,210,120,0.08)",
          color: isRemove
            ? "rgba(255,120,120,0.90)"
            : "rgba(80,220,140,0.90)",
          cursor: "pointer",
          fontSize: "15px",
          lineHeight: 1,
          transition: "background 140ms ease, border-color 140ms ease, transform 140ms ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.08)";
          e.currentTarget.style.background = isRemove
            ? "rgba(255,80,80,0.18)"
            : "rgba(60,210,120,0.18)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.background = isRemove
            ? "rgba(255,80,80,0.08)"
            : "rgba(60,210,120,0.08)";
        }}
      >
        {isRemove ? "✘" : "✓"}
      </button>
    </div>
  );
}

// ─── Micro SVG icons ──────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"
      style={{ flexShrink: 0, opacity: 0.40 }}>
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}