# Transactional Email System (Brevo)

Centralised, audited, idempotent transactional email for Growlanzo.

## 1. Architecture

```
caller (edge function / admin console)
        │
        ▼
_shared/emailService.ts        ← the ONLY send path for new code
   ├─ emailTemplates.ts        event → subject/heading/rows/CTA (HTML + text)
   ├─ emailSenders.ts          event purpose → one of the 4 verified senders
   ├─ _shared/brevo.ts         the only module that calls the Brevo API
   └─ email_logs / email_log_events   audit + delivery lifecycle
        ▲
        │
brevo-webhook (delivered/bounced/blocked)  ── fail-closed shared secret
```

Entry points:

| Function | Purpose |
| --- | --- |
| `sendTransactionalEmail({ event, to, data, idempotencyKey })` | Render a catalogued event and send it (preferred). |
| `sendLoggedEmail({ event, to, subject, html, text, senderKey, … })` | Send already-rendered HTML (used by the legacy builders in `email-notifications`, `proposal-notifications`). |
| `retryEmailLog(logId)` | Re-send a failed row (admin Retry button). |
| `_shared/brevo.ts → sendEmail(opts)` | Boolean-only compatibility wrapper for older callers (admin reports, internships, cron). |

## 2. Verified senders

| Key | Name | Address | Purpose |
| --- | --- | --- | --- |
| `security` | Growlanzo Security | `security@growlanzo.com` | OTP, email verification, password reset / changed, security alerts |
| `support` | Growlanzo Support | `support@growlanzo.com` | support tickets, acknowledgements, complaint correspondence |
| `hello` | Growlanzo Team | `hello@growlanzo.com` | welcome, registration confirmation, onboarding |
| `info` | Growlanzo Notifications | `info@growlanzo.com` | projects, proposals, milestones, payments, activity |

Addresses are read from `BREVO_FROM_SECURITY` / `_SUPPORT` / `_HELLO` / `_INFO`.
When a secret is absent the documented default above is used and a warning is
logged once per isolate — a missing secret is never silent.

## 3. Events

`EMAIL_EVENTS` in `_shared/emailTemplates.ts` is the catalogue. Each entry
declares its sender, subject, heading, intro, detail rows, CTA and whether it is
essential (transactional) or optional (activity/onboarding).

Groups: authentication/security, welcome/onboarding, support, client project
workflows, freelancer workflows, payments/payouts, trust and account state.

### Which events are actually triggered

Catalogue ≠ wired. Only events with a real workflow in the app are sent today:

| Event | Trigger (real workflow) | Recipient | Function |
| --- | --- | --- | --- |
| `proposal_accepted` / `proposal_rejected` | client accepts or rejects a proposal (`hireFreelancerFromProposal`, `rejectProposal`) | the freelancer who proposed | `proposal-notifications` |
| `project_completed` | client sets a project to `completed` (client projects list, project details) | the hired freelancer | `project-notifications` |
| `review_request` | same completion action, sent once per project | the hired freelancer | `project-notifications` |
| `review_received` | a review row is created (contract or contest review) | the person reviewed | `reviews` |
| welcome / verified / withdrawal / dispute / escrow / milestone / verification / suspension / support ack | their existing flows | the affected user | `email-notifications` |

Everything else in the catalogue (payout updates, refund confirmation, some
milestone and invitation events) is defined but **not triggered**, because no
workflow emits it yet. Wiring one means calling the pipeline from the code path
that performs the state change — never sending optimistically before it.

Both lifecycle functions resolve the recipient **server-side** (contract or
hired proposal → `profiles_private.email`) and check ownership against the
caller's session, so neither can be used as a mail relay. `project-notifications`
refuses to send unless the project really is `completed`.

`project-notifications` idempotency keys are `event:project_id:recipient`;
`review_received` uses `review_received:<review_id>` — a retried request or a
double-click cannot send the same message twice.

Every message renders **HTML + plain-text**, and the footer carries the
Growlanzo social profiles (X, Instagram, LinkedIn) plus website / help centre /
support links.

## 4. Database

Migration `20270307000000_email_logs.sql`:

* `email_logs` — one row per attempt: recipient, sender, event, subject,
  template, Brevo message id, status, error, idempotency key, retry count,
  created/sent/delivered/bounced/failed timestamps.
* `email_log_events` — raw Brevo webhook events, unique on
  `(brevo_message_id, event, event_at)` so a redelivery is applied once.
* `get_email_log_stats(p_since)` — admin-only counters
  (`profiles_private.is_admin`, `SECURITY DEFINER`, `REVOKE`d from `anon`).

Both tables have RLS enabled with **no policies** and `REVOKE ALL` from
`anon`/`authenticated`: recipient addresses are PII and are only readable by the
service role, i.e. through the `email-admin` edge function.

Statuses: `queued · processing · sent · delivered · deferred · bounced ·
blocked · failed`. `sent` means **Brevo accepted the request** — only the
webhook may move a row to `delivered` / `bounced` / `blocked`, and status never
moves backwards.

Never stored: API keys, OTP codes, passwords, session tokens.

## 5. Required configuration

```bash
npx supabase secrets set \
  BREVO_API_KEY=xkeysib-… \
  BREVO_FROM_SECURITY=security@growlanzo.com \
  BREVO_FROM_SUPPORT=support@growlanzo.com \
  BREVO_FROM_HELLO=hello@growlanzo.com \
  BREVO_FROM_INFO=info@growlanzo.com \
  BREVO_WEBHOOK_SECRET=$(openssl rand -hex 32) \
  --project-ref zttwsjehcgaicziqyxpq
```

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.
`APP_URL` must be the canonical origin (`https://growlanzo.com`).

## 6. Deployment

```bash
# 1. Migration
npx supabase db push --project-ref zttwsjehcgaicziqyxpq

# 2. Functions (config.toml already sets verify_jwt correctly)
npx supabase functions deploy email-admin
npx supabase functions deploy brevo-webhook --no-verify-jwt
npx supabase functions deploy email-notifications
npx supabase functions deploy proposal-notifications
npx supabase functions deploy project-notifications
npx supabase functions deploy reviews
```

Frontend ships with the normal Vercel deploy; the admin console lives at
`/admin/emails` and needs no extra configuration.

## 7. Brevo webhook (manual, one time)

1. Brevo → **Transactional** → **Settings** → **Webhook**.
2. URL: `https://<project-ref>.supabase.co/functions/v1/brevo-webhook?token=<BREVO_WEBHOOK_SECRET>`
   (or set the same value as the basic-auth password).
3. Enable: `delivered`, `deferred`, `hard_bounce`, `soft_bounce`, `blocked`,
   `spam`, `invalid_email`, `error`.
4. Send a test event from Brevo and confirm the message appears in
   `email_log_events` and the matching `email_logs` row shows `delivered`.

The endpoint returns **503 while `BREVO_WEBHOOK_SECRET` is unset** and **401**
for a wrong or missing secret — it fails closed by design.

## 8. Domain authentication (manual)

Brevo → **Senders, Domains & Dedicated IPs** → authenticate `growlanzo.com`
with SPF, DKIM and DMARC DNS records. `security@`, `support@`, `hello@` and
`info@` must show **verified** before delivery to Gmail/Outlook is reliable.
Without authentication the API still accepts the message (status `sent`) but
providers may bounce or spam-filter it.

## 9. Verification

```bash
npm run typecheck && npm run lint && npm test && npm run build
node scripts/e2e/email-tests.mjs     # needs EMAIL_TEST_ADMIN_EMAIL/PASSWORD
```

The harness writes `docs/EMAIL-TEST-REPORT.md` and marks anything it could not
observe as SKIP with the exact manual step — it never reports PASS for an
unverified step.

## 10. Admin console

`/admin/emails` (edge function `email-admin`, admin-only server-side):

* counters: total, queued, sent, delivered, failed, bounced/blocked, delivery
  and failure rate;
* filters: recipient, event, sender, status, date range;
* detail drawer: sender, event, subject, Brevo message id, error, delivery
  events;
* retry a failed/bounced row (rate-limited);
* test sends: one button per verified sender, plus any catalogue event — always
  addressed to the calling admin's own email, so the console cannot be used as a
  spam relay.
