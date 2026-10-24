# AVOS — Autonomous Venture Operating System

**AVOS** (Autonomous Venture Operating System) is a runtime-independent control plane for managing autonomous business ventures (e.g., ITCertHub and new incubation ventures). It orchestrates planning, task delegation, and execution across AI agent runtimes while strictly enforcing safety boundaries, human owner approvals, hard budget ceilings, persistent idempotency, and an immediate Emergency Stop in hard code.

---

## 1. Key Architectural Guarantees

1. **Policy in Code, Not Prompts:** Security, action limits, and permissions are enforced at the execution boundary (`ExecutionGateway`) in compiled code. Prompts alone never govern permissions.
2. **Deny-by-Default:** Any unlisted action class is denied immediately.
3. **Owner Approval Boundary:** High-impact or external actions (`social.publish`, `purchase`, `ads.launch`, `infrastructure.create`, `shell.execute`, `agent.fund`, `financial.transfer`) require an active, unexpired cryptographic approval matching the exact resource, target, budget ceiling, and parameters hash.
4. **No Body-Spoofing:** Identity is established exclusively via Bearer tokens checked via constant-time crypto comparison. Claims inside request bodies (such as `{ "approver": "owner" }`) are strictly ignored.
5. **Durable Idempotency & Two-Phase Locking:** Duplicate submissions return cached responses; concurrent attempts are blocked; worker crash recovery does not re-execute side effects.
6. **Hard Cost Ceilings:** Real-time ledger enforcement against per-project and global monthly budget caps (e.g. $50/month target).
7. **Synchronous Emergency Stop:** Halts all external-impacting operations immediately; safe read-only diagnostics remain accessible; recovery requires root-cause investigation sign-off.
8. **Sandboxed Automaton Adapter:** Prohibits wallet generation, automatic funding, Conway credit purchases, or unrestricted shell operations.

---

## 2. Directory Structure

```
.
├── .github/workflows/ci.yml       # GitHub Actions CI pipeline
├── docs/
│   ├── AGENT_RULES.md             # Non-negotiable agent execution rules
│   ├── ARCHITECTURE.md            # Detailed system architecture specification
│   ├── DEPLOYMENT.md              # Stage gates & deployment instructions
│   ├── INFRA-COSTS.md             # Infrastructure options & cost analysis
│   ├── PRD.md                     # Product Requirements Document
│   ├── RISK_REGISTER.md           # Prototype audit & active risk register
│   ├── RUNBOOK.md                 # Operations, Emergency Stop & disaster recovery
│   ├── SECURITY.md                # Security policies & authorization specifications
│   ├── STATUS.md                  # Detailed task tracking & evidence report
│   └── THREAT_MODEL.md            # STRIDE threat model & mitigations
├── migrations/
│   └── 001_initial_schema.sql     # Versioned PostgreSQL datastore schema
├── src/
│   ├── adapters/                  # Runtime adapters (IRuntimeAdapter, Mock, Automaton sandbox)
│   ├── api/                       # Fastify HTTP Control Plane & REST routes
│   ├── config/                    # Environment & configuration loader
│   ├── core/
│   │   ├── audit/                 # Append-only hash-chained audit logger
│   │   ├── budget/                # Cost ledger & budget ceiling service
│   │   ├── emergency/             # Persistent Emergency Stop service
│   │   ├── models/                # Typed domain models & Zod schemas
│   │   ├── policy/                # Policy engine & action gating
│   │   └── security/              # Auth, constant-time compare & secret redactor
│   ├── gateway/                   # ExecutionGateway (critical security action boundary)
│   ├── queue/                     # Durable queue with leases, backoff & dead-lettering
│   ├── reporting/                 # Daily executive summary generator
│   ├── storage/                   # Storage repositories (PostgreSQL & hermetic InMemory)
│   └── index.ts                   # Main application entry point & graceful shutdown
├── tests/                         # Comprehensive Vitest test suite
├── docker-compose.yml             # Local staging environment (PostgreSQL + AVOS Core)
├── Dockerfile                     # Multi-stage production container build
├── package.json
└── tsconfig.json
```

---

## 3. Getting Started

### Prerequisites
- **Node.js:** v22+ (tested with v22.18.0)
- **npm:** 10+ (tested with 10.9.3)
- **Docker & Docker Compose** (for PostgreSQL staging)

### Installation
```bash
git clone <repository_url>
cd AVOS-AI-Agent-Handoff
npm install
```

### Environment Configuration
Copy the template and configure your local environment:
```bash
cp .env.example .env
```
*Note: `.env.example` contains placeholders only. Never commit `.env` or real secrets to Git.*

---

## 4. Running Tests

The test suite covers security/policy enforcement, body-spoofing rejection, Emergency Stop, idempotency locks, worker failure recovery, runtime adapter contracts, and REST API endpoints.

```bash
# Run all tests (Hermetic in-memory datastore, zero external dependencies)
npm test

# Run tests with coverage
npm run test:coverage
```

---

## 5. Running the Application

### Local Development Mode
```bash
npm run dev
```

### Building for Production
```bash
npm run build
npm start
```

### Running with Docker Compose (PostgreSQL Staging)
```bash
# 1. Start PostgreSQL
docker compose up -d postgres

# 2. Run SQL migrations
npm run db:migrate

# 3. Start AVOS Core container
docker compose up -d avos-core
```

---

## 6. API Quick Reference

All administrative and gated API endpoints require the header:  
`Authorization: Bearer <AVOS_OWNER_TOKEN>`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Public liveness & worker readiness check |
| `GET` | `/api/projects` | List active venture projects |
| `POST` | `/api/projects` | Create a new isolated venture project |
| `GET` | `/api/tasks` | Query tasks (filter by project or status) |
| `POST` | `/api/tasks` | Submit task (enforces idempotency key) |
| `GET` | `/api/approvals` | List pending/approved owner approval requests |
| `POST` | `/api/approvals/:id/approve` | Authorize a gated task |
| `POST` | `/api/approvals/:id/reject` | Reject and cancel a gated task |
| `GET` | `/api/emergency/status` | Inspect current Emergency Stop status |
| `POST` | `/api/emergency/stop` | Trigger immediate Emergency Stop |
| `POST` | `/api/emergency/resume` | Resume operations after verified recovery |
| `GET` | `/api/reports/daily` | Generate daily executive summary report |
| `GET` | `/api/audit` | Query immutable hash-chained audit events |

---

## 7. Troubleshooting & Operational Guide

See [RUNBOOK.md](docs/RUNBOOK.md) for full procedures on:
- Emergency Stop trigger and resumption verification.
- Database backup and recovery (`pg_dump` and `pg_restore`).
- Worker crash analysis and dead-letter queue investigation.
- Infrastructure cost monitoring and AWS credit tracking ([INFRA-COSTS.md](docs/INFRA-COSTS.md)).
