# AVOS Architecture Specification

**Version:** 1.0.0  
**Status:** Approved for Implementation

---

## 1. Architectural Philosophy

AVOS (Autonomous Venture Operating System) is designed with four fundamental tenets:

1. **Runtime Independence:** The AVOS Core (policy, approvals, budget, audit, state, queue) is completely decoupled from any single AI agent runtime (e.g. Automaton, Claude Agent, custom scripts).
2. **Policy Enforcement at the Action Boundary:** Security and governance are enforced in hard code at the execution boundary (`ExecutionGateway`), never delegated to LLM prompts.
3. **Fail-Closed & Deny-by-Default:** Any unrecognised action, ambiguous permission, exceeded budget, or active Emergency Stop halts execution immediately.
4. **Resilience & Idempotency:** Systems survive crashes, network partitions, and worker restarts without duplicate external side effects.

---

## 2. Layered Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           API / CONTROL PLANE                           │
│  - Fastify HTTP Server (Strict Schema Validation via Zod)               │
│  - Authentication & Authorisation (Constant-time token validation)      │
│  - REST Endpoints: /tasks, /approvals, /projects, /emergency, /health   │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            CORE DOMAIN PLANE                            │
│  - Task Service & State Machine                                         │
│  - Policy & Approval Engine (Scope verification, expiry, revocations)   │
│  - Budget & Cost Ledger (Estimates vs actuals, project & monthly caps)  │
│  - Emergency Stop & Recovery Service (Synchronous persistent gate)      │
│  - Audit & Evidence Logger (Cryptographic event trail)                  │
└───────────────────┬─────────────────────────────────┬───────────────────┘
                    │                                 │
                    ▼                                 ▼
┌──────────────────────────────────────┐  ┌───────────────────────────────┐
│            STORAGE LAYER             │  │        EXECUTION PLANE        │
│  - PostgreSQL Datastore              │  │  - Durable Task Queue         │
│  - Versioned SQL Migrations          │  │  - Worker Manager             │
│  - Repository Pattern                │  │  - Lease, Heartbeat & Timeout │
│  - Hermetic In-Memory Test Fixture   │  │  - Dead-Letter Handling       │
└──────────────────────────────────────┘  └───────────────┬───────────────┘
                                                          │
                                                          ▼
                                          ┌───────────────────────────────┐
                                          │      EXECUTION GATEWAY        │
                                          │  [1] Emergency Stop Gate      │
                                          │  [2] Action Policy Check      │
                                          │  [3] Scope & Approval Gate    │
                                          │  [4] Budget Ceiling Gate      │
                                          │  [5] Idempotency Key Lock     │
                                          └───────────────┬───────────────┘
                                                          │
                                                          ▼
                                          ┌───────────────────────────────┐
                                          │   RUNTIME ADAPTER REGISTRY    │
                                          │  - IRuntimeAdapter Interface  │
                                          │  - MockRuntimeAdapter         │
                                          │  - AutomatonRuntimeAdapter    │
                                          └───────────────────────────────┘
```

---

## 3. Core Component Definitions

### 3.1 Task State Machine
Tasks transition deterministically through defined states:
- `CREATED`: Task submitted, validated, and persisted.
- `PLANNED`: Task scope, required actions, and estimated budget defined.
- `PENDING_APPROVAL`: Task requires explicit human owner approval for one or more gated action classes.
- `QUEUED`: Approved or pre-authorized task placed in the durable queue.
- `RUNNING`: Acquired by a worker with an active lease.
- `COMPLETED`: Execution succeeded, evidence captured, actual cost recorded.
- `FAILED`: Execution failed after exhausted retries; moved to dead-letter state.
- `CANCELLED`: Cancelled by operator or superseded.
- `STOPPED`: Halted immediately by Emergency Stop.

### 3.2 Action Policy & Deny-by-Default
Every action belongs to a typed action class:
- **Safe / Read Actions:** `read.public`, `read.internal`
- **Gated / External Actions:** `account.connect`, `social.draft`, `social.publish`, `social.message`, `ads.launch`, `purchase`, `infrastructure.create`, `production.change`, `domain.dns.change`, `financial.transfer`, `runtime.self_modify`, `tool.install`, `agent.spawn`, `agent.fund`, `shell.execute`

**Rule:** Any action not explicitly granted in the project's policy is DENIED. Any external action requiring approval must possess an active, valid, matching approval record.

### 3.3 Execution Gateway
The `ExecutionGateway` is the single point of dispatch for all external operations. It enforces 5 checks in sequence:
1. **Emergency Stop Check:** Both global and project-specific stop flags are verified. If active, execution is aborted with `EmergencyStopActiveError`.
2. **Policy Verification:** Validates that the requested action is permitted for the tenant project.
3. **Approval Binding Verification:** If the action is gated, validates that `approval_id` exists, is in `APPROVED` status, has not expired, and matches:
   - Target URI/resource
   - Action class
   - Budget ceiling
   - Project ID
4. **Budget Check:** Verifies that task spend will not breach project or monthly caps.
5. **Idempotency Lock:** Atomically sets idempotency status to `EXECUTING` to prevent race conditions.

### 3.4 Runtime Adapter Interface (`IRuntimeAdapter`)
All runtimes must implement:
```typescript
interface IRuntimeAdapter {
  capabilities(): RuntimeCapabilities;
  submit(task: Task, idempotencyKey: string, context: ExecutionContext): Promise<RuntimeSubmissionResult>;
  status(runtimeTaskId: string): Promise<RuntimeTaskStatus>;
  cancel(runtimeTaskId: string): Promise<boolean>;
  result(runtimeTaskId: string): Promise<ExecutionResult>;
  evidence(runtimeTaskId: string): Promise<ExecutionEvidence>;
  health(): Promise<AdapterHealth>;
  cost(runtimeTaskId: string): Promise<CostTelemetry>;
}
```

### 3.5 Storage & Migrations
- Production datastore: PostgreSQL 15+.
- Tables:
  - `projects`: Tenant boundaries, status, budget caps.
  - `tasks`: Core task lifecycle and payloads.
  - `task_transitions`: State transition audit trail.
  - `approval_requests`: Human approvals with cryptographic hash bindings.
  - `policy_rules`: Granular permissions per project.
  - `budget_ledger`: Transactional ledger recording estimated and actual costs.
  - `audit_events`: Immutable audit trail with SHA-256 event chaining.
  - `idempotency_keys`: Keys, status (`PENDING`, `EXECUTING`, `COMPLETED`), response cache.
  - `worker_leases`: Worker heartbeat and lease locking.
  - `emergency_stop_state`: Persistent stop flags and activation audit.
