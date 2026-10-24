import { DurableQueue } from './durableQueue';
import { ExecutionGateway } from '../gateway/executionGateway';
import { IRuntimeAdapter } from '../adapters/runtimeAdapter';
import { IStorageRepository } from '../storage/repository';

export interface WorkerManagerOptions {
  workerId?: string;
  concurrency?: number;
  pollIntervalMs?: number;
  leaseDurationMs?: number;
}

export class WorkerManager {
  private workerId: string;
  private concurrency: number;
  private pollIntervalMs: number;
  private leaseDurationMs: number;
  private isRunning: boolean = false;
  private activeJobs: number = 0;
  private pollTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private runningTaskIds = new Set<string>();

  constructor(
    private queue: DurableQueue,
    private gateway: ExecutionGateway,
    private adapter: IRuntimeAdapter,
    private storage: IStorageRepository,
    options: WorkerManagerOptions = {}
  ) {
    this.workerId = options.workerId || `worker_${process.pid}_${Math.random().toString(36).substring(7)}`;
    this.concurrency = options.concurrency || 3;
    this.pollIntervalMs = options.pollIntervalMs || 1000;
    this.leaseDurationMs = options.leaseDurationMs || 30000;
  }

  public getStatus() {
    return {
      workerId: this.workerId,
      isRunning: this.isRunning,
      activeJobs: this.activeJobs,
      concurrencyLimit: this.concurrency,
      runningTaskIds: Array.from(this.runningTaskIds),
    };
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Start poll loop
    this.pollTimer = setInterval(() => {
      this.poll().catch((err) => {
        // Log background error without crashing process
        console.error(`[WorkerManager ${this.workerId}] Poll error:`, err.message);
      });
    }, this.pollIntervalMs);

    // Start heartbeat loop
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeats().catch((err) => {
        console.error(`[WorkerManager ${this.workerId}] Heartbeat error:`, err.message);
      });
    }, Math.floor(this.leaseDurationMs / 3));
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    // Release all active leases
    for (const taskId of this.runningTaskIds) {
      await this.storage.releaseWorkerLease(taskId).catch(() => {});
    }
    this.runningTaskIds.clear();
    this.activeJobs = 0;
  }

  /**
   * Performs a single poll cycle (useful for step-by-step unit testing).
   */
  public async poll(): Promise<boolean> {
    if (!this.isRunning && this.activeJobs >= this.concurrency) return false;
    if (this.activeJobs >= this.concurrency) return false;

    const task = await this.queue.dequeue(this.workerId, this.leaseDurationMs);
    if (!task) return false;

    this.activeJobs++;
    this.runningTaskIds.add(task.id);

    // Process asynchronously
    this.processTask(task).finally(() => {
      this.activeJobs--;
      this.runningTaskIds.delete(task.id);
      this.storage.releaseWorkerLease(task.id).catch(() => {});
    });

    return true;
  }

  private async processTask(task: any): Promise<void> {
    try {
      await this.gateway.executeTask(task, this.adapter);
    } catch (err: any) {
      // Determine if retryable or dead-letter
      await this.queue.handleRetryOrDeadLetter(task, err);
    }
  }

  private async sendHeartbeats(): Promise<void> {
    for (const taskId of this.runningTaskIds) {
      await this.storage.renewWorkerLease(taskId, this.workerId, this.leaseDurationMs);
    }
  }
}
