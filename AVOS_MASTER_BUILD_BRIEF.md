# AVOS — Master Build Brief for AI Coding Agent

**Purpose:** Build AVOS (Autonomous Venture Operating System) from the current prototype into a tested, secure, deployable system. This document is the source-of-truth handoff for the implementation agent.

## 0. Instructions to the coding agent

Work autonomously on repository code, tests, documentation, and local development setup. Do not stop to ask the owner to choose ordinary technical details. Make reversible engineering decisions, document assumptions, and present at least two viable options with costs/pros/cons when a decision requires owner resources or materially affects cost, risk, or scope.

**Do not claim work is complete unless it is implemented and verified.** Run tests and report commands/results. Keep a `STATUS.md` updated with completed, in-progress, blocked, and unverified items.

### Non-negotiable safety rules
- Do not deploy to production, create paid cloud resources, purchase services, top up accounts, transfer funds, launch ads, publish social content, send messages, change DNS/domains, or connect real accounts unless the owner explicitly approves that specific action and its scope.
- Do not ask for passwords, private keys, access tokens, or cloud secrets in chat or commit them to Git. Use a secret manager or local environment variables and provide `.env.example` with placeholders only.
- Do not execute Automaton's interactive bootstrap or any command that may create a wallet, provision an API key, or make a $5 top-up until reviewed and separately approved.
- Do not disable, bypass, weaken, split, or route around approvals by using another runtime, worker, child agent, tool, or project.
- Emergency Stop must block all external-impacting actions at the actual execution/tool boundary. Read-only diagnostics may continue if safe.
- A connected account is not blanket permission. Permissions must be scoped per account, action type, project, budget, duration, and revocation condition.
- Never allow model prompts alone to enforce policy. Enforce policy in code at the action boundary.
- Do not allow unrestricted shell, arbitrary network access, self-modification, tool installation, git push, child-agent spawning/funding, financial transfers, x402 payments, domain/DNS operations, or production changes by default.
- Use synthetic/mock accounts and sandbox integrations for tests. No real-world side effects in tests.
- Record actual cost separately from estimates; do not invent spend or business results.

## 1. Product definition

AVOS is a runtime-independent operating system for autonomous business projects.

### Initial use cases
1. **ITCertHub:** the existing website/backend is maintained by the owner. AVOS should focus on research, marketing, content planning, approved content distribution, growth measurement, and conversion/profit analysis. Do not rebuild its backend unless separately requested.
2. **New ventures:** research opportunities, compare evidence, develop business plans, build MVPs, run bounded experiments, and manage projects after explicit scope/budget approval.
3. **Portfolio management:** compare projects on net profit, margin, ROI, payback period, risk, and stability—not revenue alone.

### Autonomy
Target autonomy level 3: AVOS can research, plan, build prototypes, run tests, and operate within an approved scope. Actions with external impact or elevated risk must pass explicit policy and approval checks.

### User/owner
The human owner is the sole approver for gated actions. No agent, runtime, or worker may approve its own action or act as the owner.

## 2. Current state and caveats

A local prototype exists separately and may be supplied with this brief. It is not production-ready. It has a small JSON-based task store, basic task/approval/Emergency Stop logic, a local HTTP API, and a few tests. It does not provide production authentication, PostgreSQL, a real queue, a production worker pool, Automaton adapter, social integrations, or cloud deployment. Treat all prototype code as untrusted starter code; audit it before extending it.

A public-documentation audit of `https://github.com/Conway-Research/automaton` found an autonomous runtime with internal SQLite state, heartbeat, wallet/API provisioning, shell/file operations, self-modification, tool installation, git push, child-agent spawning/funding, Conway credit/domain operations, x402/financial actions. Verify the exact repository commit, current license, commands, and implementation before integrating. Do not assume documentation guarantees runtime behavior.

## 3. Required architecture

Keep AVOS Core independent of any single runtime.

### Core services
- API/control plane
- Task and workflow service
- Scheduler
- Policy and approval service
- Project registry and project isolation
- Budget and cost ledger
- Audit/evidence service
- Runtime adapter registry
- Reporting/metrics service
- Emergency Stop/recovery service

### Execution plane
- Durable task queue
- Worker manager
- Runtime adapters (Automaton first, mock adapter mandatory)
- Research/browser/API execution workers
- Result validation and evidence capture
- Retry, timeout, cancellation, heartbeat, idempotency

### Data
- PostgreSQL is the canonical AVOS datastore.
- Automaton's own SQLite remains a separate runtime-owned store initially. Do not merge the databases.
- Use versioned SQL migrations.
- Store task state, approval requests, policy versions, project scope, budget ledger, evidence, audit events, runtime/job identifiers, and cost telemetry.
- Store secrets outside the database where possible, using a secrets manager or protected environment configuration.
- Project data and credentials must be isolated; tests must verify cross-project access is denied.

### Runtime Adapter contract
Define a typed interface that supports at minimum:
- `capabilities()`
- `submit(task, idempotencyKey, context)`
- `status(runtimeTaskId)`
- `cancel(runtimeTaskId)`
- `result(runtimeTaskId)`
- `evidence(runtimeTaskId)`
- `health()`
- `cost(runtimeTaskId)`
- structured error classification

Include a mock adapter and contract tests. Runtime replacement must not lose AVOS task history, policy, approvals, audit trail, or project state.

### Worker behavior
- Durable queue; bounded concurrency; per-project and global limits.
- Lease/heartbeat or equivalent worker liveness tracking.
- Timeouts, exponential backoff with jitter, max retries, dead-letter state, cancellation.
- Idempotency keys persisted in the database and passed to adapters.
- Never blindly retry a non-idempotent external action. If outcome is uncertain, reconcile status/evidence before retry.
- Persist state transitions transactionally where possible.
- Capture execution evidence and structured errors.
- Handle worker crash/restart without duplicate side effects.

## 4. Permissions, approvals, and budgets

### Action policy
Define action classes, at minimum:
- `read.public`
- `read.internal`
- `account.connect`
- `social.draft`
- `social.publish`
- `social.message`
- `ads.launch`
- `purchase`
- `infrastructure.create`
- `production.change`
- `domain.dns.change`
- `financial.transfer`
- `runtime.self_modify`
- `tool.install`
- `agent.spawn`
- `agent.fund`
- `shell.execute`

Use deny-by-default. Each capability must be explicitly granted and scoped. `social.draft` does not imply `social.publish`; connecting an account does not grant publishing or messaging rights.

### Approval request must include
- project and account/resource
- exact action and target
- rationale and evidence
- scope and expected side effects
- estimated cost and worst-case cost
- budget ceiling
- expiration/duration
- rollback/recovery plan
- revocation conditions
- idempotency/reconciliation plan where applicable

Approvals must be bound to a specific action/scope and expire. Changing target, action type, budget, or scope requires a new approval. Pending approval must not block unrelated safe work, but the gated action must remain blocked. Waiting or repeated attempts never count as approval.

### Initial budget defaults (configurable)
- Experiment duration: 14 days.
- Reference experiment budget: $5–$20.
- Any experiment above $20 requires explicit owner approval.
- Monthly reserve target: $20.
- Track project, experiment, infrastructure, and shared costs separately; roll shared infrastructure into total portfolio spend.
- User previously reported $120 AWS credit remaining. Treat this as user-provided and potentially stale; verify current balance before relying on it. Credits are not cash and do not cover every AWS charge.
- A previous monthly target of $50 was discussed. Do not silently treat it as a hard cap or combine it inconsistently with experiment budgets; document the proposed total monthly cap and obtain owner approval before enforcing it in production.
- Block spend above the effective approved cap. No top-ups or paid upgrades without approval.
- Report estimates and actuals separately.

### Emergency Stop
- Global and optionally project-scoped stop.
- Must be enforced in the execution gateway immediately before any external-impacting action.
- Stop new submissions, publication, messages, purchases, transfers, provisioning, and other external effects.
- Cancel queued work where safe; request cancellation of running work; reconcile in-flight outcomes.
- Read-only monitoring/reporting may continue if safe.
- Recovery requires checking root cause, state consistency, outstanding approvals, budget, and credentials; owner approval is required before resuming external actions.
- Audit who activated/deactivated it, when, reason, and affected tasks.

## 5. Product requirements

1. Create/update/cancel tasks and view task state/history.
2. Plan and schedule work, with explicit scope and success criteria.
3. Opportunity research includes sources/evidence, assumptions, confidence, downside risks, cost, time-to-test, and ranked alternatives.
4. Every proposed experiment includes hypothesis, metric, duration, budget, stop conditions, and decision rule.
5. Run tasks through adapters and bounded workers; capture evidence and results.
6. Isolate projects, their data, credentials, budgets, and permissions.
7. Track estimated and actual spend, net profit, margin, ROI, payback, and risk.
8. Approval inbox shows pending/approved/rejected/expired/revoked requests.
9. Audit log records task transitions, tool/action calls, policy decisions, approvals, evidence, cost, errors, and stop/recovery.
10. Daily report summarizes progress, blockers, approvals needed, spend, results, and next actions.
11. Continue safe independent work when a separate task awaits approval.
12. Provide dashboard/API health, worker health, queue depth, retry/dead-letter counts, and cost telemetry.
13. No unverified result may be represented as a verified business outcome.

## 6. Required tests and acceptance criteria

Implement unit, integration, adapter-contract, and failure-injection tests. Use a test database and fake adapters.

### Security/policy
- Unauthenticated requests are rejected.
- Non-owner cannot approve gated actions.
- Owner identity cannot be asserted by a request body field such as `{ "approver": "owner" }`.
- Deny-by-default for unknown actions.
- An approval only authorizes its exact scope, action, target, project, budget, and expiry.
- Approval expiry/revocation blocks execution.
- Switching runtime/worker/project cannot bypass policy.
- Cross-project access is denied.
- Secrets are never emitted in logs or API responses.

### Idempotency/reliability
- Duplicate submission with same idempotency key returns the same logical task/result.
- Concurrent duplicate requests do not create duplicate side effects.
- Worker crash before execution, during execution, and after side effect but before acknowledgement are handled.
- Uncertain external outcomes are reconciled before retry.
- Retry limit, backoff, timeout, cancellation, and dead-letter behavior are tested.
- Restart/recovery preserves task state and audit history.

### Emergency Stop
- Stop blocks a new external action.
- Stop blocks a queued task at execution time.
- Stop during worker execution prevents subsequent external actions and reconciles in-flight outcome.
- Stop remains effective after API/worker restart.
- Resume requires proper owner approval and validation.

### Operations
- Database migrations and backup/restore procedure tested.
- Health/readiness endpoints reflect database/queue/worker state.
- Structured logs, metrics, and redaction.
- Cost ceiling enforced even under concurrent tasks.
- CI runs lint/typecheck/unit/integration/security tests.
- Clean installation instructions verified on a fresh environment.

### Acceptance gates
- **Gate 1 — Local prototype:** all tests pass; no real external side effects.
- **Gate 2 — Secure staging:** real authentication, PostgreSQL, queue, mock adapter; all policy and failure tests pass.
- **Gate 3 — Runtime integration:** Automaton adapter runs only in a restricted sandbox; capability allowlist and execution gateway verified.
- **Gate 4 — Production readiness:** deployment, secrets, monitoring, backup/restore, incident recovery, cost caps and rollback documented and tested.
- **Gate 5 — Production deployment:** only after a separate explicit owner approval for provider, resources, region, maximum spend, and deployment window.

## 7. Infrastructure planning

Produce at least two comparable options with:
- provider, region, CPU/RAM, storage, network, database, queue, backups, monitoring, security controls
- monthly estimates with assumptions and date checked
- one-time/setup costs and variable charges
- what is covered/not covered by the $120 AWS credit (after verification)
- scaling path and operational burden
- recommendation and reason

Previous rough AWS compute estimates supplied by the owner (not verified current pricing):
- `m7i-flex.large`: $0.09576/hour, roughly $68.95 per 720-hour month.
- `t3.small`: $0.0208/hour, roughly $14.98 per 720-hour month.
- One `m7i-flex.large` plus one `t3.small`: roughly $83.93/month compute only.
- One `m7i-flex.large` plus two `t3.small`: roughly $98.90/month compute only.
These exclude storage, public IPv4, traffic, snapshots, database/queue services, tax, and other charges. Re-check current prices and region before recommending. Do not provision resources just to validate pricing.

Recommend a low-cost staging setup before always-on production. Browser automation is resource-heavy; distinguish logical agents from concurrent browser sessions and load-test before setting concurrency. Use strict limits initially.

## 8. Suggested implementation order

1. Audit the starter repository and create a risk register.
2. Add typed domain models, API validation, authentication/authorization design, and versioned database migrations.
3. Implement policy/approval service and action-boundary gateway.
4. Implement task service, transactional state transitions, idempotency, audit and cost ledger.
5. Implement durable queue, worker manager, retry/cancel/heartbeat/dead-letter.
6. Implement mock runtime adapter and contract tests.
7. Implement Emergency Stop and failure-injection tests.
8. Add PostgreSQL integration and local Docker Compose for development if available.
9. Add dashboard or minimal admin UI and daily report.
10. Audit Automaton exact code/commit; implement a restricted adapter and sandbox.
11. Produce infrastructure comparison and deployment plan.
12. Deploy only to a local/staging environment if authorized; request separate approval before paid cloud/production.
13. Produce a final runbook and owner handoff.

## 9. Deliverables expected from the coding agent

- Source code with clean module boundaries and no committed secrets.
- `README.md` with fresh-install, local run, test, and troubleshooting instructions.
- `PRD.md`, `ARCHITECTURE.md`, `SECURITY.md`, `THREAT_MODEL.md`, `INFRA-COSTS.md`, `DEPLOYMENT.md`, `RUNBOOK.md`, `STATUS.md`.
- `.env.example` with placeholders only.
- SQL migrations and backup/restore steps.
- CI workflow.
- Unit/integration/adapter-contract/failure-injection tests.
- `RISK_REGISTER.md` and explicit list of assumptions/unresolved decisions.
- A report of commands run, pass/fail results, and unverified items.
- A final deployment plan requiring explicit owner approval before any paid or external-impacting deployment.

## 10. Definition of done

Do not say “AVOS is running” until:
1. The intended environment is actually deployed and health-checked.
2. Persistent storage, worker and queue survive restart.
3. Authentication and policy enforcement are tested.
4. Idempotency and worker failure tests pass.
5. Emergency Stop is tested against an attempted external action.
6. Cost controls, logs, backups, and recovery are verified.
7. Runtime adapter has been tested in a sandbox.
8. Owner has approved production scope and budget.
9. A runbook and evidence of test results are handed over.

At every stage, report: **Done / Not done / Blocked / Evidence / Next action / Cost incurred**.
