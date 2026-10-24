# AVOS Risk Register & Prototype Audit

**Version:** 1.0.0  
**Last Updated:** 2026-10-25

---

## 1. Prototype Security Audit (Insecure Shortcuts Identified)

An audit of the initial prototype concepts and starter patterns identified the following high-risk shortcuts:

| Shortcut ID | Description in Prototype | Risk Level | Remediated in AVOS Core |
|---|---|---|---|
| **PS-01** | Identity asserted via request body (e.g. `{ "approver": "owner" }`). | **CRITICAL** | Replaced with HTTP Bearer token authentication verified via constant-time crypto comparison. Body claims are discarded. |
| **PS-02** | In-memory or raw JSON task storage without transactional locking. | **HIGH** | Replaced with ACID transactional storage (PostgreSQL schema + robust repository pattern with optimistic locking). |
| **PS-03** | Lack of execution boundary: policy checked only at API submission, not at execution time. | **CRITICAL** | Implemented `ExecutionGateway` which enforces Emergency Stop, action policy, budget, and idempotency immediately before any runtime dispatch. |
| **PS-04** | Overly broad permissions (e.g. connecting an account granted publishing and messaging rights). | **HIGH** | Granular action classes (`account.connect`, `social.draft`, `social.publish`, `social.message`) with strict deny-by-default. |
| **PS-05** | No idempotency checks on retries, leading to duplicate external actions on worker crash. | **HIGH** | Persistent idempotency table with state locking (`PENDING`, `EXECUTING`, `COMPLETED`). |
| **PS-06** | Ephemeral Emergency Stop flag lost upon process restart. | **CRITICAL** | Emergency Stop persisted to durable storage and verified synchronously on every action execution. |
| **PS-07** | Automaton runtime uncontained (capability for shell execution, wallet creation, automatic top-ups). | **CRITICAL** | Automaton adapter is sandboxed; autonomous bootstrap commands disabled; strict capability allowlist. |

---

## 2. Active Risk Register

| Risk ID | Category | Risk Description | Severity | Likelihood | Impact | Mitigation Strategy | Owner / Status |
|---|---|---|---|---|---|---|---|
| **R-01** | Financial | AWS or API costs exceed planned budget ($50/month target). | High | Medium | High | Hard cost ceilings tracked in `budget_ledger`. Workers refuse execution if project or monthly cap is exceeded. | AVOS Core / **Mitigated** |
| **R-02** | Security | Malicious prompt injection executes arbitrary shell commands via runtime. | Critical | Medium | Critical | Action `shell.execute` is blocked by default; ExecutionGateway enforces approval scope; sandbox isolation. | Gateway / **Mitigated** |
| **R-03** | Compliance | Social media content published without human owner sign-off. | High | Low | High | `social.publish` is gated behind non-transferable, time-limited owner approval. `social.draft` does not grant publish right. | Policy / **Mitigated** |
| **R-04** | Operational | Worker crashes during third-party API transaction leaving state ambiguous. | Medium | Medium | Medium | Two-phase idempotency lock and state reconciliation before any automated retry. | Queue / **Mitigated** |
| **R-05** | Reliability | Database outage halts task processing and loses queued jobs. | High | Low | High | PostgreSQL durable queue with lease renewal and transaction-backed transitions. | Storage / **Mitigated** |
| **R-06** | Third-party | Automaton bootstrap creates cryptocurrency wallet or performs Conway credit purchases. | Critical | Medium | High | Automaton integration strictly gated; bootstrap disabled; mock adapter used for test verification. | Adapter / **Mitigated** |
| **R-07** | Stale Data | Assumed $120 AWS credit expires or does not cover specific services (e.g. static IP, Route53). | Medium | High | Low | Infrastructure options documented with exact non-credit prices. Validation required before provisioning. | Infra / **Open** |

---

## 3. Assumptions & Unresolved Owner Decisions

### Assumptions Made
1. **Local & Staging Environment:** Development and automated verification run locally using TypeScript (Node 22) and PostgreSQL (via Docker or local instance). Unit and integration tests run with an in-memory test database fixture for 100% hermetic isolation.
2. **Owner Role:** A single owner token governs administrative rights and approvals for gated actions.
3. **Automaton Runtime:** Automaton will only be integrated via a sandboxed adapter interface. No interactive bootstrap or wallet provisioning will be executed without explicit owner approval.
4. **Default Budgets:**
   - Default experiment budget: $20.00
   - Monthly soft/hard spend limit: $50.00
   - Experiment duration: 14 days

### Decisions Requiring Owner Input Before Production
1. **Production Infrastructure Choice:** Review Option 1 (Low-cost staging VPS/Lightsail @ ~$15/mo) vs Option 2 (AWS ECS Fargate + RDS @ ~$85/mo) in `INFRA-COSTS.md`.
2. **AWS Credit Balance:** Owner to verify the current exact balance and expiration date of the reported $120 AWS credits.
3. **Domain / DNS Integration:** Whether ITCertHub automation requires direct API keys or will operate in export-only / draft mode initially.
