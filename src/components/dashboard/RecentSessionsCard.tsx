// src/components/dashboard/RecentSessionsCard.tsx
//
// Recent Sessions card on the coach dashboards: athlete and mode filters, the
// paged session list with the athlete avatar popover, and the empty / loading
// / error states. Shared by the desktop and mobile dashboard pages.
import { Skel } from "./Skel";
import { ModeIcon } from "../modeIcon";
import { IconBoxingGlove } from "../icons";
import type { CoachDashboard } from "../../hooks/useCoachDashboard";

type Props = {
  dash: CoachDashboard;
  // "fill": one row of equal-width pills with mode icons (desktop).
  // "wrap": pills wrap to a second line on narrow widths, no icons (mobile).
  modePills: "fill" | "wrap";
  // Where the empty state's "Session page" link goes.
  sessionPath: string;
};

export function RecentSessionsCard({ dash, modePills, sessionPath }: Props) {
  const {
    SESSION_PAGE_SIZE,
    accuracyRows,
    analysisCardRef,
    avatarPopover,
    filteredSessions,
    formatSessionTime,
    isDark,
    navigate,
    pagedSessions,
    reactionRows,
    recentSessions,
    recentSessionsError,
    recentSessionsLoading,
    resetReplay,
    selectedSessionId,
    sessionAthleteFilter,
    sessionAthletes,
    sessionModeFilter,
    sessionPage,
    setAnalysisAthleteId,
    setAnalysisAthleteName,
    setAnalysisSection,
    setAvatarPopover,
    setSelectedSessionId,
    setSessionAthleteFilter,
    setSessionModeFilter,
    setSessionPage,
    strengthRows,
    totalSessionPages,
  } = dash;
  const wrapPills = modePills === "wrap";

  return (
    <div className="ts-card">
      <div className="ts-cardTop">
        <div className="ts-cardTitle">Recent Sessions</div>
        <div className="ts-cardMeta">
          {recentSessionsLoading ? "Loading…" : filteredSessions.length > 0 ? `${sessionPage * SESSION_PAGE_SIZE + 1}–${Math.min((sessionPage + 1) * SESSION_PAGE_SIZE, filteredSessions.length)} of ${filteredSessions.length}` : "0 sessions"}
        </div>
      </div>

      {/* Filters row */}
      {!recentSessionsLoading && recentSessions.length > 0 && (() => {
        // Theme-adaptive colour tokens — all filter chrome derives from these
        const ink       = isDark ? "255,255,255" : "20,20,40";
        const subtleBg  = isDark ? `rgba(${ink},0.04)`  : `rgba(${ink},0.05)`;
        const subtleBdr = isDark ? `rgba(${ink},0.12)`  : `rgba(${ink},0.14)`;
        const idleFg    = isDark ? `rgba(${ink},0.45)`  : `rgba(${ink},0.45)`;
        const activeFg  = isDark ? `rgba(${ink},0.95)`  : `rgba(${ink},0.92)`;
        const activeBg  = isDark ? `rgba(${ink},0.10)`  : `rgba(${ink},0.09)`;
        const activeBdr = isDark ? `rgba(${ink},0.30)`  : `rgba(${ink},0.28)`;
        const clearFg   = isDark ? `rgba(${ink},0.40)`  : `rgba(${ink},0.40)`;
        const clearFgHover = isDark ? `rgba(${ink},0.70)` : `rgba(${ink},0.72)`;
        const clearBdr     = isDark ? `rgba(${ink},0.14)` : `rgba(${ink},0.16)`;
        const clearBdrHover= isDark ? `rgba(${ink},0.28)` : `rgba(${ink},0.30)`;


        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>

            {/* ── Row 1: Athlete dropdown + optional Clear ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>

              {/* Athlete dropdown — fills remaining space */}
              <div style={{ position: "relative", display: "flex", flex: 1, minWidth: 0 }}>
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"
                  style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", opacity: 0.55, flexShrink: 0 }}>
                  <circle cx="7" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M2 12c0-2.761 2.239-4 5-4s5 1.239 5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
                <select
                  value={sessionAthleteFilter}
                  onChange={(e) => setSessionAthleteFilter(e.target.value)}
                  style={{
                    width: "100%",
                    background: sessionAthleteFilter !== "all" ? "rgba(180,0,255,0.14)" : subtleBg,
                    border: sessionAthleteFilter !== "all"
                      ? "1px solid rgba(180,0,255,0.45)"
                      : `1px solid ${subtleBdr}`,
                    borderRadius: 10,
                    color: sessionAthleteFilter !== "all" ? "rgba(210,140,255,0.95)" : "inherit",
                    font: "inherit",
                    fontSize: 12,
                    fontWeight: 700,
                    padding: "7px 14px 7px 30px",
                    cursor: "pointer",
                    outline: "none",
                    appearance: "none",
                    boxSizing: "border-box",
                    boxShadow: sessionAthleteFilter !== "all" ? "0 0 0 1px rgba(180,0,255,0.2)" : "none",
                    transition: "background 150ms ease, border-color 150ms ease, color 150ms ease, box-shadow 150ms ease",
                  }}
                >
                  <option value="all">All Athletes</option>
                  {sessionAthletes.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>

              {/* Clear button — only when a filter is active */}
              {(sessionModeFilter !== "all" || sessionAthleteFilter !== "all") && (
                <button
                  type="button"
                  onClick={() => { setSessionModeFilter("all"); setSessionAthleteFilter("all"); }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    flexShrink: 0,
                    background: "transparent",
                    border: `1px solid ${clearBdr}`,
                    borderRadius: 10,
                    color: clearFg,
                    font: "inherit",
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "7px 11px",
                    cursor: "pointer",
                    letterSpacing: "0.04em",
                    transition: "color 140ms ease, border-color 140ms ease",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = clearFgHover;
                    (e.currentTarget as HTMLButtonElement).style.borderColor = clearBdrHover;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = clearFg;
                    (e.currentTarget as HTMLButtonElement).style.borderColor = clearBdr;
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                    <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                  Clear
                </button>
              )}
            </div>

            {/* ── Row 2: Mode pills — equal-width cells. "fill" keeps them on one
                row with mode icons; "wrap" lets them wrap to a second
                line on narrow widths so longer labels like "Accuracy" /
                "Reaction" / "Target" never clip. The gap shorthand
                applies vertically between wrapped rows too. */}
            <div style={{
              display: "flex",
              flexWrap: wrapPills ? "wrap" : undefined,
              width: "100%",
              background: subtleBg,
              border: `1px solid ${subtleBdr}`,
              borderRadius: 10,
              padding: 3,
              gap: wrapPills ? 3 : 2,
              boxSizing: "border-box",
            }}>
              {([
                { value: "all",      label: "All",      mode: null },
                { value: "power",    label: "Power",    mode: "power" },
                { value: "accuracy", label: "Accuracy", mode: "accuracy" },
                { value: "reaction", label: "Reaction", mode: "reaction" },
                { value: "volume",   label: "Volume",   mode: "volume" },
                { value: "target",   label: "Target",   mode: "target" },
              ] as { value: string; label: string; mode: string | null }[]).map(({ value, label, mode }) => {
                const isActive   = sessionModeFilter === value;
                const isAccented = isActive && value !== "all";
                const accentColor = value === "accuracy" ? "#00dcff" : value === "reaction" ? "#ffcc00" : value === "volume" ? "#ff6a00" : value === "target" ? "#00ff88" : "#b400ff";
                const accentBg    = value === "accuracy" ? "rgba(0,220,255,0.14)"  : value === "reaction" ? "rgba(255,200,0,0.14)"  : value === "volume" ? "rgba(255,106,0,0.14)"  : value === "target" ? "rgba(0,255,136,0.14)"  : "rgba(180,0,255,0.18)";
                const accentBdr   = value === "accuracy" ? "rgba(0,220,255,0.40)"  : value === "reaction" ? "rgba(255,200,0,0.38)"  : value === "volume" ? "rgba(255,106,0,0.40)"  : value === "target" ? "rgba(0,255,136,0.38)"  : "rgba(180,0,255,0.45)";
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSessionModeFilter(value)}
                    style={{
                      // "fill": equal width regardless of label length.
                      // "wrap": a min basis of 78px keeps "Accuracy"/"Reaction"
                      // legible; when the card is wider than ~6×78px the pills
                      // share the row equally, below that the row wraps.
                      flex: wrapPills ? "1 1 78px" : "1 1 0",
                      minWidth: 0,             // allow shrinking below content size
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      padding: wrapPills ? "6px 6px" : "6px 4px",
                      borderRadius: 7,
                      border: isActive
                        ? `1px solid ${isAccented ? accentBdr : activeBdr}`
                        : "1px solid transparent",
                      background: isActive
                        ? (isAccented ? accentBg : activeBg)
                        : "transparent",
                      color: isActive
                        ? (isAccented ? accentColor : activeFg)
                        : idleFg,
                      font: "inherit",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      letterSpacing: "0.01em",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      transition: "background 140ms ease, color 140ms ease, border-color 140ms ease",
                    }}
                  >
                    {!wrapPills && (
                      <span className="ts-filterModeIcon" style={{ lineHeight: 0, flexShrink: 0 }}>
                        {mode ? <ModeIcon mode={mode} size={12} /> : null}
                      </span>
                    )}
                    <span className="ts-filterModeLabel">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {recentSessionsError ? (
        <div className="ts-athleteError">{recentSessionsError}</div>
      ) : recentSessionsLoading ? (
        <div className="ts-recentSessionsList" style={{ gap: 6 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 2px" }}>
              <Skel w={36} h={36} r={50} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                <Skel w={`${55 + (i % 3) * 15}%`} h={12} />
                <Skel w="38%" h={10} />
              </div>
              <Skel w={68} h={24} r={999} />
              <Skel w={14} h={14} r={4} />
            </div>
          ))}
        </div>
      ) : recentSessions.length === 0 ? (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: "36px 16px",
          textAlign: "center",
        }}>
          <div style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "rgba(180,0,255,0.10)",
            border: "1px solid rgba(180,0,255,0.22)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(180,0,255,0.75)",
          }}>
            <IconBoxingGlove size={24} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 5 }}>No sessions yet</div>
            <div style={{ fontSize: 12, opacity: 0.50, lineHeight: 1.5, maxWidth: 220 }}>
              Head to the{" "}
              <button
                type="button"
                onClick={() => navigate(sessionPath)}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: "rgba(180,0,255,0.90)",
                  fontWeight: 700,
                  fontSize: "inherit",
                  cursor: "pointer",
                  textDecoration: "underline",
                  textUnderlineOffset: 2,
                }}
              >
                Session page
              </button>
              {" "}to record your first session with an athlete.
            </div>
          </div>
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="ts-athleteEmpty">No sessions match the selected filters.</div>
      ) : (
        <>
          {/* ── Avatar popover ── */}
          {avatarPopover && (() => {
            const session = recentSessions.find(s => s.id === avatarPopover.sessionId);
            if (!session?.athleteId) return null;

            const athleteId = session.athleteId;
            const fullName  = `${session.athleteFirstName} ${session.athleteLastName}`.trim();

            // Pull stats from existing leaderboard data
            const strengthRow = strengthRows.find(r => r.athleteId === athleteId);
            const reactionRow = reactionRows.find(r => r.athleteId === athleteId);
            const accuracyRow = accuracyRows.find(r => r.athleteId === athleteId);

            // Count sessions + last session from recentSessions
            const athleteSessions = recentSessions.filter(s => s.athleteId === athleteId);
            const sessionCount    = athleteSessions.length;
            const lastSession     = athleteSessions[0]; // already sorted newest first

            const ink    = isDark ? "255,255,255" : "20,20,40";
            const bg     = isDark ? "rgba(18,10,28,0.97)" : "rgba(255,255,255,0.98)";
            const border = isDark ? "rgba(180,0,255,0.35)" : "rgba(20,20,40,0.14)";

            return (
              <div
                onMouseEnter={() => {/* keep open while hovering popover */}}
                onMouseLeave={() => setAvatarPopover(null)}
                style={{
                  position: "fixed",
                  left: Math.min(avatarPopover.x + 12, window.innerWidth - 240),
                  top:  Math.min(avatarPopover.y - 8, window.innerHeight - 220),
                  zIndex: 9999,
                  width: 224,
                  borderRadius: 12,
                  background: bg,
                  border: `1px solid ${border}`,
                  boxShadow: isDark
                    ? "0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(180,0,255,0.12)"
                    : "0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)",
                  backdropFilter: "blur(16px)",
                  overflow: "hidden",
                  pointerEvents: "auto",
                  animation: "tsPopoverIn 120ms ease",
                }}
              >
                {/* Header */}
                <div style={{ padding: "11px 13px 9px", borderBottom: `1px solid rgba(${ink},0.07)`, display: "flex", alignItems: "center", gap: 9 }}>
                  <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg, rgba(180,0,255,0.30), rgba(180,0,255,0.12))", border: "1px solid rgba(180,0,255,0.35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "rgba(210,140,255,0.95)", flexShrink: 0 }}>
                    {session.athleteFirstName[0]}{session.athleteLastName[0]}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: `rgba(${ink},0.92)` }}>{fullName}</div>
                    <div style={{ fontSize: 10, opacity: 0.45, marginTop: 1 }}>
                      {sessionCount} session{sessionCount !== 1 ? "s" : ""}{lastSession ? ` · ${formatSessionTime(lastSession.timestamp)}` : ""}
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div style={{ padding: "8px 13px 10px", display: "flex", flexDirection: "column", gap: 5 }}>
                  {strengthRow ? (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, opacity: 0.50, display: "inline-flex", alignItems: "center", gap: 5 }}><ModeIcon mode="power" size={12} />Peak strength</span>
                      <span style={{ fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "rgba(180,0,255,0.90)" }}>{strengthRow.peakIndex} <span style={{ fontSize: 10, opacity: 0.45 }}>/1000</span></span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, opacity: 0.50, display: "inline-flex", alignItems: "center", gap: 5 }}><ModeIcon mode="power" size={12} />Strength</span>
                      <span style={{ fontSize: 11, opacity: 0.30 }}>no data</span>
                    </div>
                  )}
                  {reactionRow ? (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, opacity: 0.50, display: "inline-flex", alignItems: "center", gap: 5 }}><ModeIcon mode="reaction" size={12} />Avg reaction</span>
                      <span style={{ fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "rgba(255,210,60,0.95)" }}>{reactionRow.avgReactionMs} <span style={{ fontSize: 10, opacity: 0.45 }}>ms</span></span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, opacity: 0.50, display: "inline-flex", alignItems: "center", gap: 5 }}><ModeIcon mode="reaction" size={12} />Reaction</span>
                      <span style={{ fontSize: 11, opacity: 0.30 }}>no data</span>
                    </div>
                  )}
                  {accuracyRow ? (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, opacity: 0.50, display: "inline-flex", alignItems: "center", gap: 5 }}><ModeIcon mode="accuracy" size={12} />Accuracy</span>
                      <span style={{ fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "rgba(80,220,255,0.95)" }}>{accuracyRow.accuracyPct}<span style={{ fontSize: 10, opacity: 0.45 }}>%</span></span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, opacity: 0.50, display: "inline-flex", alignItems: "center", gap: 5 }}><ModeIcon mode="accuracy" size={12} />Accuracy</span>
                      <span style={{ fontSize: 11, opacity: 0.30 }}>no data</span>
                    </div>
                  )}
                </div>

                {/* CTA */}
                <div style={{ padding: "0 13px 11px" }}>
                  <div style={{ fontSize: 10, opacity: 0.38, textAlign: "center", paddingTop: 6, borderTop: `1px solid rgba(${ink},0.06)` }}>
                    Click avatar to open full analysis ↓
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="ts-recentSessionsList">
            {pagedSessions.map((session) => (
              <div
                key={session.id}
                className={`ts-recentSessionRow${selectedSessionId === session.id ? " isSelected" : ""}`}
                onClick={() => {
                  setSelectedSessionId(session.id);
                  resetReplay();
                }}
              >
                {/* Avatar — hover for popover, click to jump to analysis */}
                <div
                  className="ts-recentSessionAvatar"
                  style={{ cursor: session.athleteId ? "pointer" : "default", position: "relative" }}
                  onMouseEnter={(e) => {
                    if (!session.athleteId) return;
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setAvatarPopover({ sessionId: session.id, x: rect.right, y: rect.top });
                  }}
                  onMouseLeave={() => setAvatarPopover(null)}
                  onClick={(e) => {
                    if (!session.athleteId) return;
                    e.stopPropagation();
                    const athleteName = `${session.athleteFirstName} ${session.athleteLastName}`.trim();
                    setAnalysisAthleteId(session.athleteId);
                    setAnalysisAthleteName(athleteName);
                    setAnalysisSection("power");
                    setAvatarPopover(null);
                    // Double rAF — first frame commits state, second frame paints, then scroll
                    requestAnimationFrame(() => requestAnimationFrame(() => {
                      analysisCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }));
                  }}
                >
                  {session.athleteFirstName[0]}{session.athleteLastName[0]}
                </div>
                {/* Info: desktop = [text | mode-pill] row; mobile = stacked */}
                <div className="ts-recentSessionInfo">
                  <div className="ts-recentSessionText">
                    <div className="ts-recentSessionAthlete">
                      {session.athleteFirstName} {session.athleteLastName}
                    </div>
                    <div className="ts-recentSessionMeta">{formatSessionTime(session.timestamp)}</div>
                  </div>
                  <div
                    className="ts-recentSessionMode"
                    style={(() => {
                      const m = (session.mode ?? "power").toLowerCase();
                      const color = m === "accuracy" ? "#00dcff" : m === "reaction" ? "#ffcc00" : m === "volume" ? "#ff6a00" : m === "target" ? "#00ff88" : "#b400ff";
                      return { background: `${color}14`, border: `1px solid ${color}44`, color };
                    })()}
                  >
                    {(() => {
                      const m = (session.mode ?? "power").toLowerCase();
                      return (
                        <>
                          <ModeIcon mode={m} size={11} style={{ marginRight: 5 }} />
                          {m.charAt(0).toUpperCase() + m.slice(1)}
                        </>
                      );
                    })()}
                  </div>
                </div>
                <div className="ts-recentSessionChevron">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>
            ))}
          </div>

          {/* ── Pagination ── */}
          {totalSessionPages > 1 && (
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 12,
              paddingTop: 12,
              borderTop: `1px solid ${isDark ? "rgba(255,255,255,0.07)" : "rgba(20,20,40,0.08)"}`,
            }}>
              <button
                type="button"
                disabled={sessionPage === 0}
                onClick={() => setSessionPage((p) => p - 1)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  borderRadius: 9,
                  border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(20,20,40,0.14)"}`,
                  background: "transparent",
                  color: sessionPage === 0
                    ? (isDark ? "rgba(255,255,255,0.20)" : "rgba(20,20,40,0.22)")
                    : (isDark ? "rgba(255,255,255,0.75)" : "rgba(20,20,40,0.75)"),
                  font: "inherit",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: sessionPage === 0 ? "not-allowed" : "pointer",
                  opacity: sessionPage === 0 ? 0.45 : 1,
                  transition: "color 140ms ease, background 140ms ease, border-color 140ms ease",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Previous
              </button>

              {/* Page dots */}
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                {Array.from({ length: totalSessionPages }).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSessionPage(i)}
                    style={{
                      width: i === sessionPage ? 20 : 7,
                      height: 7,
                      borderRadius: 999,
                      border: "none",
                      background: i === sessionPage
                        ? "#b400ff"
                        : (isDark ? "rgba(255,255,255,0.18)" : "rgba(20,20,40,0.18)"),
                      cursor: "pointer",
                      padding: 0,
                      transition: "width 200ms ease, background 200ms ease",
                    }}
                    aria-label={`Page ${i + 1}`}
                  />
                ))}
              </div>

              <button
                type="button"
                disabled={sessionPage >= totalSessionPages - 1}
                onClick={() => setSessionPage((p) => p + 1)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  borderRadius: 9,
                  border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(20,20,40,0.14)"}`,
                  background: "transparent",
                  color: sessionPage >= totalSessionPages - 1
                    ? (isDark ? "rgba(255,255,255,0.20)" : "rgba(20,20,40,0.22)")
                    : (isDark ? "rgba(255,255,255,0.75)" : "rgba(20,20,40,0.75)"),
                  font: "inherit",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: sessionPage >= totalSessionPages - 1 ? "not-allowed" : "pointer",
                  opacity: sessionPage >= totalSessionPages - 1 ? 0.45 : 1,
                  transition: "color 140ms ease, background 140ms ease, border-color 140ms ease",
                }}
              >
                Next
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
