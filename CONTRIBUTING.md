# Contributing to Growlanzo

Thank you for your interest in contributing to **Growlanzo**.

Growlanzo is an AI-powered freelancing marketplace designed to connect businesses with skilled professionals through intelligent matching, secure transactions, structured project workflows, and real-time collaboration.

This document defines the engineering standards, contribution workflow, review expectations, and development practices required for contributing to the Growlanzo codebase.

> **Repository Status:** Proprietary / Controlled Contribution
> **Project:** Growlanzo
> **Website:** https://growlancer.vercel.app

---

## 1. Contribution Policy

Growlanzo is currently under active product development.

The repository contains proprietary application logic, business workflows, database structures, payment integrations, security controls, and platform infrastructure.

Contributions are therefore accepted on a controlled basis.

Before making substantial changes, contributors should ensure that the proposed change:

* Aligns with Growlanzo's product direction.
* Preserves existing platform workflows.
* Follows the project's engineering standards.
* Does not introduce unnecessary dependencies.
* Does not compromise security, privacy, or financial integrity.
* Includes appropriate testing and documentation.
* Maintains backward compatibility where applicable.

For significant architectural or workflow changes, open an issue or discuss the proposed change with the maintainers before implementation.

---

# 2. Engineering Principles

All contributions should follow these principles:

### Reliability First

Changes must not compromise existing production workflows.

### Security by Design

Authentication, authorization, payment, KYC, financial, and user-data flows must be treated as security-sensitive.

### Explicit Workflows

Core marketplace operations should use established workflow services and database functions instead of introducing independent status mutations.

### Data Integrity

Database constraints, RPCs, triggers, migrations, and transactional behavior must be preserved.

### Backward Compatibility

Existing users, projects, contracts, workspaces, payments, and historical records should remain functional after changes.

### Minimal Complexity

Prefer simple, maintainable implementations over unnecessary abstraction.

### Observability

Important production workflows should provide sufficient logging, error handling, and monitoring to diagnose failures.

---

# 3. Technology Stack

Growlanzo currently uses the following primary technologies:

| Layer          | Technology               |
| -------------- | ------------------------ |
| Frontend       | React 19                 |
| Language       | TypeScript               |
| Build Tool     | Vite                     |
| Styling        | Tailwind CSS             |
| Routing        | React Router             |
| Backend        | Supabase + Express       |
| Database       | PostgreSQL               |
| Authentication | Supabase Auth            |
| Storage        | Supabase Storage         |
| Realtime       | Supabase Realtime        |
| Serverless     | Supabase Edge Functions  |
| Payments       | Razorpay / PayPal        |
| Monitoring     | Sentry                   |
| Testing        | Vitest / Testing Library |
| Code Quality   | ESLint / Prettier        |
| Deployment     | Vercel / Supabase        |
| CI/CD          | GitHub Actions           |

---

# 4. Core Marketplace Workflow

Growlanzo's marketplace architecture follows a structured lifecycle:

```text
PROJECT
   │
   ├── AI MATCHING
   │
   ├── INVITATION
   │
   └── PROPOSAL
          │
          ▼
       CONTRACT
          │
          ▼
       WORKSPACE
          │
          ├── TEAM MEMBERS
          ├── MILESTONES
          ├── TASKS
          ├── FILES
          ├── MESSAGES
          └── ACTIVITY
          │
          ▼
     ESCROW / PAYMENT
          │
          ▼
       DELIVERY
          │
          ▼
      COMPLETION
          │
          ▼
     REVIEW / REPUTATION
```

Contributors must preserve the integrity of this lifecycle.

Avoid implementing isolated status changes when an existing workflow service, RPC, trigger, or transactional operation already exists.

---

# 5. Universal Workflow Principle

The platform should maintain a **single source of truth for business-critical workflows**.

For example:

```text
Project
   ↓
Matching / Discovery
   ↓
Invite or Proposal
   ↓
Contract
   ↓
Workspace
   ↓
Milestones
   ↓
Escrow / Payment
   ↓
Delivery
   ↓
Approval
   ↓
Completion
   ↓
Review / Reputation
```

Frontend components should not independently recreate business logic that belongs in:

* Workflow services
* Supabase RPC functions
* Database transactions
* Edge Functions
* Backend services

When modifying an existing workflow, first inspect the existing implementation and reuse it where possible.

---

# 6. Repository Structure

The project follows a modular application structure.

```text
src/
├── components/
├── pages/
├── hooks/
├── context/
├── lib/
├── services/
├── assets/
└── types/

supabase/
├── functions/
├── migrations/
└── config.toml

scripts/
.github/
docs/
public/
```

Important business logic should remain separated from presentation-layer components.

---

# 7. Development Environment

### Prerequisites

Install:

* Node.js 18+
* npm
* Git
* Supabase CLI where database or Edge Function work is required

Verify Node:

```bash
node --version
```

Verify npm:

```bash
npm --version
```

---

# 8. Local Setup

Clone the repository:

```bash
git clone https://github.com/Growlanzo-Official/Growlanzo.git
cd Growlanzo
```

Install dependencies:

```bash
npm install
```

Configure environment variables using the project's environment template.

Start the development server:

```bash
npm run dev
```

---

# 9. Environment Variables

Never commit secrets, credentials, private keys, or production tokens.

Typical environment configuration may include:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_RAZORPAY_KEY=
VITE_PAYPAL_CLIENT_ID=
VITE_SENTRY_DSN=
```

### Never commit:

* `.env`
* Production API keys
* Payment secrets
* Service-role keys
* Database passwords
* OAuth secrets
* Private signing keys
* KYC provider credentials

Use `.env.example` for documenting required configuration.

---

# 10. Branching Strategy

Use descriptive branches based on the t
