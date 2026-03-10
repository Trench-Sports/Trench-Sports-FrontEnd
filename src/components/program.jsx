// src/components/program.jsx
//
// Trench Sports — Program Management Modal (admin only)
//
// Usage:
//   import ProgramModal from "./program";
//   <ProgramModal open={showProgram} onClose={() => setShowProgram(false)} />
//
// Features:
//   • Displays program name, location, and 6-digit onboarding code
//   • Copy-to-clipboard for the program code
//   • Lists all coaches in the program with position + team
//   • Admins can remove a coach (clears program_id on their profile + removes team_members rows)

import React, { useCallback, useEffect, useState } from "react";
import Modal from "./modal";
import { supabase } from "../supabaseClient";

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  sectionLabel: {
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--muted, rgba(255,255,255,0.45))",
    marginBottom: "6px",
  },
  divider: {
    height: "1px",
    background: "rgba(255,255,255,0.07)",
    margin: "4px 0",
  },
  error: {
    padding: "10px 13px",
    borderRadius: "12px",
    border: "1px solid rgba(255,80,80,0.30)",
    background: "rgba(255,80,80,0.08)",
    color: "rgba(255,130,130,0.95)",
    fontSize: "13px",
  },

  // Program info card
  infoCard: {
    padding: "14px 16px",
    borderRadius: "14px",
    border: "1px solid var(--panel-border, rgba(255,255,255,0.10))",
    background: "var(--panel, rgba(255,255,255,0.04))",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  infoRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
  },
  programName: {
    fontSize: "17px",
    fontWeight: 950,
    letterSpacing: "0.1px",
    color: "var(--text)",
  },
  programSub: {
    fontSize: "13px",
    color: "var(--muted)",
    marginTop: "2px",
  },

  // Code block
  codeRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 14px",
    borderRadius: "12px",
    border: "1px solid rgba(180,0,255,0.22)",
    background: "rgba(180,0,255,0.06)",
  },
  codeLabel: {
    fontSize: "12px",
    fontWeight: 700,
    color: "var(--muted)",
    whiteSpace: "nowrap",
  },
  codeValue: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: "20px",
    fontWeight: 800,
    letterSpacing: "0.25em",
    color: "var(--text)",
    flex: 1,
  },
  copyBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "7px 12px",
    borderRadius: "10px",
    border: "1px solid rgba(180,0,255,0.30)",
    background: "rgba(180,0,255,0.10)",
    color: "var(--text)",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 700,
    whiteSpace: "nowrap",
    transition: "border-color 160ms ease, background 160ms ease, transform 160ms ease, box-shadow 160ms ease",
    flexShrink: 0,
  },
  copyBtnDone: {
    borderColor: "rgba(0,200,120,0.40)",
    background: "rgba(0,200,120,0.10)",
    color: "rgba(60,220,150,0.95)",
  },

  // Coach list
  coachList: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  coachRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "11px 14px",
    borderRadius: "12px",
    border: "1px solid var(--panel-border, rgba(255,255,255,0.08))",
    background: "var(--panel, rgba(255,255,255,0.02))",
    transition: "border-color 160ms ease",
  },
  coachAvatar: {
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    background: "linear-gradient(135deg, rgba(180,0,255,0.30), rgba(180,0,255,0.60))",
    border: "1.5px solid rgba(180,0,255,0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "13px",
    fontWeight: 950,
    color: "#fff",
    flexShrink: 0,
  },
  coachMeta: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  coachName: {
    fontWeight: 700,
    fontSize: "14px",
    color: "var(--text)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  coachSub: {
    fontSize: "12px",
    color: "var(--muted)",
    opacity: 0.8,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  removeBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "30px",
    height: "30px",
    padding: 0,
    borderRadius: "8px",
    border: "1px solid rgba(255,60,60,0.20)",
    background: "rgba(255,40,40,0.05)",
    color: "rgba(255,110,110,0.70)",
    cursor: "pointer",
    flexShrink: 0,
    transition: "border-color 160ms ease, background 160ms ease, color 160ms ease, transform 160ms ease",
  },
  emptyState: {
    textAlign: "center",
    padding: "24px 0",
    color: "var(--muted)",
    fontSize: "14px",
    opacity: 0.7,
  },

  // Stats row
  statsRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "8px",
  },
  statPill: {
    padding: "10px 14px",
    borderRadius: "12px",
    border: "1px solid var(--panel-border, rgba(255,255,255,0.08))",
    background: "var(--panel, rgba(255,255,255,0.03))",
    display: "flex",
    flexDirection: "column",
    gap: "3px",
  },
  statVal: {
    fontSize: "20px",
    fontWeight: 950,
    color: "var(--text)",
  },
  statLabel: {
    fontSize: "11px",
    fontWeight: 700,
    color: "var(--muted)",
    opacity: 0.75,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
};

// ─── Remove confirmation inline banner ───────────────────────────────────────

function RemoveConfirm({ coach, onConfirm, onCancel, removing }) {
  return (
    <div style={{
      padding: "12px 14px",
      borderRadius: "12px",
      border: "1px solid rgba(255,60,60,0.28)",
      background: "rgba(255,40,40,0.06)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      flexWrap: "wrap",
    }}>
      <div style={{ fontSize: "13px", color: "var(--text)", lineHeight: 1.45 }}>
        Remove <strong>{coach.name}</strong> from this program?
        <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
          They'll lose access and can rejoin with the program code.
        </div>
      </div>
      <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={removing}
          style={{
            padding: "6px 12px", borderRadius: "8px",
            border: "1px solid var(--btn-border)", background: "var(--btn-bg)",
            color: "var(--text)", cursor: "pointer", fontSize: "13px", fontWeight: 700,
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={removing}
          style={{
            padding: "6px 12px", borderRadius: "8px",
            border: "1px solid rgba(255,60,60,0.40)",
            background: "rgba(200,30,30,0.80)",
            color: "#fff", cursor: removing ? "not-allowed" : "pointer",
            fontSize: "13px", fontWeight: 800,
            opacity: removing ? 0.6 : 1,
          }}
        >
          {removing ? "Removing…" : "Remove"}
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProgramModal({ open, onClose }) {
  const [program, setProgram]         = useState(null);
  const [coaches, setCoaches]         = useState([]);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [error, setError]             = useState("");
  const [copied, setCopied]           = useState(false);

  // Inline remove flow
  const [confirmId, setConfirmId]     = useState(null); // coach user_id pending confirm
  const [removing, setRemoving]       = useState(false);
  const [removeError, setRemoveError] = useState("");

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  const bootstrap = useCallback(async () => {
    if (!supabase) return;
    setBootstrapping(true);
    setError("");
    setRemoveError("");
    setConfirmId(null);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) throw new Error("Not authenticated.");

      // Get current user's program_id
      const { data: me, error: meErr } = await supabase
        .from("profiles")
        .select("program_id, role")
        .eq("user_id", userId)
        .maybeSingle();

      if (meErr) throw meErr;
      if (!me?.program_id) throw new Error("No program found for your account.");
      if (me.role !== "admin") throw new Error("Only admins can manage the program.");

      // Fetch program details
      const { data: prog, error: progErr } = await supabase
        .from("programs")
        .select("id, name, location, onboarding_code, max_coaches, max_athletes")
        .eq("id", me.program_id)
        .single();

      if (progErr) throw progErr;
      setProgram(prog);

      // Fetch all coaches in the program
      const { data: coachRows, error: coachErr } = await supabase
        .from("profiles")
        .select("user_id, first_name, last_name, position, email, city, state")
        .eq("program_id", me.program_id)
        .eq("role", "coach")
        .order("first_name");

      if (coachErr) throw coachErr;

      // Fetch team membership to show which team each coach is on
      const coachIds = (coachRows ?? []).map((c) => c.user_id);
      let teamMap = {};

      if (coachIds.length > 0) {
        const { data: memberships } = await supabase
          .from("team_members")
          .select("coach_user_id, teams(name)")
          .in("coach_user_id", coachIds)
          .eq("program_id", me.program_id);

        (memberships ?? []).forEach((m) => {
          teamMap[m.coach_user_id] = m.teams?.name ?? null;
        });
      }

      setCoaches(
        (coachRows ?? []).map((c) => ({
          userId:   c.user_id,
          name:     [c.first_name, c.last_name].filter(Boolean).join(" ") || "—",
          initials: [c.first_name, c.last_name].filter(Boolean).map((w) => w[0]?.toUpperCase()).join("") || "?",
          position: c.position ?? "",
          email:    c.email ?? "",
          location: [c.city, c.state].filter(Boolean).join(", "),
          team:     teamMap[c.user_id] ?? null,
        }))
      );
    } catch (err) {
      setError(err.message ?? "Failed to load program.");
    } finally {
      setBootstrapping(false);
    }
  }, []);

  useEffect(() => {
    if (open) bootstrap();
  }, [open, bootstrap]);

  // ── Copy code ──────────────────────────────────────────────────────────────

  function handleCopy() {
    if (!program?.onboarding_code) return;
    navigator.clipboard.writeText(program.onboarding_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  }

  // ── Remove coach ───────────────────────────────────────────────────────────

  async function handleRemove(coachUserId) {
    if (!supabase || !program) return;
    setRemoving(true);
    setRemoveError("");

    try {
      // 1. Remove all team_member rows for this coach in the program
      const { error: tmErr } = await supabase
        .from("team_members")
        .delete()
        .eq("coach_user_id", coachUserId)
        .eq("program_id", program.id);

      if (tmErr) throw tmErr;

      // 2. Detach coach from program (null out program_id on their profile)
      const { error: profErr } = await supabase
        .from("profiles")
        .update({ program_id: null })
        .eq("user_id", coachUserId);

      if (profErr) throw profErr;

      // Optimistically remove from local list
      setCoaches((prev) => prev.filter((c) => c.userId !== coachUserId));
      setConfirmId(null);
    } catch (err) {
      setRemoveError(err.message ?? "Failed to remove coach.");
    } finally {
      setRemoving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const footer = (
    <button type="button" className="ts-btn ts-btnGhost" onClick={onClose}>
      Close
    </button>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manage Program"
      size="md"
      footer={footer}
    >
      {bootstrapping ? (
        <div style={{ textAlign: "center", padding: "28px 0", color: "var(--muted)", fontSize: "14px" }}>
          Loading program…
        </div>
      ) : error ? (
        <div style={S.error}>{error}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* ── Program info ── */}
          <div style={S.infoCard}>
            <div style={S.infoRow}>
              <div>
                <div style={S.programName}>{program?.name ?? "—"}</div>
                {program?.location && (
                  <div style={S.programSub}>
                    <LocationDot /> {program.location}
                  </div>
                )}
              </div>
              {/* Stats */}
              <div style={{ display: "flex", gap: "8px" }}>
                <StatChip value={coaches.length} label="Coaches" />
                {program?.max_coaches && (
                  <StatChip value={program.max_coaches} label="Max coaches" muted />
                )}
              </div>
            </div>

            {/* Code row */}
            <div style={S.codeRow}>
              <div style={S.codeLabel}>Program code</div>
              <div style={S.codeValue}>{program?.onboarding_code ?? "——————"}</div>
              <button
                type="button"
                style={{ ...S.copyBtn, ...(copied ? S.copyBtnDone : {}) }}
                onClick={handleCopy}
                onMouseEnter={(e) => {
                  if (!copied) {
                    e.currentTarget.style.background = "rgba(180,0,255,0.18)";
                    e.currentTarget.style.transform = "translateY(-1px)";
                    e.currentTarget.style.boxShadow = "0 0 0 2px rgba(180,0,255,0.10)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = copied ? "rgba(0,200,120,0.10)" : "rgba(180,0,255,0.10)";
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "none";
                }}
                aria-label="Copy program code to clipboard"
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          <div style={S.divider} />

          {/* ── Coaches ── */}
          <div style={S.sectionLabel}>
            Coaches ({coaches.length})
          </div>

          {removeError && <div style={S.error}>{removeError}</div>}

          {coaches.length === 0 ? (
            <div style={S.emptyState}>No coaches in this program yet.</div>
          ) : (
            <div style={S.coachList}>
              {coaches.map((coach) => (
                <React.Fragment key={coach.userId}>
                  <div style={S.coachRow}>
                    {/* Avatar */}
                    <div style={S.coachAvatar}>{coach.initials}</div>

                    {/* Info */}
                    <div style={S.coachMeta}>
                      <div style={S.coachName}>{coach.name}</div>
                      <div style={S.coachSub}>
                        {[coach.position, coach.team, coach.location]
                          .filter(Boolean)
                          .join(" · ") || coach.email || "—"}
                      </div>
                    </div>

                    {/* Remove button */}
                    <button
                      type="button"
                      style={S.removeBtn}
                      onClick={() => {
                        setConfirmId(confirmId === coach.userId ? null : coach.userId);
                        setRemoveError("");
                      }}
                      aria-label={`Remove ${coach.name}`}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "rgba(255,40,40,0.12)";
                        e.currentTarget.style.borderColor = "rgba(255,60,60,0.40)";
                        e.currentTarget.style.color = "rgba(255,110,110,0.95)";
                        e.currentTarget.style.transform = "translateY(-1px)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "rgba(255,40,40,0.05)";
                        e.currentTarget.style.borderColor = "rgba(255,60,60,0.20)";
                        e.currentTarget.style.color = "rgba(255,110,110,0.70)";
                        e.currentTarget.style.transform = "translateY(0)";
                      }}
                    >
                      <RemoveIcon />
                    </button>
                  </div>

                  {/* Inline confirmation */}
                  {confirmId === coach.userId && (
                    <RemoveConfirm
                      coach={coach}
                      removing={removing}
                      onCancel={() => { setConfirmId(null); setRemoveError(""); }}
                      onConfirm={() => handleRemove(coach.userId)}
                    />
                  )}
                </React.Fragment>
              ))}
            </div>
          )}

        </div>
      )}
    </Modal>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function StatChip({ value, label, muted }) {
  return (
    <div style={{
      ...S.statPill,
      opacity: muted ? 0.6 : 1,
      minWidth: "70px",
    }}>
      <div style={S.statVal}>{value}</div>
      <div style={S.statLabel}>{label}</div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 4V2.5A1.5 1.5 0 0 0 8.5 1h-6A1.5 1.5 0 0 0 1 2.5v6A1.5 1.5 0 0 0 2.5 10H4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 7l3.5 3.5L12 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function LocationDot() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={{ display: "inline", marginRight: 3, verticalAlign: "middle" }}>
      <path d="M6 1a3.5 3.5 0 0 1 3.5 3.5C9.5 7.5 6 11 6 11S2.5 7.5 2.5 4.5A3.5 3.5 0 0 1 6 1Z" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <circle cx="6" cy="4.5" r="1.1" fill="currentColor" />
    </svg>
  );
}