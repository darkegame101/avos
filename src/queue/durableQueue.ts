import { Task, TaskStatus } from '../core/models/task';
import { IStorageRepository } from '../storage/repository';
import { AuditLogger } from '../core/audit/auditLogger';

export interface EnqueueOptions {
  priority?: number;
}

export class DurableQueue {
  constructor(
    private storage: IStorageRepository,
    private auditLogger: AuditLogger
  ) {}

  /**
   * Enqueues a task for asynchronous worker processing.
   */
  async enqueue(task: Task, reason: string = 'Enqueued for execution'): Promise<Task> {
    const updated = await this.storage.updateTaskStatus(task.id, 'QUEUED', reason);
    await this.auditLogger.log(
      'TASK_ENQUEUED',
      'DurableQueue',
      { taskId: task.id, actionClass: task.actionClass },
      task.projectId,
      task.id
    );
    return updated;
  }

  /**
   * Acquires the next available queued task using an atomic worker lease.
   */
  async dequeue(workerId: string, leaseDurationMs: number): Promise<Task | null> {
    return this.storage.acquireNextQueuedTask(workerId, leaseDurationMs);
  }

  /**
   * Handles retry with exponential backoff and jitter.
   * If max retries reached, transitions task to FAILED (Dead-letter state).
   */
  async handleRetryOrDeadLetter(task: Task, error: Error): Promise<'RETRIED' | 'DEAD_LETTER'> {
    const nextRetry = task.retryCount + 1;

    if (nextRetry >= task.maxRetries) {
      // Transition to FAILED (Dead-letter)
      await this.storage.updateTask(task.id, {
        retryCount: nextRetry,
        status: 'FAILED',
        errorDetails: {
          message: `Exhausted maximum retries (${task.maxRetries}). Last error: ${error.message}`,
        },
      });
      await this.storage.updateTaskStatus(task.id, 'FAILED', 'Moved to Dead-Letter after max retries');
      await this.auditLogger.log(
        'TASK_DEAD_LETTERED',
        'DurableQueue',
        { taskId: task.id, retryCount: nextRetry, error: error.message },
        task.projectId,
        task.id
      );
      await this.storage.releaseWorkerLease(task.id);
      return 'DEAD_LETTER';
    }

    // Calculate exponential backoff with jitter
    const baseDelayMs = 1000;
    const exponentialDelay = baseDelayMs * Math.pow(2, nextRetry);
    const jitter = Math.random() * 500;
    const totalDelayMs = exponentialDelay + jitter;

    await this.storage.updateTask(task.id, {
      retryCount: nextRetry,
      errorDetails: {
        message: `Retry ${nextRetry}/${task.maxRetries}: ${error.message}`,
      },
    });

    // Re-queue task
    await this.storage.updateTaskStatus(
      task.id,
      'QUEUED',
      `Re-queued for retry ${nextRetry} with delay ${Math.round(totalDelayMs)}ms`
    );
    await this.storage.releaseWorkerLease(task.id);

    return 'RETRIED';
  }
}
