import { Task } from '../core/models/task';
import { ActionClass } from '../core/models/action';
import { computeParametersHash, isApprovalValid } from '../core/models/approval';
import { IStorageRepository, IdempotencyRecord } from '../storage/repository';
import { PolicyEngine, PolicyViolationError } from '../core/policy/policyEngine';
import { EmergencyService, EmergencyStopActiveError } from '../core/emergency/emergencyService';
import { BudgetService, BudgetExceededError } from '../core/budget/budgetLedger';
import { AuditLogger } from '../core/audit/auditLogger';
import { IRuntimeAdapter, ExecutionResult } from '../adapters/runtimeAdapter';

export class ApprovalMissingOrInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalMissingOrInvalidError';
  }
}

export class ConcurrentExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrentExecutionError';
  }
}

export interface ExecutionGateRequest {
  projectId: string;
  taskId: string;
  actionClass: ActionClass;
  targetResource?: string;
  parameters: Record<string, any>;
  estimatedCostUsd: number;
  idempotencyKey: string;
}

export class ExecutionGateway {
  constructor(
    private storage: IStorageRepository,
    private policyEngine: PolicyEngine,
    private emergencyService: EmergencyService,
    private budgetService: BudgetService,
    private auditLogger: AuditLogger
  ) {}

  /**
   * CRITICAL SECURITY BOUNDARY:
   * Validates all safety gates in hard code before any execution or external call.
   */
  async assertCanExecute(req: ExecutionGateRequest): Promise<void> {
    // 1. EMERGENCY STOP GATE (Checked synchronously immediately before execution)
    const stopCheck = await this.emergencyService.isStopped(req.projectId);
    if (stopCheck.stopped) {
      throw new EmergencyStopActiveError(
        `Execution blocked: Emergency Stop is active on scope '${stopCheck.scope}'. Reason: ${stopCheck.reason}`
      );
    }

    // 2. ACTION POLICY GATE (Deny-by-default)
    await this.policyEngine.assertActionAllowed(req.projectId, req.actionClass);

    // 3. APPROVAL & SCOPE GATE
    const requiresApproval = await this.policyEngine.requiresApproval(req.projectId, req.actionClass);
    if (requiresApproval) {
      const approval = await this.storage.getApprovalForTask(req.taskId);
      if (!approval) {
        throw new ApprovalMissingOrInvalidError(
          `Action '${req.actionClass}' requires owner approval, but no approval record exists for task '${req.taskId}'`
        );
      }

      // Check anti-tampering parameters hash
      const currentHash = computeParametersHash(req.parameters);
      const validation = isApprovalValid(approval, currentHash);
      if (!validation.valid) {
        throw new ApprovalMissingOrInvalidError(
          `Approval for task '${req.taskId}' is invalid: ${validation.reason}`
        );
      }

      // Verify exact target match
      if (req.targetResource && approval.targetResource !== req.targetResource) {
        throw new ApprovalMissingOrInvalidError(
          `Target resource mismatch: approved for '${approval.targetResource}', requested '${req.targetResource}'`
        );
      }

      // Verify exact project match (Hermetic Project Isolation)
      if (approval.projectId !== req.projectId) {
        throw new ApprovalMissingOrInvalidError(
          `Project isolation violation: approval belongs to project '${approval.projectId}', requested for '${req.projectId}'`
        );
      }

      // Verify budget ceiling
      if (req.estimatedCostUsd > approval.budgetCeilingUsd) {
        throw new ApprovalMissingOrInvalidError(
          `Estimated cost $${req.estimatedCostUsd.toFixed(2)} exceeds approved budget ceiling of $${approval.budgetCeilingUsd.toFixed(2)}`
        );
      }
    }

    // 4. BUDGET CEILING GATE
    await this.budgetService.assertWithinBudget(req.projectId, req.estimatedCostUsd);

    // 5. IDEMPOTENCY LOCK GATE
    const existingKey = await this.storage.getIdempotencyRecord(req.idempotencyKey);
    if (existingKey) {
      if (existingKey.status === 'COMPLETED') {
        // Return without re-executing
        return;
      }
      if (existingKey.status === 'EXECUTING') {
        throw new ConcurrentExecutionError(
          `Task with idempotency key '${req.idempotencyKey}' is already executing in another worker`
        );
      }
    }

    // Acquire idempotency lock
    await this.storage.setIdempotencyRecord({
      key: req.idempotencyKey,
      projectId: req.projectId,
      status: 'EXECUTING',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Executes a task through the gateway and manages state, evidence, costs, and audit.
   */
  async executeTask(task: Task, adapter: IRuntimeAdapter): Promise<ExecutionResult> {
    const gateRequest: ExecutionGateRequest = {
      projectId: task.projectId,
      taskId: task.id,
      actionClass: task.actionClass,
      targetResource: task.targetResource,
      parameters: task.parameters,
      estimatedCostUsd: task.estimatedCostUsd,
      idempotencyKey: task.idempotencyKey,
    };

    // Check if duplicate already completed
    const existingRecord = await this.storage.getIdempotencyRecord(task.idempotencyKey);
    if (existingRecord?.status === 'COMPLETED' && existingRecord.responsePayload) {
      return {
        runtimeTaskId: `cached_${task.id}`,
        success: true,
        output: existingRecord.responsePayload,
      };
    }

    // Pass through all gates
    await this.assertCanExecute(gateRequest);

    try {
      // Dispatch to adapter
      const submission = await adapter.submit(task, task.idempotencyKey, {
        projectId: task.projectId,
        taskId: task.id,
      });

      if (submission.status === 'FAILED') {
        throw new Error(`Runtime adapter submission failed for task ${task.id}`);
      }

      // Capture results and evidence
      const result = await adapter.result(submission.runtimeTaskId);
      const evidence = await adapter.evidence(submission.runtimeTaskId);
      const telemetry = await adapter.cost(submission.runtimeTaskId);

      // Record actual spend in budget ledger
      await this.budgetService.recordSpend(
        task.projectId,
        telemetry.totalCostUsd,
        'ACTUAL',
        task.id,
        `Execution cost for ${task.title}`
      );

      // Complete task in storage
      await this.storage.updateTask(task.id, {
        status: 'COMPLETED',
        actualCostUsd: telemetry.totalCostUsd,
        evidence: {
          artifacts: evidence.artifacts,
          logs: evidence.logs,
          timestamp: evidence.timestamp,
        },
      });

      await this.storage.updateTaskStatus(task.id, 'COMPLETED', 'Successfully executed via gateway');

      // Update idempotency to COMPLETED
      await this.storage.setIdempotencyRecord({
        key: task.idempotencyKey,
        projectId: task.projectId,
        status: 'COMPLETED',
        responsePayload: result.output,
        createdAt: existingRecord?.createdAt || new Date(),
        updatedAt: new Date(),
      });

      // Audit event
      await this.auditLogger.log(
        'TASK_COMPLETED',
        'ExecutionGateway',
        {
          taskId: task.id,
          actionClass: task.actionClass,
          costUsd: telemetry.totalCostUsd,
          evidenceHash: evidence.artifacts[0]?.contentHash,
        },
        task.projectId,
        task.id
      );

      return result;
    } catch (err: any) {
      // Update idempotency to FAILED
      await this.storage.setIdempotencyRecord({
        key: task.idempotencyKey,
        projectId: task.projectId,
        status: 'FAILED',
        createdAt: existingRecord?.createdAt || new Date(),
        updatedAt: new Date(),
      });

      // Update task failure details
      await this.storage.updateTask(task.id, {
        errorDetails: {
          message: err.message,
          name: err.name,
          stack: err.stack,
        },
      });

      await this.auditLogger.log(
        'TASK_EXECUTION_FAILED',
        'ExecutionGateway',
        {
          taskId: task.id,
          error: err.message,
        },
        task.projectId,
        task.id
      );

      throw err;
    }
  }
}
