// src/lib/inviteToken.ts
// ─────────────────────────────────────────────────────────────────────────────
// Custody of a coach invite token between /invite/:token and onboarding.
//
// Why this exists: the token has to survive signup → (optional email
// confirmation) → login → onboarding. supabase.auth.signUp can return a null
// user when confirmations are on (signup.tsx), so the URL alone isn't enough —
// the coach may come back through a completely different navigation.
//
// The preview result (program/core names) is cached alongside the token purely
// so onboarding can render the locked rows without a second round-trip. It is
// display-only: redemption ALWAYS re-validates server-side via
// redeem_coach_invite(), which never reads anything from here but the token.
//
// SECURITY: `token` is a bearer credential. Never log it, never put it in a
// telemetry payload, never include it in an error string. Use tokenPrefix() if
// you need something correlatable.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = "ts_coach_invite";

export type StashedInvite = {
  token: string;
  programId: string;
  programName: string;
  coreTeamId: string;
  coreTeamName: string;
  /** ISO timestamp — mirrors coach_invites.expires_at at preview time. */
  expiresAt: string;
};

function isStashedInvite(v: any): v is StashedInvite {
  return (
    v &&
    typeof v === "object" &&
    typeof v.token === "string" &&
    /^[0-9a-f]{64}$/.test(v.token) &&
    typeof v.programId === "string" &&
    typeof v.programName === "string" &&
    typeof v.coreTeamId === "string" &&
    typeof v.coreTeamName === "string" &&
    typeof v.expiresAt === "string"
  );
}

/** Store the invite for the rest of the signup → onboarding journey. */
export function stashInvite(v: StashedInvite): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // Safari private mode throws on setItem. The in-URL token still works for
    // a same-tab flow; this is a convenience layer, not a requirement.
  }
}

/**
 * Read the stashed invite, or null. Self-clears on expiry and on anything
 * malformed, so a stale/corrupt entry can never lock a coach into a dead
 * invite-locked onboarding.
 */
export function readInvite(): StashedInvite | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearInvite();
    return null;
  }

  if (!isStashedInvite(parsed)) {
    clearInvite();
    return null;
  }

  const expires = Date.parse(parsed.expiresAt);
  if (!Number.isFinite(expires) || expires <= Date.now()) {
    clearInvite();
    return null;
  }

  return parsed;
}

export function clearInvite(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing we can do, and nothing depends on it */
  }
}

/**
 * The only form of the token that may leave this module for logging or
 * telemetry. 8 hex chars is enough to correlate two events, far too little to
 * redeem with.
 */
export function tokenPrefix(token: string): string {
  return (token || "").slice(0, 8);
}
