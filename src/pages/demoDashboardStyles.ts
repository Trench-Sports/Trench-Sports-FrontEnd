// src/pages/demoDashboardStyles.ts
// Auto-extracted from dashboard.tsx <style> block so the public /dummy demo
// renders with the exact same design system. Do not hand-edit the shared
// section — re-extract if the dashboard styles change. Demo-only additions
// are appended in DEMO_EXTRA_CSS below.

export const DASHBOARD_CSS = String.raw`

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
`;

// ─────────────────────────────────────────────────────────────────────────────
// Demo-only additions — public /dummy showcase chrome: the "sample data" banner,
// the three-tier segmented toggle, the tier overview panel, locked-feature
// overlays, and the read-only pill. Kept out of the real dashboard.
// ─────────────────────────────────────────────────────────────────────────────
export const DEMO_EXTRA_CSS = String.raw`
  /* Demo banner */
  .dm-banner{
    display:flex; align-items:center; gap:14px; flex-wrap:wrap;
    padding:12px 18px; border-radius:16px; margin-bottom:18px;
    border:1px solid rgba(180,0,255,0.32);
    background:linear-gradient(120deg, rgba(180,0,255,0.14), rgba(180,0,255,0.05));
  }
  :root[data-theme="light"] .dm-banner{
    border-color:rgba(130,0,200,0.30);
    background:linear-gradient(120deg, rgba(180,0,255,0.10), rgba(180,0,255,0.03));
  }
  .dm-bannerDot{
    width:9px; height:9px; border-radius:50%; flex-shrink:0;
    background:#b400ff; box-shadow:0 0 10px 2px rgba(180,0,255,0.6);
    animation:dmPulse 2s ease-in-out infinite;
  }
  @keyframes dmPulse{ 0%,100%{opacity:1;} 50%{opacity:0.4;} }
  .dm-bannerText{ flex:1; min-width:220px; font-size:13px; line-height:1.5; opacity:0.9; }
  .dm-bannerText b{ font-weight:800; }
  .dm-roPill{
    display:inline-flex; align-items:center; gap:6px; flex-shrink:0;
    font-size:11px; font-weight:800; letter-spacing:0.05em; text-transform:uppercase;
    padding:5px 11px; border-radius:999px;
    border:1px solid rgba(255,255,255,0.18); background:rgba(255,255,255,0.06);
    opacity:0.85;
  }
  :root[data-theme="light"] .dm-roPill{ border-color:rgba(20,20,40,0.20); background:rgba(20,20,40,0.05); }

  /* Tier toggle — segmented control */
  .dm-tierBar{
    display:flex; align-items:stretch; gap:8px; flex-wrap:wrap; margin-bottom:16px;
  }
  .dm-tierSeg{
    flex:1; min-width:210px; text-align:left; cursor:pointer; position:relative;
    display:flex; flex-direction:column; gap:4px;
    padding:14px 16px; border-radius:16px; font:inherit; color:inherit;
    border:1px solid rgba(255,255,255,0.10);
    background:rgba(255,255,255,0.03);
    transition:border-color 160ms ease, background 160ms ease, transform 120ms ease, box-shadow 160ms ease;
  }
  :root[data-theme="light"] .dm-tierSeg{ border-color:rgba(20,20,40,0.10); background:rgba(255,255,255,0.6); }
  .dm-tierSeg:hover{ transform:translateY(-1px); border-color:rgba(180,0,255,0.35); }
  .dm-tierSeg.isActive{
    border-color:rgba(180,0,255,0.60);
    background:linear-gradient(160deg, rgba(180,0,255,0.16), rgba(180,0,255,0.05));
    box-shadow:0 8px 26px rgba(180,0,255,0.18);
  }
  .dm-tierSegTop{ display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .dm-tierSegKicker{ font-size:10px; font-weight:800; letter-spacing:0.09em; text-transform:uppercase; opacity:0.55; }
  .dm-tierSeg.isActive .dm-tierSegKicker{ color:rgba(210,140,255,0.95); opacity:1; }
  .dm-tierSegName{ font-size:18px; font-weight:850; letter-spacing:-0.01em; }
  .dm-tierSegTagline{ font-size:12px; opacity:0.62; }
  .dm-tierSegCheck{
    width:20px; height:20px; border-radius:50%; flex-shrink:0;
    border:1px solid rgba(255,255,255,0.22);
    display:flex; align-items:center; justify-content:center; font-size:11px;
  }
  .dm-tierSeg.isActive .dm-tierSegCheck{
    background:#b400ff; border-color:#b400ff; color:#fff;
    box-shadow:0 0 12px rgba(180,0,255,0.6);
  }

  /* Tier overview panel */
  .dm-tierOverview{
    display:grid; grid-template-columns:1.4fr 1fr; gap:18px; align-items:start;
  }
  @media (max-width: 860px){ .dm-tierOverview{ grid-template-columns:1fr; } }
  .dm-featureList{ display:flex; flex-direction:column; gap:9px; margin-top:4px; }
  .dm-featureRow{ display:flex; align-items:flex-start; gap:10px; font-size:13.5px; line-height:1.4; }
  .dm-featureTick{ flex-shrink:0; margin-top:1px; color:rgba(120,230,170,0.95); }
  :root[data-theme="light"] .dm-featureTick{ color:rgba(20,150,90,0.95); }
  .dm-limitGrid{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .dm-limitCell{
    padding:11px 13px; border-radius:12px;
    border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.02);
  }
  :root[data-theme="light"] .dm-limitCell{ border-color:rgba(20,20,40,0.08); background:rgba(20,20,40,0.02); }
  .dm-limitLabel{ font-size:10px; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; opacity:0.45; }
  .dm-limitValue{ font-size:16px; font-weight:800; margin-top:3px; font-variant-numeric:tabular-nums; }

  /* Locked feature overlay */
  .dm-lockWrap{ position:relative; border-radius:20px; overflow:hidden; }
  .dm-lockUnder{ filter:blur(3px) saturate(0.7); opacity:0.5; pointer-events:none; user-select:none; }
  .dm-lockOverlay{
    position:absolute; inset:0; z-index:6;
    display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;
    gap:10px; padding:24px;
    background:radial-gradient(120% 120% at 50% 40%, rgba(10,10,16,0.55), rgba(10,10,16,0.82));
  }
  :root[data-theme="light"] .dm-lockOverlay{
    background:radial-gradient(120% 120% at 50% 40%, rgba(245,245,250,0.7), rgba(245,245,250,0.9));
  }
  .dm-lockIcon{
    width:44px; height:44px; border-radius:14px;
    display:flex; align-items:center; justify-content:center; font-size:20px;
    border:1px solid rgba(180,0,255,0.4); background:rgba(180,0,255,0.14);
    color:rgba(210,140,255,0.95);
  }
  .dm-lockTitle{ font-size:15px; font-weight:800; }
  .dm-lockBody{ font-size:12.5px; line-height:1.55; opacity:0.72; max-width:340px; }
  .dm-upgradeChip{
    display:inline-flex; align-items:center; gap:7px; margin-top:2px;
    padding:8px 15px; border-radius:999px; font-size:12px; font-weight:800;
    border:1px solid rgba(180,0,255,0.5); background:rgba(180,0,255,0.18);
    color:rgba(215,150,255,0.98);
  }

  /* Small lock badge (inline, e.g. on a mode pill) */
  .dm-lockBadge{
    display:inline-flex; align-items:center; gap:4px;
    font-size:10px; font-weight:800; letter-spacing:0.04em; text-transform:uppercase;
    padding:2px 7px; border-radius:999px;
    border:1px solid rgba(255,255,255,0.16); background:rgba(255,255,255,0.05); opacity:0.75;
  }

  /* Program stat strip */
  .dm-statStrip{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px; }
  @media (max-width: 720px){ .dm-statStrip{ grid-template-columns:repeat(2,1fr); } }
  .dm-statTile{
    padding:15px 17px; border-radius:16px;
    border:1px solid rgba(255,255,255,0.09); background:rgba(255,255,255,0.03);
  }
  :root[data-theme="light"] .dm-statTile{ border-color:rgba(20,20,40,0.09); background:rgba(255,255,255,0.6); }
  .dm-statTileLabel{ font-size:11px; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; opacity:0.45; }
  .dm-statTileValue{ font-size:26px; font-weight:850; margin-top:5px; letter-spacing:-0.02em; font-variant-numeric:tabular-nums; }
  .dm-statTileSub{ font-size:11.5px; opacity:0.5; margin-top:2px; }

  /* Team comparison bars */
  .dm-teamCompareRow{ display:flex; align-items:center; gap:12px; padding:9px 0; }
  .dm-teamCompareName{ width:120px; flex-shrink:0; font-size:13px; font-weight:700; }
  .dm-teamCompareBarWrap{ flex:1; height:22px; border-radius:8px; background:rgba(255,255,255,0.04); overflow:hidden; position:relative; }
  :root[data-theme="light"] .dm-teamCompareBarWrap{ background:rgba(20,20,40,0.05); }
  .dm-teamCompareBar{ height:100%; border-radius:8px; transition:width 400ms cubic-bezier(0.22,1,0.36,1); }
  .dm-teamCompareVal{ width:64px; flex-shrink:0; text-align:right; font-size:13px; font-weight:800; font-variant-numeric:tabular-nums; }

  /* Fatigue / API rows */
  .dm-fatigueRow{
    display:flex; align-items:center; gap:12px; padding:11px 13px; border-radius:12px;
    border:1px solid rgba(255,100,80,0.18); background:rgba(255,100,80,0.05);
  }
  .dm-keyRow{
    display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:12px;
    border:1px solid rgba(255,255,255,0.09); background:rgba(255,255,255,0.02);
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px;
  }
  .dm-endpoint{
    display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:10px;
    border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.02);
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px;
  }
  .dm-verb{ font-weight:800; color:rgba(120,230,170,0.95); font-size:11px; }
`;
