<div align="center">

<img src="./assets/updated banner.png" alt="Growlanzo Banner" width="100%"/>

<br/>

# 🚀 GROWLANCER

### AI-Powered Freelancing Marketplace

**Connecting businesses with skilled professionals through intelligent talent discovery, structured project workflows, secure transactions, and real-time collaboration.**

<br/>

[![Website](https://img.shields.io/badge/Website-Live-22c55e?style=for-the-badge\&logo=googlechrome\&logoColor=white)](https://growlanzo.com)
[![Status](https://img.shields.io/badge/Status-Beta-success?style=for-the-badge\&logo=rocket\&logoColor=white)]
[![License](https://img.shields.io/badge/License-Proprietary-2563eb?style=for-the-badge\&logo=github\&logoColor=white)]

<br/>

**Find Talent · Build Projects · Grow Together**

</div>

---

# 📑 Contents

* [Overview](#-overview)
* [Mission](#-mission)
* [Platform](#-platform)
* [Core Capabilities](#-core-capabilities)
* [Marketplace Workflow](#-marketplace-workflow)
* [Architecture](#-architecture)
* [Technology Stack](#-technology-stack)
* [Repository Structure](#-repository-structure)
* [Getting Started](#-getting-started)
* [Environment Configuration](#-environment-configuration)
* [Development & Validation](#-development--validation)
* [Security](#-security)
* [Contributing](#-contributing)
* [Issue Reporting](#-issue-reporting)
* [Project Status](#-project-status)
* [Live Platform](#-live-platform)
* [Leadership](#-leadership)
* [Contact](#-contact)
* [Documentation](#-documentation)
* [License](#-license)

---

# 🌐 Overview

**Growlanzo** is a technology-driven freelancing marketplace designed to simplify how businesses discover professional talent and how freelancers discover, manage, and deliver meaningful work.

The platform brings together:

> **Talent Discovery + AI Assistance + Contracts + Collaboration + Payments + Verification + Reputation**

into a unified professional workflow.

Growlanzo is being engineered around a structured marketplace model that supports users throughout the complete project lifecycle — from discovering an opportunity to completing work and establishing professional reputation.

### Product Focus

| Area                  | Objective                                            |
| --------------------- | ---------------------------------------------------- |
| 🎯 Talent Discovery   | Help businesses identify relevant professionals      |
| 🤖 AI Assistance      | Improve discovery and marketplace workflows          |
| 📋 Project Management | Structure project execution from start to completion |
| 🔐 Trust & Security   | Protect users, transactions, and platform data       |
| 💳 Payments           | Support structured and traceable transactions        |
| 💬 Collaboration      | Enable real-time professional communication          |
| 📊 Intelligence       | Provide analytics and operational visibility         |
| ⭐ Reputation          | Build long-term professional trust                   |

---

# 🎯 Mission

Growlanzo's mission is to make professional collaboration:

**Faster. Safer. More transparent. More intelligent.**

We aim to build a modern professional ecosystem where:

**Businesses**
can efficiently discover and engage skilled professionals.

**Freelancers**
can discover meaningful opportunities, execute projects through structured workflows, and build long-term professional reputation.

**Organizations**
can access a scalable digital infrastructure for modern talent engagement.

---

# 💼 Platform

Growlanzo is built as an integrated marketplace rather than a collection of disconnected features.

The platform is designed around a complete relationship lifecycle:

```text
Discovery
   ↓
Engagement
   ↓
Agreement
   ↓
Execution
   ↓
Transaction
   ↓
Delivery
   ↓
Reputation
```

This approach provides a consistent foundation for marketplace growth while keeping critical business workflows structured and traceable.

---

# ✨ Core Capabilities

<table>
<tr>
<td width="50%" valign="top">

### 🤖 AI Talent Matching

AI-assisted matching helps connect project requirements with relevant professional profiles using skills, experience, availability, requirements, and marketplace signals.

</td>

<td width="50%" valign="top">

### 📋 Project Management

Create, organize, and manage projects through structured workflows covering proposals, contracts, milestones, workspaces, delivery, and completion.

</td>
</tr>

<tr>
<td width="50%" valign="top">

### 💬 Real-Time Collaboration

Real-time communication, notifications, workspace activity, and project updates keep participants synchronized throughout execution.

</td>

<td width="50%" valign="top">

### 🔒 Secure Transactions

Structured payment and escrow workflows support milestone-based project execution and controlled financial operations.

</td>
</tr>

<tr>
<td width="50%" valign="top">

### 🛡 Verification & Trust

Identity verification, certificate verification, ratings, and reviews are designed to strengthen trust across the marketplace.

</td>

<td width="50%" valign="top">

### 📊 Analytics & Administration

Analytics and administrative tooling provide visibility into marketplace activity, operational performance, users, verification, and platform workflows.

</td>
</tr>

<tr>
<td width="50%" valign="top">

### 💼 Internship Marketplace

Internship-oriented workflows connect organizations and professionals through dedicated opportunity and engagement flows.

</td>

<td width="50%" valign="top">

### 🔔 Notification Infrastructure

Real-time notifications keep users informed about relevant project, marketplace, collaboration, payment, and account events.

</td>
</tr>
</table>

---

# 🔄 Marketplace Workflow

Growlanzo's core marketplace architecture follows a consistent lifecycle:

```text
                         ┌──────────────────┐
                         │     PROJECT      │
                         └────────┬─────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │ AI MATCHING / DISCOVERY │
                    └────────────┬─────────────┘
                                 │
                     ┌───────────┴───────────┐
                     ▼                       ▼
              ┌─────────────┐        ┌─────────────┐
              │ INVITATION  │        │  PROPOSAL   │
              └──────┬──────┘        └──────┬──────┘
                     │                      │
                     └──────────┬───────────┘
                                ▼
                         ┌─────────────┐
                         │  CONTRACT   │
                         └──────┬──────┘
                                │
                                ▼
                         ┌─────────────┐
                         │  WORKSPACE  │
                         └──────┬──────┘
                                │
                 ┌──────────────┼──────────────┐
                 ▼              ▼              ▼
             Milestones       Tasks      Collaboration
                 │
                 ▼
          ┌───────────────┐
          │ESCROW / PAYMENT│
          └───────┬───────┘
                  │
                  ▼
             ┌──────────┐
             │ DELIVERY │
             └────┬─────┘
                  │
                  ▼
            ┌────────────┐
            │ COMPLETION │
            └─────┬──────┘
                  │
                  ▼
        ┌────────────────────┐
        │ REVIEWS & REPUTATION│
        └────────────────────┘
```

Critical marketplace operations are designed around centralized workflow logic to reduce inconsistent state transitions and preserve data integrity.

---

# 🏗 Architecture

Growlanzo uses a modular architecture separating the user interface, application logic, workflow services, infrastructure, and persistence layers.

```text
┌───────────────────────────────────────────────────────┐
│                    CLIENT LAYER                       │
│                                                       │
│        React · TypeScript · Vite · Tailwind          │
│                                                       │
│      Components · Pages · Hooks · Context             │
└───────────────────────────┬───────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────┐
│                APPLICATION LAYER                      │
│                                                       │
│       Services · Business Logic · Workflows           │
│       Validation · Shared Utilities                   │
└───────────────────────────┬───────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────┐
│                  PLATFORM LAYER                       │
│                                                       │
│                  SUPABASE                             │
│                                                       │
│  Auth · PostgreSQL · Storage · Realtime · Functions  │
│  Row Level Security · Database Workflows              │
└───────────────┬─────────────────────────┬─────────────┘
                │                         │
                ▼                         ▼
      ┌──────────────────┐       ┌───────────────────┐
      │ Payment Services │       │  Observability    │
      │                  │       │                   │
      │ Razorpay         │       │ Sentry            │
      │ PayPal           │       │ Monitoring        │
      └──────────────────┘       └───────────────────┘
```

The architecture is designed to support maintainability, workflow consistency, production observability, and future scalability.

---

# 🛠 Technology Stack

<div align="center">

### Frontend

<img src="https://skillicons.dev/icons?i=react,typescript,vite,tailwind&perline=4" alt="Frontend Technology Stack"/>

<br/><br/>

### Backend & Infrastructure

<img src="https://skillicons.dev/icons?i=supabase,postgres,nodejs,express&perline=4" alt="Backend Technology Stack"/>

<br/><br/>

### Engineering & Deployment

<img src="https://skillicons.dev/icons?i=github,vercel,docker&perline=4" alt="Engineering Technology Stack"/>

</div>

| Category              | Technology              |
| --------------------- | ----------------------- |
| 🖥 Frontend           | React                   |
| 📘 Language           | TypeScript              |
| ⚡ Build Tool          | Vite                    |
| 🎨 Styling            | Tailwind CSS            |
| 🧩 Backend Platform   | Supabase                |
| 🖧 Application Server | Express                 |
| 🗄 Database           | PostgreSQL              |
| 🔑 Authentication     | Supabase Auth           |
| 📦 Storage            | Supabase Storage        |
| 📡 Realtime           | Supabase Realtime       |
| ⚙ Serverless          | Supabase Edge Functions |
| 💳 Payments           | Razorpay & PayPal       |
| 📈 Monitoring         | Sentry                  |
| 🧪 Testing            | Vitest                  |
| 🧹 Code Quality       | ESLint & Prettier       |
| ☁ Deployment          | Vercel & Supabase       |
| 🔧 Source Control     | GitHub                  |

---

# 📂 Repository Structure

```text
Growlanzo/
│
├── src/
│   ├── components/
│   ├── pages/
│   ├── hooks/
│   ├── context/
│   ├── lib/
│   ├── services/
│   ├── assets/
│   └── types/
│
├── supabase/
│   ├── functions/
│   ├── migrations/
│   └── config.toml
│
├── public/
├── scripts/
├── .github/
│   ├── workflows/
│   └── ISSUE_TEMPLATE/
│
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

The codebase is organized to keep presentation, shared application logic, services, infrastructure configuration, and database changes independently maintainable.

---

# 🚀 Getting Started

## Prerequisites

Ensure the development environment includes:

* **Node.js 18+**
* **npm**
* **Git**
* **Supabase CLI**, where required for database and Edge Function development

Verify the environment:

```bash
node --version
npm --version
git --version
```

---

## Clone Repository

```bash
git clone https://github.com/Growlanzo-Official/Growlanzo.git
```

```bash
cd Growlanzo
```

---

## Install Dependencies

```bash
npm install
```

---

## Start Development Server

```bash
npm run dev
```

Use the local development URL provided by Vite after startup.

---

# 🔐 Environment Configuration

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_RAZORPAY_KEY=
VITE_PAYPAL_CLIENT_ID=
VITE_SENTRY_DSN=
```

### Security Requirements

Never commit:

* Production secrets
* API credentials
* Supabase service-role keys
* Payment secrets
* Private signing keys
* Authentication credentials
* Sensitive environment configuration

Use environment-specific configuration for development and production.

---

# 🧪 Development & Validation

Before submitting a change, run the relevant project validation commands.

### Type Checking

```bash
npm run typecheck
```

### Linting

```bash
npm run lint
```

### Tests

```bash
npm test
```

### Build Validation

```bash
npm run build:check
```

### Production Build

```bash
npm run build
```

Changes affecting authentication, authorization, payments, database structure, security controls, or core marketplace workflows should receive additional review.

---

# 🔐 Security

Security is a fundamental requirement of the Growlanzo platform.

Security-sensitive areas include:

* 🔑 Authentication and authorization
* 🛡 Identity and account verification
* 🗄 Database access controls
* 📁 Private project and file data
* 💳 Payment processing
* 🔒 Escrow workflows
* 💰 Withdrawals and payouts
* 📡 Realtime communication
* 🧩 Marketplace integrity
* 🔐 Secret and credential management

Growlanzo uses platform security controls including authentication mechanisms, database authorization, Row Level Security, protected server-side operations, secure environment configuration, and application monitoring.

### Vulnerability Reporting

**Do not report security vulnerabilities through public GitHub Issues or Pull Requests.**

Please follow the responsible disclosure process defined in:

**[SECURITY.md](./SECURITY.md)**

---

# 🤝 Contributing

Growlanzo is currently under active development and follows a controlled contribution model.

The repository contains proprietary application logic, marketplace workflows, security controls, financial infrastructure, and evolving platform architecture.

Before contributing, please review:

**[CONTRIBUTING.md](./CONTRIBUTING.md)**

Contributions should preserve existing:

* Architecture
* Security controls
* Database integrity
* Marketplace workflows
* Production reliability
* Maintainability standards

---

# 🐛 Issue Reporting

GitHub Issues should be used for legitimate product and engineering discussions, including:

* 🐞 Bug reports
* 💡 Feature requests
* 🔧 Technical issues
* 📈 Improvement proposals

Please use the repository's issue templates and include enough technical information for maintainers to reproduce and evaluate the request.

> **Security vulnerabilities must be reported privately through the security reporting process.**

---

# 📌 Project Status

| Area                        | Status             |
| --------------------------- | ------------------ |
| 🚀 Platform                 | Beta               |
| 🧑‍💻 Development           | Active             |
| 🇮🇳 Launch Direction       | India-first        |
| 🔄 Marketplace Workflows    | Active Development |
| 🔐 Security Hardening       | In Progress        |
| 💳 Payment Infrastructure   | Active Development |
| 🛡 Verification Systems     | Active Development |
| 📡 Real-Time Infrastructure | Active Development |
| 📊 Analytics & Operations   | Active Development |
| ⚡ Performance & Scalability | Active Development |

Growlanzo is being continuously developed toward a production-grade professional marketplace infrastructure.

---

# 🌐 Live Platform

<div align="center">

[![Visit Growlanzo](https://img.shields.io/badge/Visit%20Growlanzo-22c55e?style=for-the-badge\&logo=googlechrome\&logoColor=white)](https://growlanzo.com)

**https://growlanzo.com**

</div>

---

# 👨‍💻 Leadership

<div align="center">

### Mohammad Miran Khan

**Founder & CEO — Growlanzo**

</div>

---

# 📧 Contact

<div align="center">

[![Website](https://img.shields.io/badge/Website-growlanzo.com-22c55e?style=for-the-badge\&logo=googlechrome\&logoColor=white)](https://growlanzo.com)

[![Email](https://img.shields.io/badge/Email-support@growlanzo.com-2563eb?style=for-the-badge\&logo=gmail\&logoColor=white)](mailto:support@growlanzo.com)

[![Twitter](https://img.shields.io/badge/X-Twitter-000000?style=for-the-badge\&logo=x\&logoColor=white)](https://x.com/Growlanzo)
[![Instagram](https://img.shields.io/badge/Instagram-E4405F?style=for-the-badge\&logo=instagram\&logoColor=white)](https://www.instagram.com/invites/contact/?utm_source=ig_contact_invite&utm_medium=copy_link&utm_content=6xoewwb)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Growlanzo-0A66C2?style=for-the-badge\&logo=linkedin\&logoColor=white)](https://www.linkedin.com/company/growlancercom/)

</div>

---

# 📚 Documentation

| Document                                | Purpose                                                |
| --------------------------------------- | ------------------------------------------------------ |
| 📖 [README.md](./README.md)             | Product, architecture, setup, and engineering overview |
| 🤝 [CONTRIBUTING.md](./CONTRIBUTING.md) | Contribution process and engineering standards         |
| 🔐 [SECURITY.md](./SECURITY.md)         | Security policy and vulnerability disclosure           |

---

# ⚖️ License

Copyright © 2026 Growlanzo.

**All Rights Reserved.**

This repository contains proprietary software owned by Growlanzo.

Unless expressly authorized in writing, no part of this repository may be:

* Copied
* Modified
* Distributed
* Republished
* Resold
* Commercially exploited
* Reverse engineered for competing purposes

Access to this repository does not grant ownership, licensing, or commercial usage rights.

For authorized licensing, partnership, or commercial usage inquiries, please contact Growlanzo through the official contact channels.

---

<div align="center">

<br/>

<img src="https://cdn.simpleicons.org/github/181717" width="24" alt="GitHub"/>
&nbsp;&nbsp;
<img src="https://cdn.simpleicons.org/react/61DAFB" width="24" alt="React"/>
&nbsp;&nbsp;
<img src="https://cdn.simpleicons.org/typescript/3178C6" width="24" alt="TypeScript"/>
&nbsp;&nbsp;
<img src="https://cdn.simpleicons.org/supabase/3ECF8E" width="24" alt="Supabase"/>

<br/><br/>

# GROWLANCER

### AI-Powered Freelancing Infrastructure

**Intelligent Talent Discovery · Structured Project Execution · Secure Transactions**

<br/>

<sub>
Building the infrastructure for modern professional collaboration.
</sub>

<br/><br/>

<sub>
© 2026 Growlanzo. All rights reserved.
</sub>

</div>
