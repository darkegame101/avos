# AVOS Deployment Plan & Stage Gates

**Version:** 1.0.0  
**Enforcement:** Non-negotiable acceptance gates per `AVOS_MASTER_BUILD_BRIEF.md`

---

## 1. Acceptance Stage Gates

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    GATE 1    │ ──> │    GATE 2    │ ──> │    GATE 3    │ ──> │    GATE 4    │ ──> │    GATE 5    │
│ Local Core & │     │Secure Staging│     │   Automaton  │     │  Production  │     │  Production  │
│ Unit/Int Tests│     │ (Postgres+UI)│     │Sandbox Test  │     │  Readiness   │     │  Deployment  │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
   [VERIFIED]           [IN PROGRESS]         [GATED]              [GATED]          [OWNER APPROVAL]
```

### Gate 1: Local Core & Complete Test Suite (Target: Local verified)
- **Criteria:** All unit, integration, policy, idempotency, failure-injection, and Emergency Stop tests pass.
- **Verification:** Hermetic test run with zero external side effects.

### Gate 2: Secure Staging Environment
- **Criteria:** PostgreSQL database initialized with versioned migrations, durable queue running, API authenticated via Bearer token, Mock adapter handling end-to-end tasks.
- **Verification:** Health endpoints return `200 OK` with database and worker statuses reported as healthy.

### Gate 3: Sandboxed Automaton Runtime Integration
- **Criteria:** Automaton adapter audited; capability allowlist enforced; no wallet or fund creation permitted; sandbox boundary verified with failure injection.
- **Verification:** Attempted unauthorized actions (`shell.execute`, `agent.fund`) blocked at the gateway.

### Gate 4: Production Readiness
- **Criteria:** Runbooks, backup/restore verified, secret management documented, cost monitoring alarms set.
- **Verification:** Simulated disaster recovery and state restoration test.

### Gate 5: Production Cloud Deployment
- **Criteria:** EXPLICIT HUMAN OWNER APPROVAL required for target provider, instance size, monthly cost limit, and deployment window.
- **Rule:** Agent must NOT initiate paid provisioning without signed approval.

---

## 2. Local & Staging Deployment Instructions

### Prerequisites
- Node.js 22+ (verified: v22.18.0)
- npm 10+ (verified: 10.9.3)
- Docker & Docker Compose (optional for local staging DB)

### Quickstart (Local Test Mode)
```bash
# 1. Install dependencies
npm install

# 2. Run test suite (hermetic in-memory db)
npm test

# 3. Start local AVOS server
npm run dev
```

### Staging with Docker Compose (PostgreSQL)
```bash
# 1. Configure environment
cp .env.example .env

# 2. Start PostgreSQL container
docker compose up -d postgres

# 3. Run database migrations
npm run db:migrate

# 4. Start AVOS Core & Worker
docker compose up -d avos-core
```
