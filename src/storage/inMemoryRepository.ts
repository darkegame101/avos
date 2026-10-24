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
  isValidTransition,
  createDefaultProjectPolicies,
} from '../core/models';
import { IStorageRepository, IdempotencyRecord, WorkerLease } from './repository';

export class InMemoryRepository implements IStorageRepository {
  private projects = new Map<string, Project>();
  private tasks = new Map<string, Task>();
  private taskTransitions: TaskTransition[] = [];
  private approvals = new Map<string, ApprovalRequest>();
  private policies = new Map<string, PolicyRule>();
  private ledger: BudgetLedgerEntry[] = [];
  private auditEvents: AuditEvent[] = [];
  private idempotency = new Map<string, IdempotencyRecord>();
  private leases = new Map<string, WorkerLease>();
  private emergencyStops = new Map<string, EmergencyStopState>();

  constructor() {
    this.emergencyStops.set('GLOBAL', {
      scope: 'GLOBAL',
      isStopped: false,
      reason: 'Initialized',
    });
  }

  // Helper for test cleanup
  public clear(): void {
    this.projects.clear();
    this.tasks.clear();
    this.taskTransitions = [];
    this.approvals.clear();
    this.policies.clear();
    this.ledger = [];
    this.auditEvents = [];
    this.idempotency.clear();
    this.leases.clear();
    this.emergencyStops.clear();
    this.emergencyStops.set('GLOBAL', {
      scope: 'GLOBAL',
      isStopped: false,
      reason: 'Reset',
    });
  }

  // --- Projects ---
  async createProject(project: Project): Promise<Project> {
    if (this.projects.has(project.id)) {
      throw new Error(`Project ${project.id} already exists`);
    }
    this.projects.set(project.id, { ...project });
    // Initialize default deny-by-default policies
    const defaults = createDefaultProjectPolicies(project.id);
    for (const rule of defaults) {
      this.policies.set(`${project.id}:${rule.actionClass}`, rule);
    }
    return { ...project };
  }

  async getProject(id: string): Promise<Project | null> {
    const p = this.projects.get(id);
    return p ? { ...p } : null;
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<Project> {
    const p = this.projects.get(id);
    if (!p) throw new Error(`Project ${id} not found`);
    const updated = { ...p, ...updates, updatedAt: new Date() };
    this.projects.set(id, updated);
    return { ...updated };
  }

  async listProjects(): Promise<Project[]> {
    return Array.from(this.projects.values()).map((p) => ({ ...p }));
  }

  // --- Tasks ---
  async createTask(task: Task): Promise<Task> {
    if (this.tasks.has(task.id)) {
      throw new Error(`Task with id ${task.id} already exists`);
    }
    // Check idempotency key uniqueness
    for (const existing of this.tasks.values()) {
      if (existing.idempotencyKey === task.idempotencyKey) {
        throw new Error(`Duplicate idempotency key: ${task.idempotencyKey}`);
      }
    }
    this.tasks.set(task.id, { ...task });
    return { ...task };
  }

  async getTask(id: string): Promise<Task | null> {
    const t = this.tasks.get(id);
    return t ? { ...t } : null;
  }

  async getTaskByIdempotencyKey(key: string): Promise<Task | null> {
    for (const task of this.tasks.values()) {
      if (task.idempotencyKey === key) {
        return { ...task };
      }
    }
    return null;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task> {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`Task ${id} not found`);
    const updated = { ...t, ...updates, updatedAt: new Date() };
    this.tasks.set(id, updated);
    return { ...updated };
  }

  async updateTaskStatus(id: string, status: TaskStatus, reason?: string): Promise<Task> {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`Task ${id} not found`);

    if (t.status !== status && !isValidTransition(t.status, status)) {
      throw new Error(`Invalid state transition from ${t.status} to ${status}`);
    }

    const previousStatus = t.status;
    const updated = { ...t, status, updatedAt: new Date() };
    this.tasks.set(id, updated);

    // Record transition
    await this.recordTransition({
      id: `trans_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      taskId: id,
      fromStatus: previousStatus,
      toStatus: status,
      reason,
      createdAt: new Date(),
    });

    return { ...updated };
  }

  async listTasks(filter?: { projectId?: string; status?: TaskStatus }): Promise<Task[]> {
    let result = Array.from(this.tasks.values());
    if (filter?.projectId) {
      result = result.filter((t) => t.projectId === filter.projectId);
    }
    if (filter?.status) {
      result = result.filter((t) => t.status === filter.status);
    }
    return result.map((t) => ({ ...t }));
  }

  async acquireNextQueuedTask(workerId: string, leaseDurationMs: number): Promise<Task | null> {
    const now = new Date();
    for (const task of this.tasks.values()) {
      if (task.status === 'QUEUED') {
        const lease = this.leases.get(task.id);
        if (!lease || lease.leaseExpiresAt < now) {
          // Acquire lease atomically
          const leaseExpiresAt = new Date(Date.now() + leaseDurationMs);
          this.leases.set(task.id, {
            taskId: task.id,
            workerId,
            leaseExpiresAt,
            heartbeatAt: now,
          });
          // Update status to RUNNING
          await this.updateTaskStatus(task.id, 'RUNNING', `Acquired by worker ${workerId}`);
          return { ...task, status: 'RUNNING' };
        }
      }
    }
    return null;
  }

  // --- Transitions ---
  async recordTransition(transition: TaskTransition): Promise<TaskTransition> {
    this.taskTransitions.push({ ...transition });
    return { ...transition };
  }

  async getTaskTransitions(taskId: string): Promise<TaskTransition[]> {
    return this.taskTransitions
      .filter((t) => t.taskId === taskId)
      .map((t) => ({ ...t }));
  }

  // --- Approvals ---
  async createApproval(approval: ApprovalRequest): Promise<ApprovalRequest> {
    this.approvals.set(approval.id, { ...approval });
    return { ...approval };
  }

  async getApproval(id: string): Promise<ApprovalRequest | null> {
    const a = this.approvals.get(id);
    return a ? { ...a } : null;
  }

  async getApprovalForTask(taskId: string): Promise<ApprovalRequest | null> {
    for (const app of this.approvals.values()) {
      if (app.taskId === taskId) {
        return { ...app };
      }
    }
    return null;
  }

  async updateApprovalStatus(
    id: string,
    status: ApprovalStatus,
    approvedBy?: string,
    rejectionReason?: string
  ): Promise<ApprovalRequest> {
    const app = this.approvals.get(id);
    if (!app) throw new Error(`Approval ${id} not found`);
    const updated: ApprovalRequest = {
      ...app,
      status,
      approvedBy: approvedBy ?? app.approvedBy,
      approvedAt: status === 'APPROVED' ? new Date() : app.approvedAt,
      rejectionReason: rejectionReason ?? app.rejectionReason,
    };
    this.approvals.set(id, updated);
    return { ...updated };
  }

  async listApprovals(filter?: { projectId?: string; status?: ApprovalStatus }): Promise<ApprovalRequest[]> {
    let result = Array.from(this.approvals.values());
    if (filter?.projectId) {
      result = result.filter((a) => a.projectId === filter.projectId);
    }
    if (filter?.status) {
      result = result.filter((a) => a.status === filter.status);
    }
    return result.map((a) => ({ ...a }));
  }

  // --- Policies ---
  async getPolicyRules(projectId: string): Promise<PolicyRule[]> {
    return Array.from(this.policies.values())
      .filter((r) => r.projectId === projectId)
      .map((r) => ({ ...r }));
  }

  async upsertPolicyRule(rule: PolicyRule): Promise<PolicyRule> {
    this.policies.set(`${rule.projectId}:${rule.actionClass}`, { ...rule });
    return { ...rule };
  }

  // --- Budget ---
  async recordLedgerEntry(entry: BudgetLedgerEntry): Promise<BudgetLedgerEntry> {
    this.ledger.push({ ...entry });
    // If it's ACTUAL spend, update project total
    if (entry.entryType === 'ACTUAL') {
      const p = this.projects.get(entry.projectId);
      if (p) {
        p.spentUsd += entry.amountUsd;
        p.updatedAt = new Date();
      }
    }
    return { ...entry };
  }

  async getProjectSpent(projectId: string): Promise<number> {
    return this.ledger
      .filter((e) => e.projectId === projectId && e.entryType === 'ACTUAL')
      .reduce((sum, e) => sum + e.amountUsd, 0);
  }

  async getProjectLedger(projectId: string): Promise<BudgetLedgerEntry[]> {
    return this.ledger
      .filter((e) => e.projectId === projectId)
      .map((e) => ({ ...e }));
  }

  // --- Audit ---
  async recordAuditEvent(event: AuditEvent): Promise<AuditEvent> {
    this.auditEvents.push({ ...event });
    return { ...event };
  }

  async getLatestAuditEvent(): Promise<AuditEvent | null> {
    if (this.auditEvents.length === 0) return null;
    return { ...this.auditEvents[this.auditEvents.length - 1] };
  }

  async listAuditEvents(filter?: { projectId?: string; taskId?: string }): Promise<AuditEvent[]> {
    let res = this.auditEvents;
    if (filter?.projectId) {
      res = res.filter((e) => e.projectId === filter.projectId);
    }
    if (filter?.taskId) {
      res = res.filter((e) => e.taskId === filter.taskId);
    }
    return res.map((e) => ({ ...e }));
  }

  // --- Idempotency ---
  async getIdempotencyRecord(key: string): Promise<IdempotencyRecord | null> {
    const rec = this.idempotency.get(key);
    return rec ? { ...rec } : null;
  }

  async setIdempotencyRecord(record: IdempotencyRecord): Promise<void> {
    this.idempotency.set(record.key, { ...record, updatedAt: new Date() });
  }

  // --- Emergency Stop ---
  async getEmergencyStop(scope: string = 'GLOBAL'): Promise<EmergencyStopState> {
    const s = this.emergencyStops.get(scope);
    if (!s) {
      return { scope, isStopped: false };
    }
    return { ...s };
  }

  async setEmergencyStop(state: EmergencyStopState): Promise<void> {
    this.emergencyStops.set(state.scope, { ...state });
  }

  // --- Worker Leases ---
  async acquireWorkerLease(taskId: string, workerId: string, durationMs: number): Promise<boolean> {
    const now = new Date();
    const existing = this.leases.get(taskId);
    if (existing && existing.leaseExpiresAt > now && existing.workerId !== workerId) {
      return false; // Still held by another worker
    }
    this.leases.set(taskId, {
      taskId,
      workerId,
      leaseExpiresAt: new Date(Date.now() + durationMs),
      heartbeatAt: now,
    });
    return true;
  }

  async renewWorkerLease(taskId: string, workerId: string, durationMs: number): Promise<boolean> {
    const lease = this.leases.get(taskId);
    if (!lease || lease.workerId !== workerId) {
      return false;
    }
    lease.leaseExpiresAt = new Date(Date.now() + durationMs);
    lease.heartbeatAt = new Date();
    return true;
  }

  async releaseWorkerLease(taskId: string): Promise<void> {
    this.leases.delete(taskId);
  }
}
