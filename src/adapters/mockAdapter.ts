import crypto from 'crypto';
import { Task } from '../core/models/task';
import { ActionClassEnum } from '../core/models/action';
import {
  IRuntimeAdapter,
  RuntimeCapabilities,
  ExecutionContext,
  RuntimeSubmissionResult,
  RuntimeTaskStatus,
  ExecutionResult,
  ExecutionEvidence,
  AdapterHealth,
  CostTelemetry,
  StructuredRuntimeError,
} from './runtimeAdapter';

export interface MockAdapterOptions {
  simulatedLatencyMs?: number;
  failureMode?: 'NONE' | 'TIMEOUT' | 'NETWORK' | 'CRASH_AFTER_SUBMISSION' | 'PERMANENT_ERROR';
  mockCostPerTaskUsd?: number;
}

export class MockRuntimeAdapter implements IRuntimeAdapter {
  private tasks = new Map<string, {
    task: Task;
    idempotencyKey: string;
    context: ExecutionContext;
    status: RuntimeTaskStatus['status'];
    result?: ExecutionResult;
    evidence?: ExecutionEvidence;
    error?: StructuredRuntimeError;
    costUsd: number;
  }>();

  constructor(private options: MockAdapterOptions = {}) {}

  public setOptions(options: MockAdapterOptions): void {
    this.options = { ...this.options, ...options };
  }

  capabilities(): RuntimeCapabilities {
    return {
      name: 'MockRuntimeAdapter',
      version: '1.0.0',
      supportedActions: ActionClassEnum.options,
      supportsCancellation: true,
      supportsSandboxing: true,
    };
  }

  async submit(task: Task, idempotencyKey: string, context: ExecutionContext): Promise<RuntimeSubmissionResult> {
    const runtimeTaskId = `mock_rt_${task.id}_${Date.now()}`;

    if (this.options.failureMode === 'TIMEOUT') {
      const err: StructuredRuntimeError = {
        code: 'TIMEOUT',
        message: 'Mock execution timed out after 30000ms',
        retryable: true,
      };
      this.tasks.set(runtimeTaskId, {
        task,
        idempotencyKey,
        context,
        status: 'FAILED',
        error: err,
        costUsd: 0.001,
      });
      return { runtimeTaskId, status: 'FAILED' };
    }

    if (this.options.failureMode === 'NETWORK') {
      const err: StructuredRuntimeError = {
        code: 'NETWORK',
        message: 'Mock socket disconnected during payload transmission',
        retryable: true,
      };
      this.tasks.set(runtimeTaskId, {
        task,
        idempotencyKey,
        context,
        status: 'FAILED',
        error: err,
        costUsd: 0,
      });
      return { runtimeTaskId, status: 'FAILED' };
    }

    if (this.options.failureMode === 'PERMANENT_ERROR') {
      const err: StructuredRuntimeError = {
        code: 'POLICY_VIOLATION',
        message: 'Non-retryable execution error in simulated worker',
        retryable: false,
      };
      this.tasks.set(runtimeTaskId, {
        task,
        idempotencyKey,
        context,
        status: 'FAILED',
        error: err,
        costUsd: 0.002,
      });
      return { runtimeTaskId, status: 'FAILED' };
    }

    const cost = this.options.mockCostPerTaskUsd ?? 0.005;
    const evidencePayload = `Evidence for task ${task.id}: action=${task.actionClass}`;
    const contentHash = crypto.createHash('sha256').update(evidencePayload).digest('hex');

    const evidence: ExecutionEvidence = {
      runtimeTaskId,
      timestamp: new Date(),
      artifacts: [
        {
          name: `output-${task.id}.json`,
          contentHash,
          uri: `sandbox://artifacts/${task.id}.json`,
        },
      ],
      logs: [
        `[MOCK] Started execution for task ${task.id}`,
        `[MOCK] Action class: ${task.actionClass}`,
        `[MOCK] Execution completed successfully with mock output.`,
      ],
    };

    const result: ExecutionResult = {
      runtimeTaskId,
      success: true,
      output: {
        executedAction: task.actionClass,
        targetResource: task.targetResource,
        parameters: task.parameters,
        summary: `Successfully completed ${task.title} via MockAdapter`,
      },
    };

    this.tasks.set(runtimeTaskId, {
      task,
      idempotencyKey,
      context,
      status: 'COMPLETED',
      result,
      evidence,
      costUsd: cost,
    });

    return { runtimeTaskId, status: 'COMPLETED' };
  }

  async status(runtimeTaskId: string): Promise<RuntimeTaskStatus> {
    const item = this.tasks.get(runtimeTaskId);
    if (!item) {
      return { runtimeTaskId, status: 'FAILED', error: { code: 'UNKNOWN', message: 'Task not found', retryable: false } };
    }
    return {
      runtimeTaskId,
      status: item.status,
      progressPercent: item.status === 'COMPLETED' ? 100 : 0,
      error: item.error,
    };
  }

  async cancel(runtimeTaskId: string): Promise<boolean> {
    const item = this.tasks.get(runtimeTaskId);
    if (!item) return false;
    item.status = 'CANCELLED';
    return true;
  }

  async result(runtimeTaskId: string): Promise<ExecutionResult> {
    const item = this.tasks.get(runtimeTaskId);
    if (!item || !item.result) {
      throw new Error(`No result found for runtime task ${runtimeTaskId}`);
    }
    return item.result;
  }

  async evidence(runtimeTaskId: string): Promise<ExecutionEvidence> {
    const item = this.tasks.get(runtimeTaskId);
    if (!item || !item.evidence) {
      throw new Error(`No evidence found for runtime task ${runtimeTaskId}`);
    }
    return item.evidence;
  }

  async health(): Promise<AdapterHealth> {
    return {
      healthy: true,
      latencyMs: 1,
      message: 'MockAdapter operational',
    };
  }

  async cost(runtimeTaskId: string): Promise<CostTelemetry> {
    const item = this.tasks.get(runtimeTaskId);
    const total = item ? item.costUsd : 0;
    return {
      runtimeTaskId,
      computeCostUsd: total * 0.4,
      tokenCostUsd: total * 0.6,
      totalCostUsd: total,
    };
  }
}
