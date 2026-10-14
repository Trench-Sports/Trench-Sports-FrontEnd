// src/components/bagShell.tsx
//
// TSB-400 bag silhouette for every contact-grid surface. The bag container
// takes `bagShellStyle` (shell aspect ratio + clip-path, so full-cover overlays
// follow the silhouette), renders <BagShellArt /> as its first child, and puts
// the 8 × 12 grid — plus anything positioned against it (ripples, target
// zones, accuracy rings) — inside a `bagTorsoStyle` box. Geometry lives in
// src/tools/bagShape.ts.

import type React from "react";
import {
  ART_MARK, ART_NUMBER, ART_WORDMARK, BAG_ASPECT, BAG_FILL, BAG_H,
  SHELL_CLIP, SHELL_PATH, SHELL_VIEWBOX, TORSO_HALF, TORSO_LEFT_PCT, TORSO_WIDTH_PCT,
} from "../tools/bagShape";

// Base fillet radius (40 mm) as % of the torso box, so the grid's bottom
// corners trim to the shell instead of poking past it.
const FILLET = 40;
const FILLET_X = `${(FILLET / (TORSO_HALF * 2)) * 100}%`;
const FILLET_Y = `${(FILLET / BAG_H) * 100}%`;

export const bagShellStyle: React.CSSProperties = {
  position: "relative",
  aspectRatio: String(BAG_ASPECT),
  clipPath: SHELL_CLIP,
  background: BAG_FILL,
};

export const bagTorsoStyle: React.CSSProperties = {
  position: "absolute",
  top: 0, bottom: 0,
  left: `${TORSO_LEFT_PCT}%`,
  width: `${TORSO_WIDTH_PCT}%`,
  borderRadius: `0 0 ${FILLET_X} ${FILLET_X} / 0 0 ${FILLET_Y} ${FILLET_Y}`,
  overflow: "hidden",
};

type ArtProps = {
  /** Shell edge colour — tint with the active mode colour when connected. */
  edge?: string;
  /** Screen print opacity multiplier (1 = reference watermark strength). */
  artOpacity?: number;
};

export function BagShellArt({ edge = "rgba(180,0,255,0.42)", artOpacity = 1 }: ArtProps) {
  return (
    <svg
      viewBox={SHELL_VIEWBOX}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", display: "block" }}
    >
      <path d={SHELL_PATH} fill={BAG_FILL} />
      <g fill="#FFFFFF" fillRule="evenodd">
        <path d={ART_NUMBER} fillOpacity={0.11 * artOpacity} />
        <path d={ART_WORDMARK} fillOpacity={0.16 * artOpacity} />
        <path d={ART_MARK} fillOpacity={0.22 * artOpacity} />
      </g>
      {/* Container clips to the shell, so only the inner half of this stroke shows. */}
      <path
        d={SHELL_PATH}
        fill="none"
        stroke={edge}
        strokeWidth={8}
        style={{ transition: "stroke 300ms" }}
      />
    </svg>
  );
}
