# AVOS Security Specification

**Version:** 1.0.0  
**Status:** Approved for Implementation

---

## 1. Authentication & Identity Management

### 1.1 The Golden Rule of Identity
> **NEVER trust an API request body or unverified header to assert caller identity or privilege.**

In AVOS:
- Any field in JSON payloads such as `{ "approver": "owner" }`, `{ "role": "admin" }`, or `{ "isOwner": true }` is **strictly ignored** for authorization.
- Identity and role are derived exclusively from cryptographically verified Bearer tokens.
- Authentication tokens are validated using constant-time string comparison (`crypto.timingSafeEqual`) to prevent timing attacks.

### 1.2 Credential Protection & Secret Management
- Passwords, API keys, private keys, database credentials, and cloud secrets must **NEVER** be committed to Git.
- Secrets are injected via environment variables or a secure key-vault (e.g. AWS Secrets Manager, Doppler).
- `.env.example` contains placeholders only.
- Structured logger (`pino`) automatically redacts sensitive keys: `authorization`, `password`, `token`, `secret`, `apiKey`, `privateKey`.

---

## 2. Authorization & Policy Boundary

### 2.1 Action Classes & Deny-by-Default
Every action dispatched to any worker or tool must belong to a defined action class:

```
Safe (Pre-approved under project scope):
- read.public
- read.internal

Gated (Explicit Owner Approval Required):
- account.connect
- social.draft
- social.publish
- social.message
- ads.launch
- purchase
- infrastructure.create
- production.change
- domain.dns.change
- financial.transfer
- runtime.self_modify
- tool.install
- agent.spawn
- agent.fund
- shell.execute
```

### 2.2 Approval Binding & Anti-Tampering
An approval grant is strictly bound to:
1. `project_id`: Cannot be reused across projects.
2. `action_class`: Granting `social.draft` does not grant `social.publish`.
3. `target_resource`: Exact URI, account, or domain.
4. `budget_ceiling`: Maximum allowable cost in USD.
5. `expires_at`: Strict time limit (default: 3600 seconds).
6. `parameters_hash`: Cryptographic SHA-256 hash of the planned action parameters. Any mutation in parameters invalidates the approval.

---

## 3. Execution Boundary Gateway

All external operations flow through `ExecutionGateway.assertCanExecute()`:
```typescript
class ExecutionGateway {
  async assertCanExecute(request: ActionExecutionRequest): Promise<void> {
    // 1. Check Emergency Stop
    if (await this.emergencyService.isStopped(request.projectId)) {
      throw new EmergencyStopActiveError("Execution blocked by Emergency Stop");
    }

    // 2. Policy engine validation
    const policy = await this.policyService.getPolicy(request.projectId);
    if (!policy.isActionAllowed(request.actionClass)) {
      throw new PolicyViolationError(`Action ${request.actionClass} is not allowed`);
    }

    // 3. Approval verification if action is gated
    if (this.policyService.isActionGated(request.actionClass)) {
      await this.approvalService.verifyValidApproval(request);
    }

    // 4. Budget ceiling verification
    await this.budgetService.assertWithinBudget(request.projectId, request.estimatedCost);

    // 5. Idempotency lock acquisition
    await this.idempotencyService.acquireLock(request.idempotencyKey);
  }
}
```

---

## 4. Tenant Isolation

AVOS supports multi-venture portfolio management. To prevent cross-venture contamination:
- Every entity in the datastore (`tasks`, `approvals`, `policies`, `budgets`, `audit`) is tagged with `project_id`.
- Repositories enforce `project_id` matching on every query.
- Workers run isolated execution contexts; credentials belonging to Venture A (e.g. ITCertHub) cannot be loaded by Venture B.
