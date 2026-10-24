import { describe, it, expect } from 'vitest';
import { MockRuntimeAdapter } from '../src/adapters/mockAdapter';
import { AutomatonRuntimeAdapter } from '../src/adapters/automatonAdapter';
import { Task } from '../src/core/models/task';

describe('Runtime Adapter Contract & Automaton Sandbox Tests', () => {
  describe('MockRuntimeAdapter Contract Adherence', () => {
    const adapter = new MockRuntimeAdapter({ mockCostPerTaskUsd: 0.02 });

    it('implements capabilities() correctly', () => {
      const caps = adapter.capabilities();
      expect(caps.name).toBe('MockRuntimeAdapter');
      expect(caps.supportedActions.length).toBeGreaterThan(0);
      expect(caps.supportsCancellation).toBe(true);
      expect(caps.supportsSandboxing).toBe(true);
    });

    it('submits, returns result, evidence, and cost telemetry', async () => {
      const task: Task = {
        id: 'task_contract_1',
        projectId: 'proj_mock',
        title: 'Contract Verification Task',
        status: 'RUNNING',
        actionClass: 'read.public',
        parameters: { test: true },
        idempotencyKey: 'idem_contract_1',
        estimatedCostUsd: 0.05,
        actualCostUsd: 0,
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const submission = await adapter.submit(task, task.idempotencyKey, {
        projectId: 'proj_mock',
        taskId: task.id,
      });

      expect(submission.status).toBe('COMPLETED');
      expect(submission.runtimeTaskId).toBeDefined();

      const status = await adapter.status(submission.runtimeTaskId);
      expect(status.status).toBe('COMPLETED');
      expect(status.progressPercent).toBe(100);

      const result = await adapter.result(submission.runtimeTaskId);
      expect(result.success).toBe(true);
      expect(result.output.executedAction).toBe('read.public');

      const evidence = await adapter.evidence(submission.runtimeTaskId);
      expect(evidence.artifacts.length).toBeGreaterThan(0);
      expect(evidence.artifacts[0].contentHash).toBeDefined();
      expect(evidence.logs.length).toBeGreaterThan(0);

      const cost = await adapter.cost(submission.runtimeTaskId);
      expect(cost.totalCostUsd).toBe(0.02);
    });

    it('health check returns healthy', async () => {
      const health = await adapter.health();
      expect(health.healthy).toBe(true);
    });
  });

  describe('Automaton Sandbox Constraints & Gated Execution', () => {
    const automaton = new AutomatonRuntimeAdapter({
      sandboxPath: './sandbox/automaton',
      allowExternalActions: false,
      maxExecutionTimeoutMs: 30000,
    });

    it('ALLOWS safe sandboxed research and drafting actions', async () => {
      const task: Task = {
        id: 'task_auto_safe',
        projectId: 'proj_auto',
        title: 'Draft Syllabus Comparison',
        status: 'RUNNING',
        actionClass: 'read.public',
        parameters: { topic: 'AWS DevOps' },
        idempotencyKey: 'idem_auto_1',
        estimatedCostUsd: 0.01,
        actualCostUsd: 0,
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const sub = await automaton.submit(task, task.idempotencyKey, {
        projectId: 'proj_auto',
        taskId: task.id,
      });

      expect(sub.status).toBe('COMPLETED');
    });

    it('BLOCKS high-risk actions (shell.execute, financial.transfer, agent.fund) at the adapter boundary', async () => {
      const dangerousActions = [
        'shell.execute',
        'financial.transfer',
        'agent.fund',
        'runtime.self_modify',
      ] as const;

      for (const actionClass of dangerousActions) {
        const task: Task = {
          id: `task_danger_${actionClass}`,
          projectId: 'proj_auto',
          title: `Dangerous ${actionClass}`,
          status: 'RUNNING',
          actionClass,
          parameters: { command: 'rm -rf /' },
          idempotencyKey: `idem_danger_${actionClass}`,
          estimatedCostUsd: 0,
          actualCostUsd: 0,
          retryCount: 0,
          maxRetries: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const sub = await automaton.submit(task, task.idempotencyKey, {
          projectId: 'proj_auto',
          taskId: task.id,
        });

        // Must fail at the adapter sandbox boundary!
        expect(sub.status).toBe('FAILED');
      }
    });
  });
});
