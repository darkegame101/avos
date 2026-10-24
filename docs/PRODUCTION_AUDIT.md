# AVOS Production-Facing Security & Configuration Audit

**Audit Date:** 2026-10-25  
**Auditor:** AVOS Agent  
**Environment Target:** AWS Lightsail Staging / Lean Production

---

## 1. Security & Configuration Audit Checklist

| Domain | Control | Implementation in AVOS | Status | Verification Evidence |
|---|---|---|---|---|
| **Authentication** | Constant-Time Bearer Token Verification | `src/core/security/auth.ts` uses `crypto.timingSafeEqual` | **PASSED** | Verified in `tests/security_policy.test.ts` |
| **Authentication** | Rejection of Body-Asserted Roles | JSON body role/approver parameters are ignored | **PASSED** | Verified in `tests/security_policy.test.ts` |
| **Network & HTTPS** | TLS 1.3 Termination & HSTS | Nginx/Caddy reverse proxy terminating on port 443 | **READY** | Documented in `docs/DEPLOYMENT.md` |
| **Firewall** | Inbound Port Restriction | Inbound open ONLY for 80, 443, and SSH (IP-restricted) | **READY** | Database port 5432 bound to loopback `127.0.0.1` |
| **Firewall** | SSRF & Metadata Protection | BrowserSandbox blocks `169.254.169.254`, loopback, RFC1918 | **PASSED** | Verified in `tests/browser_sandbox.test.ts` |
| **Secrets** | Zero Committed Credentials | `.env` gitignored; `.env.example` contains placeholders | **PASSED** | Verified in git history & `.gitignore` |
| **Telemetry** | Automated Secret Redaction in Logs | `src/core/security/redactor.ts` strips tokens & keys | **PASSED** | Verified in `tests/security_policy.test.ts` |
| **Cost Limits** | Hard Portfolio Spending Ceiling ($50/mo) | `BudgetService` halts task submission if limit is breached | **PASSED** | Verified in `src/core/budget/budgetLedger.ts` |
| **Cost Limits** | Concurrency Throttling | Worker concurrency capped at 5; Browser sandbox capped at 1 | **PASSED** | Verified in `tests/browser_sandbox.test.ts` |
| **Resilience** | Persistent Emergency Stop | Synchronously enforced at execution boundary; persisted in DB | **PASSED** | Verified in `tests/postgres_integration.test.ts` |
| **Data Protection** | Database Dump & Restore | Nightly `pg_dump` procedure with verified CLI test | **PASSED** | Verified in `tests/postgres_integration.test.ts` |

---

## 2. Firewall Rules Specification (AWS Lightsail)

```
Inbound Rules:
- Port 80 (TCP): 0.0.0.0/0 (Redirects all HTTP to HTTPS)
- Port 443 (TCP): 0.0.0.0/0 (AVOS API & Admin Dashboard)
- Port 22 (SSH): <OWNER_STATIC_IP>/32 ONLY (Never open 22 to 0.0.0.0/0)
- Port 5432 (Postgres): CLOSED to public. Internal docker/loopback only.

Outbound Rules:
- Port 80 / 443 (TCP): Outbound to internet for approved research & webhooks.
- Anti-SSRF: Block traffic to 169.254.169.254 at the application & OS iptables level.
```
