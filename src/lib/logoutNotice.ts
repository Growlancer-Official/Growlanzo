/**
 * logoutNotice.ts — "why am I signed out again?"
 *
 * A Growlanzo session persists until the user presses Logout (see AuthContext).
 * The ONLY other way a session ends on its own is server-side revocation — the
 * account was deleted/suspended and the auth server rejects the token. Without
 * an explanation that looks exactly like a broken login: the person opens the
 * site and is simply not signed in.
 *
 * This module carries that reason across the sign-out. The tab that ends the
 * session writes it; the login screen reads it once and explains, then drops
 * it so it never shows twice.
 *
 * Nothing here is a credential or PII — only the reason and a timestamp.
 */

export type LogoutReason = 'session_expired';

export interface LogoutNotice {
  reason: LogoutReason;
  at: number;
}

const KEY = 'growlancer_logout_notice';

/**
 * How long the notice stays believable. Long enough to survive the redirect
 * after the sign-out (and a reload on a slow connection), short enough that a
 * notice from last week never greets anyone.
 */
export const LOGOUT_NOTICE_MAX_AGE_MS = 10 * 60 * 1000;

/** Copy the login screen shows for each reason — one place, so wording matches. */
export const LOGOUT_NOTICE_COPY: Record<LogoutReason, { title: string; message: string }> = {
  session_expired: {
    title: 'Your session has ended',
    message:
      'Growlanzo ended this session because the account is no longer active. If that is unexpected, contact support@growlanzo.com. Sign in again to continue.',
  },
};

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Record WHY the session ended, so the login screen can say so.
 * Written before the sign-out happens — the redirect that follows reads it.
 */
export function noteLogoutReason(reason: LogoutReason): void {
  const store = storage();
  if (!store) return;
  try {
    const notice: LogoutNotice = { reason, at: Date.now() };
    store.setItem(KEY, JSON.stringify(notice));
  } catch {
    // Storage unavailable — the login screen simply shows no notice.
  }
}

/**
 * The pending notice, or null when there is none / it is unreadable / too old.
 * A clock that moved backwards is treated as fresh rather than dropped.
 */
export function readLogoutNotice(now: number = Date.now()): LogoutNotice | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(KEY);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    store.removeItem(KEY);
    return null;
  }

  const notice = parsed as Partial<LogoutNotice> | null;
  if (
    !notice ||
    typeof notice.reason !== 'string' ||
    !(notice.reason in LOGOUT_NOTICE_COPY) ||
    typeof notice.at !== 'number' ||
    !Number.isFinite(notice.at)
  ) {
    store.removeItem(KEY);
    return null;
  }

  if (now - (notice.at as number) > LOGOUT_NOTICE_MAX_AGE_MS) {
    store.removeItem(KEY);
    return null;
  }
  return notice as LogoutNotice;
}

/** Drop the notice once it has been shown. */
export function clearLogoutNotice(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(KEY);
  } catch {
    // ignore
  }
}
