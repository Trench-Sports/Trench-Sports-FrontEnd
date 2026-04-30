// src/components/editProfile.jsx
//
// Trench Sports — Edit Profile Modal
//
// Usage:
//   import EditProfileModal from "./editProfile";
//
//   <EditProfileModal
//     open={showEdit}
//     onClose={() => setShowEdit(false)}
//     onSaved={(updatedProfile) => setProfile(updatedProfile)}
//   />
//
// Loads the current user's profile from Supabase on open,
// pre-fills all fields, and upserts on save.

import React, { useEffect, useState, useCallback, useRef } from "react";
import Modal from "./modal";
import { supabase } from "../supabaseClient";

// ─── Position lists (mirrors onboarding.tsx exactly) ─────────────────────────

const ADMIN_POSITIONS = [
  "Head Coach",
  "Associate Head Coach",
  "Team Doctor",
  "Athletic Director",
  "Program Director",
  "Team Manager",
];

const COACH_POSITIONS = [
  "Strength Coach",
  "Coach",
  "Athletic Trainer",
  "Assistant Coach",
  "Graduate Assistant",
  "Volunteer Coach",
];

// ─── US States (abbr + full name, matches onboarding.tsx) ────────────────────

const US_STATES = [
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],
  ["CA","California"],["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],
  ["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],
  ["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],
  ["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],
  ["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],
  ["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],
  ["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],
  ["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],
  ["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],
  ["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],
  ["VT","Vermont"],["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],
  ["WI","Wisconsin"],["WY","Wyoming"],
];

// ─── Shared field styles (mirrors createAthlete.jsx) ─────────────────────────

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
  success: {
    padding: "10px 13px",
    borderRadius: "12px",
    border: "1px solid rgba(0,200,120,0.30)",
    background: "rgba(0,200,120,0.08)",
    color: "rgba(60,220,150,0.95)",
    fontSize: "13px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
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
  avatarWrap: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    padding: "14px 16px",
    borderRadius: "14px",
    border: "1px solid var(--btn-border)",
    background: "var(--btn-bg)",
  },
  avatar: {
    width: "54px",
    height: "54px",
    borderRadius: "50%",
    border: "2px solid rgba(180,0,255,0.40)",
    objectFit: "cover",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, rgba(180,0,255,0.30), rgba(180,0,255,0.60))",
    fontSize: "18px",
    fontWeight: 950,
    color: "#fff",
  },
  avatarMeta: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    flex: 1,
    minWidth: 0,
  },
  avatarHint: {
    fontSize: "12px",
    color: "var(--muted)",
    opacity: 0.8,
  },
  readonlyPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 12px",
    borderRadius: "999px",
    border: "1px solid var(--btn-border)",
    background: "var(--btn-bg)",
    fontSize: "13px",
    fontWeight: 700,
    color: "var(--muted)",
    opacity: 0.85,
  },
};

// ─── Reusable field components ────────────────────────────────────────────────

function Field({ label, required, hint, ...inputProps }) {
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
      {hint && <div style={{ fontSize: "11px", color: "var(--muted)", opacity: 0.7, marginTop: 2 }}>{hint}</div>}
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

// ─── Avatar preview ───────────────────────────────────────────────────────────

function AvatarPreview({ url, initials }) {
  const [broken, setBroken] = useState(false);

  useEffect(() => setBroken(false), [url]);

  if (url && !broken) {
    return (
      <img
        src={url}
        alt="Avatar preview"
        style={F.avatar}
        onError={() => setBroken(true)}
      />
    );
  }

  return <div style={F.avatar}>{initials}</div>;
}

// ─── Empty form shape ─────────────────────────────────────────────────────────

const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  email: "",
  city: "",
  state: "",
  position: "",
  dateOfBirth: "",
  profilePic: "",
};

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   onSaved?: (profile: object) => void
 * }} props
 */
export default function EditProfileModal({ open, onClose, onSaved }) {
  const [form, setForm]               = useState(EMPTY_FORM);
  const [userMeta, setUserMeta]       = useState(null); // { userId, role, programName }
  const [loading, setLoading]         = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [error, setError]             = useState("");
  const [saved, setSaved]             = useState(false);

  // ── Delete account state ──
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput]             = useState("");
  const [deleteError, setDeleteError]             = useState("");
  const [deleting, setDeleting]                   = useState(false);

  // ── Bootstrap ────────────────────────────────────────────────────────────────

  const bootstrap = useCallback(async () => {
    if (!supabase) return;
    setBootstrapping(true);
    setError("");
    setSaved(false);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) throw new Error("Not authenticated.");

      const { data, error: pErr } = await supabase
        .from("profiles")
        .select("first_name, last_name, email, city, state, position, date_of_birth, profile_pic, role, programs(name)")
        .eq("user_id", userId)
        .maybeSingle();

      if (pErr) throw new Error(pErr.message);

      setForm({
        firstName:   data?.first_name   ?? "",
        lastName:    data?.last_name    ?? "",
        email:       data?.email        ?? "",
        city:        data?.city         ?? "",
        state:       data?.state        ?? "",
        position:    data?.position     ?? "",
        dateOfBirth: data?.date_of_birth ?? "",
        profilePic:  data?.profile_pic  ?? "",
      });

      setUserMeta({
        userId,
        role:        data?.role ?? "",
        programName: data?.programs?.name ?? "",
      });
    } catch (err) {
      setError(err.message ?? "Could not load profile.");
    } finally {
      setBootstrapping(false);
    }
  }, []);

  useEffect(() => {
    if (open) bootstrap();
  }, [open, bootstrap]);

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const set = (key) => (e) => {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const initials =
    [form.firstName, form.lastName]
      .filter(Boolean)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "U";

  // ── Submit ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!supabase || !userMeta) return;
    setError("");
    setSaved(false);

    if (!form.firstName.trim()) return setError("First name is required.");
    if (!form.lastName.trim())  return setError("Last name is required.");

    setLoading(true);

    try {
      const payload = {
        first_name:    form.firstName.trim(),
        last_name:     form.lastName.trim(),
        email:         form.email.trim()       || null,
        city:          form.city.trim()        || null,
        state:         form.state              || null,
        position:      form.position.trim()    || null,
        date_of_birth: form.dateOfBirth        || null,
        profile_pic:   form.profilePic.trim()  || null,
      };

      const { error: uErr } = await supabase
        .from("profiles")
        .update(payload)
        .eq("user_id", userMeta.userId);

      if (uErr) throw uErr;

      setSaved(true);

      // Bubble up a lean profile object so Dashboard can update ProfileHeader immediately
      onSaved?.({
        name:     [form.firstName, form.lastName].filter(Boolean).join(" "),
        role:     userMeta.role,
        location: [form.city, form.state].filter(Boolean).join(", "),
        program:  userMeta.programName,
        avatarUrl: form.profilePic.trim() || undefined,
      });
    } catch (err) {
      setError(err.message ?? "Failed to save profile.");
    } finally {
      setLoading(false);
    }
  }

  // ── Logout ────────────────────────────────────────────────────────────────────

  async function handleLogout() {
    if (!supabase) return;
    try {
      const { error: signOutErr } = await supabase.auth.signOut();
      if (signOutErr) console.warn("[auth] signOut error:", signOutErr);
    } finally {
      // Mirror the redirect pattern used elsewhere in the app
      window.location.href = "/";
    }
  }

  // ── Delete account ───────────────────────────────────────────────────────────

  async function handleDeleteAccount() {
    if (!supabase || !userMeta) return;
    if (deleteInput.toLowerCase() !== "delete") {
      setDeleteError("Type 'delete' exactly to confirm.");
      return;
    }
    setDeleting(true);
    setDeleteError("");
    try {
      // Delete profile row — cascade rules in your DB will clean up related rows.
      // Auth user deletion requires a server-side function or Supabase admin API;
      // this removes the profile and signs the user out as a safe client-side action.
      const { error: delErr } = await supabase
        .from("profiles")
        .delete()
        .eq("user_id", userMeta.userId);

      if (delErr) throw delErr;

      await supabase.auth.signOut();
      // Redirect to root — router will push to /login
      window.location.href = "/";
    } catch (err) {
      setDeleteError(err.message ?? "Failed to delete account.");
      setDeleting(false);
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────────
  // The Modal footer uses `justify-content: flex-end`, so `marginRight: auto`
  // on the first child pushes the Logout button to the far left while the
  // Save Changes button stays anchored on the right.

  const footer = (
    <>
      <button
        type="button"
        onClick={handleLogout}
        disabled={loading || bootstrapping || deleting}
        style={{
          marginRight: "auto",
          padding: "10px 16px",
          borderRadius: "12px",
          border: "1px solid var(--btn-border)",
          background: "var(--btn-bg)",
          color: "var(--text, rgba(255,255,255,0.92))",
          cursor: loading || bootstrapping || deleting ? "not-allowed" : "pointer",
          fontSize: "14px",
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          transition: "border-color 160ms ease, background 160ms ease, color 160ms ease, transform 160ms ease",
          opacity: loading || bootstrapping || deleting ? 0.6 : 1,
        }}
        onMouseEnter={(e) => {
          if (loading || bootstrapping || deleting) return;
          e.currentTarget.style.borderColor = "rgba(180,0,255,0.40)";
          e.currentTarget.style.background = "rgba(180,0,255,0.10)";
          e.currentTarget.style.transform = "translateY(-1px)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--btn-border)";
          e.currentTarget.style.background = "var(--btn-bg)";
          e.currentTarget.style.transform = "translateY(0)";
        }}
      >
        <LogoutIcon /> Log out
      </button>
      <button
        type="button"
        className="ts-btn ts-btnPrimary"
        onClick={handleSave}
        disabled={loading || bootstrapping}
        style={loading || bootstrapping ? { opacity: 0.6, cursor: "not-allowed" } : {}}
      >
        {loading ? "Saving…" : "Save Changes"}
      </button>
    </>
  );

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Profile"
      size="md"
      footer={footer}
    >
      {bootstrapping ? (
        <div style={{ textAlign: "center", padding: "28px 0", color: "var(--muted)", fontSize: "14px" }}>
          Loading profile…
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

          {error  && <div style={F.error}>{error}</div>}
          {saved  && (
            <div style={F.success}>
              <CheckIcon /> Profile saved successfully.
            </div>
          )}

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
            placeholder="you@example.com"
            value={form.email}
            onChange={set("email")}
            autoComplete="email"
          />

          <div style={F.divider} />

          {/* ── Location ── */}
          <div style={F.sectionLabel}>Location</div>
          <div style={F.row}>
            <Field
              label="City"
              type="text"
              placeholder="e.g. Dallas"
              value={form.city}
              onChange={set("city")}
            />
            <SelectField
              label="State"
              value={form.state}
              onChange={set("state")}
            >
              <option value="">— Select state —</option>
              {US_STATES.map(([abbr, name]) => (
                <option key={abbr} value={abbr}>{name}</option>
              ))}
            </SelectField>
          </div>

          <div style={F.divider} />

          {/* ── Role info ── */}
          <div style={F.sectionLabel}>Role & Program</div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {userMeta?.role && (
              <div style={F.readonlyPill}>
                <LockIcon /> {userMeta.role}
              </div>
            )}
            {userMeta?.programName && (
              <div style={F.readonlyPill}>
                <LockIcon /> {userMeta.programName}
              </div>
            )}
          </div>
          <div style={{ fontSize: "12px", color: "var(--muted)", opacity: 0.65, marginTop: -6 }}>
            Role and program are managed by your admin and cannot be changed here.
          </div>

          <div style={F.divider} />

          {/* ── Position + DOB ── */}
          <div style={F.sectionLabel}>Additional <span style={{ opacity: 0.5, fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>(optional)</span></div>
          <div style={F.row}>
            <SelectField
              label="Position / Title"
              value={form.position}
              onChange={set("position")}
            >
              <option value="">— Select a position —</option>
              {(userMeta?.role === "admin" ? ADMIN_POSITIONS : COACH_POSITIONS).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </SelectField>
            <Field
              label="Date of Birth"
              type="date"
              value={form.dateOfBirth}
              onChange={set("dateOfBirth")}
            />
          </div>

          <div style={F.divider} />

          {/* ── Danger zone ── */}
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
              <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--text)" }}>Delete account</div>
              <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "3px", opacity: 0.8 }}>
                Permanently removes your account and all associated data.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              style={{
                padding: "8px 14px",
                borderRadius: "10px",
                border: "1px solid rgba(255,60,60,0.35)",
                background: "rgba(255,40,40,0.08)",
                color: "rgba(255,110,110,0.95)",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: 700,
                transition: "border-color 160ms ease, background 160ms ease, transform 160ms ease",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
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
              Delete account
            </button>
          </div>

        </div>
      )}
    </Modal>

    {/* ── Delete confirmation modal ── */}
    <DeleteConfirmModal
      open={showDeleteConfirm}
      onCancel={() => { setShowDeleteConfirm(false); setDeleteInput(""); setDeleteError(""); }}
      deleteInput={deleteInput}
      setDeleteInput={setDeleteInput}
      deleteError={deleteError}
      deleting={deleting}
      onConfirm={handleDeleteAccount}
    />
    </>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M2 7l3.5 3.5L12 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={{ flexShrink: 0, opacity: 0.6 }}>
      <rect x="2" y="5" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 5V3.5a2 2 0 1 1 4 0V5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M5.5 2H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 7H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

// ─── Delete confirmation modal ────────────────────────────────────────────────

function DeleteConfirmModal({ open, onCancel, deleteInput, setDeleteInput, deleteError, deleting, onConfirm }) {
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
      title="Delete account"
      size="sm"
      closeOnBackdrop={!deleting}
      closeOnEsc={!deleting}
      footer={
        <>
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
              This action is permanent
            </div>
            <div style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.55 }}>
              Your account, profile, and all associated data will be immediately and irreversibly deleted.
              This cannot be undone.
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
            Type <span style={{ color: "rgba(255,110,110,0.9)", fontFamily: "monospace", letterSpacing: 1 }}>delete</span> to confirm
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

function WarningIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
      <path d="M10 2L18.66 17H1.34L10 2Z" stroke="rgba(255,110,110,0.9)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 8v4" stroke="rgba(255,110,110,0.9)" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="14.5" r="0.8" fill="rgba(255,110,110,0.9)" />
    </svg>
  );
}