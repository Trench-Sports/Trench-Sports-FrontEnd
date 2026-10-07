// src/components/dashboard/AthleteMostImproved.tsx
//
// Athlete "Most Improved" leaderboard on the coach dashboards (Tier II):
// metric pills, ranked first-half-vs-last-half deltas, and the locked preview
// below Tier II. Clicking a row opens that athlete's in-depth analysis.
// Shared by the desktop and mobile dashboard pages.
import { Skel } from "./Skel";
import { ModeIcon } from "../modeIcon";
import { LockedPanel, SampleTable, SAMPLE_IMPROVED_ROWS } from "../lockedFeature";
import type { CoachDashboard, MetricKey } from "../../hooks/useCoachDashboard";

type Props = {
  dash: CoachDashboard;
  // Mode icons on the metric pills (desktop); mobile omits them to save width.
  showModeIcons: boolean;
};

export function AthleteMostImproved({ dash, showModeIcons }: Props) {
  const {
    analysisCardRef,
    athleteImprovedLoading,
    athleteImprovedMetric,
    athleteImprovedRows,
    ent,
    isDark,
    setAnalysisAthleteId,
    setAnalysisAthleteName,
    setAthleteImprovedMetric,
  } = dash;

  return (
    !ent.can("mostImproved") ? (
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
              {showModeIcons && <ModeIcon mode={m} size={12} style={{ marginRight: 5 }} />}
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
              <div
                key={row.athleteId}
                className="ts-mostRow ts-leaderRowClickable"
                role="button"
                tabIndex={0}
                aria-label={`View analysis for ${row.name}`}
                onClick={() => {
                  setAnalysisAthleteId(row.athleteId);
                  setAnalysisAthleteName(row.name);
                  setTimeout(() => analysisCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setAnalysisAthleteId(row.athleteId);
                    setAnalysisAthleteName(row.name);
                    setTimeout(() => analysisCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
                  }
                }}
              >
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
    )
  );
}
