// src/lib/age.ts
// Account holders (coaches/admins) must be adults. Mirrored server-side by the
// profiles_enforce_min_age trigger in supabase/profiles_min_age.sql — keep the
// two thresholds in sync.

export const MIN_ACCOUNT_AGE = 18;

/** Whole years between a yyyy-mm-dd date of birth and today, or null if unparseable. */
export function ageFromDob(dob: string, today: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dob || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const birth = new Date(y, mo - 1, d);
  // Reject rollovers like 2001-02-31.
  if (birth.getFullYear() !== y || birth.getMonth() !== mo - 1 || birth.getDate() !== d) return null;
  if (birth > today) return null;

  let age = today.getFullYear() - y;
  const hadBirthday =
    today.getMonth() > mo - 1 || (today.getMonth() === mo - 1 && today.getDate() >= d);
  if (!hadBirthday) age -= 1;
  return age;
}

export function isAdultDob(dob: string): boolean {
  const age = ageFromDob(dob);
  return age !== null && age >= MIN_ACCOUNT_AGE;
}

/** Latest date of birth that still qualifies, as yyyy-mm-dd — for <input type="date" max>. */
export function maxAdultDob(today: Date = new Date()): string {
  const d = new Date(today.getFullYear() - MIN_ACCOUNT_AGE, today.getMonth(), today.getDate());
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const UNDERAGE_MESSAGE = `You must be at least ${MIN_ACCOUNT_AGE} years old to create a Trench Sports account.`;
