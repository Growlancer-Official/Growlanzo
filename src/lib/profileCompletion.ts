/**
 * Profile completeness for BOTH roles — the trust signal for launch.
 *
 * Full KYC is deferred for the Beta (`KYC_VERIFICATION_ENABLED` in
 * `featureFlags.ts`) and account verification is not a profile field, so nothing
 * here may depend on either. Every field below is something the user can fill
 * from the product today, which is what makes 100% reachable for a new account.
 *
 * One shared scorer keeps the numbers consistent between the freelancer
 * profile editor and the client dashboard, and the tests pin both the 100%
 * case and the "no verification field" rule.
 */

export interface ProfileCompletion {
  /** 0–100, rounded to the nearest whole percent. */
  percent: number;
  completed: number;
  total: number;
  /** Human labels of the fields still empty, in display order. */
  missing: string[];
}

interface CompletionField {
  label: string;
  done: boolean;
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasList(value: unknown[] | null | undefined): boolean {
  return Array.isArray(value) && value.length > 0;
}

function hasNumber(value: number | string | null | undefined): boolean {
  if (value === null || value === undefined || value === '') return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function score(fields: CompletionField[]): ProfileCompletion {
  const total = fields.length;
  const completed = fields.filter((f) => f.done).length;
  return {
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    completed,
    total,
    missing: fields.filter((f) => !f.done).map((f) => f.label),
  };
}

export interface FreelancerCompletionInput {
  name?: string | null;
  title?: string | null;
  bio?: string | null;
  hourly_rate?: number | string | null;
  skills?: unknown[] | null;
  languages?: unknown[] | null;
  location?: string | null;
  portfolio_url?: string | null;
  education?: string | null;
}

/** Freelancer profile editor — the same nine fields the meter has always shown. */
export function freelancerProfileCompletion(input: FreelancerCompletionInput): ProfileCompletion {
  return score([
    { label: 'Full name', done: hasText(input.name) },
    { label: 'Professional title', done: hasText(input.title) },
    { label: 'Bio', done: hasText(input.bio) },
    { label: 'Base rate', done: hasNumber(input.hourly_rate) },
    { label: 'Skills', done: hasList(input.skills) },
    { label: 'Languages', done: hasList(input.languages) },
    { label: 'Location', done: hasText(input.location) },
    { label: 'Portfolio URL', done: hasText(input.portfolio_url) },
    { label: 'Education', done: hasText(input.education) },
  ]);
}

export interface ClientCompletionInput {
  name?: string | null;
  /** Profile photo (profiles.avatar) or a business logo (client_profiles.company_logo). */
  avatar?: string | null;
  companyLogo?: string | null;
  industry?: string | null;
  location?: string | null;
  description?: string | null;
  website?: string | null;
}

/**
 * Client profile — six fields, all editable under Client → Settings.
 * `avatar` and `companyLogo` are one "photo" field so a solo client and a
 * business account are measured the same way.
 */
export function clientProfileCompletion(input: ClientCompletionInput): ProfileCompletion {
  return score([
    { label: 'Full name', done: hasText(input.name) },
    { label: 'Profile photo or logo', done: hasText(input.avatar) || hasText(input.companyLogo) },
    { label: 'Industry', done: hasText(input.industry) },
    { label: 'Location', done: hasText(input.location) },
    { label: 'About your business', done: hasText(input.description) },
    { label: 'Website', done: hasText(input.website) },
  ]);
}
