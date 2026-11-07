// ═══════════════════════════════════════════════════════════════════════════
// Growlanzo transactional email templates.
//
// ONE catalogue, ONE layout. Every event declares:
//   • which verified sender it uses (security / support / hello / info)
//   • its subject line, heading, intro, detail rows and CTA
//
// The renderer escapes every dynamic value, so a project title or a user's
// name can never inject markup into the email. Event definitions return PLAIN
// TEXT (never HTML) — that is the safety property this module relies on.
//
// Every message ships an HTML part AND a plain-text alternative, and every
// footer carries the Growlanzo social profiles.
// ═══════════════════════════════════════════════════════════════════════════

import { SITE_URL } from './site.ts';
import type { EmailSenderKey } from './emailSenders.ts';

export const SOCIAL_LINKS = {
  x: 'https://x.com/Growlanzo',
  instagram:
    'https://www.instagram.com/invites/contact/?utm_source=ig_contact_invite&utm_medium=copy_link&utm_content=6xoewwb',
  linkedin: 'https://www.linkedin.com/company/growlancercom/',
} as const;

export const SUPPORT_EMAIL = 'support@growlanzo.com';

// ── Escaping ────────────────────────────────────────────────────────────────

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Crude but safe HTML → plain text, for the legacy builders that hand us HTML
 * instead of structured data. Produces the text/plain alternative.
 */
export function htmlToText(html: string): string {
  return String(html ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h1|h2|h3|li|td)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Absolute site URL for a path, tolerating a full URL being passed in. */
function abs(path: string): string {
  if (!path) return SITE_URL;
  if (/^https?:\/\//i.test(path)) return path;
  return SITE_URL + (path.startsWith('/') ? path : `/${path}`);
}

// ── Layout ──────────────────────────────────────────────────────────────────

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const TONES = {
  neutral: { bg: '#f1f5f9', border: '#e2e8f0', text: '#0f172a' },
  success: { bg: '#f1fcef', border: '#89e07f', text: '#10591a' },
  warning: { bg: '#fffbeb', border: '#fde68a', text: '#92400e' },
  danger: { bg: '#fef2f2', border: '#fecaca', text: '#991b1b' },
} as const;

export type EmailTone = keyof typeof TONES;

function socialBar(): string {
  const pill = (href: string, label: string) => `
    <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"
       style="display:inline-block;margin:0 4px 6px;padding:7px 14px;border:1px solid #e2e8f0;border-radius:999px;
              background:#ffffff;color:#0f172a;font-size:12px;font-weight:600;text-decoration:none;">${label}</a>`;
  return `
    <tr>
      <td align="center" style="padding:0 0 12px;">
        <p style="margin:0 0 8px;color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;">
          Follow us
        </p>
        ${pill(SOCIAL_LINKS.x, 'X (Twitter)')}
        ${pill(SOCIAL_LINKS.instagram, 'Instagram')}
        ${pill(SOCIAL_LINKS.linkedin, 'LinkedIn')}
      </td>
    </tr>`;
}

function footerHtml(): string {
  return `
  <div style="padding:20px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      ${socialBar()}
      <tr>
        <td align="center" style="padding-bottom:12px;">
          <a href="${SITE_URL}" target="_blank" rel="noopener noreferrer" style="color:#14861f;font-size:12px;font-weight:600;text-decoration:none;padding:0 8px;">Website</a>
          <span style="color:#cbd5e1;font-size:12px;">|</span>
          <a href="${SITE_URL}/help-center" target="_blank" rel="noopener noreferrer" style="color:#14861f;font-size:12px;font-weight:600;text-decoration:none;padding:0 8px;">Help Center</a>
          <span style="color:#cbd5e1;font-size:12px;">|</span>
          <a href="mailto:${SUPPORT_EMAIL}" style="color:#14861f;font-size:12px;font-weight:600;text-decoration:none;padding:0 8px;">Contact</a>
        </td>
      </tr>
      <tr>
        <td align="center">
          <p style="color:#94a3b8;font-size:11px;margin:0;line-height:1.6;">
            Growlanzo — AI-Powered Freelancing Marketplace<br />
            You are receiving this email because of activity on your Growlanzo account.
          </p>
        </td>
      </tr>
    </table>
  </div>`;
}

/**
 * Wrap authored HTML in the branded Growlanzo shell.
 * `bodyHtml` must already be safe HTML (our own builders escape user data).
 */
export function brandedEmailHtml(params: {
  title: string;
  bodyHtml: string;
  preheader?: string;
  tone?: EmailTone;
}): string {
  const title = escapeHtml(params.title);
  const preheader = escapeHtml(params.preheader ?? params.title);
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>${title}</title>
</head>
<body style="font-family:${FONT};background:#f1f5f9;padding:24px 12px;margin:0;-webkit-font-smoothing:antialiased;">
  <div style="display:none;font-size:1px;color:#f1f5f9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>
  <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="center"><![endif]-->
  <div style="max-width:600px;width:100%;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 16px rgba(0,0,0,0.06);">
    <div style="background:#ffffff;padding:20px 24px 0;text-align:center;">
      <img src="${SITE_URL}/growlanzo-full.png" alt="Growlanzo" width="150" style="height:auto;max-width:150px;border:0;" />
    </div>
    <div style="background:linear-gradient(135deg,#14861f 0%,#0f6f1a 100%);margin:12px 12px 0;border-radius:12px;padding:28px 24px;text-align:center;">
      <h1 style="color:#ffffff;font-size:20px;font-weight:800;margin:0;letter-spacing:-0.3px;">${title}</h1>
    </div>
    <div style="padding:28px 24px;line-height:1.6;">
      ${params.bodyHtml}
    </div>
    ${footerHtml()}
  </div>
  <!--[if mso]></td></tr></table><![endif]-->
</body>
</html>`.trim();
}

// ── Event catalogue ─────────────────────────────────────────────────────────

export type EmailData = Record<string, unknown>;
type Text = string | ((data: EmailData) => string);

export interface EmailEventDefinition {
  /** Verified sender identity for this event. */
  sender: EmailSenderKey;
  /** Stable id stored in email_logs.template_id. */
  id: string;
  label: string;
  /** Essential = transactional/security; unaffected by marketing opt-outs. */
  essential: boolean;
  subject: (data: EmailData) => string;
  heading: Text;
  intro: Text;
  rows?: (data: EmailData) => Array<[string, string]>;
  cta?: (data: EmailData) => { label: string; path: string } | null;
  footnote?: Text;
  tone?: EmailTone;
}

const firstName = (data: EmailData): string => {
  const raw = String(data.name ?? data.first_name ?? '').trim();
  if (!raw) return 'there';
  return raw.split(/\s+/)[0];
};

const str = (value: Text, data: EmailData): string =>
  typeof value === 'function' ? value(data) : value;

const val = (data: EmailData, key: string, fallback = '—'): string => {
  const v = data[key];
  if (v === null || v === undefined || v === '') return fallback;
  return String(v);
};

function currency(data: EmailData, key: string): string {
  const n = Number(data[key]);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

export const EMAIL_EVENTS = {
  // ── Authentication / security (sender: security) ──────────────────────────
  verification_code: {
    sender: 'security',
    id: 'verification-code',
    label: 'Verification code / OTP',
    essential: true,
    subject: () => 'Your Growlanzo verification code',
    heading: 'Verify your email',
    intro: (d) =>
      `Hi ${firstName(d)}, use the code below to verify your email address. It expires in ${val(d, 'expires_in', '10 minutes')}.`,
    rows: (d) => [['Verification code', val(d, 'code')]],
    footnote: () =>
      'Never share this code. Growlanzo will never ask you for it by email, chat or phone.',
    tone: 'neutral',
  } as EmailEventDefinition,

  email_verification: {
    sender: 'security',
    id: 'email-verification',
    label: 'Email verification link',
    essential: true,
    subject: () => 'Confirm your Growlanzo email address',
    heading: 'Confirm your email',
    intro: (d) =>
      `Hi ${firstName(d)}, confirm this address to finish setting up your Growlanzo account.`,
    cta: () => ({ label: 'Confirm Email', path: '/auth/email-confirm' }),
    footnote: () =>
      'If you did not create a Growlanzo account, you can safely ignore this email.',
    tone: 'neutral',
  } as EmailEventDefinition,

  password_reset: {
    sender: 'security',
    id: 'password-reset',
    label: 'Password reset',
    essential: true,
    subject: () => 'Reset your Growlanzo password',
    heading: 'Reset your password',
    intro: (d) =>
      `Hi ${firstName(d)}, we received a request to reset the password on your Growlanzo account.`,
    cta: () => ({ label: 'Reset Password', path: '/auth/reset-password' }),
    footnote: () =>
      'This link expires shortly. If you did not ask for a reset, change your password and contact support.',
    tone: 'warning',
  } as EmailEventDefinition,

  password_changed: {
    sender: 'security',
    id: 'password-changed',
    label: 'Password changed',
    essential: true,
    subject: () => 'Your Growlanzo password was changed',
    heading: 'Password changed',
    intro: (d) =>
      `Hi ${firstName(d)}, the password on your Growlanzo account was just changed.`,
    rows: (d) => [
      ['When', val(d, 'changed_at', new Date().toISOString())],
      ['Account', val(d, 'email')],
    ],
    cta: () => ({ label: 'Review Account Security', path: '/dashboard/settings' }),
    footnote: () =>
      'If this was not you, reset your password immediately and contact support@growlanzo.com.',
    tone: 'warning',
  } as EmailEventDefinition,

  security_alert: {
    sender: 'security',
    id: 'security-alert',
    label: 'Security alert',
    essential: true,
    subject: (d) => `Security alert: ${val(d, 'alert', 'unusual account activity')}`,
    heading: 'Security alert',
    intro: (d) =>
      `Hi ${firstName(d)}, we detected activity on your Growlanzo account that needs your attention.`,
    rows: (d) => [
      ['What happened', val(d, 'alert')],
      ['When', val(d, 'when', new Date().toISOString())],
      ['Action taken', val(d, 'action', 'None — review recommended')],
    ],
    cta: () => ({ label: 'Secure My Account', path: '/dashboard/settings' }),
    footnote: () => 'Questions? Reply to this email and our security team will help.',
    tone: 'danger',
  } as EmailEventDefinition,

  // ── Welcome / onboarding (sender: hello) ─────────────────────────────────
  welcome: {
    sender: 'hello',
    id: 'welcome',
    label: 'Welcome / registration',
    essential: true,
    subject: (d) => `Welcome to Growlanzo, ${firstName(d)} 👋`,
    heading: (d) => `Welcome to Growlanzo, ${firstName(d)}!`,
    intro: (d) =>
      `Your ${val(d, 'role', 'freelancer')} account is ready. ${
        String(data_role(d)) === 'client'
          ? 'Post your first project in about two minutes — escrow protects every contract.'
          : 'Complete your profile and add your skills — that is what gets you ranked in client searches.'
      }`,
    rows: (d) => [['Account email', val(d, 'email')], ['Role', val(d, 'role', 'freelancer')]],
    cta: (d) => ({
      label: String(data_role(d)) === 'client' ? 'Post a Project' : 'Complete My Profile',
      path: String(data_role(d)) === 'client' ? '/dashboard/client/projects/new' : '/dashboard/profile',
    }),
    footnote: () => 'One flat 5% commission, charged only when a freelancer gets paid.',
    tone: 'success',
  } as EmailEventDefinition,

  email_verified: {
    sender: 'hello',
    id: 'email-verified',
    label: 'Email verified',
    essential: true,
    subject: () => 'Your Growlanzo email is verified ✅',
    heading: 'Email verified',
    intro: (d) => `Hi ${firstName(d)}, your email address is now confirmed.`,
    rows: (d) => [['Verified email', val(d, 'email')]],
    cta: () => ({ label: 'Go to Dashboard', path: '/dashboard' }),
    tone: 'success',
  } as EmailEventDefinition,

  onboarding_getting_started: {
    sender: 'hello',
    id: 'onboarding-getting-started',
    label: 'Getting started',
    essential: false,
    subject: () => 'Three steps to your first contract on Growlanzo',
    heading: 'Getting started',
    intro: (d) =>
      `Hi ${firstName(d)}, here is the fastest path from a new account to a paid contract.`,
    rows: () => [
      ['Step 1', 'Complete your profile and add your skills'],
      ['Step 2', 'Send proposals (or post a project as a client)'],
      ['Step 3', 'Fund escrow, deliver, and get paid'],
    ],
    cta: () => ({ label: 'Open Growlanzo', path: '/dashboard' }),
    tone: 'neutral',
  } as EmailEventDefinition,

  // ── Support (sender: support) ────────────────────────────────────────────
  support_ticket_ack: {
    sender: 'support',
    id: 'support-ticket-ack',
    label: 'Support ticket acknowledgement',
    essential: true,
    subject: (d) => `We received your support request${d.ticket_id ? ` #${String(d.ticket_id).slice(0, 8).toUpperCase()}` : ''}`,
    heading: 'Support request received',
    intro: (d) =>
      `Hi ${firstName(d)}, our team has your request and will respond within 24 hours.`,
    rows: (d) => [
      ['Ticket ID', d.ticket_id ? String(d.ticket_id).slice(0, 8).toUpperCase() : '—'],
      ['Subject', val(d, 'subject', 'Support request')],
    ],
    cta: () => ({ label: 'View My Tickets', path: '/dashboard/support' }),
    footnote: () => 'Reply to this email to add more detail to your ticket.',
    tone: 'neutral',
  } as EmailEventDefinition,

  support_reply: {
    sender: 'support',
    id: 'support-reply',
    label: 'Support response',
    essential: true,
    subject: (d) => `New reply on your ticket${d.ticket_id ? ` #${String(d.ticket_id).slice(0, 8).toUpperCase()}` : ''}`,
    heading: 'You have a reply from support',
    intro: (d) => `Hi ${firstName(d)}, our support team has responded to your ticket.`,
    rows: (d) => [
      ['Ticket ID', d.ticket_id ? String(d.ticket_id).slice(0, 8).toUpperCase() : '—'],
      ['Subject', val(d, 'subject')],
    ],
    cta: () => ({ label: 'Read the Reply', path: '/dashboard/support' }),
    tone: 'neutral',
  } as EmailEventDefinition,

  support_resolved: {
    sender: 'support',
    id: 'support-resolved',
    label: 'Ticket resolved',
    essential: true,
    subject: (d) => `Your support ticket${d.ticket_id ? ` #${String(d.ticket_id).slice(0, 8).toUpperCase()}` : ''} was resolved`,
    heading: 'Ticket resolved',
    intro: (d) =>
      `Hi ${firstName(d)}, we have marked your support request as resolved.`,
    rows: (d) => [
      ['Ticket ID', d.ticket_id ? String(d.ticket_id).slice(0, 8).toUpperCase() : '—'],
      ['Resolution', val(d, 'resolution', 'Resolved')],
    ],
    cta: () => ({ label: 'Review Ticket', path: '/dashboard/support' }),
    footnote: () => 'If the issue is not fully resolved, reply and we will reopen it.',
    tone: 'success',
  } as EmailEventDefinition,

  // ── Client / project workflows (sender: info) ────────────────────────────
  project_created: {
    sender: 'info',
    id: 'project-created',
    label: 'Project created',
    essential: true,
    subject: (d) => `Your project "${val(d, 'project_title')}" is live`,
    heading: 'Project published',
    intro: (d) =>
      `Hi ${firstName(d)}, your project is live and freelancers can now send proposals.`,
    rows: (d) => [
      ['Project', val(d, 'project_title')],
      ['Budget', d.budget !== undefined ? currency(d, 'budget') : val(d, 'budget')],
      ['Status', val(d, 'status', 'Open')],
    ],
    cta: (d) => ({
      label: 'View Project',
      path: d.project_id ? `/dashboard/client/projects/${val(d, 'project_id')}` : '/dashboard/client/projects',
    }),
    tone: 'success',
  } as EmailEventDefinition,

  project_invitation: {
    sender: 'info',
    id: 'project-invitation',
    label: 'Project invitation',
    essential: true,
    subject: (d) => `${val(d, 'client_name', 'A client')} invited you to "${val(d, 'project_title')}"`,
    heading: 'You have a project invitation',
    intro: (d) =>
      `Hi ${firstName(d)}, ${val(d, 'client_name', 'a client')} invited you to submit a proposal.`,
    rows: (d) => [
      ['Project', val(d, 'project_title')],
      ['Client', val(d, 'client_name')],
      ['Budget', d.budget !== undefined ? currency(d, 'budget') : val(d, 'budget')],
    ],
    cta: (d) => ({
      label: 'View Invitation',
      path: d.project_id ? `/dashboard/projects/${val(d, 'project_id')}` : '/dashboard/projects',
    }),
    tone: 'neutral',
  } as EmailEventDefinition,

  new_project_opportunity: {
    sender: 'info',
    id: 'new-project-opportunity',
    label: 'New project opportunity',
    essential: false,
    subject: (d) => `New project matching your skills: "${val(d, 'project_title')}"`,
    heading: 'A project matches your skills',
    intro: (d) =>
      `Hi ${firstName(d)}, a new project was posted that fits your profile.`,
    rows: (d) => [
      ['Project', val(d, 'project_title')],
      ['Budget', d.budget !== undefined ? currency(d, 'budget') : val(d, 'budget')],
      ['Category', val(d, 'category')],
    ],
    cta: (d) => ({
      label: 'View Project',
      path: d.project_id ? `/dashboard/projects/${val(d, 'project_id')}` : '/dashboard/projects',
    }),
    tone: 'neutral',
  } as EmailEventDefinition,

  proposal_submitted: {
    sender: 'info',
    id: 'proposal-submitted',
    label: 'Proposal submitted (freelancer receipt)',
    essential: true,
    subject: (d) => `Your proposal for "${val(d, 'project_title')}" was sent`,
    heading: 'Proposal sent',
    intro: (d) =>
      `Hi ${firstName(d)}, your proposal has been delivered to the client.`,
    rows: (d) => [
      ['Project', val(d, 'project_title')],
      ['Your bid', d.bid_amount !== undefined ? currency(d, 'bid_amount') : val(d, 'bid_amount')],
      ['Status', 'Submitted'],
    ],
    cta: () => ({ label: 'View My Proposals', path: '/dashboard/proposals' }),
    tone: 'neutral',
  } as EmailEventDefinition,

  proposal_received: {
    sender: 'info',
    id: 'proposal-received',
    label: 'New proposal received (client)',
    essential: true,
    subject: (d) => `New proposal on "${val(d, 'project_title')}"`,
    heading: 'New proposal received',
    intro: (d) =>
      `Hi ${firstName(d)}, ${val(d, 'freelancer_name', 'a freelancer')} submitted a proposal on your project.`,
    rows: (d) => [
      ['Project', val(d, 'project_title')],
      ['Freelancer', val(d, 'freelancer_name')],
      ['Bid', d.bid_amount !== undefined ? currency(d, 'bid_amount') : val(d, 'bid_amount')],
    ],
    cta: (d) => ({
      label: 'Review Proposal',
      path: d.project_id ? `/dashboard/client/projects/${val(d, 'project_id')}` : '/dashboard/client/projects',
    }),
    tone: 'neutral',
  } as EmailEventDefinition,

  proposal_accepted: {
    sender: 'info',
    id: 'proposal-accepted',
    label: 'Proposal accepted',
    essential: true,
    subject: (d) => `You're hired — "${val(d, 'project_title')}" 🎉`,
    heading: "Congratulations, you're hired!",
    intro: (d) =>
      `Hi ${firstName(d)}, ${val(d, 'client_name', 'the client')} accepted your proposal. A contract is waiting for you.`,
    rows: (d) => [
      ['Project', val(d, 'project_title')],
      ['Client', val(d, 'client_name')],
      ['Next step', 'Review the contract and start working once escrow is funded'],
    ],
    cta: () => ({ label: 'View Contract', path: '/dashboard/contracts' }),
    tone: 'success',
  } as EmailEventDefinition,

  proposal_rejected: {
    sender: 'info',
    id: 'proposal-rejected',
    label: 'Proposal not selected',
    essential: true,
    subject: (d) => `Update on your proposal for "${val(d, 'project_title')}"`,
    heading: 'Proposal update',
    intro: (d) =>
      `Hi ${firstName(d)}, the client moved forward with another freelancer for this project.`,
    rows: (d) => [['Project', val(d, 'project_title')]],
    cta: () => ({ label: 'Browse More Projects', path: '/dashboard/projects' }),
    footnote: () => 'Keep applying — new projects are posted every day.',
    tone: 'neutral',
  } as EmailEventDefinition,

  project_started: {
    sender: 'info',
    id: 'project-started',
    label: 'Project started',
    essential: true,
    subject: (d) => `"${val(d, 'project_title')}" has started`,
    heading: 'Project started',
    intro: (d) =>
      `Hi ${firstName(d)}, escrow is funded and work on the project has begun.`,
    rows: (d) => [
      ['Project', val(d, 'project_title')],
      ['Amount in escrow', d.amount !== undefined ? currency(d, 'amount') : val(d, 'amount')],
      ['Status', 'In progress'],
    ],
    cta: () => ({ label: 'Open Workspace', path: '/dashboard/contracts' }),
    tone: 'success',
  } as EmailEventDefinition,

  project_awarded: {
    sender: 'info',
    id: 'project-awarded',
    label: 'Project awarded',
    essential: true,
    subject: (d) => `You won "${val(d, 'project_title')}"`,
    heading: 'Project awarded to you',
    intro: (d) => `Hi ${firstName(d)}, this project is now yours to deliver.`,
    rows: (d) => [
      ['Project', val(d, 'project_title')],
      ['Client', val(d, 'client_name')],
    ],
    cta: () => ({ label: 'Start Working', path: '/dashboard/contracts' }),
    tone: 'success',
  } as EmailEventDefinition,

  proposal_status_changed: {
    sender: 'info',
    id: 'proposal-status-changed',
    label: 'Proposal status changed',
    essential: true,
    subject: (d) => `Proposal status: ${val(d, 'status')} — "${val(d, 'project_title')}"`,
    heading: 'Proposal status updated',
    intro: (d) => `Hi ${firstName(d)}, the status of your proposal has changed.`,
    rows: (d) => [
      ['Project', val(d, 'project_title')],
      ['New status', val(d, 'status')],
    ],
    cta: () => ({ label: 'View Proposal', path: '/dashboard/proposals' }),
    tone: 'neutral',
  } as EmailEventDefinition,

  milestone_update: {
    sender: 'info',
    id: 'milestone-update',
    label: 'Milestone update',
    essential: true,
    subject: (d) => `Milestone update — "${val(d, 'project_title')}"`,
    heading: 'Milestone update',
    intro: (d) => `Hi ${firstName(d)}, there is an update on a project milestone.`,
    rows: (d) => [
      ['Project', val(d, 'project_title')],
      ['Milestone', val(d, 'milestone_title')],
      ['Status', val(d, 'status')],
      ['Amount', d.amount !== undefined ? currency(d, 'amount') : val(d, 'amount')],
    ],
    cta: () => ({ label: 'View Milestones', path: '/dashboard/contracts' }),
    tone: 'neutral',
  } as EmailEventDefinition,

  milestone_released: {
    sender: 'info',
    id: 'milestone-released',
    label: 'Milestone payment released',
    essential: true,
    subject: (d) => `Milestone payment of ${d.amount !== undefined ? currency(d, 'amount') : val(d, 'amount')} released`,
    heading: 'Milestone payment released',
    intro: (d) =>
      `Hi ${firstName(d)}, a milestone payment for "${val(d, 'project_title')}" has landed in your wallet.`,
    rows: (d) => [
      ['Project', val(d, 'project_title')],
      ['Amount', d.amount !== undefined ? currency(d, 'amount') : val(d, 'amount')],
      ['Milestone', val(d, 'milestone_title')],
    ],
    cta: () => ({ label: 'View Wallet', path: '/dashboard/wallet' }),
    tone: 'success',
  } as EmailEventDefinition,

  project_completed: {
    sender: 'info',
    id: 'project-completed',
    label: 'Project completed',
    essential: true,
    subject: (d) => `"${val(d, 'project_title')}" is complete`,
    heading: 'Project completed',
    intro: (d) => `Hi ${firstName(d)}, this project has been marked complete.`,
    rows: (d) => [
      ['Project', val(d, 'project_title')],
      ['Total value', d.amount !== undefined ? currency(d, 'amount') : val(d, 'amount')],
    ],
    cta: () => ({ label: 'View Contract', path: '/dashboard/contracts' }),
    tone: 'success',
  } as EmailEventDefinition,

  review_request: {
    sender: 'info',
    id: 'review-request',
    label: 'Review request',
    essential: true,
    subject: (d) => `How did "${val(d, 'project_title')}" go?`,
    heading: 'Leave a review',
    intro: (d) =>
      `Hi ${firstName(d)}, your project is complete. A short review helps the next client or freelancer decide.`,
    rows: (d) => [['Project', val(d, 'project_title')]],
    cta: () => ({ label: 'Write a Review', path: '/dashboard/reviews' }),
    tone: 'neutral',
  } as EmailEventDefinition,

  review_received: {
    sender: 'info',
    id: 'review-received',
    label: 'Review received',
    essential: true,
    subject: (d) => `You received a ${val(d, 'rating')}★ review`,
    heading: 'New review received',
    intro: (d) => `Hi ${firstName(d)}, someone reviewed your work on Growlanzo.`,
    rows: (d) => [
      ['Rating', d.rating !== undefined ? `${val(d, 'rating')} / 5` : val(d, 'rating')],
      ['Project', val(d, 'project_title')],
    ],
    cta: () => ({ label: 'View Review', path: '/dashboard/reviews' }),
    tone: 'success',
  } as EmailEventDefinition,

  // ── Payments (sender: info) ──────────────────────────────────────────────
  payment_success: {
    sender: 'info',
    id: 'payment-success',
    label: 'Payment successful',
    essential: true,
    subject: (d) => `Payment confirmed — ${d.amount !== undefined ? currency(d, 'amount') : val(d, 'amount')}`,
    heading: 'Payment confirmed',
    intro: (d) => `Hi ${firstName(d)}, your payment was successful.`,
    rows: (d) => [
      ['Amount', d.amount !== undefined ? currency(d, 'amount') : val(d, 'amount')],
      ['Project', val(d, 'project_title')],
      ['Reference', val(d, 'reference')],
    ],
    cta: () => ({ label: 'View Payment', path: '/dashboard/wallet' }),
    tone: 'success',
  } as EmailEventDefinition,

  payment_failed: {
    sender: 'info',
    id: 'payment-failed',
    label: 'Payment failed',
    essential: true,
    subject: (d) => `Payment failed — ${d.amount !== undefined ? currency(d, 'amount') : val(d, 'amount')}`,
    heading: 'Payment failed',
    intro: (d) =>
      `Hi ${firstName(d)}, we could not process your payment. No money has left your account.`,
    rows: (d) => [
      ['Amount', d.amount !== undefined ? currency(d, 'amount') : val(d, 'amount')],
      ['Reason', val(d, 'reason', 'The payment provider declined the transaction')],
      ['Reference', val(d, 'reference')],
    ],
    cta: () => ({ label: 'Try Again', path: '/dashboard/wallet' }),
    tone: 'danger',
  } as EmailEventDefinition,

  refund_confirmed: {
    sender: 'info',
    id: 'refund-confirmed',
    label: 'Refund confirmed',
    essential: true,
    subject: (d) => `Refund confirmed — ${d.amount !== undefined ? currency(d, 'amount') : val(d, 'amount')}`,
    heading: 'Refund confirmed',
    intro: (d) => `Hi ${firstName(d)}, your refund has been processed.`,
    rows: (d) => [
      ['Amount', d.amount !== undefined ? currency(d, 'amount') : val(d, 'amount')],
      ['Project', val(d, 'project_title')],
      ['Reference', val(d, 'reference')],
    ],
    cta: () => ({ label: 'View Wallet', path: '/dashboard/wallet' }),
    footnote: () => 'Bank settlement usually completes within 5–7 business days.',
    tone: 'success',
  } as EmailEventDefinition,

  payout_update: {
    sender: 'info',
    id: 'payout-update',
    label: 'Payout status update',
    essential: true,
    subject: (d) => `Payout ${val(d, 'status', 'update')} — ${d.amount !== undefined ? currency(d, 'amount') : val(d, 'amount')}`,
    heading: 'Payout status update',
    intro: (d) => `Hi ${firstName(d)}, the status of your payout has changed.`,
    rows: (d) => [
      ['Amount', d.amount !== undefined ? currency(d, 'amount') : val(d, 'amount')],
      ['Status', val(d, 'status')],
      ['Reference', val(d, 'reference')],
    ],
    cta: () => ({ label: 'View Payout', path: '/dashboard/wallet' }),
    tone: 'neutral',
  } as EmailEventDefinition,

  escrow_funded: {
    sender: 'info',
    id: 'escrow-funded',
    label: 'Escrow funded',
    essential: true,
    subject: (d) => `Escrow funded — start working on "${val(d, 'project_title')}" 🚀`,
    heading: 'Escrow funded',
    intro: (d) =>
      `Hi ${firstName(d)}, the client funded escrow for "${val(d, 'project_title')}". You are cleared to start.`,
    rows: (d) => [
      ['Project', val(d, 'project_title')],
      ['Amount in escrow', d.amount !== undefined ? currency(d, 'amount') : val(d, 'amount')],
    ],
    cta: () => ({ label: 'Go to Workspace', path: '/dashboard/contracts' }),
    tone: 'success',
  } as EmailEventDefinition,

  withdrawal_completed: {
    sender: 'info',
    id: 'withdrawal-completed',
    label: 'Withdrawal completed',
    essential: true,
    subject: (d) => `Withdrawal of ${d.amount !== undefined ? currency(d, 'amount') : val(d, 'amount')} processed ✅`,
    heading: 'Withdrawal processed',
    intro: (d) => `Hi ${firstName(d)}, your withdrawal has been processed.`,
    rows: (d) => [
      ['Amount', d.amount !== undefined ? currency(d, 'amount') : val(d, 'amount')],
      ['Net received', d.net_amount !== undefined ? currency(d, 'net_amount') : val(d, 'net_amount')],
      ['Method', val(d, 'method')],
    ],
    cta: () => ({ label: 'View Wallet', path: '/dashboard/wallet' }),
    footnote: () => 'Funds usually arrive within 1–3 business days.',
    tone: 'success',
  } as EmailEventDefinition,

  withdrawal_failed: {
    sender: 'info',
    id: 'withdrawal-failed',
    label: 'Withdrawal failed',
    essential: true,
    subject: (d) => `Withdrawal of ${d.amount !== undefined ? currency(d, 'amount') : val(d, 'amount')} failed — funds returned`,
    heading: 'Withdrawal failed',
    intro: (d) =>
      `Hi ${firstName(d)}, your withdrawal could not be processed and the full amount is back in your wallet.`,
    rows: (d) => [
      ['Amount', d.amount !== undefined ? currency(d, 'amount') : val(d, 'amount')],
      ['Reason', val(d, 'reason', 'The payout provider rejected the transfer')],
    ],
    cta: () => ({ label: 'Check Wallet', path: '/dashboard/wallet' }),
    tone: 'danger',
  } as EmailEventDefinition,

  // ── Trust / account state (sender: info) ─────────────────────────────────
  verification_approved: {
    sender: 'info',
    id: 'verification-approved',
    label: 'Identity verification approved',
    essential: true,
    subject: () => 'Identity verification approved ✅',
    heading: 'Identity verified',
    intro: (d) =>
      `Hi ${firstName(d)}, your identity verification was approved and the verified badge is now on your profile.`,
    cta: () => ({ label: 'View Profile', path: '/dashboard/profile' }),
    tone: 'success',
  } as EmailEventDefinition,

  verification_rejected: {
    sender: 'info',
    id: 'verification-rejected',
    label: 'Identity verification rejected',
    essential: true,
    subject: () => 'Identity verification update',
    heading: 'Verification needs attention',
    intro: (d) =>
      `Hi ${firstName(d)}, we could not approve your verification with the documents provided.`,
    rows: (d) => [['Reason', val(d, 'reason', 'Documents were unclear or incomplete')]],
    cta: () => ({ label: 'Resubmit Verification', path: '/dashboard/settings' }),
    tone: 'warning',
  } as EmailEventDefinition,

  account_suspended: {
    sender: 'info',
    id: 'account-suspended',
    label: 'Account suspended',
    essential: true,
    subject: () => 'Your Growlanzo account has been suspended',
    heading: 'Account suspended',
    intro: (d) => `Hi ${firstName(d)}, your account has been temporarily suspended.`,
    rows: (d) => [['Reason', val(d, 'reason', 'Policy violation')]],
    cta: () => ({ label: 'Contact Support', path: '/contact' }),
    footnote: () => 'If you believe this is an error, reply to this email and we will review it.',
    tone: 'danger',
  } as EmailEventDefinition,
} as const;

/** Role helper kept small so the welcome copy stays readable. */
function data_role(data: EmailData): string {
  return String(data.role ?? 'freelancer').toLowerCase();
}

export type EmailEventKey = keyof typeof EMAIL_EVENTS;

export function isEmailEvent(key: string): key is EmailEventKey {
  return Object.prototype.hasOwnProperty.call(EMAIL_EVENTS, key);
}

export function listEmailEvents(): Array<{
  event: EmailEventKey;
  label: string;
  sender: EmailSenderKey;
  essential: boolean;
}> {
  return (Object.keys(EMAIL_EVENTS) as EmailEventKey[]).map((event) => ({
    event,
    label: EMAIL_EVENTS[event].label,
    sender: EMAIL_EVENTS[event].sender,
    essential: EMAIL_EVENTS[event].essential,
  }));
}

// ── Renderer ────────────────────────────────────────────────────────────────

export interface RenderedEmail {
  event: EmailEventKey;
  templateId: string;
  senderKey: EmailSenderKey;
  subject: string;
  html: string;
  text: string;
}

/**
 * Render an event to {subject, html, text}. All data values are escaped in the
 * HTML part; the text part is plain by construction.
 */
export function renderEmail(event: EmailEventKey, data: EmailData = {}): RenderedEmail {
  const def = EMAIL_EVENTS[event] as unknown as EmailEventDefinition;
  const heading = str(def.heading, data);
  const intro = str(def.intro, data);
  const rows = def.rows ? def.rows(data) : [];
  const cta = def.cta ? def.cta(data) : null;
  const footnote = def.footnote ? str(def.footnote, data) : '';
  const subject = def.subject(data);
  const tone = TONES[def.tone ?? 'neutral'];

  const rowsHtml = rows.length
    ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
      <tr><td style="padding:16px 18px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
          ${rows
            .map(
              ([label, value]) => `
            <tr>
              <td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px;vertical-align:top;width:42%;">${escapeHtml(label)}</td>
              <td style="padding:6px 0;color:#0f172a;font-weight:600;vertical-align:top;">${escapeHtml(value)}</td>
            </tr>`,
            )
            .join('')}
        </table>
      </td></tr>
    </table>`
    : '';

  const ctaHtml = cta
    ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
      <tr><td align="center">
        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td style="background:#14861f;border-radius:12px;padding:14px 32px;" bgcolor="#14861f">
              <a href="${escapeHtml(abs(cta.path))}" target="_blank" rel="noopener noreferrer"
                 style="display:inline-block;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">
                ${escapeHtml(cta.label)} →
              </a>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>`
    : '';

  const bodyHtml = `
    <p style="font-size:16px;color:#0f172a;line-height:1.7;margin:0 0 18px;">${escapeHtml(intro)}</p>
    ${rowsHtml}
    ${
      footnote
        ? `<div style="margin:0 0 20px;padding:14px 16px;background:${tone.bg};border:1px solid ${tone.border};border-radius:12px;">
             <p style="margin:0;font-size:13px;color:${tone.text};line-height:1.6;">${escapeHtml(footnote)}</p>
           </div>`
        : ''
    }
    ${ctaHtml}
    <p style="font-size:14px;color:#64748b;line-height:1.7;margin:0;">— The Growlanzo Team</p>`;

  const textLines = [
    heading,
    '',
    intro,
    ...(rows.length ? ['', ...rows.map(([label, value]) => `${label}: ${value}`)] : []),
    ...(cta ? ['', `${cta.label}: ${abs(cta.path)}`] : []),
    ...(footnote ? ['', footnote] : []),
    '',
    '— The Growlanzo Team',
    '',
    `Website: ${SITE_URL}`,
    `Help Center: ${SITE_URL}/help-center`,
    `Support: ${SUPPORT_EMAIL}`,
    '',
    'Follow us',
    `X (Twitter): ${SOCIAL_LINKS.x}`,
    `Instagram: ${SOCIAL_LINKS.instagram}`,
    `LinkedIn: ${SOCIAL_LINKS.linkedin}`,
    '',
    'Growlanzo — AI-Powered Freelancing Marketplace',
  ];

  return {
    event,
    templateId: def.id,
    senderKey: def.sender,
    subject,
    html: brandedEmailHtml({ title: heading, bodyHtml, preheader: subject, tone: def.tone }),
    text: textLines.join('\n'),
  };
}
