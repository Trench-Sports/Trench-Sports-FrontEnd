// src/components/modeIcon.tsx
//
// One glyph per session mode, resolved from a mode key. Every surface that
// labels a mode — the rolodex, the session HUD, the dashboard tabs, pills and
// leaderboards — goes through here, so a mode looks the same everywhere and
// changing its glyph is a one-line edit.
//
// Replaces the emoji that used to sit at each of those call sites: emoji render
// differently per platform, ignore the surrounding text colour, and can't be
// dimmed or accented alongside the UI they sit in.

import React from "react";
import {
  IconGauge,
  IconBullseye,
  IconStopwatch,
  IconStrikeRate,
  IconZoneGrid,
  IconAngle,
  type IconProps,
} from "./icons";

type Glyph = (props: IconProps) => JSX.Element;

/** The five session modes, plus the metric keys the dashboard uses for them. */
export type ModeIconKey =
  | "power" | "accuracy" | "reaction" | "volume" | "target"
  // Dashboard metric keys: named after what is measured rather than the mode
  // that produced it. Mapped onto the same glyphs so a metric and its mode are
  // never shown with two different icons on the same screen.
  | "strength" | "si" | "targetAccuracy" | "targetReaction" | "form";

const GLYPHS: Record<ModeIconKey, Glyph> = {
  power:           IconGauge,
  accuracy:        IconBullseye,
  reaction:        IconStopwatch,
  volume:          IconStrikeRate,
  target:          IconZoneGrid,

  strength:        IconGauge,
  si:              IconGauge,
  targetAccuracy:  IconZoneGrid,
  targetReaction:  IconZoneGrid,
  form:            IconAngle,
};

/** Component for a mode key, or null for an unknown key. */
export function modeGlyph(mode: string): Glyph | null {
  return GLYPHS[mode as ModeIconKey] ?? null;
}

export type ModeIconProps = {
  mode: string;
  size?: number;
  /** Overrides the inherited text colour. */
  color?: string;
  /** Extra styles on the wrapper — margin, opacity, filter. */
  style?: React.CSSProperties;
  className?: string;
  /** Set when the icon is the only thing identifying the mode. */
  label?: string;
};

/**
 * Renders a mode's icon inline. The wrapper is an inline-flex box nudged onto
 * the text baseline, so this drops in both beside label text and inside the
 * flex rows and circular badges the mode chrome is built from.
 */
export function ModeIcon({ mode, size = 16, color, style, className, label }: ModeIconProps) {
  const Glyph = modeGlyph(mode);
  if (!Glyph) return null;
  return (
    <span
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
        verticalAlign: "-0.18em",
        color,
        ...style,
      }}
    >
      <Glyph size={size} />
    </span>
  );
}
