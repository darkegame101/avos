import { IStorageRepository } from '../../storage/repository';
import { BudgetLedgerEntry, LedgerEntryType } from '../models/budget';
import { config } from '../../config';

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export class BudgetService {
  constructor(private storage: IStorageRepository) {}

  /**
   * Asserts whether a proposed cost can be spent within project and global budget caps.
   */
  async assertWithinBudget(projectId: string, proposedCostUsd: number): Promise<void> {
    if (proposedCostUsd <= 0) return;

    // 1. Check Project Budget Ceiling
    const project = await this.storage.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const currentSpent = await this.storage.getProjectSpent(projectId);
    if (currentSpent + proposedCostUsd > project.budgetCeilingUsd) {
      throw new BudgetExceededError(
        `Project '${project.name}' budget ceiling exceeded: current spent $${currentSpent.toFixed(
          2
        )} + proposed $${proposedCostUsd.toFixed(2)} > ceiling $${project.budgetCeilingUsd.toFixed(2)}`
      );
    }

    // 2. Check Global Monthly Portfolio Cap
    const allProjects = await this.storage.listProjects();
    let totalPortfolioSpent = 0;
    for (const p of allProjects) {
      totalPortfolioSpent += p.spentUsd;
    }

    if (totalPortfolioSpent + proposedCostUsd > config.monthlyBudgetCap) {
      throw new BudgetExceededError(
        `Global monthly portfolio cap of $${config.monthlyBudgetCap.toFixed(
          2
        )} exceeded: current spent $${totalPortfolioSpent.toFixed(2)} + proposed $${proposedCostUsd.toFixed(2)}`
      );
    }
  }

  /**
   * Records a spend entry in the budget ledger.
   */
  async recordSpend(
    projectId: string,
    amountUsd: number,
    entryType: LedgerEntryType,
    taskId?: string,
    description?: string
  ): Promise<BudgetLedgerEntry> {
    const entry: BudgetLedgerEntry = {
      id: `budget_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      projectId,
      taskId,
      entryType,
      amountUsd,
      description,
      createdAt: new Date(),
    };
    return this.storage.recordLedgerEntry(entry);
  }
}
