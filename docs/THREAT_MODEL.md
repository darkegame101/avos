# AVOS Threat Model

**Version:** 1.0.0  
**Status:** Approved for Implementation  
**Methodology:** STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)

---

## 1. System Overview & Trust Boundaries

AVOS (Autonomous Venture Operating System) orchestrates business tasks across autonomous agent runtimes, workers, databases, and third-party APIs.

### Trust Boundaries
1. **Boundary A: External / Client -> API Gateway (Control Plane)**
   - External callers (operators, webhooks, dashboards).
   - Untrusted boundary: all requests must be cryptographically authenticated.
2. **Boundary B: Control Plane -> Database & Queue**
   - Canonical datastore (PostgreSQL) and task queue.
   - Internal boundary: access restricted to authenticated internal services with least privilege.
3. **Boundary C: Queue -> Execution Plane (Workers)**
   - Workers consume tasks and orchestrate execution.
   - Must enforce isolation between project tenants.
4. **Boundary D: Worker -> Execution Boundary Gateway (Action Gate)**
   - **CRITICAL SECURITY BOUNDARY**: The gate where policy, approvals, budget, and Emergency Stop are strictly enforced in code before any tool, shell, or runtime call occurs.
5. **Boundary E: Execution Gateway -> Runtime Adapters (Automaton / External APIs)**
   - Untrusted / Autonomous boundary: runtimes like Automaton operate with internal heuristics and must be restricted to sandboxed operations.

```
[ External Caller / Owner ] 
           │ (HTTPS / Bearer Auth)
           ▼
┌───────────────────────────────────────────────┐
│              AVOS CONTROL PLANE               │
│  - Auth & RBAC (Constant-time token verify)   │
│  - Task Service & Idempotency Check           │
│  - Policy & Approval Engine                   │
│  - Budget & Cost Ledger                       │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│               DURABLE QUEUE                   │
│  - Lease, Heartbeat, Dead-letter, Concurrency │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│                WORKER POOL                    │
│                                               │
│   ══════════ EXECUTION GATEWAY ═══════════    │
│   [1] Emergency Stop check (Global/Project)   │
│   [2] Action Policy check (Deny-by-default)   │
│   [3] Scope & Approval Verification           │
│   [4] Budget Ceiling check                    │
│   [5] Idempotency State Lock                  │
│   ════════════════════════════════════════    │
│                        │                      │
│                        ▼                      │
│           [ RUNTIME ADAPTER REGISTRY ]        │
│           ┌─────────────┬─────────────┐       │
│           │ MockAdapter │  Automaton  │       │
│           │  (Sandbox)  │  (Sandboxed)│       │
└───────────┴─────────────┴─────────────┴───────┘
```

---

## 2. STRIDE Threat Analysis & Mitigations

| Threat ID | Category | Threat Scenario | Impact | Mitigation Strategy | Verification / Test |
|---|---|---|---|---|---|
| **T-01** | **Spoofing** | Caller submits `{ "approver": "owner" }` or spoofed header in API payload to approve an action. | Critical: Unauthorized approval of high-risk actions. | Never inspect request body for identity. Authenticate via Bearer token with constant-time equality check (`crypto.timingSafeEqual`). | `auth.test.ts`: reject requests without valid Bearer token even if body claims owner. |
| **T-02** | **Tampering** | In-flight modification of approved task parameters (e.g. changing target URL, budget from $10 to $1000). | Critical: Unapproved high-cost or malicious action executed. | Cryptographic hash binding of approval request (Action + Target + Project + Budget Ceiling + Expiry). Any mutation invalidates approval. | `policy.test.ts`: mutate target or budget after approval, verify execution gate blocks task. |
| **T-03** | **Repudiation** | An operator or agent denies triggering a high-cost action or publishing content. | High: Lack of accountability and audit trail. | Append-only immutable audit log table (`audit_events`) recording actor, action, timestamp, parameters hash, and outcome. | `audit.test.ts`: verify audit trail records every state transition and action invocation. |
| **T-04** | **Info Disclosure** | API tokens, private keys, or internal credentials leaked in logs, error traces, or API responses. | Critical: Credential theft, unauthorized cloud access. | Strict secret redaction in logger (`pino` redaction); environment secrets never echoed in API payloads. | `security.test.ts`: verify sensitive keys (`AVOS_OWNER_TOKEN`, `DATABASE_URL`) are sanitized from error traces and logs. |
| **T-05** | **Denial of Service** | Agent enters infinite retry loop, flooding workers or exhausting AWS credits. | High: System crash, financial loss. | Bounded worker concurrency, max retries (3) with exponential backoff & jitter, hard budget caps ($50/mo), dead-letter queue. | `worker.test.ts`: simulate failing task, verify dead-letter transition after max retries. |
| **T-06** | **Elevation of Privilege** | Agent runtime (e.g. Automaton) attempts shell execution, wallet funding, or child agent spawning. | Critical: Arbitrary code execution, unauthorized financial drain. | Code-level action gateway with deny-by-default. Actions (`shell.execute`, `agent.fund`, `financial.transfer`) blocked unless explicitly approved with active approval ID. | `gateway.test.ts`: verify unapproved shell/financial actions throw `PolicyViolationError`. |
| **T-07** | **Emergency Bypass** | Queued tasks continue executing external actions while Emergency Stop is active. | Critical: Inability to halt runaway agent actions. | Execution Gateway checks Emergency Stop status synchronously immediately before adapter dispatch. Worker state transitions to `stopped`. | `emergency_stop.test.ts`: activate stop while task is queued; verify execution is aborted at the boundary. |
| **T-08** | **Replay / Duplicate Side Effects** | Worker crashes after payment/post but before ACK; restarts and executes side effect a second time. | High: Double charge, duplicate public post. | Persistent idempotency keys with two-phase lock: `PENDING` -> `EXECUTING` -> `COMPLETED`. Reconcile state before any retry. | `idempotency.test.ts`: concurrent submissions with same key execute exactly once. |

---

## 3. Defense-in-Depth Rules

1. **Policy in Code, Not Prompts:** Large Language Models are non-deterministic and susceptible to jailbreaks. No policy rule may rely exclusively on LLM prompts.
2. **Deny-by-Default:** Every action not explicitly allowed in `policy_rules` is denied.
3. **Fail-Closed Gate:** If the policy service, budget service, or Emergency Stop check fails or throws an error, the task execution MUST fail and abort.
4. **Time-Bounded Approvals:** Approvals expire automatically (default: 1 hour). Expired approvals cannot be redeemed.
5. **Separation of Tenant Data:** All database queries must include `project_id` filters to enforce hermetic isolation.
