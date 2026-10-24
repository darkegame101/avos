# AVOS Operations Runbook

**Version:** 1.0.0  
**Target Audience:** Human Owner & System Operators

---

## 1. Emergency Stop Procedures

### 1.1 Activation (Immediate Halt)
Triggering Emergency Stop halts all external-impacting operations at the execution boundary immediately. Read-only diagnostics and health monitoring remain accessible.

**Via HTTP API:**
```bash
curl -X POST http://localhost:4000/api/emergency/stop \
  -H "Authorization: Bearer $AVOS_OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Unexpected financial spike detected in Venture B",
    "scope": "GLOBAL"
  }'
```

**Effects:**
1. Global and/or project-specific stop flag set in persistent storage.
2. In-flight tasks attempting external action calls are immediately aborted by `ExecutionGateway` with `EmergencyStopActiveError`.
3. Queued tasks are prevented from acquiring execution leases.
4. An immutable audit record is logged.

### 1.2 Recovery & Resumption Protocol
Resuming external actions requires following the 5-step recovery verification:
1. **Root-Cause Investigation:** Inspect `audit_events` and error logs to identify why the stop occurred.
2. **State Consistency Reconciliation:** Query running and pending tasks (`GET /api/tasks?status=running`) to verify whether any partial external calls took place.
3. **Budget & Credential Check:** Verify that no credentials were compromised and that cost ledger numbers match billing dashboards.
4. **Owner Authorization:** Only the human owner can authorize resume.
5. **Deactivation Command:**
```bash
curl -X POST http://localhost:4000/api/emergency/resume \
  -H "Authorization: Bearer $AVOS_OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Root cause resolved: runaway loop patched and verified in staging",
    "scope": "GLOBAL"
  }'
```

---

## 2. Backup and Disaster Recovery

### 2.1 Database Backup (PostgreSQL)
Run the automated backup script or invoke manual `pg_dump`:
```bash
pg_dump -U avos_user -h localhost -d avos_db -F c -b -v -f ./backups/avos_$(date +%Y%m%d_%H%M%S).dump
```

### 2.2 Database Restore
```bash
# 1. Stop AVOS workers
npm run worker:stop

# 2. Restore database from dump
pg_restore -U avos_user -h localhost -d avos_db -v -c ./backups/target_backup.dump

# 3. Verify health and restart
npm run test:health
npm run start
```

---

## 3. Routine Health & Telemetry Checks
- **Health Check Endpoint:** `GET /health` (returns database connectivity, queue depth, worker heartbeats, emergency stop status).
- **Daily Report:** `GET /api/reports/daily` (returns executive summary of tasks completed, approvals pending, spend vs budget).
