import { ActionClass, isGatedAction } from '../models/action';
import { IStorageRepository } from '../../storage/repository';

export class PolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyViolationError';
  }
}

export class PolicyEngine {
  constructor(private storage: IStorageRepository) {}

  /**
   * Asserts whether a given action is permitted for the project.
   * Throws PolicyViolationError if denied.
   */
  async assertActionAllowed(projectId: string, actionClass: ActionClass): Promise<boolean> {
    const rules = await this.storage.getPolicyRules(projectId);
    const rule = rules.find((r) => r.actionClass === actionClass);

    if (!rule) {
      // DENY-BY-DEFAULT
      throw new PolicyViolationError(
        `Action '${actionClass}' is denied by default for project '${projectId}' (no explicit allow rule found)`
      );
    }

    if (!rule.allowed) {
      throw new PolicyViolationError(
        `Action '${actionClass}' is explicitly disabled for project '${projectId}'`
      );
    }

    return true;
  }

  /**
   * Checks if an action requires explicit human owner approval.
   */
  async requiresApproval(projectId: string, actionClass: ActionClass): Promise<boolean> {
    // If it is in the global gated actions list, it ALWAYS requires approval
    if (isGatedAction(actionClass)) {
      return true;
    }

    const rules = await this.storage.getPolicyRules(projectId);
    const rule = rules.find((r) => r.actionClass === actionClass);
    return rule ? rule.requiresApproval : true;
  }
}
