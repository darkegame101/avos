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
} from '../core/models';

export interface IdempotencyRecord {
  key: string;
  projectId: string;
  status: 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED';
  responsePayload?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkerLease {
  taskId: string;
  workerId: string;
  leaseExpiresAt: Date;
  heartbeatAt: Date;
}

export interface IStorageRepository {
  // Projects
  createProject(project: Project): Promise<Project>;
  getProject(id: string): Promise<Project | null>;
  updateProject(id: string, updates: Partial<Project>): Promise<Project>;
  listProjects(): Promise<Project[]>;

  // Tasks
  createTask(task: Task): Promise<Task>;
  getTask(id: string): Promise<Task | null>;
  getTaskByIdempotencyKey(key: string): Promise<Task | null>;
  updateTask(id: string, updates: Partial<Task>): Promise<Task>;
  updateTaskStatus(id: string, status: TaskStatus, reason?: string): Promise<Task>;
  listTasks(filter?: { projectId?: string; status?: TaskStatus }): Promise<Task[]>;
  acquireNextQueuedTask(workerId: string, leaseDurationMs: number): Promise<Task | null>;

  // Task Transitions
  recordTransition(transition: TaskTransition): Promise<TaskTransition>;
  getTaskTransitions(taskId: string): Promise<TaskTransition[]>;

  // Approvals
  createApproval(approval: ApprovalRequest): Promise<ApprovalRequest>;
  getApproval(id: string): Promise<ApprovalRequest | null>;
  getApprovalForTask(taskId: string): Promise<ApprovalRequest | null>;
  updateApprovalStatus(
    id: string,
    status: ApprovalStatus,
    approvedBy?: string,
    rejectionReason?: string
  ): Promise<ApprovalRequest>;
  listApprovals(filter?: { projectId?: string; status?: ApprovalStatus }): Promise<ApprovalRequest[]>;

  // Policies
  getPolicyRules(projectId: string): Promise<PolicyRule[]>;
  upsertPolicyRule(rule: PolicyRule): Promise<PolicyRule>;

  // Budget
  recordLedgerEntry(entry: BudgetLedgerEntry): Promise<BudgetLedgerEntry>;
  getProjectSpent(projectId: string): Promise<number>;
  getProjectLedger(projectId: string): Promise<BudgetLedgerEntry[]>;

  // Audit
  recordAuditEvent(event: AuditEvent): Promise<AuditEvent>;
  getLatestAuditEvent(): Promise<AuditEvent | null>;
  listAuditEvents(filter?: { projectId?: string; taskId?: string }): Promise<AuditEvent[]>;

  // Idempotency
  getIdempotencyRecord(key: string): Promise<IdempotencyRecord | null>;
  setIdempotencyRecord(record: IdempotencyRecord): Promise<void>;

  // Emergency Stop
  getEmergencyStop(scope?: string): Promise<EmergencyStopState>;
  setEmergencyStop(state: EmergencyStopState): Promise<void>;

  // Worker Leases
  acquireWorkerLease(taskId: string, workerId: string, durationMs: number): Promise<boolean>;
  renewWorkerLease(taskId: string, workerId: string, durationMs: number): Promise<boolean>;
  releaseWorkerLease(taskId: string): Promise<void>;
}
