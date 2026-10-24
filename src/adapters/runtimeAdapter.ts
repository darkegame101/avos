import { Task } from '../core/models/task';
import { ActionClass } from '../core/models/action';

export interface RuntimeCapabilities {
  name: string;
  version: string;
  supportedActions: ActionClass[];
  supportsCancellation: boolean;
  supportsSandboxing: boolean;
}

export interface ExecutionContext {
  projectId: string;
  taskId: string;
  timeoutMs?: number;
}

export interface RuntimeSubmissionResult {
  runtimeTaskId: string;
  status: 'SUBMITTED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
}

export interface StructuredRuntimeError {
  code: 'TIMEOUT' | 'NETWORK' | 'POLICY_VIOLATION' | 'EXECUTION_FAILED' | 'RESOURCE_EXHAUSTED' | 'UNKNOWN';
  message: string;
  retryable: boolean;
  details?: Record<string, any>;
}

export interface RuntimeTaskStatus {
  runtimeTaskId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progressPercent?: number;
  error?: StructuredRuntimeError;
}

export interface ExecutionResult {
  runtimeTaskId: string;
  success: boolean;
  output: Record<string, any>;
  error?: StructuredRuntimeError;
}

export interface ExecutionEvidence {
  runtimeTaskId: string;
  timestamp: Date;
  artifacts: Array<{ name: string; contentHash: string; uri?: string }>;
  logs: string[];
}

export interface AdapterHealth {
  healthy: boolean;
  latencyMs: number;
  message?: string;
}

export interface CostTelemetry {
  runtimeTaskId: string;
  computeCostUsd: number;
  tokenCostUsd: number;
  totalCostUsd: number;
}

export interface IRuntimeAdapter {
  capabilities(): RuntimeCapabilities;
  submit(task: Task, idempotencyKey: string, context: ExecutionContext): Promise<RuntimeSubmissionResult>;
  status(runtimeTaskId: string): Promise<RuntimeTaskStatus>;
  cancel(runtimeTaskId: string): Promise<boolean>;
  result(runtimeTaskId: string): Promise<ExecutionResult>;
  evidence(runtimeTaskId: string): Promise<ExecutionEvidence>;
  health(): Promise<AdapterHealth>;
  cost(runtimeTaskId: string): Promise<CostTelemetry>;
}
