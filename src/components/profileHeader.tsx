// src/components/profileHeader.tsx
import React from "react";

export type Profile = {
  name?: string;
  role?: string;
  location?: string;
  program?: string;
  avatarUrl?: string;
  // Athlete-specific fields
  height?: string | null;
  weight?: string | null;
};

export type ProfileHeaderProps = {
  profile?: Profile | null;
  onEdit: () => void;
  onShare?: () => void;
  onViewProgram?: () => void;
};

export default function ProfileHeader({ profile, onEdit, onShare, onViewProgram }: ProfileHeaderProps): JSX.Element {
  const name      = profile?.name      ?? "Your Name";
  const role      = profile?.role      ?? "";
  const location  = profile?.location  ?? "";
  const program   = profile?.program   ?? "";
  const avatarUrl = profile?.avatarUrl ?? "";
  const height    = profile?.height    ?? null;
  const weight    = profile?.weight    ?? null;

  const isAthlete = role === "athlete";
  const isStaff   = role === "admin" || role === "coach";

  const initials =
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "U";

  return (
    <header className="ts-profileHeader">
      {/* Left: avatar + identity */}
      <div className="ts-profileHeader__left">
        <div className="ts-profileHeader__avatar">
          {avatarUrl ? (
            <img src={avatarUrl} alt={`${name} avatar`} />
          ) : (
            <div className="ts-profileHeader__avatarFallback" aria-hidden="true">
              {initials}
            </div>
          )}
          <div className="ts-profileHeader__avatarGlow" aria-hidden="true" />
        </div>

        <div className="ts-profileHeader__meta">
          <div className="ts-profileHeader__nameRow">
            <h2 className="ts-profileHeader__name">{name}</h2>
            {isStaff && onViewProgram && (
              <button
                type="button"
                className="ts-profileHeader__viewLink"
                onClick={onViewProgram}
              >
                View Program
              </button>
            )}
          </div>

          <div className="ts-profileHeader__pills">
            {/* Role pill — shown for all roles */}
            {role && (
              <span className="ts-profileHeader__pill ts-profileHeader__pill--role">
                {role}
              </span>
            )}

            {/* Admin / Coach: show location + school/program name */}
            {isStaff && location && (
              <span className="ts-profileHeader__pill ts-profileHeader__pill--location">
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path
                    d="M6 1a3.5 3.5 0 0 1 3.5 3.5C9.5 7.5 6 11 6 11S2.5 7.5 2.5 4.5A3.5 3.5 0 0 1 6 1Z"
                    stroke="currentColor" strokeWidth="1.2" fill="none"
                  />
                  <circle cx="6" cy="4.5" r="1.1" fill="currentColor" />
                </svg>
                {location}
              </span>
            )}
            {isStaff && program && (
              <span className="ts-profileHeader__pill ts-profileHeader__pill--program">
                {program}
              </span>
            )}

            {/* Athlete: show height + weight instead of location/program */}
            {isAthlete && height && (
              <span className="ts-profileHeader__pill ts-profileHeader__pill--stat">
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <line x1="6" y1="1" x2="6" y2="11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  <line x1="3" y1="1" x2="9" y2="1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  <line x1="3" y1="11" x2="9" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                {height}
              </span>
            )}
            {isAthlete && weight && (
              <span className="ts-profileHeader__pill ts-profileHeader__pill--stat">
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path
                    d="M2 9.5h8L8.5 4.5h-5L2 9.5Z"
                    stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round"
                  />
                  <path d="M4.5 4.5a1.5 1.5 0 0 1 3 0" stroke="currentColor" strokeWidth="1.2" fill="none" />
                </svg>
                {weight}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Right: actions */}
      <div className="ts-profileHeader__actions">
        <button type="button" className="ts-btn ts-btnPrimary" onClick={onEdit}>
          Edit profile
        </button>
      </div>
    </header>
  );
}