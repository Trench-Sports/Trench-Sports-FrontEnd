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

export function IconMessage({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
    </svg>
  );
}

export function IconWrench({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L3 18l3 3 6.5-6.5a4 4 0 0 0 5.2-5.2l-2.8 2.8-2.4-.6-.6-2.4 2.8-2.8z" />
    </svg>
  );
}

export function IconHandshake({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="m11 17 2 2a1 1 0 1 0 3-3" />
      <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.9-3.9a3 3 0 0 0-4.2 0l-.9.9a1 1 0 1 1-3-3l2.8-2.8a5.8 5.8 0 0 1 7 -.9l.5.3a2 2 0 0 0 1.4.3L21 4" />
      <path d="m21 3 1 11h-2" />
      <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
      <path d="M3 4h8" />
    </svg>
  );
}

export function IconNewspaper({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
      <path d="M18 14h-8" />
      <path d="M15 18h-5" />
      <path d="M10 6h8v4h-8V6Z" />
    </svg>
  );
}

export function IconMail({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

export function IconCheck({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function IconSettings({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconLock({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function IconShield({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  );
}

export function IconUserCheck({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="m16 11 2 2 4-4" />
    </svg>
  );
}

export function IconCalendar({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}

export function IconClipboard({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 11h4" />
      <path d="M12 16h4" />
      <path d="M8 11h.01" />
      <path d="M8 16h.01" />
    </svg>
  );
}

export function IconKey({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L21 5" />
      <path d="m21 2-9.6 9.6" />
      <circle cx="7.5" cy="15.5" r="5.5" />
    </svg>
  );
}

export function IconDatabase({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  );
}

export function IconLayers({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </svg>
  );
}

export function IconSearch({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function IconFileText({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v5h5" />
      <path d="M8 13h8" />
      <path d="M8 17h8" />
      <path d="M8 9h2" />
    </svg>
  );
}

export function IconUser({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function IconCopyright({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M14.83 14.83a4 4 0 1 1 0-5.66" />
    </svg>
  );
}

export function IconCreditCard({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  );
}

export function IconScale({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="M7 21h10" />
      <path d="M12 3v18" />
      <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
    </svg>
  );
}

export function IconPin({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
}

export function IconLogout({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

export function IconBan({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </svg>
  );
}

export function IconX({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function IconDownload({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

/** Quick-start prompts — "ready to get started?". */
export function IconRocket({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 2.4c2.7 2.1 4.1 5.2 4.1 8.6v3.6l-4.1 2.5-4.1-2.5v-3.6c0-3.4 1.4-6.5 4.1-8.6z" />
      <circle cx="12" cy="9.8" r="1.7" />
      <path d="M7.9 12.6 4.9 15v3.2l3-1.6" />
      <path d="M16.1 12.6 19.1 15v3.2l-3-1.6" />
      <path d="M10.4 19.4 12 22l1.6-2.6" />
    </svg>
  );
}

export function IconSun({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5" />
      <path d="M12 19.5V22" />
      <path d="M2 12h2.5" />
      <path d="M19.5 12H22" />
      <path d="m4.9 4.9 1.8 1.8" />
      <path d="m17.3 17.3 1.8 1.8" />
      <path d="m19.1 4.9-1.8 1.8" />
      <path d="m6.7 17.3-1.8 1.8" />
    </svg>
  );
}

export function IconMoon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M20.5 14.4A8.6 8.6 0 0 1 9.6 3.5a8.6 8.6 0 1 0 10.9 10.9z" />
    </svg>
  );
}

/** Strike Compass — the 3D incoming-angle view. */
export function IconCompass({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="9.2" />
      <path d="m15.4 8.6-2 5.4-5.4 2 2-5.4z" />
    </svg>
  );
}

export function IconPencil({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="m16.5 3.3 4.2 4.2" />
      <path d="M18.4 1.4a2 2 0 0 1 2.8 2.8L7.6 17.8 3 19l1.2-4.6z" />
    </svg>
  );
}

export function IconUsers({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M15.5 20v-1.8a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
      <circle cx="8.8" cy="7" r="3.6" />
      <path d="M22 20v-1.8a4 4 0 0 0-3-3.9" />
      <path d="M16.2 3.6a4 4 0 0 1 0 7" />
    </svg>
  );
}

/**
 * Injury flag. The inner pad rectangle is what makes this a bandage rather
 * than a paperclip once it's under ~20px — keep it.
 */
export function IconBandage({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <g transform="rotate(-45 12 12)">
        <rect x="1.2" y="7.6" width="21.6" height="8.8" rx="4.4" />
        <rect x="7.6" y="7.6" width="8.8" height="8.8" />
        <path d="M10.2 10.6v.01" />
        <path d="M13.8 10.6v.01" />
        <path d="M10.2 13.4v.01" />
        <path d="M13.8 13.4v.01" />
      </g>
    </svg>
  );
}

export function IconFlame({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 2.5c3.4 3.1 6 6.2 6 9.9a6 6 0 0 1-12 0c0-1.7.6-3.2 1.6-4.6.5 1 1.2 1.7 2 2.1.2-3 .9-5.4 2.4-7.4z" />
    </svg>
  );
}

export function IconThumbsUp({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M7 10.5 11 2a2.6 2.6 0 0 1 2.6 2.6V9h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.4 20H7" />
      <path d="M7 10.5V20H4a1.5 1.5 0 0 1-1.5-1.5V12A1.5 1.5 0 0 1 4 10.5z" />
    </svg>
  );
}

export function IconPlay({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M7 4.5 19.5 12 7 19.5z" />
    </svg>
  );
}

// ── Devices & connection ─────────────────────────────────────────────────────

/**
 * "No sessions yet" — go train. The knuckle band is what separates the mitt
 * silhouette from a mug or a helmet once it's down at 24px; don't drop it.
 */
export function IconBoxingGlove({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4.5 12.5v-2.6A5.9 5.9 0 0 1 10.4 4h1.7a5.9 5.9 0 0 1 5.9 5.9v2.6" />
      <path d="M18 10.6a2.2 2.2 0 0 1 0 4.4" />
      <path d="M4.5 12.5h13" />
      <path d="M4.5 12.5v2A2.5 2.5 0 0 0 7 17h8a2.5 2.5 0 0 0 2.5-2.5v-2" />
      <path d="M7.2 17v2A2 2 0 0 0 9.2 21h3.6a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

/** Bluetooth scan in progress — the rune plus a broadcast arc. */
export function IconBluetoothScan({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="m6 7 9 9-4.5 4.5V2.5L15 7l-9 9" />
      <path d="M19.5 9.2a4 4 0 0 1 0 5.6" />
      <path d="M22 6.7a7.5 7.5 0 0 1 0 10.6" />
    </svg>
  );
}

/**
 * A nearby BLE device that isn't one of ours. Ascending bars on a baseline, so
 * it stays distinct from IconStrikeRate (Volume mode), which has neither.
 */
export function IconSignalBars({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 20h18" />
      <path d="M6 20v-3.5" />
      <path d="M11 20v-7" />
      <path d="M16 20v-10.5" />
      <path d="M21 20v-14" />
    </svg>
  );
}

// ── Training modes ───────────────────────────────────────────────────────────
// One per session mode (power / accuracy / reaction / volume / target). Each is
// built to stay legible down to 16px and to be told apart from the other four at
// a glance, since they sit side by side in the mode tabs.

/**
 * Power — a gauge reading high, for the magnitude of the force behind a strike.
 * Deliberately not a lightning bolt: IconZap already means "set up in seconds"
 * on the landing page, and the two would sit on the same screen.
 */
export function IconGauge({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3.5 18a9 9 0 1 1 17 0" />
      <path d="M12 18l5-6.5" />
      <circle cx="12" cy="18" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Accuracy — concentric rings scoring proximity to the bullseye. */
export function IconBullseye({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Reaction — a stopwatch, for signal-to-impact latency. */
export function IconStopwatch({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M9.5 2.5h5" />
      <path d="M12 2.5v2.2" />
      <circle cx="12" cy="13.5" r="7.8" />
      <path d="M12 9.6v3.9h3.1" />
      <path d="M18.9 6.6l1.5-1.5" />
    </svg>
  );
}

/**
 * Volume — a run of impact spikes, for how many strikes land inside the window.
 * No baseline, so it stays distinct from IconBarChart.
 */
export function IconStrikeRate({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 9.5v5" />
      <path d="M8 5.5v13" />
      <path d="M12 8v8" />
      <path d="M16 4.5v15" />
      <path d="M20 9.5v5" />
    </svg>
  );
}

/** Target — one called zone lit up on the bag's grid. */
export function IconZoneGrid({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M9 3v18" />
      <path d="M15 3v18" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
      <rect x="15" y="9" width="6" height="6" fill="currentColor" stroke="none" />
    </svg>
  );
}
