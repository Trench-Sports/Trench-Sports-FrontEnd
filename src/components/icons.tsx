// src/components/icons.tsx
// Small, self-contained line-icon set (no external icon library).
// All icons are stroke-based, inherit color via currentColor, and accept a `size` override.

import React from "react";

export type IconProps = {
  size?: number;
  className?: string;
};

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

export function IconGraduationCap({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3l10 5-10 5L2 8l10-5z" />
      <path d="M6 10.5v5c0 1.2 2.7 3 6 3s6-1.8 6-3v-5" />
      <path d="M22 8v6" />
    </svg>
  );
}

export function IconTrophy({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4z" />
      <path d="M8 5H5a1 1 0 0 0-1 1v1a4 4 0 0 0 4 4" />
      <path d="M16 5h3a1 1 0 0 1 1 1v1a4 4 0 0 1-4 4" />
      <path d="M10 16.5h4" />
      <path d="M12 13v3.5" />
      <path d="M8 20h8" />
      <path d="M9.5 20v-2h5v2" />
    </svg>
  );
}

export function IconFlask({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M9 3h6" />
      <path d="M10 3v6.2L4.8 18a1.5 1.5 0 0 0 1.3 2.2h11.8a1.5 1.5 0 0 0 1.3-2.2L14 9.2V3" />
      <path d="M7.5 15h9" />
    </svg>
  );
}

export function IconCrosshair({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 2.5v3.2" />
      <path d="M12 18.3v3.2" />
      <path d="M2.5 12h3.2" />
      <path d="M18.3 12h3.2" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconTrendUp({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 17l6-6 4 4 8-9" />
      <path d="M15 6h6v6" />
    </svg>
  );
}

export function IconAlertTriangle({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3.5l9 16H3l9-16z" />
      <path d="M12 10v4" />
      <path d="M12 17.2v.1" />
    </svg>
  );
}

export function IconActivity({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2.5 13h4l2.5-6 4 11 2.5-7h6" />
    </svg>
  );
}

export function IconZap({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  );
}

export function IconDumbbell({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 9v6" />
      <path d="M2 10.5v3" />
      <path d="M7 7v10" />
      <path d="M7 12h10" />
      <path d="M17 7v10" />
      <path d="M20 10.5v3" />
      <path d="M22 9v6" />
    </svg>
  );
}

export function IconBarChart({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 20V10" />
      <path d="M12 20V4" />
      <path d="M20 20v-7" />
      <path d="M3 20h18" />
    </svg>
  );
}

export function IconAngle({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M4 20L18 6" />
      <path d="M9 20a5 5 0 0 1 1.8-3.8" />
    </svg>
  );
}

export function IconSparkles({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M11 3l1.6 4.4L17 9l-4.4 1.6L11 15l-1.6-4.4L5 9l4.4-1.6L11 3z" />
      <path d="M18.5 14l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4z" />
    </svg>
  );
}
