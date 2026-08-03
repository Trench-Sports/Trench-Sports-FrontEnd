// src/pages/dummy.js
//
// ─────────────────────────────────────────────────────────────────────────────
// TEAMS TAB — LAYOUT LAB
// ─────────────────────────────────────────────────────────────────────────────
// A throwaway/demo page for testing how to group CORE teams with their SUB
// teams on the dashboard "Teams" tab. Reachable at /dummy.
//
// It reuses the exact visual language of the real ts-team cards in
// src/pages/dashboard.tsx so the options look production-accurate. Flip between
// four grouping layouts with the toggle at the top:
//
//   A. Grouped List        — flat list, but each core team heads an indented
//                            rail of its own sub-teams (minimal change from today)
//   B. Nested Containers    — each core team is a bordered box wrapping its subs
//   C. Accordion            — collapsible core teams
//   D. Kanban Columns       — one column per core team
//
// Nothing here touches real data or shared components.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from "react";

// ── Dummy data ───────────────────────────────────────────────────────────────
// Shape mirrors the real Team rows: { id, name, team_type, parent_team_id,
// member_count }. Core teams have team_type "core" and parent_team_id null;
// sub-teams point at their core via parent_team_id.
const TEAMS = [
  { id: "c1", name: "Varsity Football", team_type: "core", parent_team_id: null, member_count: 58 },
  { id: "s1", name: "Offensive Line", team_type: "sub", parent_team_id: "c1", member_count: 11 },
  { id: "s2", name: "Wide Receivers", team_type: "sub", parent_team_id: "c1", member_count: 8 },
  { id: "s3", name: "Defensive Backs", team_type: "sub", parent_team_id: "c1", member_count: 9 },
  { id: "s4", name: "Linebackers", team_type: "sub", parent_team_id: "c1", member_count: 7 },

  { id: "c2", name: "JV Football", team_type: "core", parent_team_id: null, member_count: 34 },
  { id: "s5", name: "JV Skill Group", team_type: "sub", parent_team_id: "c2", member_count: 14 },
  { id: "s6", name: "JV Trenches", team_type: "sub", parent_team_id: "c2", member_count: 12 },

  { id: "c3", name: "Speed & Conditioning", team_type: "core", parent_team_id: null, member_count: 41 },
  { id: "s7", name: "Sprint Pod A", team_type: "sub", parent_team_id: "c3", member_count: 10 },
  { id: "s8", name: "Sprint Pod B", team_type: "sub", parent_team_id: "c3", member_count: 10 },
  { id: "s9", name: "Return Specialists", team_type: "sub", parent_team_id: "c3", member_count: 6 },

  // A core team with no sub-teams — make sure every layout handles this.
  { id: "c4", name: "Freshman Prospects", team_type: "core", parent_team_id: null, member_count: 22 },
];

// Group the flat list into [{ core, subs: [] }] preserving source order.
function groupTeams(teams) {
  const cores = teams.filter((t) => t.team_type === "core");
  return cores.map((core) => ({
    core,
    subs: teams.filter((t) => t.team_type === "sub" && t.parent_team_id === core.id),
  }));
}

// ── Shared bits ──────────────────────────────────────────────────────────────
const CoreIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M7 1l1.8 3.6L13 5.3l-3 2.9.7 4.1L7 10.4l-3.7 1.9.7-4.1-3-2.9 4.2-.7L7 1Z" fill="currentColor" />
  </svg>
);
const SubIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

// A single team row — the exact card used on the real Teams tab.
function TeamRow({ t, compact = false }) {
  const isCore = t.team_type === "core";
  return (
    <div className={`dl-teamRow ${compact ? "dl-teamRow--compact" : ""}`}>
      <div className={`dl-teamIcon ${isCore ? "dl-teamIcon--core" : "dl-teamIcon--sub"}`} aria-hidden="true">
        {isCore ? <CoreIcon /> : <SubIcon />}
      </div>
      <div className="dl-teamInfo">
        <div className="dl-teamName">{t.name}</div>
        <div className="dl-teamType">{isCore ? "Core team" : "Sub-team"}</div>
      </div>
      <div className={`dl-teamBadge ${isCore ? "dl-teamBadge--core" : "dl-teamBadge--sub"}`}>{t.team_type}</div>
      <div className="dl-teamCount">
        {t.member_count ?? 0}
        <span className="dl-teamCountLabel">athletes</span>
      </div>
    </div>
  );
}

// ── Layout A: Grouped List ───────────────────────────────────────────────────
// Flat vertical list (like today) but each core team heads a rail; its subs are
// indented beneath with a connector line. Smallest departure from current UI.
function LayoutGroupedList({ groups }) {
  return (
    <div className="dl-list">
      {groups.map(({ core, subs }) => (
        <div key={core.id} className="dl-groupA">
          <TeamRow t={core} />
          {subs.length > 0 && (
            <div className="dl-railA">
              {subs.map((s) => (
                <div key={s.id} className="dl-railA-item">
                  <TeamRow t={s} compact />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Layout B: Nested Containers ──────────────────────────────────────────────
// Each core team is a bordered container; its header sits at the top and its
// sub-teams are stacked inside. Strong visual grouping.
function LayoutNestedContainers({ groups }) {
  return (
    <div className="dl-list">
      {groups.map(({ core, subs }) => (
        <div key={core.id} className="dl-containerB">
          <div className="dl-containerB-head">
            <div className="dl-teamIcon dl-teamIcon--core" aria-hidden="true"><CoreIcon /></div>
            <div className="dl-teamInfo">
              <div className="dl-teamName">{core.name}</div>
              <div className="dl-teamType">Core team · {subs.length} sub-team{subs.length === 1 ? "" : "s"}</div>
            </div>
            <div className="dl-teamCount">
              {core.member_count ?? 0}
              <span className="dl-teamCountLabel">athletes</span>
            </div>
          </div>
          {subs.length > 0 ? (
            <div className="dl-containerB-body">
              {subs.map((s) => <TeamRow key={s.id} t={s} compact />)}
            </div>
          ) : (
            <div className="dl-containerB-empty">No sub-teams yet</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Layout C: Accordion ──────────────────────────────────────────────────────
// Core teams collapse/expand to reveal their sub-teams. Best when there are
// many cores and you want a scannable overview.
function LayoutAccordion({ groups }) {
  const [open, setOpen] = useState(() => new Set(groups.map((g) => g.core.id)));
  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="dl-list">
      {groups.map(({ core, subs }) => {
        const isOpen = open.has(core.id);
        return (
          <div key={core.id} className="dl-accC">
            <button type="button" className="dl-accC-head" onClick={() => toggle(core.id)} aria-expanded={isOpen}>
              <span className={`dl-accC-chev ${isOpen ? "isOpen" : ""}`} aria-hidden="true">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M3 1.5L7 5l-4 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <div className="dl-teamIcon dl-teamIcon--core" aria-hidden="true"><CoreIcon /></div>
              <div className="dl-teamInfo">
                <div className="dl-teamName">{core.name}</div>
                <div className="dl-teamType">{subs.length} sub-team{subs.length === 1 ? "" : "s"}</div>
              </div>
              <div className="dl-teamCount">
                {core.member_count ?? 0}
                <span className="dl-teamCountLabel">athletes</span>
              </div>
            </button>
            {isOpen && (
              <div className="dl-accC-body">
                {subs.length > 0
                  ? subs.map((s) => <TeamRow key={s.id} t={s} compact />)
                  : <div className="dl-containerB-empty">No sub-teams yet</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Layout D: Kanban Columns ─────────────────────────────────────────────────
// One column per core team, sub-teams stacked as mini-cards. Good for wide
// screens and comparing cores side-by-side.
function LayoutKanban({ groups }) {
  return (
    <div className="dl-kanban">
      {groups.map(({ core, subs }) => (
        <div key={core.id} className="dl-colD">
          <div className="dl-colD-head">
            <div className="dl-teamIcon dl-teamIcon--core" aria-hidden="true"><CoreIcon /></div>
            <div className="dl-teamInfo">
              <div className="dl-teamName">{core.name}</div>
              <div className="dl-teamType">{core.member_count ?? 0} athletes</div>
            </div>
            <span className="dl-colD-tag">{subs.length}</span>
          </div>
          <div className="dl-colD-body">
            {subs.length > 0
              ? subs.map((s) => (
                  <div key={s.id} className="dl-miniD">
                    <div className="dl-teamIcon dl-teamIcon--sub" aria-hidden="true"><SubIcon /></div>
                    <div className="dl-miniD-name">{s.name}</div>
                    <div className="dl-miniD-count">{s.member_count ?? 0}</div>
                  </div>
                ))
              : <div className="dl-containerB-empty">No sub-teams yet</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

const LAYOUTS = [
  { key: "A", label: "Grouped List", desc: "Flat list with indented sub-team rails — smallest change from today.", Comp: LayoutGroupedList },
  { key: "B", label: "Nested Containers", desc: "Each core team is a bordered box wrapping its sub-teams.", Comp: LayoutNestedContainers },
  { key: "C", label: "Accordion", desc: "Collapsible core teams — scannable when there are many.", Comp: LayoutAccordion },
  { key: "D", label: "Kanban Columns", desc: "One column per core team, side-by-side.", Comp: LayoutKanban },
];

export default function Dummy() {
  const [active, setActive] = useState("A");
  const groups = groupTeams(TEAMS);
  const current = LAYOUTS.find((l) => l.key === active) ?? LAYOUTS[0];
  const Active = current.Comp;

  return (
    <div className="dl-page">
      <style>{STYLES}</style>

      <div className="dl-wrap">
        <header className="dl-header">
          <div className="dl-eyebrow">Layout Lab · not shipped</div>
          <h1 className="dl-h1">Teams tab — grouping options</h1>
          <p className="dl-sub">
            Testing how to keep core teams grouped with their sub-teams. Same card styling as the live
            dashboard. Flip between layouts below.
          </p>
        </header>

        <div className="dl-toggle" role="tablist" aria-label="Layout options">
          {LAYOUTS.map((l) => (
            <button
              key={l.key}
              type="button"
              role="tab"
              aria-selected={active === l.key}
              className={`dl-toggleBtn ${active === l.key ? "isActive" : ""}`}
              onClick={() => setActive(l.key)}
            >
              <span className="dl-toggleKey">{l.key}</span>
              {l.label}
            </button>
          ))}
        </div>

        <p className="dl-layoutDesc">{current.desc}</p>

        <div className="dl-stage">
          <Active groups={groups} />
        </div>
      </div>
    </div>
  );
}

// ── Scoped styles ────────────────────────────────────────────────────────────
// `dl-` prefix keeps this fully isolated from the app's design system while
// borrowing its purple accent + dark surface language.
const STYLES = `
  .dl-page{
    min-height:100vh;
    background:radial-gradient(1200px 700px at 70% -10%, rgba(180,0,255,0.10), transparent 60%), #0b0b12;
    color:#e9e9f0;
    font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    padding:40px 20px 80px;
  }
  .dl-wrap{ max-width:960px; margin:0 auto; }
  .dl-eyebrow{
    font-size:11px; font-weight:800; letter-spacing:0.14em; text-transform:uppercase;
    color:rgba(210,130,255,0.9); margin-bottom:10px;
  }
  .dl-h1{ font-size:26px; font-weight:800; margin:0 0 8px; letter-spacing:-0.01em; }
  .dl-sub{ font-size:14px; line-height:1.6; opacity:0.6; max-width:620px; margin:0; }

  .dl-toggle{ display:flex; flex-wrap:wrap; gap:8px; margin:28px 0 6px; }
  .dl-toggleBtn{
    display:inline-flex; align-items:center; gap:8px;
    padding:9px 14px; border-radius:12px; cursor:pointer;
    font-size:13px; font-weight:600; color:rgba(255,255,255,0.66);
    background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.09);
    transition:all 150ms ease;
  }
  .dl-toggleBtn:hover{ border-color:rgba(180,0,255,0.4); color:#fff; }
  .dl-toggleBtn.isActive{
    background:rgba(180,0,255,0.16); border-color:rgba(180,0,255,0.5); color:#fff;
    box-shadow:0 4px 18px rgba(180,0,255,0.18);
  }
  .dl-toggleKey{
    display:inline-flex; align-items:center; justify-content:center;
    width:18px; height:18px; border-radius:6px; font-size:11px; font-weight:800;
    background:rgba(0,0,0,0.28);
  }
  .dl-layoutDesc{ font-size:12.5px; opacity:0.5; margin:14px 0 22px; }

  .dl-stage{ }
  .dl-list{ display:flex; flex-direction:column; gap:10px; }

  /* ── shared team card (mirrors ts-team*) ── */
  .dl-teamRow{
    display:flex; align-items:center; gap:11px;
    padding:11px 12px; border-radius:12px;
    border:1px solid rgba(255,255,255,0.07); background:rgba(255,255,255,0.02);
    cursor:pointer;
    transition:background 150ms ease, border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
  }
  .dl-teamRow:hover{
    background:rgba(180,0,255,0.07); border-color:rgba(180,0,255,0.28);
    transform:translateY(-1px); box-shadow:0 4px 16px rgba(0,0,0,0.20);
  }
  .dl-teamRow--compact{ padding:9px 11px; }
  .dl-teamIcon{
    flex-shrink:0; width:34px; height:34px; border-radius:10px;
    display:flex; align-items:center; justify-content:center;
  }
  .dl-teamIcon--core{
    background:linear-gradient(135deg, rgba(180,0,255,0.28), rgba(180,0,255,0.12));
    border:1px solid rgba(180,0,255,0.35); color:rgba(210,130,255,0.95);
  }
  .dl-teamIcon--sub{
    background:linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03));
    border:1px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.55);
  }
  .dl-teamInfo{ flex:1; min-width:0; }
  .dl-teamName{ font-weight:600; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .dl-teamType{ font-size:11px; margin-top:2px; opacity:0.5; }
  .dl-teamBadge{
    flex-shrink:0; font-size:10px; font-weight:800; letter-spacing:0.07em;
    text-transform:uppercase; padding:3px 9px; border-radius:999px;
  }
  .dl-teamBadge--core{ background:rgba(180,0,255,0.14); border:1px solid rgba(180,0,255,0.30); color:rgba(210,130,255,0.95); }
  .dl-teamBadge--sub{ background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.55); }
  .dl-teamCount{
    flex-shrink:0; display:flex; flex-direction:column; align-items:flex-end; gap:1px;
    font-size:15px; font-weight:700; font-variant-numeric:tabular-nums;
    opacity:0.8; min-width:32px; text-align:right;
  }
  .dl-teamCountLabel{
    display:block; font-size:10px; font-weight:600; letter-spacing:0.04em;
    opacity:0.5; text-transform:uppercase;
  }

  /* ── A: Grouped List ── */
  .dl-groupA{ display:flex; flex-direction:column; }
  .dl-railA{ position:relative; margin:6px 0 4px 17px; padding-left:22px; }
  .dl-railA::before{
    content:""; position:absolute; left:0; top:0; bottom:16px; width:2px;
    background:linear-gradient(rgba(180,0,255,0.35), rgba(180,0,255,0.05));
    border-radius:2px;
  }
  .dl-railA-item{ position:relative; margin-top:6px; }
  .dl-railA-item::before{
    content:""; position:absolute; left:-22px; top:22px; width:18px; height:2px;
    background:rgba(180,0,255,0.22); border-radius:2px;
  }

  /* ── B: Nested Containers ── */
  .dl-containerB{
    border:1px solid rgba(180,0,255,0.22); border-radius:16px;
    background:rgba(180,0,255,0.04); overflow:hidden;
  }
  .dl-containerB-head{
    display:flex; align-items:center; gap:11px; padding:14px 14px;
    border-bottom:1px solid rgba(255,255,255,0.06);
    background:rgba(180,0,255,0.06);
  }
  .dl-containerB-body{ display:flex; flex-direction:column; gap:8px; padding:12px; }
  .dl-containerB-empty{ padding:16px; font-size:12.5px; opacity:0.4; text-align:center; }

  /* ── C: Accordion ── */
  .dl-accC{ border:1px solid rgba(255,255,255,0.08); border-radius:14px; overflow:hidden; background:rgba(255,255,255,0.02); }
  .dl-accC-head{
    display:flex; align-items:center; gap:11px; width:100%; text-align:left;
    padding:12px 14px; background:transparent; border:0; cursor:pointer; color:inherit;
    transition:background 150ms ease;
  }
  .dl-accC-head:hover{ background:rgba(180,0,255,0.06); }
  .dl-accC-chev{ display:flex; color:rgba(210,130,255,0.9); transition:transform 160ms ease; }
  .dl-accC-chev.isOpen{ transform:rotate(90deg); }
  .dl-accC-body{
    display:flex; flex-direction:column; gap:8px;
    padding:4px 12px 12px 12px; border-top:1px solid rgba(255,255,255,0.05);
  }

  /* ── D: Kanban ── */
  .dl-kanban{
    display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:12px;
  }
  .dl-colD{ border:1px solid rgba(255,255,255,0.08); border-radius:14px; background:rgba(255,255,255,0.02); overflow:hidden; }
  .dl-colD-head{
    display:flex; align-items:center; gap:10px; padding:12px;
    border-bottom:1px solid rgba(255,255,255,0.06); background:rgba(180,0,255,0.06);
  }
  .dl-colD-tag{
    flex-shrink:0; min-width:22px; height:22px; padding:0 7px; border-radius:999px;
    display:inline-flex; align-items:center; justify-content:center;
    font-size:11px; font-weight:800; background:rgba(180,0,255,0.16);
    border:1px solid rgba(180,0,255,0.3); color:rgba(210,130,255,0.95);
  }
  .dl-colD-body{ display:flex; flex-direction:column; gap:8px; padding:10px; }
  .dl-miniD{
    display:flex; align-items:center; gap:9px; padding:9px 10px; border-radius:10px;
    border:1px solid rgba(255,255,255,0.07); background:rgba(255,255,255,0.02); cursor:pointer;
    transition:all 150ms ease;
  }
  .dl-miniD:hover{ border-color:rgba(180,0,255,0.28); background:rgba(180,0,255,0.07); }
  .dl-miniD .dl-teamIcon{ width:28px; height:28px; border-radius:8px; }
  .dl-miniD-name{ flex:1; min-width:0; font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .dl-miniD-count{ flex-shrink:0; font-size:13px; font-weight:700; opacity:0.75; font-variant-numeric:tabular-nums; }

  @media (max-width:560px){
    .dl-kanban{ grid-template-columns:1fr; }
    .dl-teamBadge{ display:none; }
  }
`;
