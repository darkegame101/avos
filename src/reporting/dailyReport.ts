import { IStorageRepository } from '../storage/repository';
import { EmergencyService } from '../core/emergency/emergencyService';

export interface DailyReportSummary {
  generatedAt: Date;
  emergencyStop: {
    globalStopped: boolean;
    reason?: string;
  };
  portfolioSpend: {
    totalSpentUsd: number;
    monthlyBudgetCapUsd: number;
    remainingBudgetUsd: number;
  };
  taskMetrics: {
    total: number;
    completed: number;
    queued: number;
    running: number;
    pendingApproval: number;
    failed: number;
  };
  pendingApprovals: Array<{
    id: string;
    projectId: string;
    actionClass: string;
    targetResource: string;
    rationale: string;
    budgetCeilingUsd: number;
    expiresAt: Date;
  }>;
  recentCompletedEvidence: Array<{
    taskId: string;
    title: string;
    actionClass: string;
    actualCostUsd: number;
    evidence: any;
  }>;
}

export class DailyReportGenerator {
  constructor(
    private storage: IStorageRepository,
    private emergencyService: EmergencyService,
    private monthlyCapUsd: number = 50.0
  ) {}

  async generate(): Promise<DailyReportSummary> {
    const projects = await this.storage.listProjects();
    const tasks = await this.storage.listTasks();
    const approvals = await this.storage.listApprovals({ status: 'PENDING' });
    const stopStatus = await this.emergencyService.isStopped();

    let totalSpentUsd = 0;
    for (const p of projects) {
      totalSpentUsd += p.spentUsd;
    }

    const taskMetrics = {
      total: tasks.length,
      completed: tasks.filter((t) => t.status === 'COMPLETED').length,
      queued: tasks.filter((t) => t.status === 'QUEUED').length,
      running: tasks.filter((t) => t.status === 'RUNNING').length,
      pendingApproval: tasks.filter((t) => t.status === 'PENDING_APPROVAL').length,
      failed: tasks.filter((t) => t.status === 'FAILED').length,
    };

    const pendingApprovals = approvals.map((a) => ({
      id: a.id,
      projectId: a.projectId,
      actionClass: a.actionClass,
      targetResource: a.targetResource,
      rationale: a.rationale,
      budgetCeilingUsd: a.budgetCeilingUsd,
      expiresAt: a.expiresAt,
    }));

    const recentCompletedEvidence = tasks
      .filter((t) => t.status === 'COMPLETED' && t.evidence)
      .slice(0, 10)
      .map((t) => ({
        taskId: t.id,
        title: t.title,
        actionClass: t.actionClass,
        actualCostUsd: t.actualCostUsd,
        evidence: t.evidence,
      }));

    return {
      generatedAt: new Date(),
      emergencyStop: {
        globalStopped: stopStatus.stopped,
        reason: stopStatus.reason,
      },
      portfolioSpend: {
        totalSpentUsd,
        monthlyBudgetCapUsd: this.monthlyCapUsd,
        remainingBudgetUsd: Math.max(0, this.monthlyCapUsd - totalSpentUsd),
      },
      taskMetrics,
      pendingApprovals,
      recentCompletedEvidence,
    };
  }
}
