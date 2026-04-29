// src/lib/sessionModes.ts
//
// Shared mode definitions imported by both session.tsx and modeRolodex.tsx.
// Keeping these here breaks the circular dependency that would arise if
// modeRolodex.tsx imported from session.tsx while session.tsx imported
// ModeRolodex from modeRolodex.tsx.

export const MODES = ["power", "accuracy", "reaction", "volume", "target"] as const;
export type SessionMode = typeof MODES[number];

export const MODE_META: Record<SessionMode, { icon: string; label: string; color: string; glow: string; desc: string }> = {
  power: {
    icon: "💥", label: "Power",
    color: "#b400ff", glow: "rgba(180,0,255,0.55)",
    desc: "Strike any zone. Every impact is captured — force and placement logged in real time.",
  },
  accuracy: {
    icon: "🎯", label: "Accuracy",
    color: "#00dcff", glow: "rgba(0,220,255,0.55)",
    desc: "Precision mode. Each strike is scored by how close you land to the bullseye.",
  },
  reaction: {
    icon: "⚡️", label: "Reaction",
    color: "#ffcc00", glow: "rgba(255,200,0,0.55)",
    desc: "Wait for the HIT! signal, then strike as fast as you can. Reaction time measured to impact.",
  },
  volume: {
    icon: "🥊", label: "Volume",
    color: "#ff6a00", glow: "rgba(255,106,0,0.55)",
    desc: "Wait for the HIT! signal, then throw as many strikes as possible in 5 seconds. Score = total hits.",
  },
  target: {
    icon: "🏹", label: "Target",
    color: "#00ff88", glow: "rgba(0,255,136,0.55)",
    desc: "Listen for the zone cue, then strike that section of the bag. Reaction time and accuracy both scored.",
  },
};