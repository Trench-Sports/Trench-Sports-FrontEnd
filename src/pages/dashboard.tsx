// src/pages/dashboard.tsx
import React, { useEffect, useRef, useState } from "react";
import ProfileHeader, { Profile } from "../components/profileHeader";
import CreateAthleteModal from "../components/createAthlete";
import EditAthleteModal from "../components/editAthlete";
import EditProfileModal from "../components/editProfile";
import ProgramModal from "../components/program";
import ManageTeamModal from "../components/manageTeam";
import ImportRosterModal from "../components/importRoster";
import ExportSessionsModal from "../components/exportSessionsModal";
import { IconDownload, IconGauge, IconBullseye, IconStopwatch, IconTrendUp, IconBarChart, IconBoxingGlove, IconRocket, IconTrophy } from "../components/icons";
import { ModeIcon } from "../components/modeIcon";
import { LockedPanel, LockBadge, LapsedBanner, TrialBanner, RetainedDataNotice, SampleTable, SAMPLE_IMPROVED_ROWS, SAMPLE_TEAM_ROWS, SAMPLE_INSIGHT_CARDS } from "../components/lockedFeature";
import {
  useCoachDashboard,
  type Athlete,
  type Team,
  type TabKey,
  type MetricKey,
  type ModeTrend,
  type LeaderDateRange,
  type ChartMetric,
  type CompareMode,
  type ChartEntity,
  type WeekPoint,
} from "../hooks/useCoachDashboard";
import { SessionHeatmapCard } from "../components/dashboard/SessionHeatmapCard";
import { Skel } from "../components/dashboard/Skel";

// Ranges the program's history window actually covers. Offering "All time"
// to a Tier I program would silently return 30 days and read as a bug.
function desktopLeaderRanges(days: number | null): LeaderDateRange[] {
  if (days === null) return ["all", 90, 30];
  if (days >= 90) return [90, 30];
  return [30];
}

export default function Dashboard() {
  const dash = useCoachDashboard({
    leaderRangesFor: desktopLeaderRanges,
    leaderRangeDefault: "all",
  });
  const {
    navigate,
    ent,
    retained,
    activeTab,
    setActiveTab,
    showCreateAthlete,
    setShowCreateAthlete,
    editAthleteTarget,
    setEditAthleteTarget,
    showCreateTeam,
    setShowCreateTeam,
    selectedTeam,
    setSelectedTeam,
    showEditProfile,
    setShowEditProfile,
    showProgram,
    setShowProgram,
    profile,
    setProfile,
    programId,
    userRole,
    coreTeamId,
    currentUserId,
    athletes,
    setAthletes,
    athletesLoading,
    setAthletesLoading,
    athletesError,
    athleteFilter,
    setAthleteFilter,
    athleteProgressMap,
    athleteProgressLoading,
    athleteModeStatsMap,
    teams,
    setTeams,
    teamsLoading,
    teamsError,
    hits,
    series,
    recentSessions,
    recentSessionsLoading,
    recentSessionsError,
    selectedSessionId,
    setSelectedSessionId,
    replaySpeed,
    resetReplay,
    formatSessionTime,
    insights,
    leaderDateRange,
    setLeaderDateRange,
    availableRanges,
    leaderMetric,
    setLeaderMetric,
    strengthRows,
    reactionRows,
    accuracyRows,
    volumeInsightRows,
    targetInsightRows,
    strengthLoading,
    reactionLoading,
    accuracyLoading,
    teamLeaderMetric,
    setTeamLeaderMetric,
    teamLeaderRows,
    teamLeaderLoading,
    teamImprovedMetric,
    setTeamImprovedMetric,
    teamImprovedRows,
    teamImprovedLoading,
    coachInsights,
    isDark,
    sessionModeFilter,
    setSessionModeFilter,
    sessionAthleteFilter,
    setSessionAthleteFilter,
    sessionPage,
    setSessionPage,
    SESSION_PAGE_SIZE,
    goToSessionsForAthlete,
    sessionAthletes,
    analysisAthleteId,
    setAnalysisAthleteId,
    analysisAthleteName,
    setAnalysisAthleteName,
    analysisSessions,
    setAnalysisSessions,
    analysisLoading,
    analysisSection,
    setAnalysisSection,
    radarWindow,
    setRadarWindow,
    analysisCardRef,
    avatarPopover,
    setAvatarPopover,
    analysisAthleteOptions,
    athleteAnalysis,
    filteredSessions,
    totalSessionPages,
    pagedSessions,
    athleteImprovedMetric,
    setAthleteImprovedMetric,
    athleteImprovedRows,
    athleteImprovedLoading,
    chartMetric,
    setChartMetric,
    compareMode,
    setCompareMode,
    chartEntityA,
    setChartEntityA,
    chartEntityB,
    setChartEntityB,
    chartDataA,
    chartDataB,
    chartLoadingA,
    chartLoadingB,
    chartHoverIdx,
    setChartHoverIdx,
    chartEntityOptionsFor,
  } = dash;

  const [showImportRoster, setShowImportRoster] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const athleteListRef = useRef<HTMLDivElement>(null);
  const [athleteListFade, setAthleteListFade] = useState<{ top: boolean; bottom: boolean }>({ top: false, bottom: true });

  const handleAthleteListScroll = () => {
    const el = athleteListRef.current;
    if (!el) return;
    const top = el.scrollTop > 8;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 8;
    setAthleteListFade({ top, bottom });
  };


  const tabBtn = (key: TabKey, label: string) => (
    <button
      key={key}
      type="button"
      className={`ts-tabBtn ${activeTab === key ? "isActive" : ""}`}
      onClick={() => setActiveTab(key)}
    >
      {label}
    </button>
  );


  return (
    <div className="ts-dash">
      <CreateAthleteModal
        open={showCreateAthlete}
        onClose={() => setShowCreateAthlete(false)}
        onCreated={(athlete: any) => {
          console.log("[dashboard] Athlete created:", athlete);
          // Append to the list immediately if the athletes tab is active
          setAthletes((prev) => [...prev, athlete as Athlete].sort((a, b) =>
            a.last_name.localeCompare(b.last_name)
          ));
        }}
      />

      <EditAthleteModal
        open={Boolean(editAthleteTarget)}
        athlete={editAthleteTarget}
        onClose={() => setEditAthleteTarget(null)}
        onSaved={(updated: any) => {
          // Merge the updated fields back into the athletes list in place
          setAthletes((prev) =>
            prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a))
          );
          setEditAthleteTarget(null);
        }}
        onDeleted={(deletedId: any) => {
          // Drop the athlete from local state. Team member counts will
          // refresh on the next teams fetch (they're derived from a join).
          setAthletes((prev) => prev.filter((a) => a.id !== deletedId));
          setEditAthleteTarget(null);
        }}
      />

      <ManageTeamModal
        open={showCreateTeam || Boolean(selectedTeam)}
        onClose={() => { setShowCreateTeam(false); setSelectedTeam(null); }}
        team={selectedTeam}
        onSaved={(saved: any) => {
          if (selectedTeam) {
            // Update in place
            setTeams((prev) => prev.map((t) => t.id === saved.id ? { ...t, ...saved, member_count: t.member_count } : t));
          } else {
            // Append new and re-sort
            setTeams((prev) => [...prev, saved].sort((a, b) => a.name.localeCompare(b.name)));
          }
          setShowCreateTeam(false);
          setSelectedTeam(null);
        }}
      />

      <EditProfileModal
        open={showEditProfile}
        onClose={() => setShowEditProfile(false)}
        onSaved={(updated: any) => setProfile(updated)}
      />

      <ProgramModal
        open={showProgram}
        onClose={() => setShowProgram(false)}
      />

      {userRole === "admin" && (
        <ImportRosterModal
          open={showImportRoster}
          onClose={() => setShowImportRoster(false)}
          onImported={(count) => {
            console.log(`[dashboard] Imported ${count} athletes`);
            // If the athletes tab is already open, trigger a re-fetch by
            // briefly resetting athletesLoading — the useEffect re-runs
            // whenever activeTab === "athletes", so switching away and back
            // is the cleanest way to force a fresh query.
            if (activeTab === "athletes") {
              setAthletes([]);
              setAthletesLoading(true);
            }
          }}
          programId={programId}
          userId={currentUserId}
        />
      )}

      <ExportSessionsModal
        open={showExport}
        onClose={() => setShowExport(false)}
        programId={programId}
        userRole={userRole}
        coreTeamId={coreTeamId}
        athletes={athletes}
      />

      {/* PROFILE HEADER — null while fetching, populates once Supabase responds */}
      <ProfileHeader
        profile={profile}
        onEdit={() => setShowEditProfile(true)}
        onShare={() => alert("Open share sheet")}
        onViewProgram={() => setShowProgram(true)}
      />

      <div className="ts-dashTop">
        <div className="ts-dashHead">
          <h1 className="ts-dashTitle">Dashboard</h1>

          {/* TABS + ACTIONS — single row */}
          <div className="ts-tabsRow" role="tablist" aria-label="Dashboard sections">
            <div className="ts-tabs">
              {tabBtn("recent", "Recent Session")}
              {tabBtn("insights", "Insights and Analysis")}
              {tabBtn("athletes", "Individual Athletes")}
            </div>
            <div className="ts-tabs ts-dashActions">
              <button
                type="button"
                className="ts-tabBtn"
                onClick={() => navigate("/session")}
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ marginRight: 6, flexShrink: 0 }}>
                  <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                New Session
              </button>
              {userRole === "admin" && (
                <button
                  type="button"
                  className="ts-tabBtn"
                  onClick={() => setShowImportRoster(true)}
                  title="Import multiple athletes from a CSV file"
                >
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ marginRight: 6, flexShrink: 0 }}>
                    <path d="M7 9V1M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M1 11h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                  Import Roster
                </button>
              )}
              <button
                type="button"
                className="ts-tabBtn ts-actionPrimary"
                onClick={() => setShowCreateAthlete(true)}
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ marginRight: 6, flexShrink: 0 }}>
                  <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                Add Athlete
              </button>
            </div>
          </div>

          <p className="ts-dashSub">Realtime training metrics + AI-ready analysis.</p>
        </div>
      </div>

      {/* Program-level plan state. The lapsed banner leads with the fact that
          captured sessions are retained, because that is the first thing a
          lapsed customer wants to know. */}
      {!ent.loading && ent.isLapsed && (
        <div style={{ padding: "0 var(--dash-pad, 24px)" }}>
          <LapsedBanner isTrial={ent.plan === "trial"} isDark={isDark} />
        </div>
      )}
      {!ent.loading && ent.isTrial && (
        <div style={{ padding: "0 var(--dash-pad, 24px)" }}>
          <TrialBanner daysLeft={ent.trialDaysLeft} isDark={isDark} />
        </div>
      )}
      {!retained.loading && retained.hasLockedData && (
        <div style={{ padding: "0 var(--dash-pad, 24px)" }}>
          <RetainedDataNotice
            lockedModes={retained.lockedModes}
            lockedModeSessions={retained.lockedModeSessions}
            lockedByHistory={retained.lockedByHistory}
            historyDays={ent.historyDays()}
            isDark={isDark}
          />
        </div>
      )}

      {/* TAB CONTENT — keyed wrapper so a tab switch replays the
           fade/slide-in animation defined in .ts-tabContent. */}
      <div key={activeTab} className="ts-tabContent">
      {activeTab === "recent" ? (
        <>
          {/* MAIN GRID */}
          <div className="ts-dashGrid ts-dashMain">
            {/* Recent Sessions */}
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

                    {/* ── Row 2: Mode pills — equal-width cells, always fill card ── */}
                    <div style={{
                      display: "flex",
                      width: "100%",
                      background: subtleBg,
                      border: `1px solid ${subtleBdr}`,
                      borderRadius: 10,
                      padding: 3,
                      gap: 2,
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
                              flex: "1 1 0",           // equal width regardless of label length
                              minWidth: 0,             // allow shrinking below content size
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 4,
                              padding: "6px 4px",
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
                            <span className="ts-filterModeIcon" style={{ lineHeight: 0, flexShrink: 0 }}>
                              {mode ? <ModeIcon mode={mode} size={12} /> : null}
                            </span>
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
                        onClick={() => navigate("/session")}
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

            {/* Impact Heatmap */}
            <SessionHeatmapCard dash={dash} />

            {/* AI Insights — Tier III. The rules engine below still runs, but
                below Tier III it is starved: tiered_session_summaries() masks
                si_fatigue_slope / si_trend / reaction_fatigue_delta_ms out of
                the quality payload and drops Volume and Target rows entirely,
                so the cards it can produce would be empty rather than merely
                hidden. The preview stands in for that. */}
            {!ent.can("aiAnalysis") ? (
              <LockedPanel
                feature="aiAnalysis"
                requiredTier={ent.requiredTier("aiAnalysis")}
                title="Coaching Insights"
                isDark={isDark}
                minHeight={280}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "2px 2px 0" }}>
                  {SAMPLE_INSIGHT_CARDS.map((c) => (
                    <div
                      key={c.headline}
                      style={{
                        borderRadius: 10,
                        border: `1px solid rgba(${isDark ? "255,255,255" : "20,20,40"},0.10)`,
                        background: `rgba(${isDark ? "255,255,255" : "20,20,40"},0.03)`,
                        padding: "12px 14px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", opacity: 0.7 }}>
                          {c.tag}
                        </span>
                        <span style={{ fontSize: 9.5, fontWeight: 800, opacity: 0.5 }}>{c.priority}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 5 }}>{c.headline}</div>
                      <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 5 }}>{c.metric}</div>
                      <div style={{ fontSize: 12, lineHeight: 1.55, opacity: 0.75 }}>{c.cue}</div>
                    </div>
                  ))}
                </div>
              </LockedPanel>
            ) : (
            <div className="ts-card" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <div className="ts-cardTop">
                <div className="ts-cardTitle">Coaching Insights</div>
                <div className="ts-cardMeta">
                  {coachInsights.filter(i => i.priority === "high").length > 0
                    ? `${coachInsights.filter(i => i.priority === "high").length} high-priority`
                    : `${coachInsights.length} insight${coachInsights.length !== 1 ? "s" : ""}`}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, overflowY: "auto", minHeight: 0 }}>
                {coachInsights.map((insight, idx) => {
                  const tagColors: Record<string, { bg: string; border: string; color: string }> = {
                    Power:       { bg: "rgba(180,0,255,0.10)",  border: "rgba(180,0,255,0.30)",  color: "rgba(210,140,255,0.95)" },
                    Accuracy:    { bg: "rgba(0,220,255,0.09)",  border: "rgba(0,220,255,0.28)",  color: "rgba(80,220,255,0.95)"  },
                    Reaction:    { bg: "rgba(255,200,0,0.09)",  border: "rgba(255,200,0,0.28)",  color: "rgba(255,210,60,0.95)"  },
                    Consistency: { bg: "rgba(80,220,160,0.09)", border: "rgba(80,220,160,0.26)", color: "rgba(80,220,160,0.95)"  },
                    Fatigue:     { bg: "rgba(255,100,80,0.09)", border: "rgba(255,100,80,0.26)", color: "rgba(255,130,110,0.95)" },
                    Tempo:       { bg: "rgba(255,170,0,0.09)",  border: "rgba(255,170,0,0.26)",  color: "rgba(255,190,60,0.95)"  },
                    Volume:      { bg: "rgba(255,106,0,0.09)",  border: "rgba(255,106,0,0.28)",  color: "rgba(255,140,60,0.95)"  },
                    Target:      { bg: "rgba(0,255,136,0.08)",  border: "rgba(0,255,136,0.26)",  color: "rgba(0,210,100,0.95)"   },
                  };
                  const priorityDot: Record<string, string> = {
                    high:   "#ff5f5f",
                    medium: "#ffcc00",
                    low:    "rgba(255,255,255,0.22)",
                  };
                  const tc = tagColors[insight.tag] ?? tagColors.Power;
                  const ink = isDark ? "255,255,255" : "20,20,40";

                  return (
                    <div key={idx} style={{
                      borderRadius: 12,
                      border: `1px solid rgba(${ink},${isDark ? "0.08" : "0.10"})`,
                      background: `rgba(${ink},${isDark ? "0.03" : "0.025"})`,
                      overflow: "hidden",
                    }}>
                      {/* Header row */}
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 14px 8px",
                        borderBottom: `1px solid rgba(${ink},${isDark ? "0.07" : "0.08"})`,
                      }}>
                        {/* Priority dot */}
                        <div style={{
                          width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                          background: priorityDot[insight.priority],
                          boxShadow: insight.priority === "high" ? "0 0 6px #ff5f5faa" : "none",
                        }} />
                        {/* Tag pill */}
                        <div style={{
                          fontSize: 10, fontWeight: 800, letterSpacing: "0.07em",
                          textTransform: "uppercase", padding: "2px 8px",
                          borderRadius: 999, background: tc.bg, border: `1px solid ${tc.border}`, color: tc.color,
                          flexShrink: 0,
                        }}>
                          {insight.tag}
                        </div>
                        {/* Headline */}
                        <div style={{
                          fontSize: 12, fontWeight: 700, flex: 1, minWidth: 0,
                          color: `rgba(${ink},0.90)`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {insight.headline}
                        </div>
                      </div>

                      {/* Numbers row */}
                      {insight.numbers.length > 0 && (
                        <div style={{
                          display: "flex", gap: 0,
                          borderBottom: `1px solid rgba(${ink},${isDark ? "0.07" : "0.08"})`,
                          overflowX: "auto",
                        }}>
                          {insight.numbers.map((n, ni) => (
                            <div key={ni} style={{
                              flex: "1 0 auto",
                              padding: "8px 14px",
                              borderRight: ni < insight.numbers.length - 1
                                ? `1px solid rgba(${ink},${isDark ? "0.07" : "0.08"})` : "none",
                              minWidth: 80,
                            }}>
                              <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.45, marginBottom: 3, whiteSpace: "nowrap" }}>
                                {n.label}
                              </div>
                              <div style={{
                                fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                                color: n.deltaDir === "up"
                                  ? tc.color
                                  : n.deltaDir === "down"
                                  ? (isDark ? "rgba(255,100,80,0.90)" : "rgba(200,50,40,0.90)")
                                  : `rgba(${ink},0.88)`,
                                lineHeight: 1.2,
                              }}>
                                {n.value}
                              </div>
                              {n.delta && (
                                <div style={{ fontSize: 10, opacity: 0.45, marginTop: 2, whiteSpace: "nowrap" }}>
                                  {n.delta}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Coaching cue */}
                      <div style={{
                        padding: "9px 14px 11px",
                        display: "flex", alignItems: "flex-start", gap: 8,
                      }}>
                        {/* Whistle / coach icon */}
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"
                          style={{ flexShrink: 0, marginTop: 1, opacity: 0.45 }}>
                          <circle cx="5.5" cy="8.5" r="3.5" stroke="currentColor" strokeWidth="1.3"/>
                          <path d="M8.5 6l3-3M8.5 5h3v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <div style={{ fontSize: 12, lineHeight: 1.55, opacity: 0.78, color: `rgba(${ink},0.88)` }}>
                          {insight.cue}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            )}

            {/* In-Depth Athlete Analysis — Tier II unlocks the axis breakdown.
                Tier I keeps the profile and session history it is entitled to
                (§4.3, "standard athlete information") rather than losing the
                panel wholesale, so the lock lands on the analysis, not the
                athlete's own record. */}
            {ent.athleteAnalysis === "profileOnly" || ent.athleteAnalysis === "none" ? (
              <LockedPanel
                feature="teamComparison"
                requiredTier="II"
                title="In-Depth Analysis"
                isDark={isDark}
                minHeight={280}
              >
                <SampleTable
                  isDark={isDark}
                  columns={["Axis", "Score", "Band"]}
                  rows={[
                    ["Force", "81", "Strong"],
                    ["Placement", "58", "Developing"],
                    ["Timing", "37", "Focus here"],
                  ]}
                />
              </LockedPanel>
            ) : (
            <div ref={analysisCardRef} className="ts-card" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <div className="ts-cardTop">
                <div className="ts-cardTitle">In-Depth Analysis</div>
                <div className="ts-cardMeta">
                  {analysisAthleteId
                    ? analysisLoading ? "Loading…"
                    : `${analysisSessions.length} session${analysisSessions.length !== 1 ? "s" : ""} · ${analysisAthleteName}`
                    : "Select an athlete"}
                </div>
              </div>

              {/* Athlete picker */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"
                    style={{ position: "absolute", left: 10, pointerEvents: "none", opacity: 0.5, flexShrink: 0 }}>
                    <circle cx="7" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
                    <path d="M2 12c0-2.761 2.239-4 5-4s5 1.239 5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                  <select
                    value={analysisAthleteId ?? ""}
                    onChange={(e) => {
                      const id   = e.target.value;
                      const name = analysisAthleteOptions.find(a => a.id === id)?.name ?? "—";
                      setAnalysisAthleteId(id || null);
                      setAnalysisAthleteName(name);
                    }}
                    style={{
                      background: analysisAthleteId ? "rgba(180,0,255,0.14)" : (isDark ? "rgba(255,255,255,0.06)" : "rgba(20,20,40,0.05)"),
                      border: analysisAthleteId ? "1px solid rgba(180,0,255,0.45)" : `1px solid ${isDark ? "rgba(255,255,255,0.14)" : "rgba(20,20,40,0.14)"}`,
                      borderRadius: 10,
                      color: analysisAthleteId ? "rgba(210,140,255,0.95)" : "inherit",
                      font: "inherit", fontSize: 12, fontWeight: 700,
                      padding: "7px 14px 7px 30px",
                      cursor: "pointer", outline: "none", appearance: "none",
                      minWidth: 180,
                      transition: "background 150ms ease, border-color 150ms ease",
                    }}
                  >
                    <option value="">Select athlete…</option>
                    {analysisAthleteOptions.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                {analysisAthleteId && (
                  <button
                    type="button"
                    onClick={() => { setAnalysisAthleteId(null); setAnalysisAthleteName("—"); setAnalysisSessions([]); }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      background: "transparent",
                      border: `1px solid ${isDark ? "rgba(255,255,255,0.14)" : "rgba(20,20,40,0.14)"}`,
                      borderRadius: 10, color: isDark ? "rgba(255,255,255,0.40)" : "rgba(20,20,40,0.40)",
                      font: "inherit", fontSize: 11, fontWeight: 700, padding: "7px 11px", cursor: "pointer",
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                    </svg>
                    Clear
                  </button>
                )}
              </div>

              {/* Empty / loading states */}
              {!analysisAthleteId && (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.32, fontSize: 13, textAlign: "center", padding: "0 16px" }}>
                  Choose an athlete above to see their individual breakdown across all session types.
                </div>
              )}
              {analysisAthleteId && analysisLoading && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* Overview strip skeleton */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", borderRadius: 10, overflow: "hidden", border: `1px solid rgba(128,128,128,0.1)` }}>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} style={{ padding: "10px 12px", borderRight: i < 2 ? "1px solid rgba(128,128,128,0.1)" : "none" }}>
                        <Skel w="50%" h={9} style={{ marginBottom: 6 }} />
                        <Skel w="65%" h={15} />
                      </div>
                    ))}
                  </div>
                  {/* Tab buttons skeleton */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skel key={i} w="100%" h={52} r={10} />
                    ))}
                  </div>
                  {/* Stat rows skeleton */}
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(128,128,128,0.08)" }}>
                      <Skel w={`${40 + (i % 3) * 14}%`} h={11} />
                      <Skel w="20%" h={13} />
                    </div>
                  ))}
                </div>
              )}
              {analysisAthleteId && !analysisLoading && analysisSessions.length === 0 && (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.35, fontSize: 13, textAlign: "center", padding: "0 16px" }}>
                  No sessions recorded yet for {analysisAthleteName}.
                </div>
              )}

              {/* Full analysis */}
              {analysisAthleteId && !analysisLoading && athleteAnalysis && (() => {
                const a   = athleteAnalysis;
                const ink = isDark ? "255,255,255" : "20,20,40";
                const divider = `1px solid rgba(${ink},${isDark ? "0.07" : "0.08"})`;

                function Sparkline({ values, color, height = 40 }: { values: number[]; color: string; height?: number }) {
                  if (values.length < 2) return <span style={{ opacity: 0.3, fontSize: 11 }}>not enough data</span>;
                  const W = 160, H = height;
                  const min = Math.min(...values), max = Math.max(...values);
                  const range = Math.max(max - min, 1);
                  const pts = values.map((v, i) => {
                    const x = (i / (values.length - 1)) * W;
                    const y = H - ((v - min) / range) * (H - 6) - 3;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                  }).join(" ");
                  const dotPts = values.map((v, i) => ({
                    x: (i / (values.length - 1)) * W,
                    y: H - ((v - min) / range) * (H - 6) - 3,
                  }));
                  return (
                    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible", display: "block" }}>
                      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.85"/>
                      {dotPts.map((p, i) => (
                        <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={color} opacity="0.7"/>
                      ))}
                    </svg>
                  );
                }

                function StatRow({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: "good" | "warn" | "bad" }) {
                  const valColor = highlight === "good" ? (isDark ? "rgba(80,220,160,0.95)" : "rgba(20,140,90,0.95)")
                                 : highlight === "warn" ? (isDark ? "rgba(255,200,60,0.95)" : "rgba(180,120,0,0.95)")
                                 : highlight === "bad"  ? (isDark ? "rgba(255,100,80,0.95)" : "rgba(180,50,30,0.95)")
                                 : `rgba(${ink},0.88)`;
                  return (
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: divider }}>
                      <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.5 }}>{label}</span>
                      <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: valColor }}>{value}</span>
                        {sub && <span style={{ fontSize: 10, opacity: 0.4 }}>{sub}</span>}
                      </span>
                    </div>
                  );
                }

                const totalMins = Math.round(a.totalDurMs / 60000);
                const durFmt    = totalMins >= 60 ? `${Math.floor(totalMins / 60)}h ${totalMins % 60}m` : `${totalMins}m`;

                // Section config — drives the accordion tabs
                type SectionKey = "power" | "accuracy" | "reaction" | "form";
                const sections: { key: SectionKey; label: string; count?: number; accent: string; accentBg: string; accentBdr: string; hasData: boolean }[] = [
                  { key: "power",    label: "Power",        count: a.stdCount,   accent: "#b400ff", accentBg: "rgba(180,0,255,0.09)",  accentBdr: "rgba(180,0,255,0.25)", hasData: a.strengthTrend.length > 0 },
                  { key: "accuracy", label: "Accuracy",     count: a.accCount,   accent: "#00dcff", accentBg: "rgba(0,220,255,0.07)",   accentBdr: "rgba(0,220,255,0.22)", hasData: a.accMetrics.length > 0 },
                  { key: "reaction", label: "Reaction",     count: a.reactCount, accent: "#ffcc00", accentBg: "rgba(255,200,0,0.07)",   accentBdr: "rgba(255,200,0,0.22)", hasData: a.reactMetrics.length > 0 },
                  { key: "form",     label: "Form & Angle", count: undefined,    accent: isDark ? "rgba(255,255,255,0.80)" : "rgba(20,20,40,0.80)", accentBg: `rgba(${ink},0.05)`, accentBdr: `rgba(${ink},0.14)`, hasData: a.avgAngle != null },
                ];

                const activeSection = sections.find(s => s.key === analysisSection) ?? sections[0];

                return (
                  <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>

                    {/* ── Overview strip ── */}
                    <div style={{
                      display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
                      gap: 0, borderRadius: 10, overflow: "hidden",
                      border: divider, marginBottom: 14, flexShrink: 0,
                    }}>
                      {[
                        { label: "Sessions",  value: String(a.total) },
                        { label: "Strikes",   value: a.totalEvents.toLocaleString() },
                        { label: "Bag Time",  value: durFmt },
                      ].map((item, i, arr) => (
                        <div key={item.label} style={{
                          padding: "10px 12px",
                          borderRight: i < arr.length - 1 ? divider : "none",
                          background: `rgba(${ink},${isDark ? "0.03" : "0.02"})`,
                        }}>
                          <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.42, marginBottom: 3 }}>{item.label}</div>
                          <div style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{item.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* ── Accordion tab row ── */}
                    <div style={{
                      display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
                      gap: 4, marginBottom: 12, flexShrink: 0,
                    }}>
                      {sections.map(sec => {
                        const isActive = analysisSection === sec.key;
                        return (
                          <button
                            key={sec.key}
                            type="button"
                            onClick={() => setAnalysisSection(sec.key)}
                            style={{
                              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                              gap: 3, padding: "8px 4px",
                              borderRadius: 10,
                              border: isActive ? `1px solid ${sec.accentBdr}` : `1px solid rgba(${ink},${isDark ? "0.10" : "0.10"})`,
                              background: isActive ? sec.accentBg : `rgba(${ink},${isDark ? "0.03" : "0.02"})`,
                              cursor: "pointer", font: "inherit",
                              transition: "background 150ms ease, border-color 150ms ease",
                              opacity: !sec.hasData && !isActive ? 0.42 : 1,
                            }}
                          >
                            <ModeIcon
                              mode={sec.key}
                              size={16}
                              style={{ color: isActive ? sec.accent : `rgba(${ink},0.55)`, transition: "color 150ms ease" }}
                            />
                            <span style={{
                              fontSize: 10, fontWeight: 800, letterSpacing: "0.04em",
                              textTransform: "uppercase", lineHeight: 1,
                              color: isActive ? sec.accent : `rgba(${ink},0.55)`,
                              transition: "color 150ms ease",
                            }}>{sec.label}</span>
                            {sec.count != null && (
                              <span style={{ fontSize: 9, opacity: 0.38, lineHeight: 1 }}>{sec.count} sess.</span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* ── Active section content (scrollable) ── */}
                    <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>

                      {/* POWER */}
                      {analysisSection === "power" && (
                        <div>
                          {a.strengthTrend.length === 0 ? (
                            <div style={{ opacity: 0.35, fontSize: 12, padding: "16px 0" }}>No power sessions recorded yet.</div>
                          ) : (
                            <>
                              <StatRow label="Consistency score" value={a.consistencyPct != null ? `${a.consistencyPct}%` : "—"} sub="avg/peak ratio" highlight={a.consistencyPct == null ? undefined : a.consistencyPct >= 80 ? "good" : a.consistencyPct >= 60 ? "warn" : "bad"} />
                              <StatRow label="Latest peak index" value={String(a.strengthTrend[a.strengthTrend.length - 1].peak)} sub="/ 1000" highlight={a.strengthTrend[a.strengthTrend.length - 1].peak >= 700 ? "good" : a.strengthTrend[a.strengthTrend.length - 1].peak >= 450 ? "warn" : "bad"} />
                              <StatRow label="Session trend" value={a.fatigueNote ?? "—"} highlight={a.fatigueNote?.includes("up") ? "good" : a.fatigueNote?.includes("down") ? "bad" : "warn"} />
                              {a.cadenceTrend.length > 0 && <StatRow label="Avg cadence" value={`${(a.cadenceTrend.reduce((s, r) => s + r.hz, 0) / a.cadenceTrend.length).toFixed(1)} Hz`} />}
                              {a.strengthTrend.length >= 2 && (
                                <div style={{ marginTop: 14 }}>
                                  <div style={{ fontSize: 10, opacity: 0.4, marginBottom: 6 }}>Peak strength index over time</div>
                                  <Sparkline values={a.strengthTrend.map(r => r.peak)} color="#b400ff" />
                                </div>
                              )}
                              <div style={{ marginTop: 14, padding: "9px 10px", borderRadius: 8, background: "rgba(180,0,255,0.08)", border: "1px solid rgba(180,0,255,0.18)", fontSize: 11, lineHeight: 1.6, opacity: 0.85 }}>
                                {a.consistencyPct != null && a.consistencyPct < 65
                                  ? `Consistency is low (${a.consistencyPct}%). Drill 8-count continuous combos to raise the floor.`
                                  : a.fatigueNote?.includes("down")
                                  ? `Output trending down. Prioritize recovery and focus on quality over quantity next session.`
                                  : a.fatigueNote?.includes("up")
                                  ? `Strength trending up. Add 10% volume or intensity next session.`
                                  : `Output is stable. Introduce power-interval training to break the plateau.`}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* ACCURACY */}
                      {analysisSection === "accuracy" && (
                        <div>
                          {a.accMetrics.length === 0 ? (
                            <div style={{ opacity: 0.35, fontSize: 12, padding: "16px 0" }}>No accuracy sessions recorded yet.</div>
                          ) : (
                            <>
                              <StatRow label="Latest score" value={a.latestAccScore != null ? `${a.latestAccScore.toFixed(1)}%` : "—"} highlight={a.latestAccScore == null ? undefined : a.latestAccScore >= 80 ? "good" : a.latestAccScore >= 60 ? "warn" : "bad"} />
                              {a.accDrift != null && <StatRow label="Accuracy drift" value={`${a.accDrift > 0 ? "+" : ""}${a.accDrift}%`} sub="first → latest" highlight={a.accDrift > 5 ? "good" : a.accDrift < -5 ? "bad" : "warn"} />}
                              {a.accMetrics[a.accMetrics.length - 1]?.offset != null && <StatRow label="Avg offset (latest)" value={`${a.accMetrics[a.accMetrics.length - 1].offset!.toFixed(0)} mm`} highlight={a.accMetrics[a.accMetrics.length - 1].offset! < 20 ? "good" : a.accMetrics[a.accMetrics.length - 1].offset! < 40 ? "warn" : "bad"} />}
                              {a.accMetrics.length >= 2 && (
                                <div style={{ marginTop: 14 }}>
                                  <div style={{ fontSize: 10, opacity: 0.4, marginBottom: 6 }}>Accuracy % over time</div>
                                  <Sparkline values={a.accMetrics.map(r => r.score)} color="#00dcff" />
                                </div>
                              )}
                              <div style={{ marginTop: 14, padding: "9px 10px", borderRadius: 8, background: "rgba(0,220,255,0.07)", border: "1px solid rgba(0,220,255,0.18)", fontSize: 11, lineHeight: 1.6, opacity: 0.85 }}>
                                {a.latestAccScore != null && a.latestAccScore < 60
                                  ? `Score below 60% — slow to target-lock fundamentals. 3×10 deliberate reps before adding speed every session.`
                                  : a.accDrift != null && a.accDrift < -8
                                  ? `Accuracy regressing (${a.accDrift}%). Reintroduce slow-speed form work before adding power.`
                                  : a.accDrift != null && a.accDrift > 8
                                  ? `Accuracy improving (+${a.accDrift}%). Introduce tighter targets or longer combos to maintain challenge.`
                                  : `Accuracy is stable. Add moving-target or reaction-accuracy combos to push further.`}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* REACTION */}
                      {analysisSection === "reaction" && (
                        <div>
                          {a.reactMetrics.length === 0 ? (
                            <div style={{ opacity: 0.35, fontSize: 12, padding: "16px 0" }}>No reaction sessions recorded yet.</div>
                          ) : (
                            <>
                              <StatRow label="Latest avg reaction" value={a.latestReactAvg != null ? `${a.latestReactAvg} ms` : "—"} highlight={a.latestReactAvg == null ? undefined : a.latestReactAvg < 400 ? "good" : a.latestReactAvg < 650 ? "warn" : "bad"} />
                              <StatRow label="Best ever reaction" value={a.reactMetrics.reduce((b, r) => r.best != null && r.best < b ? r.best : b, Infinity) < Infinity ? `${a.reactMetrics.reduce((b, r) => r.best != null && r.best < b ? r.best : b, Infinity)} ms` : "—"} highlight="good" />
                              {a.reactDrift != null && <StatRow label="Reaction drift" value={`${a.reactDrift > 0 ? "+" : ""}${a.reactDrift} ms`} sub="first → latest" highlight={a.reactDrift < -20 ? "good" : a.reactDrift > 20 ? "bad" : "warn"} />}
                              {a.reactMetrics.length >= 2 && (
                                <div style={{ marginTop: 14 }}>
                                  <div style={{ fontSize: 10, opacity: 0.4, marginBottom: 6 }}>Avg reaction ms over time (lower = better)</div>
                                  <Sparkline values={a.reactMetrics.map(r => r.avg)} color="#ffcc00" />
                                </div>
                              )}
                              <div style={{ marginTop: 14, padding: "9px 10px", borderRadius: 8, background: "rgba(255,200,0,0.07)", border: "1px solid rgba(255,200,0,0.20)", fontSize: 11, lineHeight: 1.6, opacity: 0.85 }}>
                                {a.latestReactAvg != null && a.latestReactAvg > 700
                                  ? `Reaction time is slow. Start with predictable-cue drills, then add random timing once avg drops below 600 ms.`
                                  : a.reactDrift != null && a.reactDrift > 30
                                  ? `Reaction slowing (+${a.reactDrift} ms). Vary cue signal timing to prevent anticipation.`
                                  : a.reactDrift != null && a.reactDrift < -30
                                  ? `Reaction improving (${a.reactDrift} ms). Push with multi-cue sequences.`
                                  : `Reaction is stable. Introduce random-delay cues and mixed-target sessions to break ceiling.`}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* FORM & ANGLE */}
                      {analysisSection === "form" && (
                        <div>
                          {a.avgAngle == null ? (
                            <div style={{ opacity: 0.35, fontSize: 12, padding: "16px 0" }}>No angle data recorded yet.</div>
                          ) : (
                            <>
                              <StatRow label="Avg strike angle" value={`${a.avgAngle.toFixed(1)}°`} highlight={Math.abs(a.avgAngle) < 8 ? "good" : Math.abs(a.avgAngle) < 16 ? "warn" : "bad"} />
                              <StatRow label="Bias direction" value={Math.abs(a.avgAngle) < 5 ? "Neutral" : a.avgAngle > 0 ? "Leans right / forward" : "Leans left / back"} highlight={Math.abs(a.avgAngle) < 5 ? "good" : "warn"} />
                              <div style={{ marginTop: 14, padding: "9px 10px", borderRadius: 8, background: `rgba(${ink},0.05)`, border: `1px solid rgba(${ink},0.12)`, fontSize: 11, lineHeight: 1.6, opacity: 0.85 }}>
                                {Math.abs(a.avgAngle) < 6
                                  ? `Angle is neutral — good form consistency. Monitor for drift under fatigue.`
                                  : Math.abs(a.avgAngle) < 14
                                  ? `Slight ${a.avgAngle > 0 ? "forward/right" : "back/left"} bias (${a.avgAngle.toFixed(1)}°). Cue: square shoulders, drive elbow through center of target.`
                                  : `Significant angle bias (${a.avgAngle.toFixed(1)}°). Address with form-only drills before adding power — injury risk is elevated.`}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                    </div>

                    {/* ── Performance Radar Chart ── */}
                    {(() => {
                      // ── Helper: derive 5 axis scores from a session slice ────────────
                      function computeAxes(sessions: typeof analysisSessions) {
                        const std   = sessions.filter(s => s.mode.toLowerCase() === "power");
                        const acc   = sessions.filter(s => s.mode.toLowerCase() === "accuracy");
                        const react = sessions.filter(s => s.mode.toLowerCase() === "reaction");

                        const strPeaks = std.map(s => {
                          const si = s.quality?.strength_index;
                          if (si?.max != null) return Math.round(si.max);
                          const pfs = s.peak_force_stats;
                          const pMv = pfs?.peak_mv ?? (pfs?.peak_v != null ? pfs.peak_v * 1000 : null);
                          return pMv != null ? Math.round((pMv / 3320) * 1000) : null;
                        }).filter((v): v is number => v != null);
                        const latestPeak  = strPeaks.length > 0 ? strPeaks[strPeaks.length - 1] : null;
                        const powerScore  = latestPeak != null ? Math.min(100, Math.round(latestPeak / 10)) : null;

                        const accScores   = acc.map(s => {
                          const v = s.quality?.accuracy_pct ?? s.quality?.score ?? null;
                          return v != null ? Math.min(100, Math.round(Number(v))) : null;
                        }).filter((v): v is number => v != null);
                        const accuracyScore = accScores.length > 0 ? accScores[accScores.length - 1] : null;

                        const reactAvgs   = react.map(s => s.quality?.avg_reaction_ms ?? null).filter((v): v is number => v != null);
                        const latestReact = reactAvgs.length > 0 ? reactAvgs[reactAvgs.length - 1] : null;
                        const reactionScore = latestReact != null
                          ? Math.max(0, Math.min(100, Math.round(((800 - latestReact) / 600) * 100))) : null;

                        const conPairs = std.map(s => {
                          const si = s.quality?.strength_index;
                          return si?.max != null && si?.mean != null ? si.mean / si.max : null;
                        }).filter((v): v is number => v != null);
                        const consistencyScore = conPairs.length > 0
                          ? Math.round(conPairs.reduce((a, b) => a + b, 0) / conPairs.length * 100) : null;

                        const volumeScore = Math.min(100, Math.round((sessions.length / 20) * 100));

                        return [
                          { label: "Power",       score: powerScore,       color: "#b400ff", noDataLabel: "Need power sessions" },
                          { label: "Accuracy",    score: accuracyScore,    color: "#00dcff", noDataLabel: "Need accuracy sessions" },
                          { label: "Reaction",    score: reactionScore,    color: "#ffcc00", noDataLabel: "Need reaction sessions" },
                          { label: "Consistency", score: consistencyScore, color: "#00ff88", noDataLabel: "Need 2+ power sessions" },
                          { label: "Volume",      score: volumeScore,      color: "#ff6a00", noDataLabel: "" },
                        ];
                      }

                      // ── Window slices ────────────────────────────────────────────────
                      const cut30 = new Date(); cut30.setDate(cut30.getDate() - 30);
                      const cut90 = new Date(); cut90.setDate(cut90.getDate() - 90);
                      const sessions30d = analysisSessions.filter(s => s.date_of_record >= cut30.toISOString());
                      const sessions90d = analysisSessions.filter(s => s.date_of_record >= cut90.toISOString());
                      const sessionsAll = analysisSessions;

                      // Active polygon is always 30d (most recent performance)
                      type RadarAxis = { label: string; score: number | null; color: string; noDataLabel: string };
                      const axes: RadarAxis[]      = computeAxes(sessions30d);
                      // Ghost / baseline polygon is the comparison window
                      const ghostAxes: RadarAxis[] = radarWindow === "all"
                        ? computeAxes(sessionsAll)
                        : computeAxes(sessions90d);
                      const ghostLabel = radarWindow === "all" ? "All time" : "90d";

                      const hasAnyData = axes.some(ax => ax.score != null) || sessionsAll.length > 0;

                      // Composite score from 30d active window
                      const scoredAxes = axes.filter(ax => ax.score != null);
                      const compositeScore = scoredAxes.length > 0
                        ? Math.round(scoredAxes.reduce((s, ax) => s + ax.score!, 0) / scoredAxes.length) : null;
                      const compositeTier  = compositeScore == null ? null
                        : compositeScore >= 75 ? "Elite"
                        : compositeScore >= 55 ? "Advanced"
                        : compositeScore >= 35 ? "Developing"
                        : "Beginner";
                      const compositeColor = compositeScore == null ? "rgba(255,255,255,0.4)"
                        : compositeScore >= 75 ? "#00ff88"
                        : compositeScore >= 55 ? "#ffcc00"
                        : compositeScore >= 35 ? "#ff6a00"
                        : "#ff6060";

                      // SVG radar geometry
                      const CX = 155, CY = 140, R = 95;
                      const N = axes.length;
                      const angleStep = (2 * Math.PI) / N;
                      const angleFor = (i: number) => -Math.PI / 2 + i * angleStep;

                      function polarToXY(angle: number, radius: number) {
                        return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
                      }

                      function buildPath(axList: RadarAxis[]) {
                        return axList.map((ax, i) => {
                          const r = ((ax.score ?? 0) / 100) * R;
                          const p = polarToXY(angleFor(i), r);
                          return `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
                        }).join(" ") + " Z";
                      }

                      const activePath = buildPath(axes);
                      const ghostPath  = buildPath(ghostAxes);
                      const rings = [25, 50, 75, 100];

                      // Label positions
                      const LABEL_R = R + 24;

                      return (
                        <div style={{
                          marginTop: 20,
                          paddingTop: 16,
                          borderTop: divider,
                          flexShrink: 0,
                        }}>
                          {/* Header */}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", opacity: 0.55, marginBottom: 2 }}>
                                Performance Profile
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                                {/* Legend */}
                                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                  <div style={{ width: 20, height: 2, background: "rgba(180,0,255,0.7)", borderRadius: 1 }} />
                                  <span style={{ fontSize: 10, opacity: 0.55 }}>30d (current)</span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                  <div style={{ width: 20, height: 2, background: isDark ? "rgba(255,255,255,0.25)" : "rgba(20,20,40,0.25)", borderRadius: 1, borderTop: `1px dashed ${isDark ? "rgba(255,255,255,0.35)" : "rgba(20,20,40,0.35)"}` }} />
                                  <span style={{ fontSize: 10, opacity: 0.45 }}>{ghostLabel} (baseline)</span>
                                </div>
                              </div>
                            </div>
                            {/* Window toggle */}
                            <div style={{
                              display: "inline-flex", alignItems: "center",
                              background: isDark ? "rgba(255,255,255,0.04)" : "rgba(20,20,40,0.04)",
                              border: `1px solid ${isDark ? "rgba(255,255,255,0.10)" : "rgba(20,20,40,0.10)"}`,
                              borderRadius: 8, padding: 2, gap: 2,
                            }}>
                              {(["90d", "all"] as const).map(w => {
                                const isActive = radarWindow === w;
                                return (
                                  <button
                                    key={w}
                                    type="button"
                                    onClick={() => setRadarWindow(w)}
                                    style={{
                                      padding: "4px 10px", borderRadius: 6, border: "none",
                                      background: isActive
                                        ? (isDark ? "rgba(180,0,255,0.22)" : "rgba(180,0,255,0.14)")
                                        : "transparent",
                                      color: isActive ? "rgba(210,140,255,0.95)" : (isDark ? "rgba(255,255,255,0.40)" : "rgba(20,20,40,0.40)"),
                                      font: "inherit", fontSize: 11, fontWeight: 700,
                                      cursor: "pointer", transition: "all 140ms ease",
                                      letterSpacing: "0.02em",
                                    }}
                                  >
                                    {w === "90d" ? "vs 90d" : "vs All"}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {!hasAnyData ? (
                            <div style={{ textAlign: "center", padding: "24px 0", opacity: 0.32, fontSize: 12 }}>
                              Record sessions across different modes to build your performance profile.
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
                              {/* SVG radar */}
                              <div style={{ flexShrink: 0 }}>
                                <svg
                                  width={310} height={280}
                                  viewBox="0 0 310 280"
                                  style={{ display: "block", overflow: "visible" }}
                                >
                                  {/* Concentric grid rings */}
                                  {rings.map(pct => {
                                    const ringR = (pct / 100) * R;
                                    const ringPts = Array.from({ length: N }, (_, i) => {
                                      const p = polarToXY(angleFor(i), ringR);
                                      return `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
                                    }).join(" ") + " Z";
                                    return (
                                      <g key={pct}>
                                        <path d={ringPts} fill="none"
                                          stroke={`rgba(${isDark ? "255,255,255" : "20,20,40"},${pct === 100 ? "0.14" : "0.07"})`}
                                          strokeWidth={pct === 100 ? 1.2 : 0.8}
                                          strokeDasharray={pct === 100 ? undefined : "3 3"}
                                        />
                                        <text
                                          x={CX} y={CY - ringR - 3}
                                          textAnchor="middle" fontSize="8"
                                          fill={`rgba(${isDark ? "255,255,255" : "20,20,40"},0.25)`}
                                          fontFamily="inherit"
                                        >{pct}</text>
                                      </g>
                                    );
                                  })}

                                  {/* Spoke lines */}
                                  {axes.map((_, i) => {
                                    const outer = polarToXY(angleFor(i), R);
                                    return (
                                      <line key={i}
                                        x1={CX} y1={CY}
                                        x2={outer.x.toFixed(2)} y2={outer.y.toFixed(2)}
                                        stroke={`rgba(${isDark ? "255,255,255" : "20,20,40"},0.10)`}
                                        strokeWidth="1"
                                      />
                                    );
                                  })}

                                  {/* Ghost / baseline polygon — dashed outline, no fill */}
                                  <path
                                    d={ghostPath}
                                    fill="none"
                                    stroke={isDark ? "rgba(255,255,255,0.22)" : "rgba(20,20,40,0.20)"}
                                    strokeWidth="1.5"
                                    strokeDasharray="5 3"
                                    strokeLinejoin="round"
                                  />

                                  {/* Active / 30d polygon — solid fill */}
                                  <path
                                    d={activePath}
                                    fill="rgba(180,0,255,0.13)"
                                    stroke="rgba(180,0,255,0.65)"
                                    strokeWidth="2"
                                    strokeLinejoin="round"
                                  />

                                  {/* Per-axis colored score dots (30d active) */}
                                  {axes.map((ax, i) => {
                                    const score = ax.score ?? 0;
                                    const r = (score / 100) * R;
                                    const pt = polarToXY(angleFor(i), r);
                                    if (ax.score == null) return null;
                                    return (
                                      <circle key={i}
                                        cx={pt.x.toFixed(2)} cy={pt.y.toFixed(2)}
                                        r="4.5"
                                        fill={ax.color}
                                        stroke={isDark ? "rgba(10,10,14,0.9)" : "rgba(255,255,255,0.9)"}
                                        strokeWidth="1.5"
                                      />
                                    );
                                  })}

                                  {/* Composite score in center */}
                                  {compositeScore != null && (
                                    <g>
                                      <rect
                                        x={CX - 28} y={CY - 26}
                                        width={56} height={38}
                                        rx={8}
                                        fill={isDark ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.70)"}
                                        stroke={compositeColor}
                                        strokeWidth="1.5"
                                        strokeOpacity="0.45"
                                      />
                                      <text
                                        x={CX} y={CY - 6}
                                        textAnchor="middle"
                                        fontSize="28" fontWeight="900"
                                        fill={compositeColor}
                                        fontFamily="inherit"
                                        style={{ filter: `drop-shadow(0 0 12px ${compositeColor}) drop-shadow(0 0 4px ${compositeColor})` }}
                                      >{compositeScore}</text>
                                      <text
                                        x={CX} y={CY + 9}
                                        textAnchor="middle"
                                        fontSize="7" fontWeight="800"
                                        fill={compositeColor}
                                        opacity="0.90"
                                        fontFamily="inherit"
                                        letterSpacing="0.10em"
                                      >{compositeTier?.toUpperCase()}</text>
                                    </g>
                                  )}

                                  {/* Axis labels — always middle-anchored, score stacks centered below */}
                                  {axes.map((ax, i) => {
                                    const angle = angleFor(i);
                                    const lp = polarToXY(angle, LABEL_R + 6);
                                    return (
                                      <g key={i}>
                                        <text
                                          x={lp.x.toFixed(2)} y={lp.y.toFixed(2)}
                                          textAnchor="middle"
                                          fontSize="10" fontWeight="700"
                                          fill={ax.score != null ? ax.color : `rgba(${isDark ? "255,255,255" : "20,20,40"},0.28)`}
                                          fontFamily="inherit"
                                        >
                                          {ax.label}
                                        </text>
                                        {ax.score != null && (
                                          <text
                                            x={lp.x.toFixed(2)} y={(lp.y + 13).toFixed(2)}
                                            textAnchor="middle"
                                            fontSize="10" fontWeight="900"
                                            fill={ax.color}
                                            fontFamily="inherit"
                                          >
                                            {ax.score}
                                          </text>
                                        )}
                                      </g>
                                    );
                                  })}
                                </svg>
                              </div>

                              {/* Priority callouts */}
                              <div style={{ flex: 1, minWidth: 140, display: "flex", flexDirection: "column", gap: 7, paddingTop: 4 }}>
                                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", opacity: 0.35, marginBottom: 2 }}>
                                  Priority Areas
                                </div>
                                {axes
                                  .filter(ax => ax.score != null)
                                  .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
                                  .map((ax, i) => {
                                    const score = ax.score!;
                                    const tier = score >= 75 ? "strong" : score >= 45 ? "developing" : "priority";
                                    const tierColor = tier === "strong"
                                      ? (isDark ? "rgba(80,220,160,0.9)" : "rgba(20,140,90,0.9)")
                                      : tier === "developing"
                                      ? (isDark ? "rgba(255,200,60,0.9)" : "rgba(160,110,0,0.9)")
                                      : (isDark ? "rgba(255,100,80,0.9)" : "rgba(180,50,30,0.9)");
                                    const tierBg = tier === "strong"
                                      ? (isDark ? "rgba(80,220,160,0.08)" : "rgba(20,140,90,0.06)")
                                      : tier === "developing"
                                      ? (isDark ? "rgba(255,200,60,0.07)" : "rgba(160,110,0,0.05)")
                                      : (isDark ? "rgba(255,100,80,0.09)" : "rgba(180,50,30,0.07)");

                                    return (
                                      <div key={ax.label} style={{
                                        display: "flex", alignItems: "center", gap: 8,
                                        padding: "7px 10px", borderRadius: 8,
                                        background: i === 0 ? tierBg : `rgba(${isDark ? "255,255,255" : "20,20,40"},0.025)`,
                                        border: `1px solid ${i === 0 ? ax.color + "33" : `rgba(${isDark ? "255,255,255" : "20,20,40"},0.07)`}`,
                                      }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: ax.color, flexShrink: 0 }} />
                                            <span style={{ fontSize: 11, fontWeight: 700 }}>{ax.label}</span>
                                            {i === 0 && <span style={{ fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 4, background: tierBg, border: `1px solid ${ax.color}44`, color: tierColor, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                                              {tier === "priority" ? "Focus here" : tier}
                                            </span>}
                                          </div>
                                          {/* Bar */}
                                          <div style={{ height: 4, borderRadius: 2, background: `rgba(${isDark ? "255,255,255" : "20,20,40"},0.08)` }}>
                                            <div style={{
                                              height: "100%", borderRadius: 2,
                                              width: `${score}%`,
                                              background: ax.color,
                                              transition: "width 600ms cubic-bezier(0.34,1.2,0.64,1)",
                                              boxShadow: i === 0 ? `0 0 8px 1px ${ax.color}55` : "none",
                                            }} />
                                          </div>
                                        </div>
                                        <span style={{ fontSize: 13, fontWeight: 900, color: ax.color, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{score}</span>
                                      </div>
                                    );
                                  })}
                                {/* Missing data note */}
                                {axes.filter(ax => ax.score == null).length > 0 && (
                                  <div style={{ fontSize: 10, opacity: 0.32, marginTop: 4, lineHeight: 1.5 }}>
                                    {axes.filter(ax => ax.score == null).map(ax => ax.noDataLabel).filter(Boolean).join(" · ")}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                  </div>
                );
              })()}
            </div>
            )}

            {/* Charts & Graphs */}
            <div className="ts-card ts-span2 ts-chartsCard" style={{ gridColumn: "1 / -1" }}>
              <div className="ts-cardTop">
                <div className="ts-cardTitle">Charts & Graphs</div>
                <div className="ts-cardMeta">
                  {chartEntityA && chartEntityB
                    ? `${chartEntityA.label} vs ${chartEntityB.label}`
                    : chartEntityA ? chartEntityA.label
                    : "Select entities to compare"}
                </div>
              </div>

              {(() => {
                const ink = isDark ? "255,255,255" : "20,20,40";
                const divider = `1px solid rgba(${ink},${isDark ? "0.07" : "0.09"})`;

                // ── Metric labels & units ───────────────────────────────────
                const metricMeta: Record<ChartMetric, { label: string; unit: string; mode: string; description: string }> = {
                  strength: { label: "Strength Index",   unit: "/ 1000", mode: "Power sessions", description: "Peak strength index (0–1000) per week" },
                  accuracy: { label: "Accuracy Score",   unit: "%",      mode: "Accuracy sessions", description: "Avg accuracy % per week" },
                  reaction: { label: "Reaction Time",    unit: "ms",     mode: "Reaction sessions", description: "Avg reaction time per week (lower = better)" },
                  volume:   { label: "Strike Volume",    unit: "hits",   mode: "All sessions",      description: "Total strikes logged per week" },
                };
                const meta = metricMeta[chartMetric];

                // ── Entity colors ───────────────────────────────────────────
                const colorA = "#b400ff";
                const colorB = "#00dcff";

                // ── Merge week keys from both series ────────────────────────
                const allWeeks = Array.from(new Set([
                  ...chartDataA.map(p => p.week),
                  ...chartDataB.map(p => p.week),
                ])).sort();

                const mergedA = allWeeks.map(w => chartDataA.find(p => p.week === w)?.value ?? null);
                const mergedB = allWeeks.map(w => chartDataB.find(p => p.week === w)?.value ?? null);

                const allValues = [...mergedA, ...mergedB].filter((v): v is number => v != null);
                const yMin  = allValues.length > 0 ? Math.floor(Math.min(...allValues) * 0.92) : 0;
                const yMax  = allValues.length > 0 ? Math.ceil( Math.max(...allValues) * 1.06)  : 100;
                const yRange = Math.max(yMax - yMin, 1);

                // SVG dimensions
                const W = 860, H = 220, padL = 44, padR = 16, padT = 12, padB = 28;
                const chartW = W - padL - padR;
                const chartH = H - padT - padB;

                function xPos(i: number): number {
                  return padL + (allWeeks.length <= 1 ? chartW / 2 : (i / (allWeeks.length - 1)) * chartW);
                }
                function yPos(v: number): number {
                  return padT + chartH - ((v - yMin) / yRange) * chartH;
                }

                function buildPath(values: (number | null)[]): string {
                  const segments: string[] = [];
                  let inSeg = false;
                  values.forEach((v, i) => {
                    if (v == null) { inSeg = false; return; }
                    const x = xPos(i).toFixed(1), y = yPos(v).toFixed(1);
                    if (!inSeg) { segments.push(`M${x},${y}`); inSeg = true; }
                    else        { segments.push(`L${x},${y}`); }
                  });
                  return segments.join(" ");
                }

                // Y-axis gridlines
                const yTicks = 4;
                const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) =>
                  Math.round(yMin + (yRange / yTicks) * i)
                );

                // X-axis label (show ~5 evenly spaced week labels)
                const xLabelIndices = allWeeks.length <= 6
                  ? allWeeks.map((_, i) => i)
                  : Array.from({ length: 5 }, (_, i) => Math.round(i * (allWeeks.length - 1) / 4));

                function fmtWeek(w: string): string {
                  const [yr, wk] = w.split("-W");
                  return `W${wk} '${yr.slice(2)}`;
                }

                const hasData = allWeeks.length > 0;
                const isLoading = chartLoadingA || chartLoadingB;

                // ── Hover tooltip values ─────────────────────────────────────
                const hoverA = chartHoverIdx != null ? mergedA[chartHoverIdx] : null;
                const hoverB = chartHoverIdx != null ? mergedB[chartHoverIdx] : null;
                const hoverWeek = chartHoverIdx != null ? allWeeks[chartHoverIdx] : null;

                return (
                  <div>
                    {/* ── Controls row ── */}
                    <div className="ts-chartControls" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 16 }}>

                      {/* Metric pills */}
                      <div className="ts-chartPillGroup" style={{ display: "inline-flex", background: `rgba(${ink},0.04)`, border: `1px solid rgba(${ink},0.11)`, borderRadius: 10, padding: 3, gap: 2 }}>
                        {(["strength","accuracy","reaction","volume"] as ChartMetric[]).map(m => {
                          const isActive = chartMetric === m;
                          const accentC  = m === "accuracy" ? "#00dcff" : m === "reaction" ? "#ffcc00" : m === "volume" ? "rgba(80,220,160,0.95)" : "#b400ff";
                          const accentBg = m === "accuracy" ? "rgba(0,220,255,0.13)" : m === "reaction" ? "rgba(255,200,0,0.13)" : m === "volume" ? "rgba(80,220,160,0.12)" : "rgba(180,0,255,0.16)";
                          const accentBdr= m === "accuracy" ? "rgba(0,220,255,0.38)" : m === "reaction" ? "rgba(255,200,0,0.36)" : m === "volume" ? "rgba(80,220,160,0.30)" : "rgba(180,0,255,0.40)";
                          return (
                            <button key={m} type="button" onClick={() => setChartMetric(m)} style={{
                              padding: "5px 11px", borderRadius: 7, border: isActive ? `1px solid ${accentBdr}` : "1px solid transparent",
                              background: isActive ? accentBg : "transparent",
                              color: isActive ? accentC : `rgba(${ink},0.45)`,
                              font: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer",
                              textTransform: "capitalize", transition: "all 140ms ease", whiteSpace: "nowrap",
                            }}>
                              {metricMeta[m].label}
                            </button>
                          );
                        })}
                      </div>

                      {/* Compare mode pills */}
                      <div className="ts-chartPillGroup" style={{ display: "inline-flex", background: `rgba(${ink},0.04)`, border: `1px solid rgba(${ink},0.11)`, borderRadius: 10, padding: 3, gap: 2 }}>
                        {([
                          { v: "athlete-athlete", shortLabel: "Ath vs Ath" },
                          { v: "athlete-team",shortLabel: "Ath vs Team" },
                          { v: "team-team", shortLabel: "Team vs Team" },
                        ] as { v: CompareMode; label: string; shortLabel: string }[]).map(({ v, label, shortLabel }) => {
                          const isActive = compareMode === v;
                          return (
                            <button key={v} type="button" onClick={() => setCompareMode(v)} style={{
                              padding: "5px 11px", borderRadius: 7,
                              border: isActive ? `1px solid rgba(${ink},0.28)` : "1px solid transparent",
                              background: isActive ? `rgba(${ink},0.09)` : "transparent",
                              color: isActive ? `rgba(${ink},0.90)` : `rgba(${ink},0.45)`,
                              font: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer",
                              transition: "all 140ms ease", whiteSpace: "nowrap",
                            }}>
                              <span className="ts-chartLabelFull">{label}</span>
                              <span className="ts-chartLabelShort">{shortLabel}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* ── Entity selectors ── */}
                    <div className="ts-chartEntityRow" style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
                      {(["A","B"] as const).map(slot => {
                        const entity   = slot === "A" ? chartEntityA : chartEntityB;
                        const setEntity= slot === "A" ? setChartEntityA : setChartEntityB;
                        const color    = slot === "A" ? colorA : colorB;
                        const opts     = chartEntityOptionsFor(slot);
                        const isAthleteSlot = compareMode === "athlete-athlete" || (compareMode === "athlete-team" && slot === "A");
                        const slotLabel = compareMode === "athlete-team" ? (slot === "A" ? "Athlete" : "Team") : compareMode === "team-team" ? "Team" : "Athlete";
                        return (
                          <div key={slot} className="ts-chartEntityItem" style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            {/* Color swatch */}
                            <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0, boxShadow: `0 0 6px ${color}88` }} />
                            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true"
                                style={{ position: "absolute", left: 9, pointerEvents: "none", opacity: 0.45, flexShrink: 0 }}>
                                {isAthleteSlot
                                  ? <><circle cx="7" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.4"/><path d="M2 12c0-2.761 2.239-4 5-4s5 1.239 5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>
                                  : <><rect x="2" y="5" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M5 5V3.5a2 2 0 0 1 4 0V5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>
                                }
                              </svg>
                              <select
                                className="ts-chartEntitySelect"
                                value={entity?.id ?? ""}
                                onChange={e => {
                                  const id  = e.target.value;
                                  const opt = opts.find(o => o.id === id) ?? null;
                                  setEntity(opt);
                                }}
                                style={{
                                  background: entity ? `${color}18` : `rgba(${ink},0.05)`,
                                  border: entity ? `1px solid ${color}55` : `1px solid rgba(${ink},0.13)`,
                                  borderRadius: 10, color: entity ? color : "inherit",
                                  font: "inherit", fontSize: 12, fontWeight: 700,
                                  padding: "7px 12px 7px 27px",
                                  cursor: "pointer", outline: "none", appearance: "none",
                                  minWidth: 160, transition: "all 150ms ease",
                                }}
                              >
                                <option value="">{slotLabel} {slot}…</option>
                                {isAthleteSlot ? (
                                  opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)
                                ) : (
                                  <>
                                    {opts.filter((o: any) => o.teamType === "core").length > 0 && (
                                      <optgroup label="── Full Roster">
                                        {opts.filter((o: any) => o.teamType === "core").map(o => (
                                          <option key={o.id} value={o.id}>{o.label}</option>
                                        ))}
                                      </optgroup>
                                    )}
                                    {opts.filter((o: any) => o.teamType !== "core").length > 0 && (
                                      <optgroup label="── Sub-Teams">
                                        {opts.filter((o: any) => o.teamType !== "core").map(o => (
                                          <option key={o.id} value={o.id}>{o.label}</option>
                                        ))}
                                      </optgroup>
                                    )}
                                  </>
                                )}
                              </select>
                            </div>
                          </div>
                        );
                      })}

                      {/* Description */}
                      <span className="ts-chartDesc" style={{ fontSize: 11, opacity: 0.38, marginLeft: 4 }}>{meta.description} · {meta.mode}</span>
                    </div>

                    {/* ── Chart area ── */}
                    <div style={{
                      borderRadius: 12, border: divider,
                      background: `rgba(${ink},${isDark ? "0.025" : "0.018"})`,
                      padding: "16px 16px 10px",
                      position: "relative", overflow: "hidden",
                    }}>
                      {/* Legend */}
                      <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
                        {[
                          { entity: chartEntityA, color: colorA, loading: chartLoadingA },
                          { entity: chartEntityB, color: colorB, loading: chartLoadingB },
                        ].map(({ entity, color, loading }, i) => entity && (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <svg width="20" height="3" viewBox="0 0 20 3"><line x1="0" y1="1.5" x2="20" y2="1.5" stroke={color} strokeWidth="2" strokeDasharray={i === 1 ? "4 2" : "none"}/></svg>
                            <span style={{ fontSize: 11, fontWeight: 700, color, opacity: loading ? 0.5 : 1 }}>
                              {entity.label}{loading ? " (loading…)" : ""}
                            </span>
                          </div>
                        ))}
                        {/* Hover tooltip */}
                        {chartHoverIdx != null && hoverWeek && (
                          <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center", fontSize: 11, fontWeight: 700 }}>
                            <span style={{ opacity: 0.4 }}>{fmtWeek(hoverWeek)}</span>
                            {hoverA != null && <span style={{ color: colorA }}>{hoverA} <span style={{ opacity: 0.5, fontWeight: 600 }}>{meta.unit}</span></span>}
                            {hoverB != null && <span style={{ color: colorB }}>{hoverB} <span style={{ opacity: 0.5, fontWeight: 600 }}>{meta.unit}</span></span>}
                          </div>
                        )}
                      </div>

                      {/* SVG chart */}
                      {isLoading ? (
                        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
                          {/* Y-axis skeleton labels */}
                          {Array.from({ length: 5 }).map((_, i) => {
                            const y = padT + (chartH / 4) * i;
                            return (
                              <g key={i}>
                                <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="rgba(128,128,128,0.08)" strokeWidth="1"/>
                                <rect x={0} y={y - 5} width={32} height={10} rx={3} className="ts-skel" />
                              </g>
                            );
                          })}
                          {/* X-axis skeleton labels */}
                          {Array.from({ length: 5 }).map((_, i) => {
                            const x = padL + (chartW / 4) * i;
                            return <rect key={i} x={x - 14} y={H - padB + 6} width={28} height={9} rx={3} className="ts-skel" />;
                          })}
                          {/* Skeleton line A */}
                          <rect x={padL} y={padT + chartH * 0.3} width={chartW} height={3} rx={2} className="ts-skel" style={{ opacity: 0.7 }} />
                          {/* Skeleton line B (dashed look — two segments) */}
                          <rect x={padL} y={padT + chartH * 0.55} width={chartW * 0.45} height={3} rx={2} className="ts-skel" style={{ opacity: 0.45 }} />
                          <rect x={padL + chartW * 0.55} y={padT + chartH * 0.55} width={chartW * 0.45} height={3} rx={2} className="ts-skel" style={{ opacity: 0.45 }} />
                        </svg>
                      ) : !chartEntityA && !chartEntityB ? (
                        <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.28, fontSize: 13 }}>Select entities above to render the chart.</div>
                      ) : !hasData ? (
                        <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.28, fontSize: 13 }}>No {meta.mode.toLowerCase()} found for the selected entities.</div>
                      ) : (
                        <svg
                          width="100%" viewBox={`0 0 ${W} ${H}`}
                          style={{ overflow: "visible", display: "block", cursor: "crosshair" }}
                          onMouseLeave={() => setChartHoverIdx(null)}
                          onMouseMove={e => {
                            if (!allWeeks.length) return;
                            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                            const mouseX = (e.clientX - rect.left) / rect.width * W;
                            const closestIdx = allWeeks.reduce((best, _, i) => {
                              const dx = Math.abs(xPos(i) - mouseX);
                              return dx < Math.abs(xPos(best) - mouseX) ? i : best;
                            }, 0);
                            setChartHoverIdx(closestIdx);
                          }}
                        >
                          {/* Y-axis gridlines + labels */}
                          {yTickVals.map(v => (
                            <g key={v}>
                              <line x1={padL} y1={yPos(v)} x2={W - padR} y2={yPos(v)} stroke={`rgba(${ink},${isDark ? "0.08" : "0.07"})`} strokeWidth="1"/>
                              <text x={padL - 6} y={yPos(v) + 4} textAnchor="end" fontSize="9" fill={`rgba(${ink},0.35)`}>{v}</text>
                            </g>
                          ))}

                          {/* X-axis labels */}
                          {xLabelIndices.map(i => (
                            <text key={i} x={xPos(i)} y={H - 4} textAnchor="middle" fontSize="9" fill={`rgba(${ink},0.35)`}>
                              {fmtWeek(allWeeks[i])}
                            </text>
                          ))}

                          {/* Entity B line (dashed, behind A) */}
                          {chartEntityB && mergedB.some(v => v != null) && (
                            <>
                              <path d={buildPath(mergedB)} fill="none" stroke={colorB} strokeWidth="2" strokeDasharray="5 3" strokeLinecap="round" strokeLinejoin="round" opacity="0.85"/>
                              {mergedB.map((v, i) => v != null && (
                                <circle key={i} cx={xPos(i)} cy={yPos(v)} r={chartHoverIdx === i ? 5 : 3} fill={colorB} opacity={chartHoverIdx === i ? 1 : 0.7}/>
                              ))}
                            </>
                          )}

                          {/* Entity A line (solid, on top) */}
                          {chartEntityA && mergedA.some(v => v != null) && (
                            <>
                              <path d={buildPath(mergedA)} fill="none" stroke={colorA} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.90"/>
                              {mergedA.map((v, i) => v != null && (
                                <circle key={i} cx={xPos(i)} cy={yPos(v)} r={chartHoverIdx === i ? 5 : 3} fill={colorA} opacity={chartHoverIdx === i ? 1 : 0.7}/>
                              ))}
                            </>
                          )}

                          {/* Hover vertical line */}
                          {chartHoverIdx != null && (
                            <line
                              x1={xPos(chartHoverIdx)} y1={padT}
                              x2={xPos(chartHoverIdx)} y2={padT + chartH}
                              stroke={`rgba(${ink},0.22)`} strokeWidth="1" strokeDasharray="3 2"
                            />
                          )}
                        </svg>
                      )}
                    </div>

                    {/* ── Summary stats below chart ── */}
                    {(chartDataA.length > 0 || chartDataB.length > 0) && (() => {
                      function seriesSummary(data: WeekPoint[], color: string, entity: ChartEntity | null) {
                        if (!entity || data.length === 0) return null;
                        const vals = data.map(p => p.value).filter((v): v is number => v != null);
                        if (!vals.length) return null;
                        const avg  = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
                        const peak = Math.max(...vals);
                        const low  = Math.min(...vals);
                        const trend = vals.length >= 2 ? vals[vals.length - 1] - vals[0] : null;
                        return { entity, color, avg, peak, low, trend, count: data.length };
                      }
                      const summaries = [
                        seriesSummary(chartDataA, colorA, chartEntityA),
                        seriesSummary(chartDataB, colorB, chartEntityB),
                      ].filter(Boolean) as NonNullable<ReturnType<typeof seriesSummary>>[];

                      if (!summaries.length) return null;
                      return (
                        <div style={{ display: "grid", gridTemplateColumns: `repeat(${summaries.length}, 1fr)`, gap: 10, marginTop: 14 }}>
                          {summaries.map(s => (
                            <div key={s.entity.id} style={{
                              borderRadius: 10, border: `1px solid ${s.color}28`,
                              background: `${s.color}09`, padding: "12px 14px",
                            }}>
                              <div style={{ fontSize: 11, fontWeight: 800, color: s.color, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                                <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.color }} />
                                {s.entity.label}
                                <span style={{ fontSize: 10, opacity: 0.5, fontWeight: 600, marginLeft: 2 }}>({s.count} weeks)</span>
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                                {[
                                  { label: "Avg",   value: `${s.avg} ${meta.unit}` },
                                  { label: "Peak",  value: `${s.peak} ${meta.unit}` },
                                  { label: "Low",   value: `${s.low} ${meta.unit}` },
                                  { label: "Trend", value: s.trend != null ? `${s.trend > 0 ? "+" : ""}${s.trend} ${meta.unit}` : "—",
                                    color: s.trend == null ? undefined : (chartMetric === "reaction" ? (s.trend < 0 ? "rgba(80,220,160,0.95)" : "rgba(255,100,80,0.90)") : (s.trend > 0 ? "rgba(80,220,160,0.95)" : "rgba(255,100,80,0.90)")) },
                                ].map(stat => (
                                  <div key={stat.label}>
                                    <div style={{ fontSize: 9, fontWeight: 600, opacity: 0.4, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>{stat.label}</div>
                                    <div style={{ fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: (stat as any).color ?? `rgba(${ink},0.88)` }}>{stat.value}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
            </div>
          </div>
        </>
      ) : activeTab === "insights" ? (() => {
        const isLoadingAny = strengthLoading || reactionLoading || accuracyLoading;
        const hasAnyData   = strengthRows.length > 0 || reactionRows.length > 0 || accuracyRows.length > 0;
        const ink          = isDark ? "255,255,255" : "20,20,40";

        // ── DATE RANGE FILTER — shared across empty + populated states so it is
        //    always visible (otherwise narrowing to a range with no data would
        //    flip to the onboarding view and hide the control, trapping the user).
        const dateRangeBar = (
          <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", opacity: 0.45 }}>Date Range</span>
              <span style={{ fontSize: 11, opacity: 0.32 }}>Applies to all leaderboards &amp; Most Improved</span>
            </div>
            <div style={{ display: "inline-flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
              {/* Export is Tier II. Kept visible but disabled rather than
                  removed — a coach who cannot see the button cannot be sold it. */}
              <button
                type="button"
                className="ts-btn ts-btnGhost"
                onClick={() => ent.can("csvExport") && setShowExport(true)}
                disabled={!ent.can("csvExport")}
                title={ent.can("csvExport") ? undefined : "CSV export is included from Tier II"}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, height: 38,
                  opacity: ent.can("csvExport") ? 1 : 0.5,
                  cursor: ent.can("csvExport") ? "pointer" : "not-allowed",
                }}
              >
                <IconDownload size={15} /> Export CSV
                {!ent.can("csvExport") && (
                  <LockBadge tier={ent.requiredTier("csvExport")} compact style={{ marginLeft: 2 }} />
                )}
              </button>
              <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
                <label className="ts-leaderLabel" htmlFor="leaderDateRange">Range</label>
                {/* Only the windows the tier's history actually covers. Offering
                    "All time" to a 30-day plan would return 30 days and read as
                    a bug rather than as a limit. */}
                <select
                  id="leaderDateRange"
                  className="ts-select"
                  value={String(leaderDateRange)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLeaderDateRange(v === "all" ? "all" : (Number(v) as LeaderDateRange));
                  }}
                >
                  {availableRanges.map((r) => (
                    <option key={String(r)} value={String(r)}>
                      {r === "all" ? "All time" : `Last ${r} days`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        );

        // ── Full onboarding state — shown while loading finishes or when truly no data ──
        if (!isLoadingAny && !hasAnyData) return (
          <div className="ts-dashGrid ts-dashMain">
            {dateRangeBar}
            <div style={{ gridColumn: "1 / -1" }}>

              {/* Hero prompt */}
              <div style={{
                borderRadius: 16,
                border: isDark ? "1px solid rgba(180,0,255,0.22)" : "1px solid rgba(180,0,255,0.18)",
                background: isDark ? "rgba(180,0,255,0.07)" : "rgba(180,0,255,0.04)",
                padding: "36px 40px",
                marginBottom: 20,
                display: "flex", alignItems: "flex-start", gap: 24, flexWrap: "wrap",
              }}>
                {/* Icon */}
                <div style={{
                  width: 56, height: 56, borderRadius: 14, flexShrink: 0,
                  background: isDark ? "rgba(180,0,255,0.18)" : "rgba(180,0,255,0.12)",
                  border: "1px solid rgba(180,0,255,0.30)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: isDark ? "rgba(210,140,255,0.95)" : "rgba(120,0,200,0.90)",
                }}><IconBarChart size={26} /></div>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8, color: isDark ? "rgba(210,140,255,0.95)" : "rgba(120,0,200,0.90)" }}>
                    Your leaderboards will appear here
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.65, opacity: 0.72, maxWidth: 560 }}>
                    Start recording sessions to unlock rankings, improvement trends, and team comparisons.
                    Each section has a minimum session threshold — here's what to aim for first.
                  </div>
                </div>
              </div>

              {/* Unlock cards grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 20 }}>
                {[
                  {
                    Icon: IconGauge, label: "Athlete Leaderboard", accentColor: "#b400ff",
                    accentBg: isDark ? "rgba(180,0,255,0.10)" : "rgba(180,0,255,0.06)",
                    accentBdr: isDark ? "rgba(180,0,255,0.28)" : "rgba(180,0,255,0.20)",
                    steps: [
                      "Record Power sessions for your athletes",
                      "3+ sessions per athlete generates a Strength Index",
                      "Rankings update automatically after each session",
                    ],
                  },
                  {
                    Icon: IconBullseye, label: "Accuracy Leaderboard", accentColor: "#00dcff",
                    accentBg: isDark ? "rgba(0,220,255,0.08)" : "rgba(0,220,255,0.05)",
                    accentBdr: isDark ? "rgba(0,220,255,0.25)" : "rgba(0,220,255,0.18)",
                    steps: [
                      "Record Accuracy sessions for your athletes",
                      "Each session logs accuracy % and avg offset",
                      "Scores aggregate across all accuracy sessions",
                    ],
                  },
                  {
                    Icon: IconStopwatch, label: "Reaction Leaderboard", accentColor: "#ffcc00",
                    accentBg: isDark ? "rgba(255,200,0,0.08)" : "rgba(255,200,0,0.05)",
                    accentBdr: isDark ? "rgba(255,200,0,0.25)" : "rgba(255,200,0,0.18)",
                    steps: [
                      "Record Reaction sessions for your athletes",
                      "Avg and best reaction times are tracked per session",
                      "Top 5 athletes ranked by fastest avg response",
                    ],
                  },
                  {
                    Icon: IconTrendUp, label: "Most Improved", accentColor: isDark ? "rgba(80,220,160,0.95)" : "rgba(15,130,80,0.90)",
                    accentBg: isDark ? "rgba(80,220,160,0.08)" : "rgba(15,130,80,0.05)",
                    accentBdr: isDark ? "rgba(80,220,160,0.24)" : "rgba(15,130,80,0.18)",
                    steps: [
                      "Requires 4+ sessions per athlete in any one mode",
                      "Compares first half vs last half of session history",
                      "Automatically updates as more sessions are recorded",
                    ],
                  },
                ].map(({ Icon, label, accentColor, accentBg, accentBdr, steps }) => (
                  <div key={label} style={{
                    borderRadius: 12,
                    border: `1px solid ${accentBdr}`,
                    background: accentBg,
                    padding: "16px 18px",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ display: "flex", color: accentColor }}><Icon size={18} /></span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: accentColor }}>{label}</span>
                    </div>
                    <ol style={{ margin: 0, padding: "0 0 0 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                      {steps.map((step, si) => (
                        <li key={si} style={{ fontSize: 12, lineHeight: 1.55, opacity: 0.72 }}>{step}</li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>

              {/* Quick-start CTA */}
              <div style={{
                borderRadius: 12,
                border: `1px solid rgba(${ink},${isDark ? "0.08" : "0.09"})`,
                background: `rgba(${ink},${isDark ? "0.03" : "0.025"})`,
                padding: "14px 20px",
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ display: "flex", flexShrink: 0, opacity: 0.75 }}><IconRocket size={18} /></span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Ready to get started?</div>
                    <div style={{ fontSize: 12, opacity: 0.55 }}>Head to the Recent Sessions tab and record your first Power session.</div>
                  </div>
                </div>
                <button
                  type="button"
                  className="ts-btn ts-btnSecondary"
                  onClick={() => setActiveTab("recent")}
                  style={{ fontSize: 12, padding: "8px 16px", whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  Go to Recent Sessions →
                </button>
              </div>

            </div>
          </div>
        );

        // ── Normal populated state ──
        return (
        <div className="ts-dashGrid ts-dashMain">

          {/* ── DATE RANGE FILTER — controls all leaderboards + most improved ── */}
          {dateRangeBar}

          {/* ── ATHLETE SECTION HEADER ── */}
          <div className="ts-span2" style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 12, paddingBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.45 }}>Athletes</div>
            <div style={{ flex: 1, height: 1, background: isDark ? "rgba(255,255,255,0.08)" : "rgba(20,20,40,0.10)" }} />
          </div>

          {/* Athlete Leaderboard */}
          <div className="ts-card ts-span2">
            <div className="ts-cardTop">
              <div className="ts-cardTitle">Athlete Leaderboard</div>
              <div className="ts-cardMeta">
                {leaderMetric === "strength"
                  ? strengthLoading ? "Loading…" : `${strengthRows.length} athletes · ${leaderDateRange === "all" ? "all time" : `last ${leaderDateRange}d`}`
                  : leaderMetric === "reaction"
                  ? reactionLoading ? "Loading…" : reactionRows.length > 0 ? `${reactionRows.length} athletes · ${leaderDateRange === "all" ? "all time" : `last ${leaderDateRange}d`}` : "no data yet"
                  : leaderMetric === "volume"
                  ? volumeInsightRows.length > 0 ? `${volumeInsightRows.length} athletes · ${leaderDateRange === "all" ? "all time" : `last ${leaderDateRange}d`}` : "no data yet"
                  : leaderMetric === "target"
                  ? targetInsightRows.length > 0 ? `${targetInsightRows.length} athletes · ${leaderDateRange === "all" ? "all time" : `last ${leaderDateRange}d`}` : "no data yet"
                  : accuracyLoading ? "Loading…" : accuracyRows.length > 0 ? `${accuracyRows.length} athletes · ${leaderDateRange === "all" ? "all time" : `last ${leaderDateRange}d`}` : "no data yet"}
              </div>
            </div>

            <div className="ts-leaderTop">
              <div className="ts-leaderNote">
                {leaderMetric === "strength"
                  ? "Top athletes by Strength Index (0–1000), derived from peak & avg force across all power sessions."
                  : leaderMetric === "reaction"
                  ? "Top athletes by avg reaction time — lower is better. Best = fastest single response."
                  : leaderMetric === "volume"
                  ? "Top athletes by total hits across volume sessions, with avg Strength Index showing output quality."
                  : leaderMetric === "target"
                  ? "Top athletes by zone accuracy %. Avg RT is correct-zone reaction time only — lower is better."
                  : "Top athletes by Accuracy Score (0–100%) across all accuracy sessions."}
              </div>
              <div className="ts-leaderControls">
                <label className="ts-leaderLabel" htmlFor="leaderMetric">Mode</label>
                <select id="leaderMetric" className="ts-select" value={leaderMetric} onChange={(e) => setLeaderMetric(e.target.value as MetricKey)}>
                  <option value="strength">Power</option>
                  <option value="reaction">Reaction</option>
                  <option value="accuracy">Accuracy</option>
                  <option value="volume">Volume</option>
                  <option value="target">Target</option>
                </select>
              </div>
            </div>

            <div className="ts-leaderTable" role="table" aria-label="Athlete Leaderboard">
              <div className="ts-leaderRow ts-leaderHead" role="row">
                <div className="ts-leaderCell rank" role="columnheader">#</div>
                <div className="ts-leaderCell name" role="columnheader">Athlete</div>
                {leaderMetric === "strength" ? (<>
                  <div className="ts-leaderCell" role="columnheader">Peak Index</div>
                  <div className="ts-leaderCell" role="columnheader">Avg Index</div>
                  <div className="ts-leaderCell" role="columnheader">Sessions</div>
                </>) : leaderMetric === "reaction" ? (<>
                  <div className="ts-leaderCell" role="columnheader">Avg Reaction</div>
                  <div className="ts-leaderCell" role="columnheader">Best</div>
                  <div className="ts-leaderCell" role="columnheader">Attempts</div>
                </>) : leaderMetric === "volume" ? (<>
                  <div className="ts-leaderCell" role="columnheader">Avg Events / Win</div>
                  <div className="ts-leaderCell" role="columnheader">Avg SI</div>
                  <div className="ts-leaderCell" role="columnheader">Sessions</div>
                </>) : leaderMetric === "target" ? (<>
                  <div className="ts-leaderCell" role="columnheader">Accuracy</div>
                  <div className="ts-leaderCell" role="columnheader">Avg RT (correct)</div>
                  <div className="ts-leaderCell" role="columnheader">Attempts</div>
                </>) : (<>
                  <div className="ts-leaderCell" role="columnheader">Accuracy %</div>
                  <div className="ts-leaderCell" role="columnheader">Avg Offset</div>
                  <div className="ts-leaderCell" role="columnheader">Sessions</div>
                </>)}
              </div>

              {leaderMetric === "strength" ? (
                strengthLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 4 }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 8px" }}>
                      <Skel w={20} h={12} r={4} />
                      <Skel w={`${30 + (i % 3) * 10}%`} h={13} />
                      <div style={{ marginLeft: "auto", display: "flex", gap: 24 }}>
                        <Skel w={40} h={13} />
                        <Skel w={36} h={13} />
                        <Skel w={24} h={13} />
                      </div>
                    </div>
                  ))}
                </div>)
                : strengthRows.length === 0 ? (
                <div style={{ padding: "24px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
                  <ModeIcon mode="power" size={26} style={{ opacity: 0.45 }} />
                  <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.65 }}>No strength data yet</div>
                  <div style={{ fontSize: 12, opacity: 0.42, maxWidth: 300, lineHeight: 1.6 }}>Record Power sessions for your athletes. 3+ sessions per athlete generates a Strength Index ranking.</div>
                </div>)
                : strengthRows.map((row, idx) => (
                  <div
                    key={row.athleteId}
                    className="ts-leaderRow ts-leaderRowClickable"
                    role="row"
                    tabIndex={0}
                    aria-label={`View sessions for ${row.name}`}
                    title={`View sessions for ${row.name}`}
                    onClick={() => goToSessionsForAthlete(row.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        goToSessionsForAthlete(row.name);
                      }
                    }}
                  >
                    <div className="ts-leaderCell rank" role="cell">{idx + 1}</div>
                    <div className="ts-leaderCell name" role="cell">
                      <div className="ts-leaderName">{row.name}</div>
                      <div className="ts-leaderSub">Power profile</div>
                    </div>
                    <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(210,140,255,0.95)" }}>{row.peakIndex}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>/1000</span></div>
                    <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(210,140,255,0.95)" }}>{row.avgIndex}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>/1000</span></div>
                    <div className="ts-leaderCell" role="cell">{row.sessions}</div>
                  </div>
                ))
              ) : leaderMetric === "reaction" ? (
                reactionLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 4 }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 8px" }}>
                      <Skel w={20} h={12} r={4} />
                      <Skel w={`${30 + (i % 3) * 10}%`} h={13} />
                      <div style={{ marginLeft: "auto", display: "flex", gap: 24 }}>
                        <Skel w={44} h={13} />
                        <Skel w={36} h={13} />
                        <Skel w={28} h={13} />
                      </div>
                    </div>
                  ))}
                </div>)
                : reactionRows.length === 0 ? (
                <div style={{ padding: "24px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
                  <ModeIcon mode="reaction" size={26} style={{ opacity: 0.45 }} />
                  <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.65 }}>No reaction data yet</div>
                  <div style={{ fontSize: 12, opacity: 0.42, maxWidth: 300, lineHeight: 1.6 }}>Record Reaction sessions to start tracking response times. Rankings show avg and best reaction ms per athlete.</div>
                </div>)
                : reactionRows.map((row, idx) => (
                  <div
                    key={row.athleteId}
                    className="ts-leaderRow ts-leaderRowClickable"
                    role="row"
                    tabIndex={0}
                    aria-label={`View sessions for ${row.name}`}
                    title={`View sessions for ${row.name}`}
                    onClick={() => goToSessionsForAthlete(row.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        goToSessionsForAthlete(row.name);
                      }
                    }}
                  >
                    <div className="ts-leaderCell rank" role="cell">{idx + 1}</div>
                    <div className="ts-leaderCell name" role="cell">
                      <div className="ts-leaderName">{row.name}</div>
                      <div className="ts-leaderSub">Reaction profile</div>
                    </div>
                    <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(255,210,60,0.95)" }}>{row.avgReactionMs}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>ms avg</span></div>
                    <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums" }}>{row.bestReactionMs}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>ms best</span></div>
                    <div className="ts-leaderCell" role="cell">{row.attempts}</div>
                  </div>
                ))
              ) : leaderMetric === "volume" ? (
                volumeInsightRows.length === 0 ? (
                <div style={{ padding: "24px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
                  <ModeIcon mode="volume" size={26} style={{ opacity: 0.45 }} />
                  <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.65 }}>No volume data yet</div>
                  <div style={{ fontSize: 12, opacity: 0.42, maxWidth: 300, lineHeight: 1.6 }}>Record Volume sessions to track hit counts and output quality per athlete.</div>
                </div>)
                : volumeInsightRows.slice(0, 5).map((row, idx) => (
                  <div
                    key={row.athleteId}
                    className="ts-leaderRow ts-leaderRowClickable"
                    role="row"
                    tabIndex={0}
                    aria-label={`View sessions for ${row.name}`}
                    title={`View sessions for ${row.name}`}
                    onClick={() => goToSessionsForAthlete(row.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        goToSessionsForAthlete(row.name);
                      }
                    }}
                  >
                    <div className="ts-leaderCell rank" role="cell">{idx + 1}</div>
                    <div className="ts-leaderCell name" role="cell">
                      <div className="ts-leaderName">{row.name}</div>
                      <div className="ts-leaderSub">Volume profile · {row.sessions} session{row.sessions !== 1 ? "s" : ""}</div>
                    </div>
                    <div className="ts-leaderCell" role="cell">
                      <span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(255,150,60,0.95)" }}>{row.avgWindowHits}</span>
                      <span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>events/win</span>
                    </div>
                    <div className="ts-leaderCell" role="cell">
                      {row.avgSi != null
                        ? <><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(255,150,60,0.95)" }}>{row.avgSi}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>/1000</span></>
                        : <span style={{ opacity: 0.35 }}>—</span>}
                    </div>
                    <div className="ts-leaderCell" role="cell">{row.sessions}</div>
                  </div>
                ))
              ) : leaderMetric === "target" ? (
                targetInsightRows.length === 0 ? (
                <div style={{ padding: "24px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
                  <ModeIcon mode="target" size={26} style={{ opacity: 0.45 }} />
                  <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.65 }}>No target data yet</div>
                  <div style={{ fontSize: 12, opacity: 0.42, maxWidth: 300, lineHeight: 1.6 }}>Record Target sessions to rank athletes by zone accuracy and correct-zone reaction time.</div>
                </div>)
                : targetInsightRows.slice(0, 5).map((row, idx) => (
                  <div
                    key={row.athleteId}
                    className="ts-leaderRow ts-leaderRowClickable"
                    role="row"
                    tabIndex={0}
                    aria-label={`View sessions for ${row.name}`}
                    title={`View sessions for ${row.name}`}
                    onClick={() => goToSessionsForAthlete(row.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        goToSessionsForAthlete(row.name);
                      }
                    }}
                  >
                    <div className="ts-leaderCell rank" role="cell">{idx + 1}</div>
                    <div className="ts-leaderCell name" role="cell">
                      <div className="ts-leaderName">{row.name}</div>
                      <div className="ts-leaderSub">Target profile · {row.attempts} attempt{row.attempts !== 1 ? "s" : ""}</div>
                    </div>
                    <div className="ts-leaderCell" role="cell">
                      <span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(0,220,110,0.95)" }}>{row.avgAccuracyPct}</span>
                      <span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>%</span>
                    </div>
                    <div className="ts-leaderCell" role="cell">
                      {row.avgReactionMsCorrect != null
                        ? <><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(255,210,60,0.95)" }}>{row.avgReactionMsCorrect}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>ms</span></>
                        : <span style={{ opacity: 0.35 }}>—</span>}
                    </div>
                    <div className="ts-leaderCell" role="cell">{row.attempts}</div>
                  </div>
                ))
              ) : (
                accuracyLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 4 }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 8px" }}>
                      <Skel w={20} h={12} r={4} />
                      <Skel w={`${30 + (i % 3) * 10}%`} h={13} />
                      <div style={{ marginLeft: "auto", display: "flex", gap: 24 }}>
                        <Skel w={36} h={13} />
                        <Skel w={40} h={13} />
                        <Skel w={24} h={13} />
                      </div>
                    </div>
                  ))}
                </div>)
                : accuracyRows.length === 0 ? (
                <div style={{ padding: "24px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
                  <ModeIcon mode="accuracy" size={26} style={{ opacity: 0.45 }} />
                  <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.65 }}>No accuracy data yet</div>
                  <div style={{ fontSize: 12, opacity: 0.42, maxWidth: 300, lineHeight: 1.6 }}>Record Accuracy sessions to track placement scores and avg offset. Each session logs accuracy % automatically.</div>
                </div>)
                : accuracyRows.map((row, idx) => (
                  <div
                    key={row.athleteId}
                    className="ts-leaderRow ts-leaderRowClickable"
                    role="row"
                    tabIndex={0}
                    aria-label={`View sessions for ${row.name}`}
                    title={`View sessions for ${row.name}`}
                    onClick={() => goToSessionsForAthlete(row.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        goToSessionsForAthlete(row.name);
                      }
                    }}
                  >
                    <div className="ts-leaderCell rank" role="cell">{idx + 1}</div>
                    <div className="ts-leaderCell name" role="cell">
                      <div className="ts-leaderName">{row.name}</div>
                      <div className="ts-leaderSub">Accuracy profile</div>
                    </div>
                    <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(80,220,255,0.95)" }}>{row.accuracyPct}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>%</span></div>
                    <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums" }}>{row.avgOffsetCm > 0 ? row.avgOffsetCm : "—"}</span>{row.avgOffsetCm > 0 && <span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>offset</span>}</div>
                    <div className="ts-leaderCell" role="cell">{row.sessions}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Athlete Most Improved — Tier II. It ranks change rather than
              level, which needs the 90-day window Tier II unlocks; on a 30-day
              history the split would compare two weeks against two weeks. */}
          {!ent.can("mostImproved") ? (
            <LockedPanel
              feature="mostImproved"
              requiredTier={ent.requiredTier("mostImproved")}
              title="Most Improved"
              isDark={isDark}
              minHeight={200}
            >
              <SampleTable
                isDark={isDark}
                columns={["Athlete", "Change", "Metric"]}
                rows={SAMPLE_IMPROVED_ROWS.map((r) => [r.name, r.delta, r.metric])}
              />
            </LockedPanel>
          ) : (
          <div className="ts-card">
            <div className="ts-cardTop">
              <div className="ts-cardTitle">Most Improved</div>
              <div className="ts-cardMeta">{athleteImprovedLoading ? "Loading…" : athleteImprovedRows.length > 0 ? `${athleteImprovedRows.length} athletes` : "needs more data"}</div>
            </div>

            {/* Metric selector */}
            <div style={{ display: "inline-flex", background: isDark ? "rgba(255,255,255,0.04)" : "rgba(20,20,40,0.04)", border: `1px solid ${isDark ? "rgba(255,255,255,0.10)" : "rgba(20,20,40,0.10)"}`, borderRadius: 9, padding: 3, gap: 2, marginBottom: 14 }}>
              {(["strength","reaction","accuracy","form"] as MetricKey[]).map(m => {
                const isActive = athleteImprovedMetric === m;
                const accent   = m === "accuracy" ? "#00dcff" : m === "reaction" ? "#ffcc00" : m === "form" ? (isDark ? "rgba(255,255,255,0.80)" : "rgba(20,20,40,0.80)") : "#b400ff";
                const accentBg = m === "accuracy" ? "rgba(0,220,255,0.12)" : m === "reaction" ? "rgba(255,200,0,0.12)" : m === "form" ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(20,20,40,0.07)") : "rgba(180,0,255,0.16)";
                const accentBdr= m === "accuracy" ? "rgba(0,220,255,0.35)" : m === "reaction" ? "rgba(255,200,0,0.35)" : m === "form" ? (isDark ? "rgba(255,255,255,0.22)" : "rgba(20,20,40,0.22)") : "rgba(180,0,255,0.40)";
                return (
                  <button key={m} type="button" onClick={() => setAthleteImprovedMetric(m)} style={{ padding: "4px 10px", borderRadius: 6, border: isActive ? `1px solid ${accentBdr}` : "1px solid transparent", background: isActive ? accentBg : "transparent", color: isActive ? accent : isDark ? "rgba(255,255,255,0.45)" : "rgba(20,20,40,0.45)", font: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer", textTransform: "capitalize", transition: "all 130ms ease" }}>
                    <ModeIcon mode={m} size={12} style={{ marginRight: 5 }} />
                    {m === "form" ? "Form" : m}
                  </button>
                );
              })}
            </div>

            {athleteImprovedLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(128,128,128,0.08)" }}>
                    <Skel w={20} h={12} r={4} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                      <Skel w={`${40 + (i % 3) * 15}%`} h={12} />
                      <Skel w="55%" h={9} />
                    </div>
                    <Skel w={72} h={24} r={999} />
                  </div>
                ))}
              </div>
            ) : athleteImprovedRows.length === 0 ? (
              <div className="ts-mostImproved">
                <div className="ts-mostRow">
                  <div className="ts-miLabel">
                    <div className="ts-miTitle" style={{ fontSize: 13 }}>
                      <ModeIcon mode={athleteImprovedMetric} size={13} style={{ marginRight: 6 }} />
                      {athleteImprovedMetric === "form" ? "Form & Angle" : athleteImprovedMetric === "strength" ? "Strength" : athleteImprovedMetric === "reaction" ? "Reaction" : "Accuracy"}
                    </div>
                    <div className="ts-miSubtitle">needs 4+ sessions per athlete to compute trend</div>
                  </div>
                  <div className="ts-miBody"><div className="ts-miName" style={{ opacity: 0.3 }}>—</div></div>
                </div>
              </div>
            ) : (
              <div className="ts-mostImproved">
                {athleteImprovedRows.map((row, idx) => {
                  const isForm     = athleteImprovedMetric === "form";
                  const isPositive = row.delta > 0;
                  const accent = athleteImprovedMetric === "accuracy" ? "#00dcff" : athleteImprovedMetric === "reaction" ? "#ffcc00" : isForm ? (isDark ? "rgba(255,255,255,0.80)" : "rgba(20,20,40,0.80)") : "#b400ff";
                  const unit   = athleteImprovedMetric === "reaction" ? "ms" : athleteImprovedMetric === "accuracy" ? "%" : isForm ? "°" : "pts";
                  const fromVal = isForm ? `${row.from}°` : `${row.from}${unit}`;
                  const toVal   = isForm ? `${row.to}°`   : `${row.to}${unit}`;
                  const dirLabel= isForm ? (isPositive ? "↗ more neutral" : "↘ more biased") : (isPositive ? "▲" : "▼");
                  return (
                    <div key={row.athleteId} className="ts-mostRow">
                      <div className="ts-leaderCell rank" style={{ fontSize: 13, fontWeight: 800, opacity: 0.4, minWidth: 24 }}>{idx + 1}</div>
                      <div className="ts-miLabel" style={{ minWidth: 0, flex: 1 }}>
                        <div className="ts-miTitle" style={{ fontSize: 13 }}>{row.name}</div>
                        <div className="ts-miSubtitle">{fromVal} → {toVal}{isForm ? " avg bias" : ""} · {row.sessions} sessions</div>
                      </div>
                      <div className="ts-miPills">
                        <div className="ts-improvePill" style={{ color: isPositive ? accent : "rgba(255,100,80,0.90)", borderColor: isPositive ? `${accent}40` : "rgba(255,100,80,0.30)", background: isPositive ? `${accent}10` : "rgba(255,100,80,0.08)", fontSize: 12 }}>
                          {dirLabel} {isForm ? `${Math.abs(row.delta)}°` : `${Math.abs(row.delta)} ${unit}`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

          {/* ── TEAM SECTION DIVIDER ── */}
          <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 12, paddingTop: 8, paddingBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.45 }}>Teams</div>
            <div style={{ flex: 1, height: 1, background: isDark ? "rgba(255,255,255,0.08)" : "rgba(20,20,40,0.10)" }} />
          </div>

          {/* Team Leaderboard — Tier II. A leaderboard is meaningless without a
              cohort to populate it, which is why team comparison starts here. */}
          {!ent.can("teamComparison") ? (
            <LockedPanel
              feature="teamComparison"
              requiredTier={ent.requiredTier("teamComparison")}
              title="Team Leaderboard"
              isDark={isDark}
              minHeight={220}
            >
              <SampleTable
                isDark={isDark}
                columns={["Team", "Avg SI", "Athletes"]}
                rows={SAMPLE_TEAM_ROWS.map((r) => [r.name, r.avg, r.athletes])}
              />
            </LockedPanel>
          ) : (
          <div className="ts-card ts-span2">
            <div className="ts-cardTop">
              <div className="ts-cardTitle">Team Leaderboard</div>
              <div className="ts-cardMeta">{teamLeaderLoading ? "Loading…" : teamLeaderRows.length > 0 ? `${teamLeaderRows.length} teams · ${leaderDateRange === "all" ? "all time" : `last ${leaderDateRange}d`}` : "no data yet"}</div>
            </div>

            <div className="ts-leaderTop">
              <div className="ts-leaderNote">
                {teamLeaderMetric === "strength"
                  ? "Teams ranked by avg peak strength index across all power sessions. Core = full roster, Sub = smaller groups."
                  : teamLeaderMetric === "reaction"
                  ? "Teams ranked by avg reaction time across all reaction sessions — lower is better."
                  : teamLeaderMetric === "volume"
                  ? "Teams ranked by total hits across volume sessions. Avg SI shows collective output quality."
                  : teamLeaderMetric === "target"
                  ? "Teams ranked by zone accuracy % across target sessions. Avg RT is correct-zone reaction only."
                  : "Teams ranked by avg accuracy score across all accuracy sessions."}
              </div>
              <div className="ts-leaderControls">
                <label className="ts-leaderLabel" htmlFor="teamLeaderMetric">Mode</label>
                <select id="teamLeaderMetric" className="ts-select" value={teamLeaderMetric} onChange={(e) => setTeamLeaderMetric(e.target.value as MetricKey)}>
                  <option value="strength">Power</option>
                  <option value="reaction">Reaction</option>
                  <option value="accuracy">Accuracy</option>
                  <option value="volume">Volume</option>
                  <option value="target">Target</option>
                </select>
              </div>
            </div>

            <div className="ts-leaderTable" role="table" aria-label="Team Leaderboard">
              <div className="ts-leaderRow ts-leaderHead" role="row">
                <div className="ts-leaderCell rank" role="columnheader">#</div>
                <div className="ts-leaderCell name" role="columnheader">Team</div>
                {teamLeaderMetric === "strength" ? (<>
                  <div className="ts-leaderCell" role="columnheader">Peak Index</div>
                  <div className="ts-leaderCell" role="columnheader">Avg Index</div>
                  <div className="ts-leaderCell" role="columnheader">Sessions</div>
                </>) : teamLeaderMetric === "reaction" ? (<>
                  <div className="ts-leaderCell" role="columnheader">Avg Reaction</div>
                  <div className="ts-leaderCell" role="columnheader">Best</div>
                  <div className="ts-leaderCell" role="columnheader">Sessions</div>
                </>) : teamLeaderMetric === "volume" ? (<>
                  <div className="ts-leaderCell" role="columnheader">Avg Events / Win</div>
                  <div className="ts-leaderCell" role="columnheader">Avg SI</div>
                  <div className="ts-leaderCell" role="columnheader">Sessions</div>
                </>) : teamLeaderMetric === "target" ? (<>
                  <div className="ts-leaderCell" role="columnheader">Accuracy</div>
                  <div className="ts-leaderCell" role="columnheader">Avg RT (correct)</div>
                  <div className="ts-leaderCell" role="columnheader">Sessions</div>
                </>) : (<>
                  <div className="ts-leaderCell" role="columnheader">Accuracy %</div>
                  <div className="ts-leaderCell" role="columnheader">Avg Offset</div>
                  <div className="ts-leaderCell" role="columnheader">Sessions</div>
                </>)}
              </div>

              {teamLeaderLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 4 }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 8px" }}>
                      <Skel w={20} h={12} r={4} />
                      <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Skel w={`${28 + (i % 3) * 10}%`} h={13} />
                          <Skel w={36} h={16} r={999} />
                        </div>
                        <Skel w="35%" h={9} />
                      </div>
                      <div style={{ display: "flex", gap: 24 }}>
                        <Skel w={40} h={13} />
                        <Skel w={36} h={13} />
                        <Skel w={24} h={13} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : teamLeaderRows.length === 0 ? (
                <div style={{ padding: "24px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
                  <span style={{ display: "flex", opacity: 0.5 }}><IconTrophy size={24} /></span>
                  <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.65 }}>No team data for this mode</div>
                  <div style={{ fontSize: 12, opacity: 0.42, maxWidth: 320, lineHeight: 1.6 }}>Record sessions in this mode for athletes on your teams. Core teams aggregate all roster sessions; sub-teams pull from their member athletes.</div>
                </div>
              ) : teamLeaderRows.map((row, idx) => {
                const isCore = row.teamType === "core";
                const typePill = (
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", padding: "2px 6px", borderRadius: 999, marginLeft: 6,
                    background: isCore ? "rgba(180,0,255,0.12)" : isDark ? "rgba(255,255,255,0.07)" : "rgba(20,20,40,0.06)",
                    border:     isCore ? "1px solid rgba(180,0,255,0.28)" : isDark ? "1px solid rgba(255,255,255,0.18)" : "1px solid rgba(20,20,40,0.20)",
                    color:      isCore ? "rgba(210,140,255,0.90)" : isDark ? "rgba(255,255,255,0.75)" : "rgba(20,20,40,0.70)",
                    opacity: 1,
                  }}>
                    {isCore ? "core" : "sub"}
                  </span>
                );
                return (
                  <div key={row.teamId} className="ts-leaderRow" role="row">
                    <div className="ts-leaderCell rank" role="cell">{idx + 1}</div>
                    <div className="ts-leaderCell name" role="cell">
                      <div className="ts-leaderName" style={{ display: "flex", alignItems: "center" }}>{row.name}{typePill}</div>
                      <div className="ts-leaderSub">{row.memberCount} members · {row.sessionCount} sessions</div>
                    </div>
                    {teamLeaderMetric === "strength" ? (<>
                      <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(210,140,255,0.95)" }}>{row.peakIndex ?? "—"}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>/1000</span></div>
                      <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(210,140,255,0.95)" }}>{row.avgIndex ?? "—"}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>/1000</span></div>
                      <div className="ts-leaderCell" role="cell">{row.sessionCount}</div>
                    </>) : teamLeaderMetric === "reaction" ? (<>
                      <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(255,210,60,0.95)" }}>{row.avgReactionMs ?? "—"}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>ms</span></div>
                      <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums" }}>{row.bestReactionMs ?? "—"}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>ms</span></div>
                      <div className="ts-leaderCell" role="cell">{row.sessionCount}</div>
                    </>) : teamLeaderMetric === "volume" ? (<>
                      <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(255,150,60,0.95)" }}>{row.totalHits ?? "—"}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>events/win</span></div>
                      <div className="ts-leaderCell" role="cell">{row.avgSi != null ? <><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(255,150,60,0.95)" }}>{row.avgSi}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>/1000</span></> : <span style={{ opacity: 0.35 }}>—</span>}</div>
                      <div className="ts-leaderCell" role="cell">{row.sessionCount}</div>
                    </>) : teamLeaderMetric === "target" ? (<>
                      <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(0,220,110,0.95)" }}>{row.targetAccuracyPct ?? "—"}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>%</span></div>
                      <div className="ts-leaderCell" role="cell">{row.avgReactionMsCorrect != null ? <><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(255,210,60,0.95)" }}>{row.avgReactionMsCorrect}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>ms</span></> : <span style={{ opacity: 0.35 }}>—</span>}</div>
                      <div className="ts-leaderCell" role="cell">{row.sessionCount}</div>
                    </>) : (<>
                      <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(80,220,255,0.95)" }}>{row.accuracyPct ?? "—"}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>%</span></div>
                      <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums" }}>{row.avgOffsetMm != null ? `${row.avgOffsetMm} mm` : "—"}</span></div>
                      <div className="ts-leaderCell" role="cell">{row.sessionCount}</div>
                    </>)}
                  </div>
                );
              })}
            </div>
          </div>
          )}

          {/* Team Most Improved — needs both team comparison and the change
              ranking, so it unlocks with the rest of Tier II. */}
          {!ent.can("teamComparison") || !ent.can("mostImproved") ? (
            <LockedPanel
              feature="mostImproved"
              requiredTier="II"
              title="Most Improved"
              isDark={isDark}
              minHeight={200}
            >
              <SampleTable
                isDark={isDark}
                columns={["Team", "Change", "Metric"]}
                rows={[
                  ["JV", "+61", "Strength Index"],
                  ["Varsity", "+24", "Strength Index"],
                  ["Freshman", "−12", "Strength Index"],
                ]}
              />
            </LockedPanel>
          ) : (
          <div className="ts-card">
            <div className="ts-cardTop">
              <div className="ts-cardTitle">Most Improved</div>
              <div className="ts-cardMeta">{teamImprovedLoading ? "Loading…" : teamImprovedRows.length > 0 ? `${teamImprovedRows.length} teams` : "needs more data"}</div>
            </div>

            {/* Metric selector */}
            <div style={{ display: "inline-flex", background: isDark ? "rgba(255,255,255,0.04)" : "rgba(20,20,40,0.04)", border: `1px solid ${isDark ? "rgba(255,255,255,0.10)" : "rgba(20,20,40,0.10)"}`, borderRadius: 9, padding: 3, gap: 2, marginBottom: 14 }}>
              {(["strength","reaction","accuracy","form"] as MetricKey[]).map(m => {
                const isActive  = teamImprovedMetric === m;
                const accent    = m === "accuracy" ? "#00dcff" : m === "reaction" ? "#ffcc00" : m === "form" ? (isDark ? "rgba(255,255,255,0.80)" : "rgba(20,20,40,0.80)") : "#b400ff";
                const accentBg  = m === "accuracy" ? "rgba(0,220,255,0.12)" : m === "reaction" ? "rgba(255,200,0,0.12)" : m === "form" ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(20,20,40,0.07)") : "rgba(180,0,255,0.16)";
                const accentBdr = m === "accuracy" ? "rgba(0,220,255,0.35)" : m === "reaction" ? "rgba(255,200,0,0.35)" : m === "form" ? (isDark ? "rgba(255,255,255,0.22)" : "rgba(20,20,40,0.22)") : "rgba(180,0,255,0.40)";
                return (
                  <button key={m} type="button" onClick={() => setTeamImprovedMetric(m)} style={{ padding: "4px 10px", borderRadius: 6, border: isActive ? `1px solid ${accentBdr}` : "1px solid transparent", background: isActive ? accentBg : "transparent", color: isActive ? accent : isDark ? "rgba(255,255,255,0.45)" : "rgba(20,20,40,0.45)", font: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer", textTransform: "capitalize", transition: "all 130ms ease" }}>
                    <ModeIcon mode={m} size={12} style={{ marginRight: 5 }} />
                    {m === "form" ? "Form" : m}
                  </button>
                );
              })}
            </div>

            {teamImprovedLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(128,128,128,0.08)" }}>
                    <Skel w={20} h={12} r={4} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Skel w={`${35 + (i % 3) * 12}%`} h={12} />
                        <Skel w={32} h={14} r={999} />
                      </div>
                      <Skel w="50%" h={9} />
                    </div>
                    <Skel w={72} h={24} r={999} />
                  </div>
                ))}
              </div>
            ) : teamImprovedRows.length === 0 ? (
              <div className="ts-mostImproved">
                <div className="ts-mostRow">
                  <div className="ts-miLabel">
                    <div className="ts-miTitle" style={{ fontSize: 13 }}>
                      <ModeIcon mode={teamImprovedMetric} size={13} style={{ marginRight: 6 }} />
                      {teamImprovedMetric === "form" ? "Form & Angle" : teamImprovedMetric === "strength" ? "Strength" : teamImprovedMetric === "reaction" ? "Reaction" : "Accuracy"}
                    </div>
                    <div className="ts-miSubtitle">needs 4+ sessions per team to compute trend</div>
                  </div>
                  <div className="ts-miBody"><div className="ts-miName" style={{ opacity: 0.3 }}>—</div></div>
                </div>
              </div>
            ) : (
              <div className="ts-mostImproved">
                {teamImprovedRows.map((row, idx) => {
                  const isForm     = teamImprovedMetric === "form";
                  const isPositive = row.delta > 0;
                  const isCore     = row.teamType === "core";
                  const accent = teamImprovedMetric === "accuracy" ? "#00dcff" : teamImprovedMetric === "reaction" ? "#ffcc00" : isForm ? (isDark ? "rgba(255,255,255,0.80)" : "rgba(20,20,40,0.80)") : "#b400ff";
                  const unit   = teamImprovedMetric === "reaction" ? "ms" : teamImprovedMetric === "accuracy" ? "%" : isForm ? "°" : "pts";
                  const fromVal = isForm ? `${row.from}°` : `${row.from}${unit}`;
                  const toVal   = isForm ? `${row.to}°`   : `${row.to}${unit}`;
                  const dirLabel= isForm ? (isPositive ? "↗ more neutral" : "↘ more biased") : (isPositive ? "▲" : "▼");
                  return (
                    <div key={row.teamId} className="ts-mostRow">
                      <div className="ts-leaderCell rank" style={{ fontSize: 13, fontWeight: 800, opacity: 0.4, minWidth: 24 }}>{idx + 1}</div>
                      <div className="ts-miLabel" style={{ minWidth: 0, flex: 1 }}>
                        <div className="ts-miTitle" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                          {row.name}
                          <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", padding: "2px 5px", borderRadius: 999,
                            background: isCore ? "rgba(180,0,255,0.12)" : isDark ? "rgba(255,255,255,0.07)" : "rgba(20,20,40,0.06)",
                            border:     isCore ? "1px solid rgba(180,0,255,0.28)" : isDark ? "1px solid rgba(255,255,255,0.18)" : "1px solid rgba(20,20,40,0.20)",
                            color:      isCore ? "rgba(210,140,255,0.90)" : isDark ? "rgba(255,255,255,0.75)" : "rgba(20,20,40,0.70)",
                            opacity: 1,
                          }}>
                            {isCore ? "roster" : "sub"}
                          </span>
                        </div>
                        <div className="ts-miSubtitle">{fromVal} → {toVal}{isForm ? " avg bias" : ""} · {row.sessions} sessions</div>
                      </div>
                      <div className="ts-miPills">
                        <div className="ts-improvePill" style={{ color: isPositive ? accent : "rgba(255,100,80,0.90)", borderColor: isPositive ? `${accent}40` : "rgba(255,100,80,0.30)", background: isPositive ? `${accent}10` : "rgba(255,100,80,0.08)", fontSize: 12 }}>
                          {dirLabel} {isForm ? `${Math.abs(row.delta)}°` : `${Math.abs(row.delta)} ${unit}`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

        </div>
        ); // end normal populated return
      })() : (
        <div className="ts-dashGrid ts-dashMain">
          <div className="ts-card ts-span2" style={{ display: "flex", flexDirection: "column", height: 600 }}>
            <div className="ts-cardTop">
              <div className="ts-cardTitle">Individual Athletes</div>
              <div className="ts-cardMeta">{athletes.length} athlete{athletes.length !== 1 ? "s" : ""}</div>
            </div>

            {athletesLoading && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(128,128,128,0.08)" }}>
                    <Skel w={40} h={40} r={50} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                      <Skel w={`${40 + (i % 3) * 14}%`} h={13} />
                      <Skel w="28%" h={10} />
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Skel w={52} h={26} r={999} />
                      <Skel w={52} h={26} r={999} />
                    </div>
                    <Skel w={86} h={28} r={999} />
                  </div>
                ))}
              </div>
            )}

            {!athletesLoading && athletesError && (
              <div className="ts-athleteError">{athletesError}</div>
            )}

            {!athletesLoading && !athletesError && athletes.length === 0 && (
              <div className="ts-athleteEmpty">No athletes in this program yet. Use "Add Athlete" to get started.</div>
            )}

            {!athletesLoading && !athletesError && athletes.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                {/* Filter bar */}
                <div className="ts-athleteFilterBar">
                  <svg className="ts-athleteFilterIcon" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
                    <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                  <input
                    className="ts-athleteFilterInput"
                    type="text"
                    placeholder="Filter by name, sport, or position…"
                    value={athleteFilter}
                    onChange={(e) => setAthleteFilter(e.target.value)}
                    aria-label="Filter athletes"
                  />
                  {athleteFilter && (
                    <button
                      type="button"
                      className="ts-athleteFilterClear"
                      onClick={() => setAthleteFilter("")}
                      aria-label="Clear filter"
                    >✕</button>
                  )}
                </div>

                {(() => {
                  const q = athleteFilter.trim().toLowerCase();
                  const filtered = q
                    ? athletes.filter((a) =>
                        `${a.first_name} ${a.last_name}`.toLowerCase().includes(q) ||
                        (a.sport ?? "").toLowerCase().includes(q) ||
                        (a.position ?? "").toLowerCase().includes(q)
                      )
                    : athletes;

                  if (filtered.length === 0) {
                    return <div className="ts-athleteEmpty">No athletes match "{athleteFilter}".</div>;
                  }

                  return (
                    <div className="ts-athleteListWrap" data-fade-top={athleteListFade.top} data-fade-bottom={athleteListFade.bottom}>
                    <div className="ts-athleteList" ref={athleteListRef} onScroll={handleAthleteListScroll}>
                      {filtered
                        // Sort: improving first, then stable, then declining, then no data
                        .slice()
                        .sort((a, b) => {
                          const order = { up: 0, stable: 1, down: 2 };
                          const pa = athleteProgressMap.get(a.id);
                          const pb = athleteProgressMap.get(b.id);
                          if (!pa && !pb) return 0;
                          if (!pa) return 1;
                          if (!pb) return -1;
                          return order[pa.trend] - order[pb.trend];
                        })
                        .map((a) => {
                        const fullName = `${a.first_name} ${a.last_name}`;
                        const initials = [a.first_name, a.last_name]
                          .filter(Boolean)
                          .map((w) => w[0]?.toUpperCase())
                          .join("");
                        const progress = athleteProgressMap.get(a.id) ?? null;
                        const ink = isDark ? "255,255,255" : "20,20,40";

                        // Badge colours
                        const trendColor = progress?.trend === "up"
                          ? (isDark ? "rgba(80,220,160,0.95)"  : "rgba(15,130,80,0.95)")
                          : progress?.trend === "down"
                          ? (isDark ? "rgba(255,100,80,0.90)"  : "rgba(180,50,30,0.90)")
                          : `rgba(${ink},0.50)`;
                        const trendBg = progress?.trend === "up"
                          ? (isDark ? "rgba(80,220,160,0.10)"  : "rgba(15,130,80,0.08)")
                          : progress?.trend === "down"
                          ? (isDark ? "rgba(255,100,80,0.10)"  : "rgba(180,50,30,0.08)")
                          : `rgba(${ink},0.04)`;
                        const trendBdr = progress?.trend === "up"
                          ? (isDark ? "rgba(80,220,160,0.28)"  : "rgba(15,130,80,0.22)")
                          : progress?.trend === "down"
                          ? (isDark ? "rgba(255,100,80,0.28)"  : "rgba(180,50,30,0.22)")
                          : `rgba(${ink},0.12)`;

                        const trendIcon  = progress?.trend === "up" ? "↑" : progress?.trend === "down" ? "↓" : "→";
                        const trendLabel = progress?.trend === "up" ? "Improving" : progress?.trend === "down" ? "Declining" : "Stable";


                        const metricLabel = progress?.metric === "targetAccuracy" ? "target acc"
                          : progress?.metric === "targetReaction" ? "target RT"
                          : progress?.metric;

                        return (
                          <div
                            key={a.id}
                            className="ts-athleteRow"
                            onClick={() => setEditAthleteTarget(a)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && setEditAthleteTarget(a)}
                          >
                            <div className="ts-athleteAvatar" aria-hidden="true">{initials}</div>
                            <div className="ts-athleteInfo">
                              <div className="ts-athleteName">{fullName}</div>
                              {(a.sport || a.position) && (
                                <div className="ts-athleteMeta">
                                  {[a.sport, a.position].filter(Boolean).join(" · ")}
                                </div>
                              )}
                            </div>
                            <div className="ts-athletePills">
                              {a.height && (
                                <span className="ts-athletePill">
                                  <span className="ts-pillLabel">HT</span>{a.height}
                                </span>
                              )}
                              {a.weight && (
                                <span className="ts-athletePill">
                                  <span className="ts-pillLabel">WT</span>{a.weight}
                                </span>
                              )}
                              {/* Per-mode analytics pills — only modes with > 5 sessions appear */}
                              {(() => {
                                const stats = athleteModeStatsMap.get(a.id);
                                if (!stats) return null;
                                const trendArrow = (t: ModeTrend) => t === "up" ? "▲" : t === "down" ? "▼" : "→";
                                const pills: React.ReactNode[] = [];

                                if (stats.power) {
                                  const { peakIndex, trend, delta, sessions } = stats.power;
                                  pills.push(
                                    <span
                                      key="power"
                                      className={`ts-athletePill ts-modePill ts-modePill--power ts-modePill--${trend}`}
                                      title={`Power · ${sessions} sessions · peak SI ${peakIndex}/1000 · trend ${trend === "up" ? "improving" : trend === "down" ? "declining" : "stable"} (${delta > 0 ? "+" : ""}${delta} pts)`}
                                    >
                                      <span className="ts-pillLabel"><ModeIcon mode="power" size={10} style={{ marginRight: 4 }} />SI</span>{peakIndex}
                                      {trend !== "stable" && (
                                        <span className="ts-modePillDelta">{trendArrow(trend)}{Math.abs(delta)}</span>
                                      )}
                                    </span>
                                  );
                                }
                                if (stats.reaction) {
                                  const { avgMs, trend, delta, sessions } = stats.reaction;
                                  pills.push(
                                    <span
                                      key="reaction"
                                      className={`ts-athletePill ts-modePill ts-modePill--reaction ts-modePill--${trend}`}
                                      title={`Reaction · ${sessions} sessions · avg ${avgMs}ms · ${trend === "up" ? "faster" : trend === "down" ? "slower" : "stable"} by ${Math.abs(delta)}ms`}
                                    >
                                      <span className="ts-pillLabel"><ModeIcon mode="reaction" size={10} style={{ marginRight: 4 }} />RT</span>{avgMs}<span style={{ opacity: 0.5, marginLeft: 2 }}>ms</span>
                                      {trend !== "stable" && (
                                        <span className="ts-modePillDelta">{trendArrow(trend)}{Math.abs(delta)}ms</span>
                                      )}
                                    </span>
                                  );
                                }
                                if (stats.accuracy) {
                                  const { avgPct, trend, delta, sessions } = stats.accuracy;
                                  pills.push(
                                    <span
                                      key="accuracy"
                                      className={`ts-athletePill ts-modePill ts-modePill--accuracy ts-modePill--${trend}`}
                                      title={`Accuracy · ${sessions} sessions · avg ${avgPct}% · ${trend === "up" ? "improving" : trend === "down" ? "declining" : "stable"} (${delta > 0 ? "+" : ""}${delta}%)`}
                                    >
                                      <span className="ts-pillLabel"><ModeIcon mode="accuracy" size={10} style={{ marginRight: 4 }} />ACC</span>{avgPct}<span style={{ opacity: 0.5, marginLeft: 2 }}>%</span>
                                      {trend !== "stable" && (
                                        <span className="ts-modePillDelta">{trendArrow(trend)}{Math.abs(delta)}%</span>
                                      )}
                                    </span>
                                  );
                                }
                                if (stats.volume) {
                                  const { maxEvents, avgEvents, sessions } = stats.volume;
                                  pills.push(
                                    <span
                                      key="volume"
                                      className="ts-athletePill ts-modePill ts-modePill--volume"
                                      title={`Volume · ${sessions} sessions · max ${maxEvents} events/session · avg ${avgEvents}`}
                                    >
                                      <span className="ts-pillLabel"><ModeIcon mode="volume" size={10} style={{ marginRight: 4 }} />MAX</span>{maxEvents}
                                    </span>
                                  );
                                }
                                if (stats.target) {
                                  const { avgPct, trend, delta, sessions } = stats.target;
                                  pills.push(
                                    <span
                                      key="target"
                                      className={`ts-athletePill ts-modePill ts-modePill--target ts-modePill--${trend}`}
                                      title={`Target precision · ${sessions} sessions · avg ${avgPct}% · ${trend === "up" ? "improving" : trend === "down" ? "declining" : "stable"} (${delta > 0 ? "+" : ""}${delta}%)`}
                                    >
                                      <span className="ts-pillLabel"><ModeIcon mode="target" size={10} style={{ marginRight: 4 }} />PREC</span>{avgPct}<span style={{ opacity: 0.5, marginLeft: 2 }}>%</span>
                                      {trend !== "stable" && (
                                        <span className="ts-modePillDelta">{trendArrow(trend)}{Math.abs(delta)}%</span>
                                      )}
                                    </span>
                                  );
                                }

                                return pills;
                              })()}
                            </div>

                            {/* Progress badge */}
                            <div className="ts-athleteTrendBadge">
                              {progress ? (
                                <div style={{
                                  display: "flex", flexDirection: "column", alignItems: "flex-end",
                                  gap: 3, flexShrink: 0, marginLeft: 4,
                                }}>
                                  <div style={{
                                    display: "inline-flex", alignItems: "center", gap: 5,
                                    padding: "4px 9px", borderRadius: 999,
                                    background: trendBg, border: `1px solid ${trendBdr}`,
                                    color: trendColor,
                                    fontSize: 11, fontWeight: 800, letterSpacing: "0.02em",
                                    whiteSpace: "nowrap",
                                  }}>
                                    <span style={{ fontSize: 13, lineHeight: 1 }}>{trendIcon}</span>
                                    {trendLabel}
                                  </div>
                                  <div style={{
                                    fontSize: 10, opacity: 0.42, whiteSpace: "nowrap",
                                    textAlign: "right", paddingRight: 2,
                                  }}>
                                    <ModeIcon mode={progress.metric} size={11} style={{ marginRight: 4 }} />
                                    {metricLabel} · {progress.delta > 0 ? "+" : ""}{progress.delta} {progress.unit} · {progress.sessions} sess.
                                  </div>
                                </div>
                              ) : athleteProgressLoading ? (
                                <div style={{ width: 80, height: 28, borderRadius: 999, background: `rgba(${ink},0.05)`, flexShrink: 0 }} />
                              ) : (
                                <div style={{
                                  display: "inline-flex", alignItems: "center", gap: 5,
                                  padding: "4px 9px", borderRadius: 999,
                                  background: `rgba(${ink},0.04)`,
                                  border: `1px solid rgba(${ink},0.10)`,
                                  color: `rgba(${ink},0.30)`,
                                  fontSize: 11, fontWeight: 700,
                                  whiteSpace: "nowrap", flexShrink: 0,
                                }}>
                                  — no data
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Teams card */}
          <div className="ts-card">
            <div className="ts-cardTop">
              <div className="ts-cardTitle">Program Teams</div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div className="ts-cardMeta">
                  {profile?.role === "admin" ? "all teams" : "your sub-teams"}
                </div>
                <button
                  type="button"
                  className="ts-btn ts-btnSecondary ts-addTeamBtn"
                  onClick={() => setShowCreateTeam(true)}
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ marginRight: 5, flexShrink: 0 }}>
                    <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  Add Team
                </button>
              </div>
            </div>

            {teamsLoading && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(128,128,128,0.08)" }}>
                    <Skel w={34} h={34} r={10} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                      <Skel w={`${35 + (i % 3) * 12}%`} h={13} />
                      <Skel w="22%" h={10} />
                    </div>
                    <Skel w={46} h={22} r={999} />
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <Skel w={24} h={16} />
                      <Skel w={38} h={9} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!teamsLoading && teamsError && (
              <div className="ts-athleteError">{teamsError}</div>
            )}

            {!teamsLoading && !teamsError && teams.length === 0 && (
              <div className="ts-athleteEmpty">
                {profile?.role === "coach"
                  ? "No sub-teams found for your program."
                  : "No teams found for this program."}
              </div>
            )}

            {!teamsLoading && !teamsError && teams.length > 0 && (
              <div className="ts-teamList">
                {teams.map((t) => {
                  const isCore = t.team_type === "core";
                  return (
                    <div key={t.id} className="ts-teamRow" onClick={() => setSelectedTeam(t)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSelectedTeam(t)}>
                      <div className={`ts-teamIcon ${isCore ? "ts-teamIcon--core" : "ts-teamIcon--sub"}`} aria-hidden="true">
                        {isCore ? (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M7 1l1.8 3.6L13 5.3l-3 2.9.7 4.1L7 10.4l-3.7 1.9.7-4.1-3-2.9 4.2-.7L7 1Z" fill="currentColor"/>
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
                          </svg>
                        )}
                      </div>
                      <div className="ts-teamInfo">
                        <div className="ts-teamName">{t.name}</div>
                        <div className="ts-teamType">
                          {isCore ? "Core team" : "Sub-team"}
                        </div>
                      </div>
                      <div className={`ts-teamBadge ${isCore ? "ts-teamBadge--core" : "ts-teamBadge--sub"}`}>
                        {t.team_type}
                      </div>
                      <div className="ts-teamCount">
                        {t.member_count ?? 0}
                        <span className="ts-teamCountLabel">athletes</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      </div>

      {/* Tiny scoped styles so we don't disturb your existing design system */}
      <style>{`

        /* ─────────────────────────────────────────────
           STRUCTURAL LAYOUT — mobile-first responsive
           These classes are referenced in JSX but live
           in the global stylesheet. We re-declare them
           here so the dashboard is fully self-contained.
        ───────────────────────────────────────────── */

        /* Root wrapper */
        .ts-dash {
          padding: 24px 32px 48px;
          box-sizing: border-box;
          width: 100%;
        }

        /* Top bar: title/tabs on left, action button on right */
        .ts-dashTop {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 24px;
          flex-wrap: wrap;
        }
        .ts-dashHead {
          flex: 1;
          min-width: 0;
        }
        .ts-dashTitle {
          font-size: 26px;
          font-weight: 800;
          margin: 0 0 4px;
          letter-spacing: -0.01em;
        }
        .ts-dashSub {
          font-size: 13px;
          opacity: 0.50;
          margin: 6px 0 0;
        }
        .ts-dashActions {
          /* row layout inherited from ts-tabs; no column overrides */
        }

        /* Buttons */
        .ts-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 9px 18px;
          border-radius: 12px;
          font: inherit;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          border: 1px solid transparent;
          transition: background 140ms ease, border-color 140ms ease,
                      transform 100ms ease, box-shadow 140ms ease;
          white-space: nowrap;
        }
        .ts-btn:active { transform: translateY(1px); }
        .ts-btnGhost {
          background: rgba(255,255,255,0.05);
          border-color: rgba(255,255,255,0.14);
          color: inherit;
        }
        .ts-btnGhost:hover {
          background: rgba(255,255,255,0.09);
          border-color: rgba(255,255,255,0.22);
          transform: translateY(-1px);
        }
        .ts-btnSecondary {
          background: rgba(180,0,255,0.14);
          border-color: rgba(180,0,255,0.38);
          color: rgba(210,140,255,0.95);
        }
        .ts-btnSecondary:hover {
          background: rgba(180,0,255,0.22);
          border-color: rgba(180,0,255,0.55);
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(180,0,255,0.18);
        }
        :root[data-theme="light"] .ts-btnGhost {
          background: rgba(20,20,40,0.05);
          border-color: rgba(20,20,40,0.16);
        }
        :root[data-theme="light"] .ts-btnGhost:hover {
          background: rgba(20,20,40,0.09);
        }

        /* 2-column dashboard grid */
        .ts-dashGrid {
          display: grid;
          gap: 16px;
        }
        .ts-dashMain {
          grid-template-columns: 1fr 1fr;
        }
        .ts-span2 {
          grid-column: span 2;
        }

        /* Tab-switch animation — the wrapper is keyed by activeTab so React
           remounts this div on every tab change, replaying the keyframe. */
        @keyframes ts-tabFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ts-tabContent {
          animation: ts-tabFadeIn 280ms cubic-bezier(0.22, 1, 0.36, 1) both;
          will-change: opacity, transform;
        }
        @media (prefers-reduced-motion: reduce){
          .ts-tabContent { animation: none; }
        }

        /* Card */
        .ts-card {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 20px;
          padding: 20px 22px;
          box-sizing: border-box;
          min-width: 0;
        }
        :root[data-theme="light"] .ts-card {
          background: rgba(255,255,255,0.75);
          border-color: rgba(20,20,40,0.10);
          box-shadow: 0 2px 12px rgba(0,0,0,0.06);
        }
        .ts-cardTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 14px;
          flex-wrap: wrap;
        }
        .ts-cardTitle {
          font-size: 16px;
          font-weight: 800;
          letter-spacing: -0.01em;
        }

        /* ── Mobile overrides ── */

        /* Tablet: single-column grid */
        @media (max-width: 860px) {
          .ts-dashMain {
            grid-template-columns: 1fr;
          }
          .ts-span2 {
            grid-column: span 1;
          }
          .ts-dash {
            padding: 20px 20px 40px;
          }
        }

        /* Phone: tighter padding, stacked top bar */
        @media (max-width: 600px) {
          .ts-dash {
            padding: 16px 14px 36px;
          }
          .ts-dashTop {
            flex-direction: column;
            gap: 12px;
            margin-bottom: 18px;
          }
          .ts-dashTitle {
            font-size: 22px;
          }
          .ts-card {
            padding: 16px 16px;
            border-radius: 16px;
          }
          .ts-dashGrid {
            gap: 12px;
          }
        }

        /* Small phone */
        @media (max-width: 400px) {
          .ts-dash {
            padding: 12px 10px 32px;
          }
          .ts-card {
            padding: 14px 12px;
            border-radius: 14px;
          }
          .ts-dashTitle {
            font-size: 20px;
          }
        }

        /* ── Recent Sessions — filter bar ── */

        /* Hide emoji icons only on very small phones to reclaim label space */
        @media (max-width: 1024px) {
          .ts-filterModeIcon { display: none; }
        }

        /* ── Charts & Graphs — hidden on mobile ── */
        @media (max-width: 860px) {
          .ts-chartsCard {
            display: none;
          }
        }

        /* ─────────────────────────────────────────────
           END STRUCTURAL LAYOUT
        ───────────────────────────────────────────── */

        .ts-tabsRow{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          margin-top:12px;
          margin-bottom:4px;
          flex-wrap:wrap;
        }
        .ts-tabs{
          display:flex;
          gap:10px;
          flex-wrap:wrap;
          border:1px solid rgba(255,255,255,0.20);
          border-radius:999px;
          padding:4px;
        }
        :root[data-theme="light"] .ts-tabs{
          border-color:rgba(0,0,0,0.75);
        }
        .ts-tabBtn{
          appearance:none;
          border:1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.04);
          color: inherit;
          padding: 8px 12px;
          border-radius: 999px;
          cursor:pointer;
          font: inherit;
          line-height: 1;
          transition: transform 120ms ease, background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
        }
        .ts-tabBtn:hover{
          background: rgba(255,255,255,0.07);
          transform: translateY(-1px);
        }
        .ts-tabBtn.isActive{
          border-color: rgba(255,255,255,0.22);
          background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03));
          box-shadow: 0 4px 18px rgba(0,0,0,0.18);
        }
        /* Dark mode — purple text + border on active tab */
        :root:not([data-theme="light"]) .ts-tabBtn.isActive{
          border-color: rgba(180,0,255,0.55);
          color: rgba(210,140,255,0.96);
        }
        .ts-tabBtn:active{
          transform: translateY(1px);
        }

        /* ── Light mode pill overrides ── */
        :root[data-theme="light"] .ts-tabBtn {
          border-color: rgba(10,10,20,0.28);
          background: rgba(10,10,20,0.04);
          color: rgba(10,10,20,0.80);
        }
        :root[data-theme="light"] .ts-tabBtn:hover {
          border-color: rgba(10,10,20,0.45);
          background: rgba(10,10,20,0.07);
          color: rgba(10,10,20,0.95);
        }
        :root[data-theme="light"] .ts-tabBtn.isActive {
          border-color: rgba(10,10,20,0.70);
          background: rgba(10,10,20,0.07);
          color: rgba(10,10,20,1);
          box-shadow: 0 2px 8px rgba(0,0,0,0.10);
        }
        :root[data-theme="light"] .ts-actionPrimary {
          background: rgba(130,0,200,0.08) !important;
          border-color: rgba(110,0,180,0.45) !important;
          color: rgba(100,0,170,0.95) !important;
        }
        :root[data-theme="light"] .ts-actionPrimary:hover {
          background: rgba(130,0,200,0.14) !important;
          border-color: rgba(110,0,180,0.65) !important;
        }

        /* Action button — purple accent variant (mirrors the old ts-btnSecondary) */
        .ts-actionPrimary {
          background: rgba(180,0,255,0.18) !important;
          border-color: rgba(180,0,255,0.50) !important;
          color: rgba(210,140,255,0.96) !important;
        }
        .ts-actionPrimary:hover {
          background: rgba(180,0,255,0.28) !important;
          border-color: rgba(180,0,255,0.70) !important;
        }

        /* Avatar popover */
        /* ── Skeleton shimmer ── */
        @keyframes tsSkeleton {
          0%   { background-position: -200% center; }
          100% { background-position:  200% center; }
        }
        .ts-skel {
          border-radius: 6px;
          background: linear-gradient(90deg,
            rgba(255,255,255,0.06) 25%,
            rgba(255,255,255,0.12) 50%,
            rgba(255,255,255,0.06) 75%
          );
          background-size: 200% 100%;
          animation: tsSkeleton 1.4s ease infinite;
        }
        :root[data-theme="light"] .ts-skel {
          background: linear-gradient(90deg,
            rgba(20,20,40,0.06) 25%,
            rgba(20,20,40,0.11) 50%,
            rgba(20,20,40,0.06) 75%
          );
          background-size: 200% 100%;
        }

        @keyframes tsPopoverIn {
          from { opacity: 0; transform: translateY(4px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    }
        }
        .ts-recentSessionAvatar:hover{
          border-color: rgba(180,0,255,0.55) !important;
          background: linear-gradient(135deg, rgba(180,0,255,0.38), rgba(180,0,255,0.18)) !important;
        }

        /* Leaderboard */
        .ts-leaderTop{
          display:flex;
          align-items:flex-end;
          justify-content:space-between;
          gap:14px;
          margin-top:8px;
          margin-bottom:14px;
          flex-wrap:wrap;
        }
        .ts-leaderNote{
          opacity:0.95;
          font-size:14px;
          max-width: 740px;
        }
        .ts-leaderControls{
          display:flex;
          align-items:center;
          gap:10px;
        }
        .ts-leaderLabel{
          font-size:12px;
          opacity:0.85;
        }
        .ts-select{
          border:1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.06);
          color: inherit;
          padding: 8px 12px;
          border-radius: 12px;
          font: inherit;
          outline:none;
        }
        .ts-leaderTable{
          display:flex;
          flex-direction:column;
          gap:10px;
        }
        .ts-leaderRow{
          display:grid;
          grid-template-columns: 44px 1.6fr 1fr 1fr 0.8fr;
          gap:10px;
          padding: 12px;
          border:1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          background: rgba(255,255,255,0.02);
          align-items:center;
        }
        .ts-leaderHead{
          background: rgba(255,255,255,0.04);
          border-color: rgba(255,255,255,0.12);
          font-size:12px;
          letter-spacing:0.02em;
          text-transform:uppercase;
          opacity:0.95;
        }
        .ts-leaderCell{
          display:flex;
          align-items:center;
          min-width:0;
        }
        .ts-leaderCell.rank{
          justify-content:center;
          font-variant-numeric: tabular-nums;
          opacity:0.85;
        }
        .ts-leaderCell.name{
          flex-direction:column;
          align-items:flex-start;
          gap:2px;
        }
        .ts-leaderName{
          font-weight:600;
        }
        .ts-leaderSub{
          font-size:12px;
          opacity:0.75;
        }
        /* Clickable athlete rows — drills into Recent Sessions filtered by athlete */
        .ts-leaderRowClickable{
          cursor: pointer;
          transition: background 160ms ease,
                      border-color 160ms ease,
                      transform 160ms ease,
                      box-shadow 160ms ease;
        }
        .ts-leaderRowClickable:hover{
          background: rgba(180,0,255,0.07);
          border-color: rgba(180,0,255,0.32);
          transform: translateY(-1px);
          box-shadow: 0 6px 18px rgba(0,0,0,0.22);
        }
        .ts-leaderRowClickable:active{
          transform: translateY(0);
          box-shadow: 0 2px 8px rgba(0,0,0,0.18);
        }
        .ts-leaderRowClickable:focus-visible{
          outline: none;
          border-color: rgba(180,0,255,0.55);
          box-shadow: 0 0 0 3px rgba(180,0,255,0.25);
        }
        :root[data-theme="light"] .ts-leaderRowClickable:hover{
          background: rgba(180,0,255,0.06);
          border-color: rgba(180,0,255,0.30);
          box-shadow: 0 6px 18px rgba(20,20,40,0.10);
        }
        @media (prefers-reduced-motion: reduce){
          .ts-leaderRowClickable,
          .ts-leaderRowClickable:hover,
          .ts-leaderRowClickable:active{
            transition: none;
            transform: none;
          }
        }
        @media (max-width: 880px){
          .ts-leaderRow{
            grid-template-columns: 40px 1.6fr 1fr 1fr;
          }
          .ts-leaderRow .ts-leaderCell:last-child{
            display:none;
          }
        }

        /* Most Improved */
        .ts-mostImproved{
          display:flex;
          flex-direction:column;
          gap:12px;
          margin-top:8px;
        }
        .ts-mostRow{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          padding: 12px;
          border-radius: 12px;
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.06);
        }
        .ts-miLabel{
          min-width: 180px;
        }
        .ts-miTitle{
          font-weight:600;
          font-size:15px;
        }
        .ts-miSubtitle{
          font-size:12px;
          opacity:0.7;
          margin-top:4px;
        }
        .ts-miBody{
          display:flex;
          align-items:center;
          gap:16px;
          min-width:220px;
        }
        .ts-miName{
          font-weight:600;
          min-width:120px;
        }
        .ts-miPills{
          display:flex;
          gap:8px;
          flex-wrap:wrap;
        }
        .ts-improvePill{
          display:inline-flex;
          align-items:center;
          gap:8px;
          padding: 6px 10px;
          border-radius: 999px;
          border:1px solid rgba(255,255,255,0.10);
          background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
          font-size: 13px;
          white-space: nowrap;
        }
        .ts-addTeamBtn{
          font-size:12px;
          padding:5px 10px;
          border-radius:999px;
          display:inline-flex;
          align-items:center;
          white-space:nowrap;
        }
        .ts-cardMeta{
          opacity:0.85;
        }
        .ts-cardHint{
          margin-top:10px;
          opacity:0.85;
          font-size:13px;
        }

        /* Athletes list */
        .ts-athleteFilterBar{
          display:flex;
          align-items:center;
          gap:8px;
          margin-top:14px;
          padding:9px 13px;
          border-radius:12px;
          border:1px solid rgba(255,255,255,0.10);
          background:rgba(255,255,255,0.04);
          transition:border-color 160ms ease, box-shadow 160ms ease;
        }
        .ts-athleteFilterBar:focus-within{
          border-color:rgba(180,0,255,0.45);
          box-shadow:0 0 0 3px rgba(180,0,255,0.10);
        }
        .ts-athleteFilterIcon{
          flex-shrink:0;
          opacity:0.45;
        }
        .ts-athleteFilterInput{
          flex:1;
          background:none;
          border:none;
          outline:none;
          color:inherit;
          font:inherit;
          font-size:14px;
          min-width:0;
        }
        .ts-athleteFilterInput::placeholder{
          opacity:0.40;
        }
        .ts-athleteFilterClear{
          appearance:none;
          border:none;
          background:none;
          color:inherit;
          opacity:0.40;
          cursor:pointer;
          padding:2px 4px;
          font-size:12px;
          line-height:1;
          transition:opacity 120ms ease;
        }
        .ts-athleteFilterClear:hover{ opacity:0.80; }
        .ts-athleteListWrap{
          position:relative;
          flex:1;
          min-height:0;
          display:flex;
          flex-direction:column;
        }
        /* Top fade overlay */
        .ts-athleteListWrap::before,
        .ts-athleteListWrap::after{
          content:"";
          position:absolute;
          left:0;
          right:8px; /* leave room for scrollbar */
          height:48px;
          pointer-events:none;
          z-index:2;
          transition:opacity 200ms ease;
        }
        .ts-athleteListWrap::before{
          top:0;
          background:linear-gradient(to bottom, rgb(14,14,22) 0%, transparent 100%);
          opacity:0;
        }
        .ts-athleteListWrap::after{
          bottom:0;
          background:linear-gradient(to top, rgb(14,14,22) 0%, transparent 100%);
          opacity:0;
        }
        .ts-athleteListWrap[data-fade-top="true"]::before{ opacity:1; }
        .ts-athleteListWrap[data-fade-bottom="true"]::after{ opacity:1; }
        :root[data-theme="light"] .ts-athleteListWrap::before{
          background:linear-gradient(to bottom, rgb(245,245,250) 0%, transparent 100%);
        }
        :root[data-theme="light"] .ts-athleteListWrap::after{
          background:linear-gradient(to top, rgb(245,245,250) 0%, transparent 100%);
        }
        .ts-athleteList{
          display:flex;
          flex-direction:column;
          gap:8px;
          margin-top:10px;
          overflow-y:auto;
          flex:1;
          min-height:0;
          padding-right:4px;
        }
        .ts-athleteList::-webkit-scrollbar{
          width:4px;
        }
        .ts-athleteList::-webkit-scrollbar-track{
          background:transparent;
        }
        .ts-athleteList::-webkit-scrollbar-thumb{
          background:rgba(128,128,128,0.25);
          border-radius:999px;
        }
        .ts-athleteList::-webkit-scrollbar-thumb:hover{
          background:rgba(128,128,128,0.45);
        }
        .ts-athleteRow{
          display:flex;
          align-items:center;
          gap:14px;
          padding:12px 14px;
          border-radius:14px;
          border:1px solid rgba(255,255,255,0.07);
          background:rgba(255,255,255,0.02);
          cursor:pointer;
          transition:background 150ms ease, border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
        }
        :root[data-theme="light"] .ts-athleteRow{
          border-color:rgba(20,20,40,0.08);
          background:rgba(20,20,40,0.02);
        }
        .ts-athleteRow:hover{
          background:rgba(180,0,255,0.07);
          border-color:rgba(180,0,255,0.28);
          transform:translateY(-1px);
          box-shadow:0 4px 18px rgba(0,0,0,0.22);
        }
        :root[data-theme="light"] .ts-athleteRow:hover{
          box-shadow:0 4px 18px rgba(0,0,0,0.10);
        }
        .ts-athleteRow:active{
          transform:translateY(0);
          box-shadow:none;
        }
        .ts-athleteAvatar{
          flex-shrink:0;
          width:40px;
          height:40px;
          border-radius:50%;
          background:linear-gradient(135deg, rgba(180,0,255,0.25), rgba(180,0,255,0.10));
          border:1px solid rgba(180,0,255,0.30);
          display:flex;
          align-items:center;
          justify-content:center;
          font-size:13px;
          font-weight:700;
          color:rgba(200,120,255,0.95);
          letter-spacing:0.02em;
          transition:background 150ms ease, border-color 150ms ease;
        }
        .ts-athleteRow:hover .ts-athleteAvatar{
          background:linear-gradient(135deg, rgba(180,0,255,0.40), rgba(180,0,255,0.20));
          border-color:rgba(180,0,255,0.55);
        }
        .ts-athleteInfo{
          flex:1;
          min-width:0;
        }
        .ts-athleteName{
          font-weight:600;
          font-size:15px;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .ts-athleteMeta{
          font-size:12px;
          margin-top:2px;
          opacity:0.60;
        }
        .ts-athletePills{
          display:flex;
          gap:6px;
          flex-shrink:0;
        }
        .ts-athleteTrendBadge{
          flex-shrink:0;
        }
        @media (max-width: 600px) {
          .ts-athleteTrendBadge {
            display: none;
          }
        }
        .ts-athletePill{
          display:inline-flex;
          align-items:center;
          gap:5px;
          padding:4px 10px;
          border-radius:999px;
          border:1px solid rgba(255,255,255,0.10);
          background:rgba(255,255,255,0.04);
          font-size:12px;
          white-space:nowrap;
          opacity:0.90;
        }
        :root[data-theme="light"] .ts-athletePill{
          border-color:rgba(20,20,40,0.12);
          background:rgba(20,20,40,0.04);
        }
        .ts-pillLabel{
          font-size:10px;
          font-weight:800;
          letter-spacing:0.06em;
          opacity:0.50;
          text-transform:uppercase;
        }

        /* ── Per-mode analytics pills ────────────────────────────────
           Each pill has a mode accent (border + bg + label color) and an
           optional trend overlay (green = improving, red = declining). */
        .ts-athletePills{
          flex-wrap:wrap;
          row-gap:6px;
          justify-content:flex-end;
          max-width:60%;
        }
        @media (max-width: 880px){
          .ts-athletePills{ max-width:70%; }
        }
        .ts-modePill{
          font-variant-numeric:tabular-nums;
          font-weight:600;
          opacity:1;
        }
        .ts-modePill .ts-pillLabel{
          opacity:0.95;
        }
        .ts-modePillDelta{
          margin-left:6px;
          padding-left:6px;
          font-size:10px;
          font-weight:800;
          letter-spacing:0.02em;
          border-left:1px solid rgba(255,255,255,0.18);
          opacity:0.95;
        }
        :root[data-theme="light"] .ts-modePillDelta{
          border-left-color:rgba(20,20,40,0.18);
        }

        /* Mode accents (dark) */
        .ts-modePill--power{
          background:rgba(180,0,255,0.12);
          border-color:rgba(180,0,255,0.35);
          color:rgba(220,160,255,0.96);
        }
        .ts-modePill--reaction{
          background:rgba(255,200,0,0.12);
          border-color:rgba(255,200,0,0.38);
          color:rgba(255,220,90,0.96);
        }
        .ts-modePill--accuracy{
          background:rgba(0,220,255,0.10);
          border-color:rgba(0,220,255,0.35);
          color:rgba(90,220,255,0.96);
        }
        .ts-modePill--volume{
          background:rgba(255,106,0,0.12);
          border-color:rgba(255,106,0,0.38);
          color:rgba(255,170,90,0.96);
        }
        .ts-modePill--target{
          background:rgba(0,255,136,0.10);
          border-color:rgba(0,255,136,0.34);
          color:rgba(90,255,170,0.96);
        }

        /* Mode accents (light) — softer, darker text for legibility */
        :root[data-theme="light"] .ts-modePill--power{
          background:rgba(180,0,255,0.08);
          border-color:rgba(180,0,255,0.30);
          color:rgba(120,0,200,0.95);
        }
        :root[data-theme="light"] .ts-modePill--reaction{
          background:rgba(200,140,0,0.10);
          border-color:rgba(200,140,0,0.35);
          color:rgba(150,100,0,0.95);
        }
        :root[data-theme="light"] .ts-modePill--accuracy{
          background:rgba(0,160,200,0.08);
          border-color:rgba(0,160,200,0.30);
          color:rgba(0,110,160,0.95);
        }
        :root[data-theme="light"] .ts-modePill--volume{
          background:rgba(220,90,0,0.08);
          border-color:rgba(220,90,0,0.34);
          color:rgba(170,70,0,0.95);
        }
        :root[data-theme="light"] .ts-modePill--target{
          background:rgba(0,170,90,0.08);
          border-color:rgba(0,170,90,0.32);
          color:rgba(0,130,70,0.95);
        }

        /* Trend overlays — recolor the delta chunk only.
           These compose on top of the base mode accent. */
        .ts-modePill--up .ts-modePillDelta{
          color:rgba(80,220,160,0.98);
        }
        .ts-modePill--down .ts-modePillDelta{
          color:rgba(255,110,90,0.98);
        }
        :root[data-theme="light"] .ts-modePill--up .ts-modePillDelta{
          color:rgba(15,130,80,0.95);
        }
        :root[data-theme="light"] .ts-modePill--down .ts-modePillDelta{
          color:rgba(180,50,30,0.95);
        }
        .ts-athleteEmpty{
          margin-top:16px;
          font-size:13px;
          opacity:0.55;
          text-align:center;
          padding:24px 0;
        }
        .ts-athleteError{
          margin-top:12px;
          padding:10px 13px;
          border-radius:12px;
          border:1px solid rgba(255,80,80,0.25);
          background:rgba(255,80,80,0.07);
          color:rgba(255,130,130,0.95);
          font-size:13px;
        }

        /* Teams card */
        .ts-teamList{
          display:flex;
          flex-direction:column;
          gap:8px;
          margin-top:14px;
        }
        .ts-teamRow{
          display:flex;
          align-items:center;
          gap:11px;
          padding:11px 12px;
          border-radius:12px;
          border:1px solid rgba(255,255,255,0.07);
          background:rgba(255,255,255,0.02);
          cursor:pointer;
          transition:background 150ms ease, border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
        }
        .ts-teamRow:hover{
          background:rgba(180,0,255,0.07);
          border-color:rgba(180,0,255,0.28);
          transform:translateY(-1px);
          box-shadow:0 4px 16px rgba(0,0,0,0.20);
        }
        .ts-teamRow:active{ transform:translateY(0); box-shadow:none; }
        .ts-teamIcon{
          flex-shrink:0;
          width:34px;
          height:34px;
          border-radius:10px;
          display:flex;
          align-items:center;
          justify-content:center;
        }
        .ts-teamIcon--core{
          background:linear-gradient(135deg, rgba(180,0,255,0.28), rgba(180,0,255,0.12));
          border:1px solid rgba(180,0,255,0.35);
          color:rgba(210,130,255,0.95);
        }
        .ts-teamIcon--sub{
          background:linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03));
          border:1px solid rgba(255,255,255,0.12);
          color:rgba(255,255,255,0.55);
        }
        :root[data-theme="light"] .ts-teamIcon--sub{
          background:linear-gradient(135deg, rgba(20,20,40,0.07), rgba(20,20,40,0.03));
          border:1px solid rgba(20,20,40,0.16);
          color:rgba(20,20,40,0.60);
        }
        .ts-teamInfo{
          flex:1;
          min-width:0;
        }
        .ts-teamName{
          font-weight:600;
          font-size:14px;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .ts-teamType{
          font-size:11px;
          margin-top:2px;
          opacity:0.50;
        }
        .ts-teamBadge{
          flex-shrink:0;
          font-size:10px;
          font-weight:800;
          letter-spacing:0.07em;
          text-transform:uppercase;
          padding:3px 9px;
          border-radius:999px;
        }
        .ts-teamBadge--core{
          background:rgba(180,0,255,0.14);
          border:1px solid rgba(180,0,255,0.30);
          color:rgba(210,130,255,0.95);
        }
        .ts-teamBadge--sub{
          background:rgba(255,255,255,0.05);
          border:1px solid rgba(255,255,255,0.12);
          color:rgba(255,255,255,0.55);
        }
        :root[data-theme="light"] .ts-teamBadge--sub{
          background:rgba(20,20,40,0.05);
          border:1px solid rgba(20,20,40,0.18);
          color:rgba(20,20,40,0.65);
        }
        .ts-teamCount{
          flex-shrink:0;
          display:flex;
          flex-direction:column;
          align-items:flex-end;
          gap:1px;
          font-size:15px;
          font-weight:700;
          font-variant-numeric:tabular-nums;
          opacity:0.80;
          min-width:32px;
          text-align:right;
        }
        .ts-teamCountLabel{
          display:block;
          font-size:10px;
          font-weight:600;
          letter-spacing:0.04em;
          opacity:0.50;
          text-transform:uppercase;
        }

        @media (max-width: 720px) {
          .ts-miBody{
            flex-direction:column;
            align-items:flex-start;
            gap:6px;
          }
          .ts-miLabel{
            min-width: auto;
          }
        }

        /* Recent Sessions */
        .ts-recentSessionsList{
          display:flex;
          flex-direction:column;
          gap:8px;
          margin-top:10px;
        }
        .ts-recentSessionRow{
          display:flex;
          align-items:center;
          gap:12px;
          padding:10px 12px;
          border-radius:14px;
          border:1px solid rgba(255,255,255,0.07);
          background:rgba(255,255,255,0.02);
          transition:background 150ms ease, border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
          cursor:pointer;
          min-height: 52px;
        }
        .ts-recentSessionRow:hover{
          background:rgba(180,0,255,0.07);
          border-color:rgba(180,0,255,0.28);
          transform:translateY(-1px);
          box-shadow:0 4px 18px rgba(0,0,0,0.22);
        }
        .ts-recentSessionRow:hover .ts-recentSessionAvatar{
          background:linear-gradient(135deg, rgba(180,0,255,0.40), rgba(180,0,255,0.20));
          border-color:rgba(180,0,255,0.55);
        }
        .ts-recentSessionRow:active{
          transform:translateY(0);
          box-shadow:none;
        }
        .ts-recentSessionRow.isSelected{
          background:rgba(180,0,255,0.10);
          border-color:rgba(180,0,255,0.40);
          box-shadow:0 0 0 1px rgba(180,0,255,0.18), 0 4px 18px rgba(0,0,0,0.20);
        }
        .ts-recentSessionRow.isSelected .ts-recentSessionAvatar{
          background:linear-gradient(135deg, rgba(180,0,255,0.45), rgba(180,0,255,0.22));
          border-color:rgba(180,0,255,0.60);
        }
        .ts-recentSessionAvatar{
          flex-shrink:0;
          width:36px;
          height:36px;
          border-radius:50%;
          background:linear-gradient(135deg, rgba(180,0,255,0.25), rgba(180,0,255,0.10));
          border:1px solid rgba(180,0,255,0.30);
          display:flex;
          align-items:center;
          justify-content:center;
          font-size:12px;
          font-weight:700;
          color:rgba(200,120,255,0.95);
          letter-spacing:0.02em;
          transition:background 150ms ease, border-color 150ms ease;
        }
        /* Info column: grows to fill available width */
        .ts-recentSessionInfo{
          flex:1;
          min-width:0;
          display:flex;
          align-items:center;
          gap:10px;
        }
        /* Text block: name + timestamp */
        .ts-recentSessionText{
          flex:1;
          min-width:0;
        }
        .ts-recentSessionAthlete{
          font-size:14px;
          font-weight:600;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .ts-recentSessionMeta{
          font-size:12px;
          margin-top:2px;
          opacity:0.50;
        }
        .ts-recentSessionMode{
          flex-shrink:0;
          font-size:11px;
          font-weight:700;
          letter-spacing:0.06em;
          text-transform:uppercase;
          padding:3px 10px;
          border-radius:999px;
        }
        .ts-recentSessionChevron{
          flex-shrink:0;
          opacity:0.30;
          transition:opacity 150ms ease, transform 150ms ease;
        }
        .ts-recentSessionRow:hover .ts-recentSessionChevron,
        .ts-recentSessionRow.isSelected .ts-recentSessionChevron{
          opacity:0.70;
          transform:translateX(2px);
        }

        /* ── Session row: mobile responsive ── */
        @media (max-width: 600px) {
          /* Stack info column vertically: name on top, meta + mode pill below */
          .ts-recentSessionInfo {
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
          }
          .ts-recentSessionText {
            width: 100%;
          }
          .ts-recentSessionAthlete {
            font-size: 13px;
            white-space: nowrap;
          }
          .ts-recentSessionMeta {
            font-size: 11px;
            margin-top: 0;
          }
          /* Mode pill tucks under the name */
          .ts-recentSessionMode {
            font-size: 10px;
            padding: 2px 8px;
            letter-spacing: 0.04em;
          }
          .ts-recentSessionRow {
            gap: 10px;
            padding: 10px 10px;
            align-items: center;
          }
          /* Disable hover lift on touch devices */
          .ts-recentSessionRow:hover {
            transform: none;
          }
        }

        @media (max-width: 400px) {
          .ts-recentSessionAvatar {
            width: 32px;
            height: 32px;
            font-size: 11px;
          }
          .ts-recentSessionAthlete {
            font-size: 12px;
          }
          .ts-recentSessionRow {
            padding: 9px 8px;
            gap: 8px;
          }
        }

        /* Heatmap card */
        .ts-heatmapCard{
          display:flex;
          flex-direction:column;
        }

        /* Two-column body: matrix left (2/3), stats right (1/3) */
        .ts-heatmapBody{
          display: flex;
          gap: 14px;
          align-items: flex-start;
          margin-top: 10px;
        }

        .ts-heatmapBagCol{
          flex: 0 0 calc(66.666% - 7px);
          min-width: 0;
          width: auto;
        }

        .ts-heatmapStatsCol{
          flex: 0 0 calc(33.333% - 7px);
          min-width: 0;
        }

        @media (max-width: 560px){
          .ts-heatmapBody{
            flex-direction: column;
          }

          .ts-heatmapBagCol,
          .ts-heatmapStatsCol{
            flex: none;
            width: 100%;
          }
        }

        /* Hide 3D angle compass on phones and tablets */
        @media (max-width: 1024px){
          .ts-strikeCompassWrap{
            display: none;
          }
        }

        /* Bag wrap — mirrors ts-ses-bagWrap */
        .ts-dash-bagWrap{
          position:relative;
          border-radius:16px;
          overflow:hidden;
          border:1px solid var(--panel-border, rgba(255,255,255,0.10));
          background:var(--panel, rgba(255,255,255,0.03));
          backdrop-filter:blur(12px);
          aspect-ratio: 2 / 3;
          width: 100%;
          transition:border-color 300ms ease, box-shadow 300ms ease;
          user-select:none;
        }

        /* Cell border */
        .ts-dash-cell{
          border:1px solid rgba(255,255,255,0.12);
          min-height:0;
        }
        :root[data-theme="light"] .ts-dash-cell{
          border-color:rgba(0,0,0,0.12);
        }

        /* Mode pill in card header */
        .ts-summaryModePill{
          font-size:10px;
          font-weight:800;
          letter-spacing:0.07em;
          text-transform:uppercase;
          padding:2px 8px;
          border-radius:999px;
        }
        .ts-summaryModePill[data-mode="power"]{
          background:rgba(180,0,255,0.12);
          border:1px solid rgba(180,0,255,0.28);
          color:rgba(210,130,255,0.95);
        }
        .ts-summaryModePill[data-mode="accuracy"]{
          background:rgba(0,220,255,0.10);
          border:1px solid rgba(0,220,255,0.28);
          color:rgba(80,220,255,0.95);
        }
        .ts-summaryModePill[data-mode="reaction"]{
          background:rgba(255,200,0,0.10);
          border:1px solid rgba(255,200,0,0.26);
          color:rgba(255,210,60,0.95);
        }
        .ts-summaryModePill[data-mode="volume"]{
          background:rgba(255,106,0,0.10);
          border:1px solid rgba(255,106,0,0.28);
          color:rgba(255,150,60,0.95);
        }
        .ts-summaryModePill[data-mode="target"]{
          background:rgba(0,255,136,0.10);
          border:1px solid rgba(0,255,136,0.28);
          color:rgba(0,220,110,0.95);
        }

        /* Summary stat rows */
        .ts-summaryList{
          display:flex;
          flex-direction:column;
          gap:4px;
        }
        .ts-summaryRow{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:8px;
          padding:7px 10px;
          border-radius:9px;
          background:rgba(255,255,255,0.025);
          border:1px solid rgba(255,255,255,0.055);
          transition:background 120ms ease;
        }
        .ts-summaryRow:hover{
          background:rgba(255,255,255,0.042);
        }
        .ts-summaryRow.isAccent{
        }
        .ts-summaryRowLabel{
          font-size:11px;
          font-weight:600;
          opacity:0.50;
          white-space:nowrap;
          flex-shrink:0;
        }
        .ts-summaryRowValue{
          font-size:12px;
          font-weight:700;
          font-variant-numeric:tabular-nums;
          text-align:right;
          min-width:0;
        }
        .ts-summaryRow.isAccent .ts-summaryRowValue{
        }

        /* Replay controls */
        .ts-replayControls{
          display:flex;
          align-items:center;
          gap:8px;
          flex-wrap:wrap;
          margin-top:10px;
        }
        .ts-replayBtn{
          display:inline-flex;
          align-items:center;
          gap:5px;
          padding:5px 10px;
          border-radius:8px;
          border:1px solid rgba(255,255,255,0.12);
          background:rgba(255,255,255,0.05);
          color:inherit;
          font:inherit;
          font-size:12px;
          font-weight:600;
          cursor:pointer;
          transition:background 120ms ease, border-color 120ms ease, transform 100ms ease;
        }
        .ts-replayBtn:hover:not(:disabled){
          background:rgba(180,0,255,0.12);
          border-color:rgba(180,0,255,0.35);
          transform:translateY(-1px);
        }
        .ts-replayBtn:disabled{
          opacity:0.35;
          cursor:default;
        }
        .ts-replayBtnPrimary{
          background:rgba(180,0,255,0.18);
          border-color:rgba(180,0,255,0.40);
          color:rgba(210,140,255,0.95);
        }
        .ts-replayBtnPrimary:hover:not(:disabled){
          background:rgba(180,0,255,0.28);
          border-color:rgba(180,0,255,0.55);
        }
        .ts-replaySpeed{
          display:flex;
          align-items:center;
          gap:4px;
          margin-left:4px;
        }
        .ts-replaySpeedLabel{
          font-size:11px;
          opacity:0.45;
          margin-right:2px;
        }
        .ts-replaySpeedBtn{
          padding:3px 8px;
          border-radius:6px;
          border:1px solid rgba(255,255,255,0.10);
          background:rgba(255,255,255,0.03);
          color:inherit;
          font:inherit;
          font-size:11px;
          font-weight:600;
          cursor:pointer;
          opacity:0.55;
          transition:opacity 100ms ease, background 100ms ease, border-color 100ms ease;
        }
        .ts-replaySpeedBtn:hover{ opacity:0.85; }
        .ts-replaySpeedBtn.isActive{
          opacity:1;
          background:rgba(180,0,255,0.14);
          border-color:rgba(180,0,255,0.35);
          color:rgba(210,140,255,0.95);
        }
        /* ── Timeline scrubber ── */
        .ts-replayTimeline{
          position: relative;
          height: 20px;
          display: flex;
          align-items: center;
          cursor: pointer;
          padding: 0 2px;
          /* Extend click target above/below the thin track */
          margin: -4px 0;
          padding-top: 4px;
          padding-bottom: 4px;
          box-sizing: content-box;
        }
        /* The track background */
        .ts-replayTimeline::before{
          content: "";
          position: absolute;
          left: 0; right: 0;
          top: 50%; transform: translateY(-50%);
          height: 3px;
          border-radius: 999px;
          background: rgba(255,255,255,0.10);
          pointer-events: none;
        }
        /* The filled portion — injected as a child div */
        .ts-replayTrackFill{
          position: absolute;
          left: 0;
          top: 50%; transform: translateY(-50%);
          height: 3px;
          border-radius: 999px;
          pointer-events: none;
          transition: width 80ms linear;
        }
        /* Playhead knob — var(--text) so it's white in dark mode, black in light mode */
        .ts-replayHead{
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--text);
          box-shadow: 0 1px 4px rgba(0,0,0,0.35);
          pointer-events: none;
          transition: left 80ms linear;
          z-index: 4;
        }
        /* Event dots on the timeline */
        .ts-replayDot{
          position: absolute;
          top: 50%;
          border-radius: 50%;
          cursor: pointer;
          transition: background 150ms, transform 150ms, box-shadow 150ms;
          pointer-events: all;
        }
        .ts-replayDot:hover{
          transform: translate(-50%,-50%) scale(1.8) !important;
          z-index: 5 !important;
        }

        /* Ripple keyframes — identical to hitSimulator + session */
        @keyframes tsCorePulse {
          0%   { opacity:1;   transform:scale(1); }
          60%  { opacity:0.7; transform:scale(1.6); }
          100% { opacity:0;   transform:scale(0.5); }
        }
        @keyframes tsRipple {
          0%   { opacity:0.9; transform:translate(-50%,-50%) scale(0.5); }
          100% { opacity:0;   transform:translate(-50%,-50%) scale(4.5); }
        }
      `}</style>
    </div>
  );
}
