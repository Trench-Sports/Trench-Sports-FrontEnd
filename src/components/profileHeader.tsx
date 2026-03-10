// src/components/profileHeader.tsx
import React from "react";

export type Profile = {
  name?: string;
  role?: string;
  location?: string;
  program?: string;
  avatarUrl?: string;
};

export type ProfileHeaderProps = {
  profile?: Profile | null;
  onEdit: () => void;
  onShare: () => void;
  onViewProgram?: () => void;
};

export default function ProfileHeader({ profile, onEdit, onShare, onViewProgram }: ProfileHeaderProps): JSX.Element {
  const name      = profile?.name      ?? "Your Name";
  const role      = profile?.role      ?? "";
  const location  = profile?.location  ?? "";
  const program   = profile?.program   ?? "";
  const avatarUrl = profile?.avatarUrl ?? "";

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
            {role === "admin" && onViewProgram && (
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
            {role && (
              <span className="ts-profileHeader__pill ts-profileHeader__pill--role">
                {role}
              </span>
            )}
            {location && (
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
            {program && (
              <span className="ts-profileHeader__pill ts-profileHeader__pill--program">
                {program}
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