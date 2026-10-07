// src/components/dashboard/TeamLeaderboards.tsx
//
// Team section of the coach dashboards' leaderboard tab: the "Teams" divider,
// the team leaderboard and team Most Improved (both Tier II, with locked
// previews below that). Rendered as a fragment so each part stays a direct
// child of the page's grid. Shared by the desktop and mobile dashboard pages.
import { Skel } from "./Skel";
import { ModeIcon } from "../modeIcon";
import { IconTrophy } from "../icons";
import { LockedPanel, SampleTable, SAMPLE_TEAM_ROWS } from "../lockedFeature";
import type { CoachDashboard, MetricKey } from "../../hooks/useCoachDashboard";

type Props = {
  dash: CoachDashboard;
  // Mode icons on the Most Improved metric pills (desktop); mobile omits them to save width.
  showModeIcons: boolean;
};

export function TeamLeaderboards({ dash, showModeIcons }: Props) {
  const {
    ent,
    isDark,
    leaderDateRange,
    setTeamImprovedMetric,
    setTeamLeaderMetric,
    teamImprovedLoading,
    teamImprovedMetric,
    teamImprovedRows,
    teamLeaderLoading,
    teamLeaderMetric,
    teamLeaderRows,
  } = dash;

  return (
    <>
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
                {showModeIcons && <ModeIcon mode={m} size={12} style={{ marginRight: 5 }} />}
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
    </>
  );
}
