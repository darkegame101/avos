# AVOS Pre-Deployment Security & Configuration Audit

**Audit Date:** 2026-10-25  
**Auditor:** AVOS AI Coding Agent  
**Environment Target:** AWS Lightsail Staging / Lean Production

---

## 1. Security & Production-Facing Audit Classification

| Category | Control / Invariant | Status | Primary Code / Config | Test File & Evidence |
|---|---|---|---|---|
| **Authentication** | Constant-Time Bearer Token Verification | **PASS** | [src/core/security/auth.ts](file:///e:/AVOS-AI-Agent-Handoff/src/core/security/auth.ts) (`crypto.timingSafeEqual`) | [tests/security_policy.test.ts](file:///e:/AVOS-AI-Agent-Handoff/tests/security_policy.test.ts): verified token check & rejection of forged tokens. |
| **Authentication** | Rejection of Body-Asserted Roles | **PASS** | [src/core/security/auth.ts](file:///e:/AVOS-AI-Agent-Handoff/src/core/security/auth.ts) | [tests/api_server.test.ts](file:///e:/AVOS-AI-Agent-Handoff/tests/api_server.test.ts): 401 Unauthorized when asserting `{ approver: 'owner' }`. |
| **Authorization** | Action Policy Deny-by-Default | **PASS** | [src/core/policy/policyEngine.ts](file:///e:/AVOS-AI-Agent-Handoff/src/core/policy/policyEngine.ts) | [tests/security_policy.test.ts](file:///e:/AVOS-AI-Agent-Handoff/tests/security_policy.test.ts): unallowed actions throw `PolicyViolationError`. |
| **Authorization** | Anti-Tampering Approval Hash Binding | **PASS** | [src/core/models/approval.ts](file:///e:/AVOS-AI-Agent-Handoff/src/core/models/approval.ts) (SHA-256 parameter hash) | [tests/security_policy.test.ts](file:///e:/AVOS-AI-Agent-Handoff/tests/security_policy.test.ts): parameter mutation throws tampering error. |
| **Authorization** | Hermetic Project Isolation | **PASS** | [src/gateway/executionGateway.ts](file:///e:/AVOS-AI-Agent-Handoff/src/gateway/executionGateway.ts) | [tests/security_policy.test.ts](file:///e:/AVOS-AI-Agent-Handoff/tests/security_policy.test.ts): cross-project approval reuse throws error. |
| **Resilience** | Persistent Emergency Stop | **PASS** | [src/core/emergency/emergencyService.ts](file:///e:/AVOS-AI-Agent-Handoff/src/core/emergency/emergencyService.ts) & PostgreSQL DB | [tests/postgres_integration.test.ts](file:///e:/AVOS-AI-Agent-Handoff/tests/postgres_integration.test.ts): persists stop flag across simulated crash. |
| **Reliability** | Atomic Queue Leasing with `SKIP LOCKED` | **PASS** | [src/storage/postgresRepository.ts](file:///e:/AVOS-AI-Agent-Handoff/src/storage/postgresRepository.ts) | [tests/postgres_integration.test.ts](file:///e:/AVOS-AI-Agent-Handoff/tests/postgres_integration.test.ts): second worker receives null lease. |
| **Reliability** | Durable Idempotency & Duplicate Prevention | **PASS** | [src/gateway/executionGateway.ts](file:///e:/AVOS-AI-Agent-Handoff/src/gateway/executionGateway.ts) | [tests/idempotency_reliability.test.ts](file:///e:/AVOS-AI-Agent-Handoff/tests/idempotency_reliability.test.ts): duplicate key returns cached output without re-executing. |
| **SSRF Defense** | Anti-SSRF & Encoded IP Normalization | **PASS** | [src/adapters/browserSandbox.ts](file:///e:/AVOS-AI-Agent-Handoff/src/adapters/browserSandbox.ts) | [tests/browser_sandbox.test.ts](file:///e:/AVOS-AI-Agent-Handoff/tests/browser_sandbox.test.ts): blocks loopback, metadata, RFC1918, dword/hex/IPv6. |
| **SSRF Defense** | Manual Redirect Interception | **PASS** | [src/adapters/browserSandbox.ts](file:///e:/AVOS-AI-Agent-Handoff/src/adapters/browserSandbox.ts) | Verified `redirect: 'manual'` re-validation prevents redirect-based SSRF. |
| **SSRF Defense** | DNS Rebinding Protection | **PASS** | [src/adapters/browserSandbox.ts](file:///e:/AVOS-AI-Agent-Handoff/src/adapters/browserSandbox.ts) (`validateTargetUrlAsync`) | [tests/browser_sandbox.test.ts](file:///e:/AVOS-AI-Agent-Handoff/tests/browser_sandbox.test.ts): resolves hostname and verifies destination IP is not private/loopback. |
| **Protocol Defense**| Strict HTTP/HTTPS Whitelist | **PASS** | [src/adapters/browserSandbox.ts](file:///e:/AVOS-AI-Agent-Handoff/src/adapters/browserSandbox.ts) | [tests/browser_sandbox.test.ts](file:///e:/AVOS-AI-Agent-Handoff/tests/browser_sandbox.test.ts): blocks `ws:`, `wss:`, `ftp:`, `file:`, `data:`, `javascript:`. |
| **Resource Limits**| Concurrency Cap = 1 for Chromium | **PASS** | [src/adapters/browserSandbox.ts](file:///e:/AVOS-AI-Agent-Handoff/src/adapters/browserSandbox.ts) | [tests/browser_sandbox.test.ts](file:///e:/AVOS-AI-Agent-Handoff/tests/browser_sandbox.test.ts): second session throws `BrowserConcurrencyExceededError`. |
| **Cost Limits** | Hard Portfolio Monthly Cap ($50.00) | **PASS** | [src/core/budget/budgetLedger.ts](file:///e:/AVOS-AI-Agent-Handoff/src/core/budget/budgetLedger.ts) | [tests/security_policy.test.ts](file:///e:/AVOS-AI-Agent-Handoff/tests/security_policy.test.ts): exceeding budget throws `BudgetExceededError`. |
| **Telemetry** | Automated Secret Redaction | **PASS** | [src/core/security/redactor.ts](file:///e:/AVOS-AI-Agent-Handoff/src/core/security/redactor.ts) | [tests/security_policy.test.ts](file:///e:/AVOS-AI-Agent-Handoff/tests/security_policy.test.ts): recursively masks tokens, passwords, database URLs. |
| **API Defense** | Security Headers & Rate Limiting | **PASS** | [src/api/server.ts](file:///e:/AVOS-AI-Agent-Handoff/src/api/server.ts) | [tests/api_server.test.ts](file:///e:/AVOS-AI-Agent-Handoff/tests/api_server.test.ts): verified `nosniff`, `DENY`, HSTS, and 429 rate limit enforcement. |
| **Database** | Least-Privilege DB Role | **PASS** | [migrations/002_least_privilege_user.sql](file:///e:/AVOS-AI-Agent-Handoff/migrations/002_least_privilege_user.sql) | DDL script revokes PUBLIC, grants SELECT/INSERT/UPDATE/DELETE only to `avos_app_user`. |
| **Data Protection**| Database Backup Integrity | **PASS** | `pg_dump` CLI backup routine | [tests/postgres_integration.test.ts](file:///e:/AVOS-AI-Agent-Handoff/tests/postgres_integration.test.ts): verified binary/text schema export. |
| **Cloud Infra** | AWS Lightsail VPS Provisioning | **NOT VERIFIED** | [docs/LIGHTSAIL_DEPLOYMENT_PLAN.md](file:///e:/AVOS-AI-Agent-Handoff/docs/LIGHTSAIL_DEPLOYMENT_PLAN.md) | **BLOCKED:** Awaiting explicit human owner approval. Zero cloud resources created. |
| **Cloud Infra** | AWS Credit Expiration & Exact Balance | **NOT VERIFIED** | [docs/INFRA-COSTS.md](file:///e:/AVOS-AI-Agent-Handoff/docs/INFRA-COSTS.md) | **BLOCKED:** Unverified by AWS Billing Console. Treat as provisional until owner confirms. |

---

## 2. Firewall Specification (AWS Lightsail)

```
Inbound (Strictly Minimal):
- TCP 80:  0.0.0.0/0 (HTTP -> HTTPS Redirect)
- TCP 443: 0.0.0.0/0 (TLS 1.3 AVOS Control Plane)
- TCP 22:  <OWNER_IP>/32 ONLY (Never open 22 to 0.0.0.0/0)
- TCP 5432: DENIED to public. Loopback / internal Docker network ONLY.

Outbound:
- TCP 80 / 443: Outbound to public web for approved market research.
- Anti-SSRF: OS-level iptables blocking access to 169.254.169.254.
```
