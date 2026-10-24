import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRepository } from '../src/storage/inMemoryRepository';
import { PolicyEngine } from '../src/core/policy/policyEngine';
import { EmergencyService, EmergencyStopActiveError } from '../src/core/emergency/emergencyService';
import { BudgetService } from '../src/core/budget/budgetLedger';
import { AuditLogger } from '../src/core/audit/auditLogger';
import { ExecutionGateway } from '../src/gateway/executionGateway';
import { MockRuntimeAdapter } from '../src/adapters/mockAdapter';
import { Task } from '../src/core/models/task';

describe('Emergency Stop & Execution Boundary Tests', () => {
  let storage: InMemoryRepository;
  let policyEngine: PolicyEngine;
  let emergencyService: EmergencyService;
  let budgetService: BudgetService;
  let auditLogger: AuditLogger;
  let gateway: ExecutionGateway;
  let adapter: MockRuntimeAdapter;

  beforeEach(async () => {
    storage = new InMemoryRepository();
    policyEngine = new PolicyEngine(storage);
    emergencyService = new EmergencyService(storage);
    budgetService = new BudgetService(storage);
    auditLogger = new AuditLogger(storage);
    gateway = new ExecutionGateway(storage, policyEngine, emergencyService, budgetService, auditLogger);
    adapter = new MockRuntimeAdapter();

    await storage.createProject({
      id: 'proj_emerg',
      name: 'Emergency Test Project',
      status: 'ACTIVE',
      budgetCeilingUsd: 100,
      spentUsd: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it('allows execution when emergency stop is NOT active', async () => {
    const task: Task = {
      id: 'task_safe_1',
      projectId: 'proj_emerg',
      title: 'Safe Market Research',
      status: 'QUEUED',
      actionClass: 'read.public',
      parameters: { query: 'certification syllabus' },
      idempotencyKey: 'idem_safe_1',
      estimatedCostUsd: 0.01,
      actualCostUsd: 0,
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await storage.createTask(task);
    const result = await gateway.executeTask(task, adapter);
    expect(result.success).toBe(true);

    const completed = await storage.getTask(task.id);
    expect(completed?.status).toBe('COMPLETED');
  });

  it('BLOCKS new action execution synchronously when GLOBAL emergency stop is activated', async () => {
    // Activate global emergency stop
    await emergencyService.triggerStop('GLOBAL', 'Anomalous billing detected', 'owner');

    const isStopped = await emergencyService.isStopped();
    expect(isStopped.stopped).toBe(true);
    expect(isStopped.reason).toBe('Anomalous billing detected');

    const task: Task = {
      id: 'task_stopped_1',
      projectId: 'proj_emerg',
      title: 'Blocked Task',
      status: 'QUEUED',
      actionClass: 'read.public',
      parameters: {},
      idempotencyKey: 'idem_stopped_1',
      estimatedCostUsd: 0.01,
      actualCostUsd: 0,
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await storage.createTask(task);

    // Gateway must block task immediately
    await expect(gateway.executeTask(task, adapter)).rejects.toThrow(EmergencyStopActiveError);

    // Verify audit event was recorded for stop activation
    const latestAudit = await storage.getLatestAuditEvent();
    expect(latestAudit?.eventType).toBe('EMERGENCY_STOP_ACTIVATED');
  });

  it('BLOCKS project-scoped actions when project emergency stop is active, but allows other projects', async () => {
    await storage.createProject({
      id: 'proj_other',
      name: 'Unrelated Project',
      status: 'ACTIVE',
      budgetCeilingUsd: 100,
      spentUsd: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Trigger stop ONLY for proj_emerg
    await emergencyService.triggerStop('proj_emerg', 'Compromised credential in proj_emerg', 'owner');

    // proj_emerg task is blocked
    const blockedTask: Task = {
      id: 'task_blocked_proj',
      projectId: 'proj_emerg',
      title: 'Should be blocked',
      status: 'QUEUED',
      actionClass: 'read.public',
      parameters: {},
      idempotencyKey: 'idem_blk_proj',
      estimatedCostUsd: 0.01,
      actualCostUsd: 0,
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await storage.createTask(blockedTask);
    await expect(gateway.executeTask(blockedTask, adapter)).rejects.toThrow(EmergencyStopActiveError);

    // proj_other task proceeds safely! (Independent safe work is not blocked)
    const allowedTask: Task = {
      id: 'task_allowed_proj',
      projectId: 'proj_other',
      title: 'Should proceed',
      status: 'QUEUED',
      actionClass: 'read.public',
      parameters: {},
      idempotencyKey: 'idem_allow_proj',
      estimatedCostUsd: 0.01,
      actualCostUsd: 0,
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await storage.createTask(allowedTask);
    const result = await gateway.executeTask(allowedTask, adapter);
    expect(result.success).toBe(true);
  });

  it('prohibits resuming without verified root-cause investigation', async () => {
    await emergencyService.triggerStop('GLOBAL', 'Test stop', 'owner');

    // Attempting to resume without completing investigation throws error
    await expect(
      emergencyService.resume('GLOBAL', 'Quick resume', 'owner', false)
    ).rejects.toThrow(/Cannot resume operations without confirmed root-cause investigation/);
  });

  it('successfully resumes execution after verified investigation', async () => {
    await emergencyService.triggerStop('GLOBAL', 'Test stop', 'owner');

    // Resume with investigation confirmation
    await emergencyService.resume('GLOBAL', 'Issue root cause addressed and verified', 'owner', true);

    const isStopped = await emergencyService.isStopped();
    expect(isStopped.stopped).toBe(false);

    // Execution now succeeds
    const task: Task = {
      id: 'task_resumed_1',
      projectId: 'proj_emerg',
      title: 'Resumed Task',
      status: 'QUEUED',
      actionClass: 'read.public',
      parameters: {},
      idempotencyKey: 'idem_resumed_1',
      estimatedCostUsd: 0.01,
      actualCostUsd: 0,
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await storage.createTask(task);
    const res = await gateway.executeTask(task, adapter);
    expect(res.success).toBe(true);
  });
});
