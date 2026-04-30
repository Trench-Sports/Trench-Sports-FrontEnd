// src/components/editAthlete.jsx
//
// Trench Sports — Edit Athlete Modal
//
// Usage:
//   import EditAthleteModal from "./editAthlete";
//
//   <EditAthleteModal
//     open={showEdit}
//     athlete={selectedAthlete}   // { id, first_name, last_name, height, weight, email, sport, position }
//     onClose={() => setShowEdit(false)}
//     onSaved={(updated) => console.log("Updated:", updated)}
//     onDeleted={(athleteId) => console.log("Deleted:", athleteId)}
//   />
//
// Behaviour:
//   • Coaches and admins can edit: first name, last name, height, weight,
//     email, sport, and position.
//   • Team assignment is intentionally excluded — use manageTeam for that.
//   • Performs a Supabase UPDATE on the athletes table by id.
//   • Danger Zone: a "Delete athlete" action that requires typing "delete" to
//     confirm. The deletion intentionally PRESERVES connected data
//     (sessions, events, session_summaries) by NULL-ing their athlete_id FK
//     before removing the athlete row. team_members rows for the athlete are
//     also removed so they're cleared from every team.

import React, { useEffect, useState } from "react";
import Modal from "./modal";
import { supabase } from "../supabaseClient";

// ─── Shared field styles (mirrors createAthlete) ─────────────────────────────

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

// ─── Field components ─────────────────────────────────────────────────────────

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

function HeightField({ label = "Height", required, value, onChange }) {
  const [focused, setFocused] = React.useState(false);

  function applyFormat(raw) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 0) return "";
    if (digits.length === 1) return digits;
    const ft  = digits[0];
    const ins = digits.slice(1, 3);
    const insNum = parseInt(ins, 10);
    const insClamped = isNaN(insNum) ? ins : Math.min(insNum, 11).toString();
    return `${ft}'${insClamped}`;
  }

  function handleChange(e) {
    const raw = e.target.value;
    const stripped = raw.endsWith("'") ? raw.slice(0, -1) : raw;
    const formatted = applyFormat(stripped);
    onChange({ target: { value: formatted } });
  }

  function handleBlur() {
    setFocused(false);
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

/**
 * @param {{
 *   open: boolean,
 *   athlete: {
 *     id: string,
 *     first_name: string,
 *     last_name: string,
 *     height?: string | null,
 *     weight?: string | null,
 *     email?: string | null,
 *     sport?: string | null,
 *     position?: string | null,
 *   } | null,
 *   onClose: () => void,
 *   onSaved?: (athlete: object) => void,
 *   onDeleted?: (athleteId: string) => void,
 * }} props
 */
export default function EditAthleteModal({ open, athlete, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    height: "",
    weight: "",
    email: "",
    sport: "Football",
    position: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ── Delete-flow state ──────────────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput]             = useState("");
  const [deleteError, setDeleteError]             = useState("");
  const [deleting, setDeleting]                   = useState(false);

  // ── Populate form whenever the athlete prop changes ────────────────────────
  useEffect(() => {
    if (open && athlete) {
      setForm({
        firstName: athlete.first_name ?? "",
        lastName:  athlete.last_name  ?? "",
        height:    athlete.height     ?? "",
        weight:    athlete.weight     ?? "",
        email:     athlete.email      ?? "",
        sport:     athlete.sport      ?? "Football",
        position:  athlete.position   ?? "",
      });
      setError("");
      // Reset any leftover delete state from a previous open
      setShowDeleteConfirm(false);
      setDeleteInput("");
      setDeleteError("");
      setDeleting(false);
    }
  }, [open, athlete]);

  // ── Field helper ─────────────────────────────────────────────────────────────
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // ── Submit ────────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setError("");

    if (!form.firstName.trim()) return setError("First name is required.");
    if (!form.lastName.trim())  return setError("Last name is required.");
    if (!form.height.trim())    return setError("Height is required — enter as feet and inches, e.g. 5'11\".");
    if (!form.weight.trim())    return setError("Weight is required.");

    if (!athlete?.id) return setError("No athlete selected.");

    setLoading(true);

    try {
      const updates = {
        first_name: form.firstName.trim(),
        last_name:  form.lastName.trim(),
        height:     form.height.trim(),
        weight:     form.weight.trim(),
        email:      form.email.trim()    || null,
        sport:      form.sport.trim()    || null,
        position:   form.position.trim() || null,
      };

      const { data, error: updateErr } = await supabase
        .from("athletes")
        .update(updates)
        .eq("id", athlete.id)
        .select()
        .single();

      if (updateErr) throw updateErr;

      onSaved?.(data);
      onClose();
    } catch (err) {
      setError(err.message ?? "Failed to save changes.");
    } finally {
      setLoading(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────────
  // Removes the athlete while PRESERVING connected data (sessions, events,
  // session_summaries). The strategy:
  //   1. Delete every team_members row for this athlete (clears them off all teams).
  //   2. NULL out athlete_id on sessions and session_summaries so the historical
  //      data is kept but no longer references the about-to-be-deleted athlete.
  //      (events have no athlete_id of their own — they hang off sessions.)
  //   3. Delete the athletes row itself.
  // If any step fails, surface the error and do NOT close — the user can retry.
  async function handleDelete() {
    if (!athlete?.id) {
      setDeleteError("No athlete selected.");
      return;
    }
    if (deleteInput.trim().toLowerCase() !== "delete") {
      setDeleteError("Type 'delete' exactly to confirm.");
      return;
    }

    setDeleteError("");
    setDeleting(true);

    try {
      // 1. Remove from every team
      const { error: tmErr } = await supabase
        .from("team_members")
        .delete()
        .eq("athlete_id", athlete.id);
      if (tmErr) throw tmErr;

      // 2. Disconnect — but keep — historical session + summary records
      const { error: sErr } = await supabase
        .from("sessions")
        .update({ athlete_id: null })
        .eq("athlete_id", athlete.id);
      if (sErr) throw sErr;

      const { error: ssErr } = await supabase
        .from("session_summaries")
        .update({ athlete_id: null })
        .eq("athlete_id", athlete.id);
      if (ssErr) throw ssErr;

      // 3. Finally remove the athlete row
      const { error: aErr } = await supabase
        .from("athletes")
        .delete()
        .eq("id", athlete.id);
      if (aErr) throw aErr;

      const deletedId = athlete.id;
      setShowDeleteConfirm(false);
      setDeleteInput("");
      onDeleted?.(deletedId);
      onClose();
    } catch (err) {
      setDeleteError(err.message ?? "Failed to delete athlete.");
    } finally {
      setDeleting(false);
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────────
  const footer = (
    <button
      type="button"
      className="ts-btn ts-btnPrimary"
      onClick={handleSubmit}
      disabled={loading}
      style={loading ? { opacity: 0.6, cursor: "not-allowed" } : {}}
    >
      {loading ? "Saving…" : "Save Changes"}
    </button>
  );

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title={athlete ? `Edit ${athlete.first_name} ${athlete.last_name}` : "Edit Athlete"}
      size="md"
      footer={footer}
    >
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

        <Field
          label="Email"
          type="email"
          placeholder="e.g. jordan@example.com"
          value={form.email}
          onChange={set("email")}
          autoComplete="email"
        />

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

        {/* Read-only note: team changes go through manageTeam */}
        <div style={{
          marginTop: "2px",
          padding: "9px 12px",
          borderRadius: "10px",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.07)",
          fontSize: "12px",
          color: "var(--muted, rgba(255,255,255,0.45))",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ flexShrink: 0, opacity: 0.6 }}>
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M7 6v4M7 4.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          Team assignment is managed separately via the Teams panel.
        </div>

        <div style={F.divider} />

        {/* ── Danger Zone ───────────────────────────────────────────────── */}
        <div style={F.sectionLabel}>Danger Zone</div>
        <div style={{
          padding: "14px 16px",
          borderRadius: "14px",
          border: "1px solid rgba(255,60,60,0.22)",
          background: "rgba(255,40,40,0.04)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap",
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--text)" }}>Delete athlete</div>
            <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "3px", opacity: 0.85, lineHeight: 1.5 }}>
              Removes this athlete from every team and deletes their record.
              Their session history, events, and summaries are preserved.
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setDeleteInput(""); setDeleteError(""); setShowDeleteConfirm(true); }}
            disabled={!athlete?.id || loading}
            style={{
              padding: "8px 14px",
              borderRadius: "10px",
              border: "1px solid rgba(255,60,60,0.35)",
              background: "rgba(255,40,40,0.08)",
              color: "rgba(255,110,110,0.95)",
              cursor: athlete?.id && !loading ? "pointer" : "not-allowed",
              fontSize: "13px",
              fontWeight: 700,
              transition: "border-color 160ms ease, background 160ms ease, transform 160ms ease",
              whiteSpace: "nowrap",
              flexShrink: 0,
              opacity: athlete?.id && !loading ? 1 : 0.5,
            }}
            onMouseEnter={(e) => {
              if (!athlete?.id || loading) return;
              e.currentTarget.style.background = "rgba(255,40,40,0.15)";
              e.currentTarget.style.borderColor = "rgba(255,60,60,0.55)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,40,40,0.08)";
              e.currentTarget.style.borderColor = "rgba(255,60,60,0.35)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            Delete athlete
          </button>
        </div>

      </div>
    </Modal>

    {/* ── Delete confirmation modal ─────────────────────────────────────── */}
    <DeleteConfirmModal
      open={showDeleteConfirm}
      athleteName={athlete ? `${athlete.first_name} ${athlete.last_name}` : "this athlete"}
      onCancel={() => {
        if (deleting) return;
        setShowDeleteConfirm(false);
        setDeleteInput("");
        setDeleteError("");
      }}
      deleteInput={deleteInput}
      setDeleteInput={setDeleteInput}
      deleteError={deleteError}
      deleting={deleting}
      onConfirm={handleDelete}
    />
    </>
  );
}

// ─── Delete confirmation modal ────────────────────────────────────────────────

function DeleteConfirmModal({
  open,
  athleteName,
  onCancel,
  deleteInput,
  setDeleteInput,
  deleteError,
  deleting,
  onConfirm,
}) {
  const [focused, setFocused] = useState(false);
  const inputRef = React.useRef(null);
  const confirmed = deleteInput.toLowerCase() === "delete";

  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Delete athlete"
      size="sm"
      closeOnBackdrop={!deleting}
      closeOnEsc={!deleting}
      footer={
        <>
          <button
            type="button"
            className="ts-btn ts-btnGhost"
            onClick={onCancel}
            disabled={deleting}
            style={{ opacity: deleting ? 0.6 : 1 }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!confirmed || deleting}
            style={{
              padding: "10px 16px",
              borderRadius: "12px",
              border: "1px solid rgba(255,60,60,0.40)",
              background: confirmed ? "rgba(200,30,30,0.85)" : "rgba(255,40,40,0.08)",
              color: confirmed ? "#fff" : "rgba(255,110,110,0.5)",
              cursor: confirmed && !deleting ? "pointer" : "not-allowed",
              fontSize: "14px",
              fontWeight: 800,
              transition: "background 160ms ease, color 160ms ease, border-color 160ms ease",
              opacity: deleting ? 0.6 : 1,
            }}
          >
            {deleting ? "Deleting…" : "Permanently delete"}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

        {/* Warning banner */}
        <div style={{
          display: "flex",
          gap: "12px",
          padding: "14px",
          borderRadius: "12px",
          border: "1px solid rgba(255,60,60,0.25)",
          background: "rgba(255,40,40,0.06)",
        }}>
          <WarningIcon />
          <div>
            <div style={{ fontWeight: 800, fontSize: "14px", color: "rgba(255,110,110,0.95)", marginBottom: "4px" }}>
              This action cannot be undone
            </div>
            <div style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.55 }}>
              <strong style={{ color: "var(--text, rgba(255,255,255,0.92))" }}>{athleteName}</strong>{" "}
              will be removed from every team and their athlete record will be deleted.
              Their session history, events, and summaries will be preserved
              but no longer linked to a named athlete.
            </div>
          </div>
        </div>

        {/* Confirmation input */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{
            fontSize: "13px",
            fontWeight: 700,
            color: "var(--muted)",
            letterSpacing: "0.02em",
          }}>
            Type{" "}
            <span style={{
              color: "rgba(255,110,110,0.9)",
              fontFamily: "monospace",
              letterSpacing: 1,
            }}>
              delete
            </span>{" "}
            to confirm
          </label>
          <input
            ref={inputRef}
            type="text"
            value={deleteInput}
            onChange={(e) => setDeleteInput(e.target.value)}
            placeholder="delete"
            autoComplete="off"
            spellCheck={false}
            disabled={deleting}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 13px",
              borderRadius: "12px",
              border: confirmed
                ? "1px solid rgba(255,60,60,0.55)"
                : "1px solid var(--btn-border)",
              background: confirmed ? "rgba(200,30,30,0.08)" : "var(--btn-bg)",
              color: "var(--text)",
              fontSize: "15px",
              outline: "none",
              transition: "border-color 160ms ease, background 160ms ease, box-shadow 160ms ease",
              boxShadow: focused
                ? confirmed
                  ? "0 0 0 3px rgba(200,30,30,0.15)"
                  : "0 0 0 3px rgba(180,0,255,0.12)"
                : "none",
              fontFamily: "monospace",
              letterSpacing: "0.5px",
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => { if (e.key === "Enter" && confirmed && !deleting) onConfirm(); }}
          />
        </div>

        {deleteError && (
          <div style={{
            padding: "10px 13px",
            borderRadius: "12px",
            border: "1px solid rgba(255,80,80,0.30)",
            background: "rgba(255,80,80,0.08)",
            color: "rgba(255,130,130,0.95)",
            fontSize: "13px",
          }}>
            {deleteError}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function WarningIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
      <path d="M10 2L18.66 17H1.34L10 2Z" stroke="rgba(255,110,110,0.9)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 8v4" stroke="rgba(255,110,110,0.9)" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="14.5" r="0.8" fill="rgba(255,110,110,0.9)" />
    </svg>
  );
}