import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRepository } from '../src/storage/inMemoryRepository';
import { PolicyEngine } from '../src/core/policy/policyEngine';
import { EmergencyService } from '../src/core/emergency/emergencyService';
import { BudgetService } from '../src/core/budget/budgetLedger';
import { AuditLogger } from '../src/core/audit/auditLogger';
import { ExecutionGateway, ConcurrentExecutionError } from '../src/gateway/executionGateway';
import { MockRuntimeAdapter } from '../src/adapters/mockAdapter';
import { DurableQueue } from '../src/queue/durableQueue';
import { WorkerManager } from '../src/queue/workerManager';
import { Task } from '../src/core/models/task';

describe('Idempotency, Worker Failure and Recovery Tests', () => {
  let storage: InMemoryRepository;
  let policyEngine: PolicyEngine;
  let emergencyService: EmergencyService;
  let budgetService: BudgetService;
  let auditLogger: AuditLogger;
  let gateway: ExecutionGateway;
  let adapter: MockRuntimeAdapter;
  let queue: DurableQueue;
  let workerManager: WorkerManager;

  beforeEach(async () => {
    storage = new InMemoryRepository();
    policyEngine = new PolicyEngine(storage);
    emergencyService = new EmergencyService(storage);
    budgetService = new BudgetService(storage);
    auditLogger = new AuditLogger(storage);
    gateway = new ExecutionGateway(storage, policyEngine, emergencyService, budgetService, auditLogger);
    adapter = new MockRuntimeAdapter();
    queue = new DurableQueue(storage, auditLogger);
    workerManager = new WorkerManager(queue, gateway, adapter, storage, {
      concurrency: 2,
      pollIntervalMs: 100,
      leaseDurationMs: 1000,
    });

    await storage.createProject({
      id: 'proj_idem',
      name: 'Idempotency Venture',
      status: 'ACTIVE',
      budgetCeilingUsd: 100,
      spentUsd: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  describe('Durable Idempotency & Duplicate Prevention', () => {
    it('returns cached result for duplicate submission with same idempotency key without re-running', async () => {
      const task: Task = {
        id: 'task_dup_1',
        projectId: 'proj_idem',
        title: 'Single Execution Task',
        status: 'QUEUED',
        actionClass: 'read.public',
        parameters: { action: 'fetch' },
        idempotencyKey: 'idem_unique_key_100',
        estimatedCostUsd: 0.05,
        actualCostUsd: 0,
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await storage.createTask(task);

      // First run: executes through adapter
      const result1 = await gateway.executeTask(task, adapter);
      expect(result1.success).toBe(true);

      // Verify spend was recorded
      const spentAfterRun1 = await storage.getProjectSpent('proj_idem');
      expect(spentAfterRun1).toBeGreaterThan(0);

      // Second run with SAME task / idempotency key:
      const result2 = await gateway.executeTask(task, adapter);
      expect(result2.success).toBe(true);

      // CRITICAL: Spent must NOT increase because adapter was not called a second time!
      const spentAfterRun2 = await storage.getProjectSpent('proj_idem');
      expect(spentAfterRun2).toBe(spentAfterRun1);
    });

    it('rejects concurrent duplicate execution while first execution is in-flight', async () => {
      const task: Task = {
        id: 'task_concurrent',
        projectId: 'proj_idem',
        title: 'Concurrent Task',
        status: 'QUEUED',
        actionClass: 'read.public',
        parameters: {},
        idempotencyKey: 'idem_concurrent_999',
        estimatedCostUsd: 0.01,
        actualCostUsd: 0,
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Simulate first worker acquiring lock
      await storage.setIdempotencyRecord({
        key: 'idem_concurrent_999',
        projectId: 'proj_idem',
        status: 'EXECUTING',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Second worker attempts to execute same key
      await expect(
        gateway.assertCanExecute({
          projectId: 'proj_idem',
          taskId: 'task_concurrent',
          actionClass: 'read.public',
          parameters: {},
          estimatedCostUsd: 0.01,
          idempotencyKey: 'idem_concurrent_999',
        })
      ).rejects.toThrow(ConcurrentExecutionError);
    });
  });

  describe('Worker Failure, Retry Limits & Dead-Letter Handling', () => {
    it('moves failing task to DEAD-LETTER (FAILED) after exceeding max retries', async () => {
      const failingTask: Task = {
        id: 'task_failing_1',
        projectId: 'proj_idem',
        title: 'Task Destined to Fail',
        status: 'RUNNING',
        actionClass: 'read.public',
        parameters: {},
        idempotencyKey: 'idem_fail_1',
        estimatedCostUsd: 0.01,
        actualCostUsd: 0,
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await storage.createTask(failingTask);

      const err = new Error('Simulated network timeout');

      // Attempt 1 -> Re-queued
      const res1 = await queue.handleRetryOrDeadLetter(failingTask, err);
      expect(res1).toBe('RETRIED');
      let current = await storage.getTask(failingTask.id);
      expect(current?.retryCount).toBe(1);
      expect(current?.status).toBe('QUEUED');

      // Attempt 2 -> Re-queued
      failingTask.retryCount = 1;
      const res2 = await queue.handleRetryOrDeadLetter(failingTask, err);
      expect(res2).toBe('RETRIED');
      current = await storage.getTask(failingTask.id);
      expect(current?.retryCount).toBe(2);

      // Attempt 3 -> Max retries reached -> Moved to DEAD-LETTER
      failingTask.retryCount = 2;
      const res3 = await queue.handleRetryOrDeadLetter(failingTask, err);
      expect(res3).toBe('DEAD_LETTER');

      current = await storage.getTask(failingTask.id);
      expect(current?.status).toBe('FAILED');
      expect(current?.errorDetails?.message).toContain('Exhausted maximum retries (3)');
    });

    it('worker manager processes queued tasks asynchronously within concurrency bounds', async () => {
      // Create 3 tasks
      for (let i = 1; i <= 3; i++) {
        const task: Task = {
          id: `task_batch_${i}`,
          projectId: 'proj_idem',
          title: `Batch Task ${i}`,
          status: 'QUEUED',
          actionClass: 'read.public',
          parameters: { idx: i },
          idempotencyKey: `idem_batch_${i}`,
          estimatedCostUsd: 0.01,
          actualCostUsd: 0,
          retryCount: 0,
          maxRetries: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await storage.createTask(task);
      }

      // Concurrency is set to 2. Let's poll twice.
      const processed1 = await workerManager.poll();
      expect(processed1).toBe(true);

      const processed2 = await workerManager.poll();
      expect(processed2).toBe(true);

      // Active jobs should now be 2 (concurrency limit reached)
      const status = workerManager.getStatus();
      expect(status.activeJobs).toBeLessThanOrEqual(2);

      // Wait briefly for execution completion
      await new Promise((r) => setTimeout(r, 200));

      const completed = await storage.listTasks({ projectId: 'proj_idem', status: 'COMPLETED' });
      expect(completed.length).toBeGreaterThanOrEqual(2);
    });
  });
});
