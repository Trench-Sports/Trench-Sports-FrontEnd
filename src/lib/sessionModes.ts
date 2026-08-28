// src/lib/sessionModes.ts
//
// Shared mode definitions imported by both session.tsx and modeRolodex.tsx.
// Keeping these here breaks the circular dependency that would arise if
// modeRolodex.tsx imported from session.tsx while session.tsx imported
// ModeRolodex from modeRolodex.tsx.

import {
  IconGauge,
  IconBullseye,
  IconStopwatch,
  IconStrikeRate,
  IconZoneGrid,
  type IconProps,
} from "../components/icons";

export const MODES = ["power", "accuracy", "reaction", "volume", "target"] as const;
export type SessionMode = typeof MODES[number];

export type ModeMeta = {
  /** Line icon for the mode — render it, don't print it. See components/modeIcon.tsx. */
  Icon: (props: IconProps) => JSX.Element;
  label: string;
  color: string;
  glow: string;
  desc: string;
};

export const MODE_META: Record<SessionMode, ModeMeta> = {
  power: {
    Icon: IconGauge, label: "Power",
    color: "#b400ff", glow: "rgba(180,0,255,0.55)",
    desc: "Strike any zone. Every impact is captured — force and placement logged in real time.",
  },
  accuracy: {
    Icon: IconBullseye, label: "Accuracy",
    color: "#00dcff", glow: "rgba(0,220,255,0.55)",
    desc: "Precision mode. Each strike is scored by how close you land to the bullseye.",
  },
  reaction: {
    Icon: IconStopwatch, label: "Reaction",
    color: "#ffcc00", glow: "rgba(255,200,0,0.55)",
    desc: "Wait for the HIT! signal, then strike as fast as you can. Reaction time measured to impact.",
  },
  volume: {
    Icon: IconStrikeRate, label: "Volume",
    color: "#ff6a00", glow: "rgba(255,106,0,0.55)",
    desc: "Wait for the HIT! signal, then throw as many strikes as possible in 5 seconds. Score = total hits.",
  },
  target: {
    Icon: IconZoneGrid, label: "Target",
    color: "#00ff88", glow: "rgba(0,255,136,0.55)",
    desc: "Listen for the zone cue, then strike that section of the bag. Reaction time and accuracy both scored.",
  },
};
