// src/pages/mobile/dashboard.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import ProfileHeader from "../../components/profileHeader";
import CreateAthleteModal from "../../components/createAthlete";
import EditAthleteModal from "../../components/editAthlete";
import EditProfileModal from "../../components/editProfile";
import ProgramModal from "../../components/program";
import ManageTeamModal from "../../components/manageTeam";
import { IconGauge, IconBullseye, IconStopwatch, IconTrendUp, IconBarChart, IconRocket, IconTrophy, IconClipboard, IconPencil, IconPlay, type IconProps } from "../../components/icons";
import { ModeIcon } from "../../components/modeIcon";
import { StrengthIndexInfo } from "../../components/strengthIndexInfo";
import { LockedPanel, LapsedBanner, TrialBanner, RetainedDataNotice, SampleTable, SAMPLE_TEAM_ROWS } from "../../components/lockedFeature";
import {
  useCoachDashboard,
  type Athlete,
  type Team,
  type TabKey,
  type MetricKey,
  type ModeTrend,
  type LeaderDateRange,
} from "../../hooks/useCoachDashboard";
import { SessionHeatmapCard } from "../../components/dashboard/SessionHeatmapCard";
import { RecentSessionsCard } from "../../components/dashboard/RecentSessionsCard";
import { AthleteMostImproved } from "../../components/dashboard/AthleteMostImproved";
import { Skel } from "../../components/dashboard/Skel";


// ─────────────────────────────────────────────────────────────────────────────
// Gesture hooks
// ─────────────────────────────────────────────────────────────────────────────

const TAB_KEYS: TabKey[] = ["recent", "insights", "athletes"];

/** Mirrors useBagModeSwipe from session.tsx — horizontal swipe cycles dashboard tabs. */
function useTabSwipe(
  activeTab: TabKey,
  setActiveTab: (t: TabKey) => void,
): { onTouchStart: React.TouchEventHandler; onTouchEnd: React.TouchEventHandler } {
  const startXRef = useRef(0);
  const startYRef = useRef(0);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startXRef.current;
      const dy = Math.abs(e.changedTouches[0].clientY - startYRef.current);
      // Ignore if not clearly horizontal or too short
      if (Math.abs(dx) < 44 || dy > Math.abs(dx) * 0.75) return;
      const idx = TAB_KEYS.indexOf(activeTab);
      if (dx < 0 && idx < TAB_KEYS.length - 1) setActiveTab(TAB_KEYS[idx + 1]);
      if (dx > 0 && idx > 0) setActiveTab(TAB_KEYS[idx - 1]);
    },
    [activeTab, setActiveTab],
  );

  return { onTouchStart, onTouchEnd };
}

/**
 * Attaches a document-level touchstart/touchend listener while a modal is open.
 * Calls onClose() when the user swipes down ≥ threshold px.
 */
function useSwipeToDismiss(isOpen: boolean, onClose: () => void, threshold = 80) {
  const startYRef = useRef(0);
  const startXRef = useRef(0);

  useEffect(() => {
    if (!isOpen) return;

    function onStart(e: TouchEvent) {
      startYRef.current = e.touches[0].clientY;
      startXRef.current = e.touches[0].clientX;
    }
    function onEnd(e: TouchEvent) {
      const dy = e.changedTouches[0].clientY - startYRef.current;
      const dx = Math.abs(e.changedTouches[0].clientX - startXRef.current);
      if (dy >= threshold && dx < dy * 0.65) onClose();
    }

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, [isOpen, onClose, threshold]);
}

// Mobile carries a 7-day option the desktop does not; it is inside every
// tier's window, so it always survives the filter.
function mobileLeaderRanges(days: number | null): LeaderDateRange[] {
  if (days === null) return [7, 30, 90, "all"];
  if (days >= 90) return [7, 30, 90];
  return [7, 30];
}

export default function Dashboard() {


  // ── Gesture: pull-to-refresh ─────────────────────────────────────────────
  const dashRef        = useRef<HTMLDivElement>(null);
  const [pullY,        setPullY]        = useState(0);       // px the indicator has been dragged
  const [isRefreshing, setIsRefreshing] = useState(false);   // spinner active
  const [refreshKey,   setRefreshKey]   = useState(0);       // bump to re-fetch everything
  const PULL_THRESHOLD = 60;                                  // px needed to trigger

  // ── Gesture: long-press action sheet ────────────────────────────────────
  const [actionSheetAthlete, setActionSheetAthlete] = useState<Athlete | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressMoved = useRef(false);

  const dash = useCoachDashboard({
    refreshKey,
    leaderRangesFor: mobileLeaderRanges,
    leaderRangeDefault: 30,
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
    athletes,
    setAthletes,
    athletesLoading,
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
    replaySpeed,
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
    isDark,
    goToSessionsForAthlete,
  } = dash;


  // ── Pull-to-refresh ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = dashRef.current;
    if (!el) return;

    let startY = 0;
    let active = false;

    function onTouchStart(e: TouchEvent) {
      // Only activate when scrolled to very top (el is guarded non-null above)
      if (el!.scrollTop > 2) return;
      startY = e.touches[0].clientY;
      active = true;
    }

    function onTouchMove(e: TouchEvent) {
      if (!active) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 0) {
        setPullY(Math.min(dy * 0.45, PULL_THRESHOLD + 24));
      } else {
        active = false;
        setPullY(0);
      }
    }

    function onTouchEnd() {
      if (!active) return;
      active = false;
      // Read pullY via closure won't work — use a local variable tracked in move
      // We use a ref to check it reliably
      setPullY(prev => {
        if (prev >= PULL_THRESHOLD) {
          setIsRefreshing(true);
          setRefreshKey(k => k + 1);
          // Auto-clear the spinner after a short delay
          setTimeout(() => setIsRefreshing(false), 1200);
        }
        return 0;
      });
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove",  onTouchMove,  { passive: true });
    el.addEventListener("touchend",   onTouchEnd,   { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove",  onTouchMove);
      el.removeEventListener("touchend",   onTouchEnd);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tab swipe ────────────────────────────────────────────────────────────
  const tabSwipe = useTabSwipe(activeTab, setActiveTab);

  // ── Swipe-to-dismiss for Create/Edit Athlete and Manage Team modals ─────
  const closeCreateAthlete = useCallback(() => setShowCreateAthlete(false), []);
  const closeEditAthlete   = useCallback(() => setEditAthleteTarget(null),  []);
  const closeManageTeam    = useCallback(() => { setShowCreateTeam(false); setSelectedTeam(null); }, []);

  useSwipeToDismiss(showCreateAthlete,        closeCreateAthlete);
  useSwipeToDismiss(Boolean(editAthleteTarget), closeEditAthlete);
  useSwipeToDismiss(showCreateTeam || Boolean(selectedTeam), closeManageTeam);


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
    <div
      className="ts-dash"
      ref={dashRef}
      style={{ position: "relative" }}
    >
      {/* Pull-to-refresh indicator */}
      {(pullY > 0 || isRefreshing) && (
        <div style={{
          position: "absolute",
          top: 0, left: 0, right: 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 100,
          pointerEvents: "none",
          transform: `translateY(${isRefreshing ? 48 : Math.min(pullY, PULL_THRESHOLD + 24) - 4}px)`,
          transition: pullY === 0 ? "transform 300ms ease" : "none",
        }}>
          <div style={{
            width: 32, height: 32,
            borderRadius: "50%",
            background: isDark ? "rgba(255,255,255,0.10)" : "rgba(20,20,40,0.08)",
            border: `1px solid ${isDark ? "rgba(255,255,255,0.18)" : "rgba(20,20,40,0.14)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {isRefreshing ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                style={{ animation: "ts-spin 700ms linear infinite" }}>
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2"
                  strokeDasharray="28" strokeDashoffset="10" strokeLinecap="round" opacity="0.7"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                style={{ transform: pullY >= PULL_THRESHOLD ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 200ms ease", opacity: 0.6 }}>
                <path d="M7 2v10M3 9l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
        </div>
      )}
      <CreateAthleteModal
        open={showCreateAthlete}
        onClose={closeCreateAthlete}
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
        onClose={closeEditAthlete}
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
        onClose={closeManageTeam}
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

      {/* ── Long-press action sheet ─────────────────────────────────────────── */}
      {actionSheetAthlete && (() => {
        const ink = isDark ? "255,255,255" : "20,20,40";
        const a   = actionSheetAthlete;
        const fullName = `${a.first_name} ${a.last_name}`;
        type Action = { label: string; Icon: (p: IconProps) => JSX.Element; accent?: boolean; onClick: () => void };
        const actions: Action[] = [
          {
            label: "View Sessions",
            Icon: IconClipboard,
            onClick: () => {
              setActionSheetAthlete(null);
              navigate("/m/session", { state: { athleteId: a.id, athleteName: fullName } });
            },
          },
          {
            label: "Edit Athlete",
            Icon: IconPencil,
            onClick: () => {
              setActionSheetAthlete(null);
              setEditAthleteTarget(a);
            },
          },
          {
            label: "New Session",
            Icon: IconPlay,
            accent: true,
            onClick: () => {
              setActionSheetAthlete(null);
              navigate("/m/session", { state: { athleteId: a.id, athleteName: fullName, autoStart: true } });
            },
          },
        ];
        return (
          <>
            {/* Backdrop */}
            <div
              onClick={() => setActionSheetAthlete(null)}
              style={{
                position: "fixed", inset: 0, zIndex: 3000,
                background: "rgba(0,0,0,0.45)",
                backdropFilter: "blur(3px)",
                animation: "ts-fadeIn 180ms ease",
              }}
            />
            {/* Sheet */}
            <div style={{
              position: "fixed",
              bottom: 0, left: 0, right: 0,
              zIndex: 3001,
              background: isDark ? "rgba(18,18,24,0.97)" : "rgba(255,255,255,0.97)",
              borderTop: `1px solid rgba(${ink},0.12)`,
              borderRadius: "20px 20px 0 0",
              padding: "12px 16px 32px",
              animation: "ts-slideUp 260ms cubic-bezier(0.34,1.10,0.64,1)",
            }}>
              {/* Drag handle */}
              <div style={{
                width: 36, height: 4, borderRadius: 2,
                background: `rgba(${ink},0.18)`,
                margin: "0 auto 16px",
              }} />
              {/* Athlete name */}
              <div style={{
                fontSize: 13, fontWeight: 700, opacity: 0.45,
                marginBottom: 10, paddingLeft: 4,
              }}>{fullName}</div>
              {/* Actions */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {actions.map((act) => (
                  <button
                    key={act.label}
                    type="button"
                    onClick={act.onClick}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      width: "100%",
                      padding: "14px 16px",
                      borderRadius: 14,
                      border: act.accent
                        ? "1px solid rgba(180,0,255,0.40)"
                        : `1px solid rgba(${ink},0.10)`,
                      background: act.accent
                        ? "rgba(180,0,255,0.15)"
                        : `rgba(${ink},0.04)`,
                      color: act.accent ? "rgba(210,140,255,0.95)" : "inherit",
                      font: "inherit", fontSize: 15, fontWeight: 700,
                      cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <span style={{ display: "flex", justifyContent: "center", width: 24, flexShrink: 0 }}>
                      <act.Icon size={19} />
                    </span>
                    {act.label}
                  </button>
                ))}
              </div>
              {/* Cancel */}
              <button
                type="button"
                onClick={() => setActionSheetAthlete(null)}
                style={{
                  width: "100%", marginTop: 10,
                  padding: "14px 16px", borderRadius: 14,
                  border: `1px solid rgba(${ink},0.10)`,
                  background: "transparent",
                  font: "inherit", fontSize: 15, fontWeight: 600,
                  opacity: 0.45, cursor: "pointer",
                }}
              >Cancel</button>
            </div>
          </>
        );
      })()}

      <EditProfileModal
        open={showEditProfile}
        onClose={() => setShowEditProfile(false)}
        onSaved={(updated: any) => setProfile(updated)}
      />

      <ProgramModal
        open={showProgram}
        onClose={() => setShowProgram(false)}
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
            <div
              className="ts-tabs ts-sectionTabs"
              onTouchStart={tabSwipe.onTouchStart}
              onTouchEnd={tabSwipe.onTouchEnd}
            >
              {tabBtn("recent", "Recent Session")}
              {tabBtn("insights", "Insights & Analysis")}
              {tabBtn("athletes", "Individual Athletes")}
            </div>
            <div className="ts-tabs ts-dashActions">
              <button
                type="button"
                className="ts-tabBtn"
                onClick={() => navigate("/m/session")}
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ marginRight: 6, flexShrink: 0 }}>
                  <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                New Session
              </button>
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
        <div style={{ padding: "0 var(--dash-pad, 16px)" }}>
          <LapsedBanner isTrial={ent.plan === "trial"} isDark={isDark} />
        </div>
      )}
      {!ent.loading && ent.isTrial && (
        <div style={{ padding: "0 var(--dash-pad, 16px)" }}>
          <TrialBanner daysLeft={ent.trialDaysLeft} isDark={isDark} />
        </div>
      )}
      {!retained.loading && retained.hasLockedData && (
        <div style={{ padding: "0 var(--dash-pad, 16px)" }}>
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
            <RecentSessionsCard dash={dash} modePills="wrap" sessionPath="/m/session" />

            {/* Impact Heatmap */}
            <SessionHeatmapCard dash={dash} />

          </div>
        </>
      ) : activeTab === "insights" ? (() => {
        const isLoadingAny = strengthLoading || reactionLoading || accuracyLoading;
        const hasAnyData   = strengthRows.length > 0 || reactionRows.length > 0 || accuracyRows.length > 0;
        const ink          = isDark ? "255,255,255" : "20,20,40";

        // ── Full onboarding state — shown while loading finishes or when truly no data ──
        if (!isLoadingAny && !hasAnyData) return (
          <div className="ts-dashGrid ts-dashMain">
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
          <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", opacity: 0.45 }}>Date Range</span>
              <span style={{ fontSize: 11, opacity: 0.32 }}>Applies to all leaderboards &amp; Most Improved</span>
            </div>
            <div style={{
              display: "inline-flex",
              background: isDark ? "rgba(255,255,255,0.04)" : "rgba(20,20,40,0.04)",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.10)" : "rgba(20,20,40,0.10)"}`,
              borderRadius: 10, padding: 3, gap: 2,
            }}>
              {/* Only the windows the tier's history actually covers — a 30-day
                  plan offered "All time" would return 30 days and read as a bug. */}
              {availableRanges.map(r => {
                const isActive = leaderDateRange === r;
                const ink = isDark ? "255,255,255" : "20,20,40";
                return (
                  <button
                    key={String(r)}
                    type="button"
                    onClick={() => setLeaderDateRange(r)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 7,
                      border: isActive
                        ? isDark ? "1px solid rgba(180,0,255,0.55)" : `1px solid rgba(${ink},0.28)`
                        : "1px solid transparent",
                      background: isActive
                        ? isDark ? "rgba(180,0,255,0.18)" : `rgba(${ink},0.09)`
                        : "transparent",
                      color: isActive
                        ? isDark ? "rgba(210,140,255,0.96)" : `rgba(${ink},0.92)`
                        : `rgba(${ink},0.45)`,
                      font: "inherit",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 140ms ease",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r === "all" ? "All time" : `${r}d`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── ATHLETE SECTION HEADER ── */}
          <div className="ts-span2" style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 12, paddingBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.45 }}>Athletes</div>
            <div style={{ flex: 1, height: 1, background: isDark ? "rgba(255,255,255,0.08)" : "rgba(20,20,40,0.10)" }} />
          </div>

          {/* Athlete Leaderboard */}
          <div className="ts-card ts-span2">
            <div className="ts-cardTop">
              <div className="ts-cardTitle" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                Athlete Leaderboard
                <StrengthIndexInfo />
              </div>
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
          <AthleteMostImproved dash={dash} showModeIcons={false} />

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
          <div className="ts-card ts-span2">
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
              <>
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
                    <div className="ts-athleteList">
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
                            onTouchStart={() => {
                              longPressMoved.current = false;
                              longPressTimer.current = setTimeout(() => {
                                if (!longPressMoved.current) setActionSheetAthlete(a);
                              }, 400);
                            }}
                            onTouchMove={() => {
                              longPressMoved.current = true;
                              if (longPressTimer.current) {
                                clearTimeout(longPressTimer.current);
                                longPressTimer.current = null;
                              }
                            }}
                            onTouchEnd={() => {
                              if (longPressTimer.current) {
                                clearTimeout(longPressTimer.current);
                                longPressTimer.current = null;
                              }
                            }}
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
                  );
                })()}
              </>
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

        /* ── Recent Sessions — filter bar ──
           Pills wrap to multiple rows on narrow widths (see flexWrap on the
           container), so labels stay readable at any viewport. */

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
          max-width:100%;
        }
        .ts-sectionTabs{
          width:fit-content;
        }
        :root[data-theme="light"] .ts-tabs{
          border-color:rgba(0,0,0,0.75);
        }
        .ts-tabBtn{
          appearance:none;
          -webkit-appearance:none;
          border:1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.04);
          color: inherit;
          padding: 8px 12px;
          border-radius: 999px;
          cursor:pointer;
          font: inherit;
          line-height: 1;
          transition: transform 120ms ease, background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
          min-width:0;
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

        /* ── Light mode tab overrides ── */
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

        /* Dashboard section tabs — mobile/iOS responsive 2-over-1 stack */
        @media (max-width: 600px) {
          .ts-tabsRow{
            width:100%;
            align-items:stretch;
            gap:10px;
          }

          .ts-sectionTabs{
            display:grid;
            grid-template-columns:repeat(2, minmax(0, 1fr));
            width:100%;
            gap:6px;
            border-radius:20px;
            padding:5px;
          }

          .ts-sectionTabs .ts-tabBtn{
            width:100%;
            min-height:40px;
            padding:10px 8px;
            white-space:normal;
            text-align:center;
            line-height:1.15;
            font-size:13px;
          }

          .ts-sectionTabs .ts-tabBtn:nth-child(3){
            grid-column:1 / -1;
          }

          .ts-dashActions{
            width:100%;
            justify-content:stretch;
            gap:8px;
            border-radius:20px;
          }

          .ts-dashActions .ts-tabBtn{
            flex:1 1 0;
            min-height:40px;
            display:inline-flex;
            align-items:center;
            justify-content:center;
            white-space:nowrap;
          }
        }

        @media (max-width: 380px) {
          .ts-sectionTabs .ts-tabBtn{
            font-size:12px;
            padding-inline:6px;
          }
        }

        @supports (-webkit-touch-callout: none) {
          @media (max-width: 600px) {
            .ts-sectionTabs .ts-tabBtn,
            .ts-dashActions .ts-tabBtn{
              -webkit-user-select:none;
              user-select:none;
            }
          }
        }

        /* Action button — purple accent variant */
        .ts-actionPrimary {
          background: rgba(180,0,255,0.18) !important;
          border-color: rgba(180,0,255,0.50) !important;
          color: rgba(210,140,255,0.96) !important;
        }
        .ts-actionPrimary:hover {
          background: rgba(180,0,255,0.28) !important;
          border-color: rgba(180,0,255,0.70) !important;
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
        .ts-athleteList{
          display:flex;
          flex-direction:column;
          gap:8px;
          margin-top:10px;
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
        /* Speed controls add too much horizontal weight to the Impact
           Heatmap toolbar on phone-sized viewports — hide them below the
           tablet breakpoint. Tablets and up keep the full Play/Pause/Reset
           + 0.5×/1×/2× cluster. */
        @media (max-width: 599px) {
          .ts-replaySpeed { display: none; }
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

        /* ── Pull-to-refresh spinner ── */
        @keyframes ts-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }

        /* ── Action sheet animations ── */
        @keyframes ts-slideUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        @keyframes ts-fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        /* Prevent iOS scroll bounce interfering with pull-to-refresh */
        .ts-dash {
          overscroll-behavior-y: contain;
        }
      `}</style>
    </div>
  );
}
