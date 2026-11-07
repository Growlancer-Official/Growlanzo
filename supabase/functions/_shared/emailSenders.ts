// ═══════════════════════════════════════════════════════════════════════════
// Sender identities for Growlanzo transactional email.
//
// Four verified Brevo senders, one per purpose. Every email MUST pick one of
// these — there is no ad-hoc From address anywhere in the codebase.
//
//   security → OTP, email verification, password reset/change, security alerts
//   support  → support tickets, acknowledgement, complaint correspondence
//   hello    → welcome, registration confirmation, onboarding
//   info     → projects, proposals, milestones, payments, activity updates
//
// Addresses come from edge-function secrets so a domain change is a secret
// change, not a code change. The literals below are the documented defaults
// (the addresses verified in the Brevo account) and are used only when the
// matching secret is absent — a missing secret is logged, never silent.
// ═══════════════════════════════════════════════════════════════════════════

export type EmailSenderKey = 'security' | 'support' | 'hello' | 'info';

export interface EmailSender {
  key: EmailSenderKey;
  name: string;
  email: string;
  /** True when the address came from its dedicated env secret. */
  configured: boolean;
}

export const EMAIL_SENDER_KEYS: EmailSenderKey[] = ['security', 'support', 'hello', 'info'];

const DEFAULT_SENDERS: Record<EmailSenderKey, { name: string; email: string }> = {
  security: { name: 'Growlanzo Security', email: 'security@growlanzo.com' },
  support: { name: 'Growlanzo Support', email: 'support@growlanzo.com' },
  hello: { name: 'Growlanzo Team', email: 'hello@growlanzo.com' },
  info: { name: 'Growlanzo Notifications', email: 'info@growlanzo.com' },
};

/** Env var holding the address for a sender key (BREVO_FROM_SECURITY, …). */
export function senderEnvVar(key: EmailSenderKey): string {
  return `BREVO_FROM_${key.toUpperCase()}`;
}

const warned = new Set<EmailSenderKey>();

/**
 * Resolve a sender identity. Falls back to the documented verified address
 * when the secret is unset, and logs the miss once per isolate.
 */
export function getSender(key: EmailSenderKey): EmailSender {
  const fallback = DEFAULT_SENDERS[key];
  if (!fallback) {
    throw new Error(`Unknown email sender key: ${key}`);
  }

  const raw = (Deno.env.get(senderEnvVar(key)) ?? '').trim();
  if (!raw) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(
        `[email] ${senderEnvVar(key)} is not set — using default ${fallback.email}. ` +
          'Verify that address in Brevo (Dashboard → Senders) before relying on it.',
      );
    }
    return { key, name: fallback.name, email: fallback.email, configured: false };
  }

  // Accept both "addr@domain" and "Display Name <addr@domain>".
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return {
      key,
      name: match[1].trim() || fallback.name,
      email: match[2].trim(),
      configured: true,
    };
  }
  return { key, name: fallback.name, email: raw, configured: true };
}

/** Describe every configured sender — used by the admin sender-health panel. */
export function listSenders(): EmailSender[] {
  return EMAIL_SENDER_KEYS.map(getSender);
}
