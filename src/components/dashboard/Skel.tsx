// src/components/dashboard/Skel.tsx
//
// Skeleton helper for the coach dashboards — shape-matched shimmer blocks.
import type { CSSProperties } from "react";

export const Skel = ({ w, h = 14, r = 6, style }: { w: number | string; h?: number; r?: number; style?: CSSProperties }) => (
  <div className="ts-skel" style={{ width: w, height: h, borderRadius: r, flexShrink: 0, ...style }} />
);
