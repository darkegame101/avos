import { Pool, PoolClient } from 'pg';
import {
  Project,
  Task,
  TaskStatus,
  TaskTransition,
  ApprovalRequest,
  ApprovalStatus,
  PolicyRule,
  BudgetLedgerEntry,
  AuditEvent,
  EmergencyStopState,
  createDefaultProjectPolicies,
  isValidTransition,
} from '../core/models';
import { IStorageRepository, IdempotencyRecord } from './repository';

export class PostgresRepository implements IStorageRepository {
  private pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  // --- Projects ---
  async createProject(project: Project): Promise<Project> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const query = `
        INSERT INTO projects (id, name, status, budget_ceiling_usd, spent_usd, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *;
      `;
      await client.query(query, [
        project.id,
        project.name,
        project.status,
        project.budgetCeilingUsd,
        project.spentUsd,
        project.createdAt,
        project.updatedAt,
      ]);

      // Seed default deny-by-default policies
      const defaults = createDefaultProjectPolicies(project.id);
      for (const rule of defaults) {
        await client.query(
          `INSERT INTO policy_rules (id, project_id, action_class, allowed, requires_approval, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (project_id, action_class) DO NOTHING;`,
          [rule.id, rule.projectId, rule.actionClass, rule.allowed, rule.requiresApproval, rule.createdAt]
        );
      }

      await client.query('COMMIT');
      return project;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getProject(id: string): Promise<Project | null> {
    const res = await this.pool.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      budgetCeilingUsd: parseFloat(r.budget_ceiling_usd),
      spentUsd: parseFloat(r.spent_usd),
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    };
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<Project> {
    const existing = await this.getProject(id);
    if (!existing) throw new Error(`Project ${id} not found`);

    const updated = { ...existing, ...updates, updatedAt: new Date() };
    await this.pool.query(
      `UPDATE projects 
       SET name = $1, status = $2, budget_ceiling_usd = $3, spent_usd = $4, updated_at = $5
       WHERE id = $6`,
      [updated.name, updated.status, updated.budgetCeilingUsd, updated.spentUsd, updated.updatedAt, id]
    );
    return updated;
  }

  async listProjects(): Promise<Project[]> {
    const res = await this.pool.query('SELECT * FROM projects ORDER BY created_at DESC');
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      budgetCeilingUsd: parseFloat(r.budget_ceiling_usd),
      spentUsd: parseFloat(r.spent_usd),
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    }));
  }

  // --- Tasks ---
  async createTask(task: Task): Promise<Task> {
    const query = `
      INSERT INTO tasks (
        id, project_id, title, description, status, action_class, 
        target_resource, parameters, idempotency_key, estimated_cost_usd, 
        actual_cost_usd, retry_count, max_retries, evidence, error_details, 
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *;
    `;
    await this.pool.query(query, [
      task.id,
      task.projectId,
      task.title,
      task.description || null,
      task.status,
      task.actionClass,
      task.targetResource || null,
      JSON.stringify(task.parameters),
      task.idempotencyKey,
      task.estimatedCostUsd,
      task.actualCostUsd,
      task.retryCount,
      task.maxRetries,
      task.evidence ? JSON.stringify(task.evidence) : null,
      task.errorDetails ? JSON.stringify(task.errorDetails) : null,
      task.createdAt,
      task.updatedAt,
    ]);
    return task;
  }

  private mapTaskRow(r: any): Task {
    return {
      id: r.id,
      projectId: r.project_id,
      title: r.title,
      description: r.description || undefined,
      status: r.status,
      actionClass: r.action_class,
      targetResource: r.target_resource || undefined,
      parameters: typeof r.parameters === 'string' ? JSON.parse(r.parameters) : r.parameters,
      idempotencyKey: r.idempotency_key,
      estimatedCostUsd: parseFloat(r.estimated_cost_usd),
      actualCostUsd: parseFloat(r.actual_cost_usd),
      retryCount: r.retry_count,
      maxRetries: r.max_retries,
      evidence: r.evidence ? (typeof r.evidence === 'string' ? JSON.parse(r.evidence) : r.evidence) : undefined,
      errorDetails: r.error_details ? (typeof r.error_details === 'string' ? JSON.parse(r.error_details) : r.error_details) : undefined,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    };
  }

  async getTask(id: string): Promise<Task | null> {
    const res = await this.pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapTaskRow(res.rows[0]);
  }

  async getTaskByIdempotencyKey(key: string): Promise<Task | null> {
    const res = await this.pool.query('SELECT * FROM tasks WHERE idempotency_key = $1', [key]);
    if (res.rows.length === 0) return null;
    return this.mapTaskRow(res.rows[0]);
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task> {
    const existing = await this.getTask(id);
    if (!existing) throw new Error(`Task ${id} not found`);

    const updated = { ...existing, ...updates, updatedAt: new Date() };
    const query = `
      UPDATE tasks SET 
        title = $1, description = $2, status = $3, actual_cost_usd = $4,
        retry_count = $5, evidence = $6, error_details = $7, updated_at = $8
      WHERE id = $9
    `;
    await this.pool.query(query, [
      updated.title,
      updated.description || null,
      updated.status,
      updated.actualCostUsd,
      updated.retryCount,
      updated.evidence ? JSON.stringify(updated.evidence) : null,
      updated.errorDetails ? JSON.stringify(updated.errorDetails) : null,
      updated.updatedAt,
      id,
    ]);
    return updated;
  }

  async updateTaskStatus(id: string, status: TaskStatus, reason?: string): Promise<Task> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query('SELECT * FROM tasks WHERE id = $1 FOR UPDATE', [id]);
      if (res.rows.length === 0) throw new Error(`Task ${id} not found`);

      const current = this.mapTaskRow(res.rows[0]);
      if (current.status !== status && !isValidTransition(current.status, status)) {
        throw new Error(`Invalid state transition from ${current.status} to ${status}`);
      }

      await client.query('UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);
      await client.query(
        `INSERT INTO task_transitions (id, task_id, from_status, to_status, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [`trans_${Date.now()}_${Math.random().toString(36).substring(7)}`, id, current.status, status, reason || null]
      );

      await client.query('COMMIT');
      return { ...current, status, updatedAt: new Date() };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listTasks(filter?: { projectId?: string; status?: TaskStatus }): Promise<Task[]> {
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params: any[] = [];
    if (filter?.projectId) {
      params.push(filter.projectId);
      query += ` AND project_id = $${params.length}`;
    }
    if (filter?.status) {
      params.push(filter.status);
      query += ` AND status = $${params.length}`;
    }
    query += ' ORDER BY created_at DESC';
    const res = await this.pool.query(query, params);
    return res.rows.map((r) => this.mapTaskRow(r));
  }

  async acquireNextQueuedTask(workerId: string, leaseDurationMs: number): Promise<Task | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Use SKIP LOCKED for durable high-throughput worker acquisition
      const findQuery = `
        SELECT t.* FROM tasks t
        LEFT JOIN worker_leases l ON t.id = l.task_id
        WHERE t.status = 'QUEUED' 
          AND (l.task_id IS NULL OR l.lease_expires_at < NOW())
        ORDER BY t.created_at ASC
        FOR UPDATE OF t SKIP LOCKED
        LIMIT 1;
      `;
      const res = await client.query(findQuery);
      if (res.rows.length === 0) {
        await client.query('COMMIT');
        return null;
      }

      const task = this.mapTaskRow(res.rows[0]);
      const leaseExpiresAt = new Date(Date.now() + leaseDurationMs);

      // Upsert worker lease
      await client.query(
        `INSERT INTO worker_leases (task_id, worker_id, lease_expires_at, heartbeat_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (task_id) DO UPDATE 
         SET worker_id = EXCLUDED.worker_id, lease_expires_at = EXCLUDED.lease_expires_at, heartbeat_at = NOW();`,
        [task.id, workerId, leaseExpiresAt]
      );

      // Update task to RUNNING
      await client.query(
        `UPDATE tasks SET status = 'RUNNING', updated_at = NOW() WHERE id = $1`,
        [task.id]
      );

      await client.query(
        `INSERT INTO task_transitions (id, task_id, from_status, to_status, reason, created_at)
         VALUES ($1, $2, 'QUEUED', 'RUNNING', $3, NOW())`,
        [`trans_${Date.now()}`, task.id, `Acquired by worker ${workerId}`]
      );

      await client.query('COMMIT');
      return { ...task, status: 'RUNNING', updatedAt: new Date() };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // --- Task Transitions ---
  async recordTransition(transition: TaskTransition): Promise<TaskTransition> {
    await this.pool.query(
      `INSERT INTO task_transitions (id, task_id, from_status, to_status, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [transition.id, transition.taskId, transition.fromStatus, transition.toStatus, transition.reason || null, transition.createdAt]
    );
    return transition;
  }

  async getTaskTransitions(taskId: string): Promise<TaskTransition[]> {
    const res = await this.pool.query(
      'SELECT * FROM task_transitions WHERE task_id = $1 ORDER BY created_at ASC',
      [taskId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      reason: r.reason || undefined,
      createdAt: new Date(r.created_at),
    }));
  }

  // --- Approvals ---
  async createApproval(approval: ApprovalRequest): Promise<ApprovalRequest> {
    const query = `
      INSERT INTO approval_requests (
        id, project_id, task_id, action_class, target_resource, parameters_hash,
        rationale, estimated_cost_usd, budget_ceiling_usd, status, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `;
    await this.pool.query(query, [
      approval.id,
      approval.projectId,
      approval.taskId,
      approval.actionClass,
      approval.targetResource,
      approval.parametersHash,
      approval.rationale,
      approval.estimatedCostUsd,
      approval.budgetCeilingUsd,
      approval.status,
      approval.expiresAt,
      approval.createdAt,
    ]);
    return approval;
  }

  private mapApprovalRow(r: any): ApprovalRequest {
    return {
      id: r.id,
      projectId: r.project_id,
      taskId: r.task_id,
      actionClass: r.action_class,
      targetResource: r.target_resource,
      parametersHash: r.parameters_hash,
      rationale: r.rationale,
      estimatedCostUsd: parseFloat(r.estimated_cost_usd),
      budgetCeilingUsd: parseFloat(r.budget_ceiling_usd),
      status: r.status,
      approvedBy: r.approved_by || undefined,
      approvedAt: r.approved_at ? new Date(r.approved_at) : undefined,
      expiresAt: new Date(r.expires_at),
      rejectionReason: r.rejection_reason || undefined,
      createdAt: new Date(r.created_at),
    };
  }

  async getApproval(id: string): Promise<ApprovalRequest | null> {
    const res = await this.pool.query('SELECT * FROM approval_requests WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapApprovalRow(res.rows[0]);
  }

  async getApprovalForTask(taskId: string): Promise<ApprovalRequest | null> {
    const res = await this.pool.query('SELECT * FROM approval_requests WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1', [taskId]);
    if (res.rows.length === 0) return null;
    return this.mapApprovalRow(res.rows[0]);
  }

  async updateApprovalStatus(
    id: string,
    status: ApprovalStatus,
    approvedBy?: string,
    rejectionReason?: string
  ): Promise<ApprovalRequest> {
    const query = `
      UPDATE approval_requests 
      SET status = $1, approved_by = $2, approved_at = CASE WHEN $1 = 'APPROVED' THEN NOW() ELSE approved_at END,
          rejection_reason = $3
      WHERE id = $4
      RETURNING *;
    `;
    const res = await this.pool.query(query, [status, approvedBy || null, rejectionReason || null, id]);
    if (res.rows.length === 0) throw new Error(`Approval ${id} not found`);
    return this.mapApprovalRow(res.rows[0]);
  }

  async listApprovals(filter?: { projectId?: string; status?: ApprovalStatus }): Promise<ApprovalRequest[]> {
    let query = 'SELECT * FROM approval_requests WHERE 1=1';
    const params: any[] = [];
    if (filter?.projectId) {
      params.push(filter.projectId);
      query += ` AND project_id = $${params.length}`;
    }
    if (filter?.status) {
      params.push(filter.status);
      query += ` AND status = $${params.length}`;
    }
    query += ' ORDER BY created_at DESC';
    const res = await this.pool.query(query, params);
    return res.rows.map((r) => this.mapApprovalRow(r));
  }

  // --- Policies ---
  async getPolicyRules(projectId: string): Promise<PolicyRule[]> {
    const res = await this.pool.query('SELECT * FROM policy_rules WHERE project_id = $1', [projectId]);
    return res.rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      actionClass: r.action_class,
      allowed: r.allowed,
      requiresApproval: r.requires_approval,
      createdAt: new Date(r.created_at),
    }));
  }

  async upsertPolicyRule(rule: PolicyRule): Promise<PolicyRule> {
    const query = `
      INSERT INTO policy_rules (id, project_id, action_class, allowed, requires_approval, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (project_id, action_class) DO UPDATE
      SET allowed = EXCLUDED.allowed, requires_approval = EXCLUDED.requires_approval;
    `;
    await this.pool.query(query, [rule.id, rule.projectId, rule.actionClass, rule.allowed, rule.requiresApproval, rule.createdAt]);
    return rule;
  }

  // --- Budget ---
  async recordLedgerEntry(entry: BudgetLedgerEntry): Promise<BudgetLedgerEntry> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO budget_ledger (id, project_id, task_id, entry_type, amount_usd, description, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [entry.id, entry.projectId, entry.taskId || null, entry.entryType, entry.amountUsd, entry.description || null, entry.createdAt]
      );
      if (entry.entryType === 'ACTUAL') {
        await client.query(
          `UPDATE projects SET spent_usd = spent_usd + $1, updated_at = NOW() WHERE id = $2`,
          [entry.amountUsd, entry.projectId]
        );
      }
      await client.query('COMMIT');
      return entry;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getProjectSpent(projectId: string): Promise<number> {
    const res = await this.pool.query(
      `SELECT COALESCE(SUM(amount_usd), 0) as total FROM budget_ledger WHERE project_id = $1 AND entry_type = 'ACTUAL'`,
      [projectId]
    );
    return parseFloat(res.rows[0].total);
  }

  async getProjectLedger(projectId: string): Promise<BudgetLedgerEntry[]> {
    const res = await this.pool.query(
      `SELECT * FROM budget_ledger WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      taskId: r.task_id || undefined,
      entryType: r.entry_type,
      amountUsd: parseFloat(r.amount_usd),
      description: r.description || undefined,
      createdAt: new Date(r.created_at),
    }));
  }

  // --- Audit ---
  async recordAuditEvent(event: AuditEvent): Promise<AuditEvent> {
    const query = `
      INSERT INTO audit_events (id, event_type, actor, project_id, task_id, details, prev_event_hash, event_hash, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;
    await this.pool.query(query, [
      event.id,
      event.eventType,
      event.actor,
      event.projectId || null,
      event.taskId || null,
      JSON.stringify(event.details),
      event.prevEventHash || null,
      event.eventHash,
      event.createdAt,
    ]);
    return event;
  }

  async getLatestAuditEvent(): Promise<AuditEvent | null> {
    const res = await this.pool.query('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 1');
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      eventType: r.event_type,
      actor: r.actor,
      projectId: r.project_id || undefined,
      taskId: r.task_id || undefined,
      details: typeof r.details === 'string' ? JSON.parse(r.details) : r.details,
      prevEventHash: r.prev_event_hash || undefined,
      eventHash: r.event_hash,
      createdAt: new Date(r.created_at),
    };
  }

  async listAuditEvents(filter?: { projectId?: string; taskId?: string }): Promise<AuditEvent[]> {
    let query = 'SELECT * FROM audit_events WHERE 1=1';
    const params: any[] = [];
    if (filter?.projectId) {
      params.push(filter.projectId);
      query += ` AND project_id = $${params.length}`;
    }
    if (filter?.taskId) {
      params.push(filter.taskId);
      query += ` AND task_id = $${params.length}`;
    }
    query += ' ORDER BY created_at DESC';
    const res = await this.pool.query(query, params);
    return res.rows.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      actor: r.actor,
      projectId: r.project_id || undefined,
      taskId: r.task_id || undefined,
      details: typeof r.details === 'string' ? JSON.parse(r.details) : r.details,
      prevEventHash: r.prev_event_hash || undefined,
      eventHash: r.event_hash,
      createdAt: new Date(r.created_at),
    }));
  }

  // --- Idempotency ---
  async getIdempotencyRecord(key: string): Promise<IdempotencyRecord | null> {
    const res = await this.pool.query('SELECT * FROM idempotency_keys WHERE key = $1', [key]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      key: r.key,
      projectId: r.project_id,
      status: r.status,
      responsePayload: r.response_payload ? (typeof r.response_payload === 'string' ? JSON.parse(r.response_payload) : r.response_payload) : undefined,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    };
  }

  async setIdempotencyRecord(record: IdempotencyRecord): Promise<void> {
    const query = `
      INSERT INTO idempotency_keys (key, project_id, status, response_payload, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (key) DO UPDATE
      SET status = EXCLUDED.status, response_payload = EXCLUDED.response_payload, updated_at = NOW();
    `;
    await this.pool.query(query, [
      record.key,
      record.projectId,
      record.status,
      record.responsePayload ? JSON.stringify(record.responsePayload) : null,
      record.createdAt,
      record.updatedAt,
    ]);
  }

  // --- Emergency Stop ---
  async getEmergencyStop(scope: string = 'GLOBAL'): Promise<EmergencyStopState> {
    const res = await this.pool.query('SELECT * FROM emergency_stop_state WHERE scope = $1', [scope]);
    if (res.rows.length === 0) {
      return { scope, isStopped: false };
    }
    const r = res.rows[0];
    return {
      scope: r.scope,
      isStopped: r.is_stopped,
      reason: r.reason || undefined,
      activatedBy: r.activated_by || undefined,
      activatedAt: r.activated_at ? new Date(r.activated_at) : undefined,
      deactivatedBy: r.deactivated_by || undefined,
      deactivatedAt: r.deactivated_at ? new Date(r.deactivated_at) : undefined,
    };
  }

  async setEmergencyStop(state: EmergencyStopState): Promise<void> {
    const query = `
      INSERT INTO emergency_stop_state (scope, is_stopped, reason, activated_by, activated_at, deactivated_by, deactivated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (scope) DO UPDATE
      SET is_stopped = EXCLUDED.is_stopped, reason = EXCLUDED.reason,
          activated_by = EXCLUDED.activated_by, activated_at = EXCLUDED.activated_at,
          deactivated_by = EXCLUDED.deactivated_by, deactivated_at = EXCLUDED.deactivated_at;
    `;
    await this.pool.query(query, [
      state.scope,
      state.isStopped,
      state.reason || null,
      state.activatedBy || null,
      state.activatedAt || null,
      state.deactivatedBy || null,
      state.deactivatedAt || null,
    ]);
  }

  // --- Worker Leases ---
  async acquireWorkerLease(taskId: string, workerId: string, durationMs: number): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const leaseExpiresAt = new Date(Date.now() + durationMs);
      const query = `
        INSERT INTO worker_leases (task_id, worker_id, lease_expires_at, heartbeat_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (task_id) DO UPDATE
        SET worker_id = EXCLUDED.worker_id, lease_expires_at = EXCLUDED.lease_expires_at, heartbeat_at = NOW()
        WHERE worker_leases.lease_expires_at < NOW() OR worker_leases.worker_id = EXCLUDED.worker_id
        RETURNING *;
      `;
      const res = await client.query(query, [taskId, workerId, leaseExpiresAt]);
      await client.query('COMMIT');
      return res.rows.length > 0;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async renewWorkerLease(taskId: string, workerId: string, durationMs: number): Promise<boolean> {
    const leaseExpiresAt = new Date(Date.now() + durationMs);
    const res = await this.pool.query(
      `UPDATE worker_leases 
       SET lease_expires_at = $1, heartbeat_at = NOW()
       WHERE task_id = $2 AND worker_id = $3
       RETURNING *;`,
      [leaseExpiresAt, taskId, workerId]
    );
    return res.rows.length > 0;
  }

  async releaseWorkerLease(taskId: string): Promise<void> {
    await this.pool.query('DELETE FROM worker_leases WHERE task_id = $1', [taskId]);
  }
}
