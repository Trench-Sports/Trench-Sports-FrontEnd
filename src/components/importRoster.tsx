// src/components/importRoster.tsx
//
// Trench Sports — Import Roster Modal
//
// Usage:
//   import ImportRosterModal from "./importRoster";
//
//   <ImportRosterModal
//     open={showImport}
//     onClose={() => setShowImport(false)}
//     onImported={(count) => console.log(`Imported ${count} athletes`)}
//     programId={programId}
//     userId={userId}
//   />
//
// Flow:
//   Step 1 — Team select    (admin picks core_team; roles guard coaches out)
//   Step 2 — Upload / parse (drag-drop or browse; papaparse; 500-row cap)
//   Step 3 — Preview table  (per-row status: valid | warning | error)
//   Step 4 — Confirm        (batch insert athletes + team_members; error export)
//
// Admin-only. Rendered inside the existing Modal component.

import React, { useCallback, useEffect, useRef, useState } from "react";
import Modal from "./modal";
import { supabase } from "../supabaseClient";

// ─── Template config ──────────────────────────────────────────────────────────

const TEMPLATE_VERSION = "1";

const COLUMNS = [
  "first_name",
  "last_name",
  "email",
  "height",
  "weight",
  "date_of_birth",
  "sport",
  "position",
  "city",
  "state",
] as const;

type Col = typeof COLUMNS[number];

const REQUIRED: Set<Col> = new Set(["first_name", "last_name"]);

const COL_LABELS: Record<Col, string> = {
  first_name:    "First Name",
  last_name:     "Last Name",
  email:         "Email",
  height:        "Height",
  weight:        "Weight",
  date_of_birth: "Date of Birth",
  sport:         "Sport",
  position:      "Position",
  city:          "City",
  state:         "State",
};

const MAX_ROWS = 500;

// ─── Types ────────────────────────────────────────────────────────────────────

type RawRow = Record<Col, string>;

type RowStatus = "valid" | "warning" | "error";

interface ParsedRow {
  /** 1-based CSV row number (accounts for header + example rows) */
  csvLine: number;
  data: RawRow;
  status: RowStatus;
  /** Human-readable reason for warning/error */
  reason: string | null;
  /** Existing athlete record that collides (warning only) */
  duplicate: ExistingAthlete | null;
  /** Admin skipped this row in the preview table */
  skipped: boolean;
}

interface ExistingAthlete {
  id: string;
  first_name: string;
  last_name: string;
  sport: string | null;
  position: string | null;
}

interface Team {
  id: string;
  name: string;
  team_type: string;
  parent_team_id: string | null;
}

// ─── Adaptive CSS variables injected once ────────────────────────────────────
// Dark-mode values are the originals; light-mode overrides flip whites→darks.

const ADAPTIVE_STYLES = `
  .ir-root {
    --ir-text:          rgba(255,255,255,0.92);
    --ir-muted:         rgba(255,255,255,0.55);
    --ir-muted-weak:    rgba(255,255,255,0.45);
    --ir-divider:       rgba(255,255,255,0.07);
    --ir-border:        rgba(255,255,255,0.12);
    --ir-border-weak:   rgba(255,255,255,0.08);
    --ir-surface:       rgba(255,255,255,0.04);
    --ir-surface-hover: rgba(255,255,255,0.025);
    --ir-dot-inactive:  rgba(255,255,255,0.14);
    --ir-connector:     rgba(255,255,255,0.10);
    --ir-drag-border:   rgba(255,255,255,0.16);
    --ir-drag-bg:       rgba(255,255,255,0.025);
    --ir-col-opt-bg:    rgba(255,255,255,0.05);
    --ir-col-opt-border:rgba(255,255,255,0.10);
    --ir-col-opt-text:  rgba(255,255,255,0.55);
    --ir-skip-border:   rgba(255,255,255,0.12);
    --ir-skip-bg:       rgba(255,255,255,0.04);
    --ir-skip-text:     rgba(255,255,255,0.45);
    --ir-dl-border:     rgba(255,255,255,0.14);
    --ir-dl-bg:         rgba(255,255,255,0.04);
    --ir-dl-text:       rgba(255,255,255,0.60);
    --ir-req-note:      rgba(255,255,255,0.38);
    --ir-dot-sep:       rgba(255,255,255,0.25);
    --ir-row-num:       rgba(255,255,255,0.38);
    --ir-col-label:     rgba(255,255,255,0.42);
    --ir-col-empty:     rgba(255,255,255,0.30);
    /* warning */
    --ir-warn-bg:       rgba(255,190,0,0.10);
    --ir-warn-border:   rgba(255,190,0,0.32);
    --ir-warn-text:     rgba(255,200,40,0.95);
    --ir-warn-bar:      rgba(255,200,40,0.90);
    --ir-warn-dupe-bg:  rgba(255,190,0,0.07);
    --ir-warn-dupe-bd:  rgba(255,190,0,0.18);
    --ir-warn-dupe-txt: rgba(255,200,40,0.85);
    --ir-warn-ack-bd:   rgba(255,190,0,0.24);
    --ir-warn-ack-bg:   rgba(255,190,0,0.06);
    --ir-warn-ack-txt:  rgba(255,200,40,0.85);
    /* error */
    --ir-err-bg:        rgba(255,70,70,0.10);
    --ir-err-border:    rgba(255,70,70,0.30);
    --ir-err-text:      rgba(255,110,100,0.95);
    --ir-err-bar:       rgba(255,110,100,0.90);
  }
  @media (prefers-color-scheme: light) {
    .ir-root {
      --ir-text:          rgba(15,10,30,0.92);
      --ir-muted:         rgba(15,10,30,0.55);
      --ir-muted-weak:    rgba(15,10,30,0.48);
      --ir-divider:       rgba(15,10,30,0.10);
      --ir-border:        rgba(15,10,30,0.16);
      --ir-border-weak:   rgba(15,10,30,0.10);
      --ir-surface:       rgba(15,10,30,0.04);
      --ir-surface-hover: rgba(15,10,30,0.03);
      --ir-dot-inactive:  rgba(15,10,30,0.14);
      --ir-connector:     rgba(15,10,30,0.12);
      --ir-drag-border:   rgba(15,10,30,0.20);
      --ir-drag-bg:       rgba(15,10,30,0.03);
      --ir-col-opt-bg:    rgba(15,10,30,0.05);
      --ir-col-opt-border:rgba(15,10,30,0.14);
      --ir-col-opt-text:  rgba(15,10,30,0.60);
      --ir-skip-border:   rgba(15,10,30,0.16);
      --ir-skip-bg:       rgba(15,10,30,0.04);
      --ir-skip-text:     rgba(15,10,30,0.50);
      --ir-dl-border:     rgba(15,10,30,0.16);
      --ir-dl-bg:         rgba(15,10,30,0.04);
      --ir-dl-text:       rgba(15,10,30,0.60);
      --ir-req-note:      rgba(15,10,30,0.45);
      --ir-dot-sep:       rgba(15,10,30,0.25);
      --ir-row-num:       rgba(15,10,30,0.45);
      --ir-col-label:     rgba(15,10,30,0.55);
      --ir-col-empty:     rgba(15,10,30,0.35);
      /* warning */
      --ir-warn-bg:       rgba(180,120,0,0.08);
      --ir-warn-border:   rgba(160,100,0,0.40);
      --ir-warn-text:     rgba(140,85,0,0.95);
      --ir-warn-bar:      rgba(140,85,0,0.90);
      --ir-warn-dupe-bg:  rgba(180,120,0,0.07);
      --ir-warn-dupe-bd:  rgba(160,100,0,0.30);
      --ir-warn-dupe-txt: rgba(140,85,0,0.90);
      --ir-warn-ack-bd:   rgba(160,100,0,0.35);
      --ir-warn-ack-bg:   rgba(180,120,0,0.06);
      --ir-warn-ack-txt:  rgba(140,85,0,0.90);
      /* error */
      --ir-err-bg:        rgba(180,30,30,0.08);
      --ir-err-border:    rgba(160,20,20,0.35);
      --ir-err-text:      rgba(160,20,20,0.95);
      --ir-err-bar:       rgba(160,20,20,0.90);
    }
  }
  [data-theme="light"] .ir-root {
    --ir-text:          rgba(15,10,30,0.92);
    --ir-muted:         rgba(15,10,30,0.55);
    --ir-muted-weak:    rgba(15,10,30,0.48);
    --ir-divider:       rgba(15,10,30,0.10);
    --ir-border:        rgba(15,10,30,0.16);
    --ir-border-weak:   rgba(15,10,30,0.10);
    --ir-surface:       rgba(15,10,30,0.04);
    --ir-surface-hover: rgba(15,10,30,0.03);
    --ir-dot-inactive:  rgba(15,10,30,0.14);
    --ir-connector:     rgba(15,10,30,0.12);
    --ir-drag-border:   rgba(15,10,30,0.20);
    --ir-drag-bg:       rgba(15,10,30,0.03);
    --ir-col-opt-bg:    rgba(15,10,30,0.05);
    --ir-col-opt-border:rgba(15,10,30,0.14);
    --ir-col-opt-text:  rgba(15,10,30,0.60);
    --ir-skip-border:   rgba(15,10,30,0.16);
    --ir-skip-bg:       rgba(15,10,30,0.04);
    --ir-skip-text:     rgba(15,10,30,0.50);
    --ir-dl-border:     rgba(15,10,30,0.16);
    --ir-dl-bg:         rgba(15,10,30,0.04);
    --ir-dl-text:       rgba(15,10,30,0.60);
    --ir-req-note:      rgba(15,10,30,0.45);
    --ir-dot-sep:       rgba(15,10,30,0.25);
    --ir-row-num:       rgba(15,10,30,0.45);
    --ir-col-label:     rgba(15,10,30,0.55);
    --ir-col-empty:     rgba(15,10,30,0.35);
    /* warning */
    --ir-warn-bg:       rgba(180,120,0,0.08);
    --ir-warn-border:   rgba(160,100,0,0.40);
    --ir-warn-text:     rgba(140,85,0,0.95);
    --ir-warn-bar:      rgba(140,85,0,0.90);
    --ir-warn-dupe-bg:  rgba(180,120,0,0.07);
    --ir-warn-dupe-bd:  rgba(160,100,0,0.30);
    --ir-warn-dupe-txt: rgba(140,85,0,0.90);
    --ir-warn-ack-bd:   rgba(160,100,0,0.35);
    --ir-warn-ack-bg:   rgba(180,120,0,0.06);
    --ir-warn-ack-txt:  rgba(140,85,0,0.90);
    /* error */
    --ir-err-bg:        rgba(180,30,30,0.08);
    --ir-err-border:    rgba(160,20,20,0.35);
    --ir-err-text:      rgba(160,20,20,0.95);
    --ir-err-bar:       rgba(160,20,20,0.90);
  }
`;

// ─── Shared field styles (mirrors createAthlete.jsx) ─────────────────────────

const F = {
  group: { display: "flex", flexDirection: "column" as const, gap: "6px" },
  label: { fontSize: "13px", fontWeight: 700, color: "var(--muted, var(--ir-muted))", letterSpacing: "0.02em" },
  input: {
    width: "100%", boxSizing: "border-box" as const,
    padding: "10px 13px", borderRadius: "12px",
    border: "1px solid var(--btn-border, var(--ir-border))",
    background: "var(--btn-bg, var(--ir-surface))",
    color: "var(--text, var(--ir-text))",
    fontSize: "15px", outline: "none",
    transition: "border-color 160ms ease, box-shadow 160ms ease",
  },
  inputFocus: { borderColor: "var(--accent, #b400ff)", boxShadow: "0 0 0 3px rgba(180,0,255,0.14)" },
  error: {
    padding: "10px 13px", borderRadius: "12px",
    border: "1px solid rgba(220,50,50,0.35)",
    background: "rgba(220,50,50,0.08)",
    color: "rgba(200,50,50,0.95)", fontSize: "13px",
  },
  divider: { height: "1px", background: "var(--ir-divider)", margin: "4px 0" },
  sectionLabel: {
    fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "var(--muted, var(--ir-muted-weak))", marginBottom: "2px",
  },
};

// ─── Utility helpers ──────────────────────────────────────────────────────────

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function isValidDate(s: string): boolean {
  if (!s.trim()) return true; // optional
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.trim())) return !isNaN(Date.parse(s.trim()));
  // MM/DD/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s.trim())) {
    const [m, d, y] = s.trim().split("/").map(Number);
    return !isNaN(new Date(y, m - 1, d).getTime());
  }
  return false;
}

/** Normalise to "YYYY-MM-DD" for DB storage */
function normaliseDate(s: string): string {
  if (!s.trim()) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.trim())) return s.trim();
  const [m, d, y] = s.trim().split("/").map(Number);
  return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

/** Generate template CSV Blob entirely client-side */
function buildTemplateBlob(): Blob {
  const header = `_template_version,${COLUMNS.join(",")}`;
  const example = `${TEMPLATE_VERSION},John,Smith,john@example.com,6'1",185lbs,1998-04-15,Football,Linebacker,Dallas,TX`;
  const content = [header, example].join("\r\n");
  return new Blob([content], { type: "text/csv;charset=utf-8;" });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Papaparse dynamic import wrapper ────────────────────────────────────────
// We load papaparse lazily from CDN so there's no bundle-time dependency.

declare const Papa: any; // will be on window after script loads

function loadPapaParse(): Promise<void> {
  if (typeof Papa !== "undefined") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-lib="papaparse"]');
    if (existing) { existing.addEventListener("load", () => resolve()); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js";
    s.setAttribute("data-lib", "papaparse");
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load PapaParse"));
    document.head.appendChild(s);
  });
}

// ─── SelectField (mirroring createAthlete.jsx) ───────────────────────────────

function SelectField({ label, required, children, ...p }: any) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={F.group}>
      <label style={F.label}>
        {label}
        {required && <span style={{ color: "rgba(180,0,255,0.9)", marginLeft: 3 }}>*</span>}
      </label>
      <select
        style={{ ...F.input, appearance: "none", WebkitAppearance: "none", cursor: "pointer", ...(focused ? F.inputFocus : {}) }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...p}
      >
        {children}
      </select>
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<RowStatus, { bg: string; border: string; color: string; label: string }> = {
  valid:   { bg: "rgba(0,220,140,0.10)",       border: "rgba(0,220,140,0.30)",       color: "rgba(0,200,130,0.95)",  label: "Valid"   },
  warning: { bg: "var(--ir-warn-bg)",           border: "var(--ir-warn-border)",      color: "var(--ir-warn-text)",   label: "Warning" },
  error:   { bg: "var(--ir-err-bg)",            border: "var(--ir-err-border)",       color: "var(--ir-err-text)",    label: "Error"   },
};

function StatusBadge({ status }: { status: RowStatus }) {
  const c = STATUS_COLORS[status];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap",
      fontSize: 11, fontWeight: 800, letterSpacing: "0.04em",
      background: c.bg, border: `1px solid ${c.border}`, color: c.color,
    }}>
      {status === "valid" ? "✓" : status === "warning" ? "⚠" : "✕"} {c.label}
    </span>
  );
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepDots({ step, total }: { step: number; total: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 20 }}>
      {Array.from({ length: total }).map((_, i) => {
        const done   = i < step;
        const active = i === step;
        return (
          <React.Fragment key={i}>
            <div style={{
              width: active ? 20 : 8, height: 8, borderRadius: 999,
              background: done
                ? "rgba(180,0,255,0.55)"
                : active
                ? "rgba(180,0,255,0.90)"
                : "var(--ir-dot-inactive)",
              transition: "width 200ms ease, background 200ms ease",
            }} />
            {i < total - 1 && (
              <div style={{ flex: 1, height: 1, background: done ? "rgba(180,0,255,0.30)" : "var(--ir-connector)" }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ImportRosterModalProps {
  open: boolean;
  onClose: () => void;
  onImported?: (count: number) => void;
  programId: string | null;
  userId: string | null;
}

export default function ImportRosterModal({
  open,
  onClose,
  onImported,
  programId,
  userId,
}: ImportRosterModalProps) {
  // ── Wizard step: 0 = team, 1 = upload, 2 = preview, 3 = done ─────────────
  const [step, setStep] = useState(0);

  // ── Step 0 — Team ─────────────────────────────────────────────────────────
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");

  // ── Step 1 — Upload ───────────────────────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Step 2 — Preview ──────────────────────────────────────────────────────
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [existingAthletes, setExistingAthletes] = useState<ExistingAthlete[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  /** Warning acknowledgment checkbox */
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);

  // ── Step 3 — Confirm ──────────────────────────────────────────────────────
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ count: number } | null>(null);

  // ── Reset on open/close ───────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setStep(0);
      setSelectedTeamId("");
      setRows([]);
      setParseError(null);
      setPreviewError(null);
      setImportError(null);
      setImportResult(null);
      setWarningsAcknowledged(false);
      setIsDragging(false);
    }
  }, [open]);

  // ── Fetch teams when modal opens ──────────────────────────────────────────
  useEffect(() => {
    if (!open || !programId || !supabase) return;
    setTeamsLoading(true);
    supabase
      .from("teams")
      .select("id, name, team_type, parent_team_id")
      .eq("program_id", programId)
      .order("name")
      .then(({ data, error }) => {
        setTeamsLoading(false);
        if (!error && data) setTeams(data);
      });
  }, [open, programId]);

  // ── Fetch existing athletes for duplicate detection ───────────────────────
  useEffect(() => {
    if (step !== 1 || !programId || !supabase) return;
    supabase
      .from("athletes")
      .select("id, first_name, last_name, sport, position")
      .eq("program_id", programId)
      .then(({ data }) => { if (data) setExistingAthletes(data); });
  }, [step, programId]);

  // ── Derived counts ────────────────────────────────────────────────────────
  const validRows    = rows.filter((r) => !r.skipped && r.status === "valid");
  const warningRows  = rows.filter((r) => !r.skipped && r.status === "warning");
  const errorRows    = rows.filter((r) => !r.skipped && r.status === "error");
  const activeErrors = errorRows.length;
  const activeWarnings = warningRows.length;
  const skippedCount = rows.filter((r) => r.skipped).length;
  const importableCount = validRows.length + warningRows.length;

  const canConfirm =
    activeErrors === 0 &&
    importableCount > 0 &&
    (activeWarnings === 0 || warningsAcknowledged);

  // ── Template download ─────────────────────────────────────────────────────
  function handleDownloadTemplate() {
    downloadBlob(buildTemplateBlob(), "trench_roster_template.csv");
  }

  // ── File parse ────────────────────────────────────────────────────────────
  async function parseFile(file: File) {
    setParseError(null);
    if (!file.name.match(/\.csv$/i)) {
      setParseError("Please upload a .csv file.");
      return;
    }

    try {
      await loadPapaParse();
    } catch {
      setParseError("Failed to load CSV parser. Please check your connection.");
      return;
    }

    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results: any) => {
        const rawData: string[][] = results.data;
        if (rawData.length < 2) {
          setParseError("CSV is empty or missing headers.");
          return;
        }

        // Row 0: header. Detect template version column.
        const headerRow = rawData[0].map((h: string) => h.trim().toLowerCase());
        const hasVersionCol = headerRow[0] === "_template_version";

        // Find column indices
        const colOffset = hasVersionCol ? 1 : 0;
        const dataHeaders = headerRow.slice(colOffset);
        const colIdx: Record<string, number> = {};
        dataHeaders.forEach((h: string, i: number) => { colIdx[h] = i; });

        // Row 1: example/instructions row — always strip it
        const dataRows = rawData.slice(2); // rows after header + example

        if (dataRows.length === 0) {
          setParseError("No athlete data found. Did you remove the example row?");
          return;
        }

        if (dataRows.length > MAX_ROWS) {
          setParseError(`CSV exceeds ${MAX_ROWS}-row limit (found ${dataRows.length} rows). For large imports, contact support.`);
          return;
        }

        // Build a lookup for quick duplicate detection
        const existingSet = new Set(
          existingAthletes.map((a) =>
            `${a.first_name.trim().toLowerCase()}|${a.last_name.trim().toLowerCase()}`
          )
        );
        const existingMap = new Map(
          existingAthletes.map((a) => [
            `${a.first_name.trim().toLowerCase()}|${a.last_name.trim().toLowerCase()}`,
            a,
          ])
        );

        const parsed: ParsedRow[] = dataRows.map((cells: string[], idx: number) => {
          const offset = colOffset; // shift past _template_version col
          const get = (col: Col): string =>
            (cells[colIdx[col] + offset] ?? "").trim();

          const data: RawRow = {
            first_name:    get("first_name"),
            last_name:     get("last_name"),
            email:         get("email"),
            height:        get("height"),
            weight:        get("weight"),
            date_of_birth: get("date_of_birth"),
            sport:         get("sport"),
            position:      get("position"),
            city:          get("city"),
            state:         get("state"),
          };

          // Validation
          if (!data.first_name) {
            return { csvLine: idx + 3, data, status: "error", reason: "Missing first_name", duplicate: null, skipped: false };
          }
          if (!data.last_name) {
            return { csvLine: idx + 3, data, status: "error", reason: "Missing last_name", duplicate: null, skipped: false };
          }
          if (data.email && !isValidEmail(data.email)) {
            return { csvLine: idx + 3, data, status: "error", reason: `Invalid email format: "${data.email}"`, duplicate: null, skipped: false };
          }
          if (data.date_of_birth && !isValidDate(data.date_of_birth)) {
            return { csvLine: idx + 3, data, status: "error", reason: `Invalid date format "${data.date_of_birth}" — use YYYY-MM-DD or MM/DD/YYYY`, duplicate: null, skipped: false };
          }

          // Duplicate check
          const dupeKey = `${data.first_name.toLowerCase()}|${data.last_name.toLowerCase()}`;
          if (existingSet.has(dupeKey)) {
            return { csvLine: idx + 3, data, status: "warning", reason: "Athlete with same name already exists in program", duplicate: existingMap.get(dupeKey) ?? null, skipped: false };
          }

          return { csvLine: idx + 3, data, status: "valid", reason: null, duplicate: null, skipped: false };
        });

        setRows(parsed);
        setStep(2);
      },
      error: (err: any) => {
        setParseError(`Parse error: ${err.message}`);
      },
    });
  }

  // ── Drag-drop handlers ────────────────────────────────────────────────────
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }, [existingAthletes]); // re-bind when existingAthletes updates

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  // ── Confirm import ────────────────────────────────────────────────────────
  async function handleConfirm() {
    if (!programId || !userId || !selectedTeamId || !supabase) return;
    setImporting(true);
    setImportError(null);

    const toImport = rows.filter((r) => !r.skipped && r.status !== "error");

    // Resolve core_team_id
    const selectedTeam = teams.find((t) => t.id === selectedTeamId);
    const coreTeamId = selectedTeam?.parent_team_id ?? selectedTeamId;
    const subTeamId  = selectedTeam?.parent_team_id ? selectedTeamId : null;

    try {
      // 1. Batch insert athletes
      const athletePayloads = toImport.map((r) => ({
        program_id:    programId,
        core_team_id:  coreTeamId,
        created_by:    userId,
        coach_user_id: null,
        first_name:    r.data.first_name,
        last_name:     r.data.last_name,
        email:         r.data.email     || null,
        height:        r.data.height    || null,
        weight:        r.data.weight    || null,
        date_of_birth: r.data.date_of_birth ? normaliseDate(r.data.date_of_birth) : null,
        sport:         r.data.sport     || null,
        position:      r.data.position  || null,
        city:          r.data.city      || null,
        state:         r.data.state     || null,
      }));

      const { data: inserted, error: insertErr } = await supabase
        .from("athletes")
        .insert(athletePayloads)
        .select("id");

      if (insertErr) throw insertErr;
      if (!inserted) throw new Error("No data returned from athlete insert.");

      // 2. Batch insert team_members for primary selected team
      const memberPayloads = inserted.map((a: { id: string }) => ({
        program_id:  programId,
        team_id:     selectedTeamId,
        athlete_id:  a.id,
        added_by:    userId,
        member_role: "athlete",
      }));

      const { error: memberErr } = await supabase
        .from("team_members")
        .insert(memberPayloads);

      // If a sub-team was selected, also link to core team
      if (!memberErr && subTeamId && coreTeamId !== selectedTeamId) {
        const coreMemberPayloads = inserted.map((a: { id: string }) => ({
          program_id:  programId,
          team_id:     coreTeamId,
          athlete_id:  a.id,
          added_by:    userId,
          member_role: "athlete",
        }));
        await supabase.from("team_members").insert(coreMemberPayloads);
      }

      if (memberErr) {
        console.warn("[importRoster] team_members insert failed:", memberErr.message);
      }

      setImportResult({ count: inserted.length });
      setStep(3);
      onImported?.(inserted.length);
    } catch (err: any) {
      setImportError(err.message ?? "Import failed. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  // ── Error export ──────────────────────────────────────────────────────────
  function handleDownloadErrors() {
    const failed = rows.filter((r) => r.status === "error" || r.skipped);
    if (failed.length === 0) return;
    const headerCols = [...COLUMNS, "_error_reason"];
    const lines = [
      headerCols.join(","),
      ...failed.map((r) => [
        ...COLUMNS.map((c) => `"${(r.data[c] ?? "").replace(/"/g, '""')}"`),
        `"${r.skipped ? "Skipped by admin" : (r.reason ?? "")}"`,
      ].join(",")),
    ];
    downloadBlob(
      new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" }),
      "trench_roster_errors.csv"
    );
  }

  // ── Toggle row skip ───────────────────────────────────────────────────────
  function toggleSkip(idx: number) {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, skipped: !r.skipped } : r));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER STEPS
  // ─────────────────────────────────────────────────────────────────────────

  function renderStep0() {
    const coreTeams = teams.filter((t) => !t.parent_team_id);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={F.sectionLabel}>Assign to Team</div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted, var(--ir-muted))", lineHeight: 1.5 }}>
          All imported athletes will be assigned to the selected core team. Sub-team assignments can be made individually after import.
        </p>
        {teamsLoading ? (
          <div style={{ fontSize: 13, opacity: 0.4 }}>Loading teams…</div>
        ) : (
          <SelectField
            label="Core Team"
            required
            value={selectedTeamId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedTeamId(e.target.value)}
          >
            <option value="">— Select a core team —</option>
            {coreTeams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </SelectField>
        )}

        {/* Template download */}
        <div style={F.divider} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={F.sectionLabel}>CSV Template</div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted, var(--ir-muted))", lineHeight: 1.5 }}>
            Download our template with all supported columns. The first row is headers; the second row is an example — both are handled automatically.
          </p>
          <button
            type="button"
            onClick={handleDownloadTemplate}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "9px 14px", borderRadius: 10,
              border: "1px solid rgba(180,0,255,0.30)",
              background: "rgba(180,0,255,0.08)",
              color: "rgba(200,130,255,0.95)",
              fontSize: 13, fontWeight: 700, cursor: "pointer",
              alignSelf: "flex-start",
              transition: "background 140ms ease, border-color 140ms ease",
            }}
          >
            <DownloadIcon />
            Download Template
          </button>
        </div>
      </div>
    );
  }

  // ── Step 1: Upload ────────────────────────────────────────────────────────
  function renderStep1() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {parseError && <div style={F.error}>{parseError}</div>}

        {/* Drag-drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${isDragging ? "rgba(180,0,255,1)" : "rgba(180,0,255,0.45)"}`,
            borderRadius: 16,
            background: isDragging ? "rgba(180,0,255,0.06)" : "var(--ir-drag-bg)",
            padding: "36px 24px",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
            cursor: "pointer",
            transition: "border-color 180ms ease, background 180ms ease",
          }}
        >
          <UploadCloudIcon />
          <div style={{ fontSize: 14, fontWeight: 700, textAlign: "center", color: "var(--ir-text)" }}>
            {isDragging ? "Drop your CSV here" : "Drag & drop a CSV, or click to browse"}
          </div>
          <div style={{ fontSize: 12, color: "var(--ir-muted)", opacity: 0.75, textAlign: "center" }}>
            Accepts .csv files up to {MAX_ROWS} athletes
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) parseFile(file);
              e.target.value = "";
            }}
          />
        </div>

        {/* Column guide */}
        <div style={F.divider} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={F.sectionLabel}>Expected Columns</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {COLUMNS.map((col) => (
              <span
                key={col}
                style={{
                  padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                  background: REQUIRED.has(col) ? "rgba(180,0,255,0.12)" : "var(--ir-col-opt-bg)",
                  border: REQUIRED.has(col) ? "1px solid rgba(180,0,255,0.30)" : "1px solid var(--ir-col-opt-border)",
                  color: REQUIRED.has(col) ? "rgba(210,140,255,0.95)" : "var(--ir-col-opt-text)",
                }}
              >
                {col}{REQUIRED.has(col) ? " *" : ""}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "var(--ir-req-note)", marginTop: 2 }}>* required field</div>
        </div>
      </div>
    );
  }

  // ── Step 2: Preview ───────────────────────────────────────────────────────
  function renderStep2() {
    const effectiveErrors   = rows.filter((r) => !r.skipped && r.status === "error");
    const effectiveWarnings = rows.filter((r) => !r.skipped && r.status === "warning");
    const effectiveValid    = rows.filter((r) => !r.skipped && r.status === "valid");

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {/* Sticky summary bar */}
        <div style={{
          position: "sticky", top: 0, zIndex: 10,
          display: "flex", alignItems: "center",
          padding: "10px 0 12px",
          background: "transparent",
          borderBottom: "1px solid var(--ir-divider)",
          marginBottom: 14,
        }}>
          {/* Left spacer — same width as the right-side button so the stats stay truly centered */}
          <div style={{ flex: 1 }} />

          {/* Centered stats group */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(0,220,130,0.90)" }}>
              {effectiveValid.length} valid
            </span>
            <span style={{ color: "var(--ir-dot-sep)" }}>·</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ir-warn-bar)" }}>
              {effectiveWarnings.length} warning{effectiveWarnings.length !== 1 ? "s" : ""}
            </span>
            <span style={{ color: "var(--ir-dot-sep)" }}>·</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ir-err-bar)" }}>
              {effectiveErrors.length} error{effectiveErrors.length !== 1 ? "s" : ""}
            </span>
            {skippedCount > 0 && (
              <>
                <span style={{ color: "var(--ir-dot-sep)" }}>·</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ir-muted)" }}>
                  {skippedCount} skipped
                </span>
              </>
            )}
          </div>

          {/* Right side — export button (or spacer to keep stats centered when absent) */}
          <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
            {(effectiveErrors.length > 0 || skippedCount > 0) && (
              <button
                type="button"
                onClick={handleDownloadErrors}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
                  border: "1px solid var(--ir-dl-border)",
                  background: "var(--ir-dl-bg)",
                  color: "var(--ir-dl-text)",
                  transition: "background 120ms ease",
                }}
              >
                <DownloadIcon size={11} />
                Export errors
              </button>
            )}
          </div>
        </div>

        {previewError && <div style={{ ...F.error, marginBottom: 12 }}>{previewError}</div>}

        {/* Rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((row, idx) => {
            const tc = STATUS_COLORS[row.status];
            return (
              <div
                key={idx}
                style={{
                  borderRadius: 12,
                  border: `1px solid ${row.skipped ? "rgba(255,255,255,0.06)" : tc.border}`,
                  background: row.skipped ? "rgba(255,255,255,0.02)" : tc.bg,
                  padding: "10px 13px",
                  opacity: row.skipped ? 0.42 : 1,
                  transition: "opacity 160ms ease, border-color 160ms ease",
                }}
              >
                {/* Header row: row number + badge + skip */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: "var(--ir-row-num)", minWidth: 28 }}>
                    #{row.csvLine}
                  </span>
                  <StatusBadge status={row.status} />
                  {row.reason && (
                    <span style={{ fontSize: 11, color: tc.color, opacity: 0.85, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.reason}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleSkip(idx)}
                    style={{
                      marginLeft: "auto", flexShrink: 0,
                      padding: "3px 9px", borderRadius: 7, fontSize: 11, fontWeight: 700,
                      cursor: "pointer",
                      border: row.skipped
                        ? "1px solid rgba(180,0,255,0.35)"
                        : "1px solid var(--ir-skip-border)",
                      background: row.skipped ? "rgba(180,0,255,0.12)" : "var(--ir-skip-bg)",
                      color: row.skipped ? "rgba(200,130,255,0.95)" : "var(--ir-skip-text)",
                      transition: "all 140ms ease",
                    }}
                  >
                    {row.skipped ? "Undo skip" : "Skip"}
                  </button>
                </div>

                {/* Field values */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
                  {COLUMNS.map((col) => {
                    const val = row.data[col];
                    if (!val && !REQUIRED.has(col)) return null;
                    return (
                      <span key={col} style={{ fontSize: 12, color: "var(--text, var(--ir-text))" }}>
                        <span style={{ color: "var(--ir-col-label)", marginRight: 3 }}>{COL_LABELS[col]}:</span>
                        <span style={{ fontWeight: 600 }}>{val || <em style={{ color: "var(--ir-col-empty)" }}>—</em>}</span>
                      </span>
                    );
                  })}
                </div>

                {/* Duplicate info */}
                {row.duplicate && !row.skipped && (
                  <div style={{
                    marginTop: 8, padding: "7px 10px", borderRadius: 8,
                    background: "var(--ir-warn-dupe-bg)",
                    border: "1px solid var(--ir-warn-dupe-bd)",
                    fontSize: 11, color: "var(--ir-warn-dupe-txt)",
                  }}>
                    Existing: {row.duplicate.first_name} {row.duplicate.last_name}
                    {row.duplicate.sport ? ` · ${row.duplicate.sport}` : ""}
                    {row.duplicate.position ? ` · ${row.duplicate.position}` : ""}
                    {" "}— skip this row or proceed to add a second record.
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Warning acknowledgment */}
        {activeWarnings > 0 && activeErrors === 0 && (
          <label style={{
            display: "flex", alignItems: "flex-start", gap: 10, marginTop: 16,
            padding: "11px 13px", borderRadius: 11,
            border: "1px solid var(--ir-warn-ack-bd)",
            background: "var(--ir-warn-ack-bg)",
            cursor: "pointer",
          }}>
            <input
              type="checkbox"
              checked={warningsAcknowledged}
              onChange={(e) => setWarningsAcknowledged(e.target.checked)}
              style={{ marginTop: 2, accentColor: "#b400ff", flexShrink: 0 }}
            />
            <span style={{ fontSize: 13, color: "var(--ir-warn-ack-txt)", lineHeight: 1.5 }}>
              I understand {activeWarnings} row{activeWarnings !== 1 ? "s" : ""} may create duplicate athlete records. Proceed anyway.
            </span>
          </label>
        )}
      </div>
    );
  }

  // ── Step 3: Done ──────────────────────────────────────────────────────────
  function renderStep3() {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "24px 0", textAlign: "center" }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%",
          background: "rgba(0,220,130,0.12)",
          border: "1px solid rgba(0,220,130,0.30)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M5 12l5 5L19 7" stroke="rgba(0,210,120,0.95)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 950, marginBottom: 5 }}>
            {importResult?.count ?? 0} Athlete{(importResult?.count ?? 0) !== 1 ? "s" : ""} Imported
          </div>
          <div style={{ fontSize: 13, opacity: 0.50, lineHeight: 1.5 }}>
            All athletes have been added to your program and assigned to the selected team.
          </div>
        </div>
        {skippedCount > 0 && (
          <button
            type="button"
            onClick={handleDownloadErrors}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer",
              border: "1px solid var(--ir-dl-border)",
              background: "var(--ir-dl-bg)",
              color: "var(--ir-dl-text)",
            }}
          >
            <DownloadIcon />
            Download skipped rows
          </button>
        )}
      </div>
    );
  }

  // ── Footer buttons ────────────────────────────────────────────────────────
  function renderFooter() {
    if (step === 3) {
      return (
        <button type="button" className="ts-btn ts-btnPrimary" onClick={onClose}>
          Done
        </button>
      );
    }

    if (step === 2) {
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
          <button
            type="button"
            className="ts-btn ts-btnGhost"
            onClick={() => setStep(1)}
          >
            ← Back
          </button>
          <div style={{ flex: 1 }} />
          {importError && (
            <span style={{ fontSize: 12, color: "rgba(200,50,50,0.90)", maxWidth: 200, textAlign: "right" }}>
              {importError}
            </span>
          )}
          <button
            type="button"
            className="ts-btn ts-btnPrimary"
            disabled={!canConfirm || importing}
            onClick={handleConfirm}
            style={(!canConfirm || importing) ? { opacity: 0.5, cursor: "not-allowed" } : {}}
            title={
              activeErrors > 0
                ? "Resolve or skip all errors before importing"
                : activeWarnings > 0 && !warningsAcknowledged
                ? "Acknowledge duplicate warnings to continue"
                : ""
            }
          >
            {importing ? "Importing…" : `Import ${importableCount} Athlete${importableCount !== 1 ? "s" : ""}`}
          </button>
        </div>
      );
    }

    if (step === 1) {
      return (
        <button
          type="button"
          className="ts-btn ts-btnGhost"
          onClick={() => setStep(0)}
        >
          ← Back
        </button>
      );
    }

    // Step 0
    return (
      <button
        type="button"
        className="ts-btn ts-btnPrimary"
        disabled={!selectedTeamId}
        onClick={() => setStep(1)}
        style={!selectedTeamId ? { opacity: 0.5, cursor: "not-allowed" } : {}}
      >
        Next: Upload CSV →
      </button>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────

  const STEP_TITLES = [
    "Select Team",
    "Upload Roster CSV",
    "Review & Preview",
    "Import Complete",
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Import Roster · ${STEP_TITLES[step]}`}
      size="lg"
      footer={renderFooter()}
    >
      <div className="ir-root">
        <style>{ADAPTIVE_STYLES}</style>
        <StepDots step={step} total={4} />
        {step === 0 && renderStep0()}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
      </div>
    </Modal>
  );
}

// ─── Icon helpers ─────────────────────────────────────────────────────────────

function DownloadIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 11h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}

function UploadCloudIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true" style={{ opacity: 0.35 }}>
      <path d="M18 24V12M13 17l5-5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9 28a7 7 0 0 1-1-13.93 9 9 0 0 1 17.94 0A7 7 0 0 1 27 28H9Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}