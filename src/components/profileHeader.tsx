// src/componets/profileHeader.tsx
import React from "react";
import { Link } from "react-router-dom";

export type Profile = {
  name?: string;
  title?: string;
  team?: string;
  avatarUrl?: string;
};

export type ProfileHeaderProps = {
  profile?: Profile | null;
  onEdit: () => void;
  onShare: () => void;
};

export default function ProfileHeader({ profile, onEdit, onShare }: ProfileHeaderProps): JSX.Element {
  const name = profile?.name ?? "Your Name";
  const title = profile?.title ?? "";
  const team = profile?.team ?? "";
  const avatarUrl = profile?.avatarUrl ?? "";

  const initials =
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "";

  return (
    <header className="profile-header">
      <div className="profile-header__left">
        <div className="profile-header__avatar">
          {avatarUrl ? (
            <img src={avatarUrl} alt={`${name} avatar`} />
          ) : (
            <div className="profile-header__avatar-fallback" aria-hidden="true">
              {initials || "U"}
            </div>
          )}
        </div>

        <div className="profile-header__meta">
          <div className="profile-header__name-row">
            <h1 className="profile-header__name">{name}</h1>
            <Link className="profile-header__view-profile" to="/profile">
              View profile
            </Link>
          </div>

          {(title || team) && (
            <div className="profile-header__sub">
              {title && <span className="profile-header__title">{title}</span>}
              {title && team && <span className="profile-header__dot">•</span>}
              {team && <span className="profile-header__team">{team}</span>}
            </div>
          )}
        </div>
      </div>

      <div className="profile-header__actions">
        <button type="button" className="btn btn--secondary" onClick={onShare}>
          Share
        </button>
        <button type="button" className="btn btn--primary" onClick={onEdit}>
          Edit profile
        </button>
      </div>
    </header>
  );
}