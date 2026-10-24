import { z } from 'zod';
import { ActionClassEnum, ActionClass, GATED_ACTION_CLASSES } from './action';

export const PolicyRuleSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  actionClass: ActionClassEnum,
  allowed: z.boolean().default(false),
  requiresApproval: z.boolean().default(true),
  createdAt: z.date().default(() => new Date()),
});

export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

/**
 * Returns baseline secure policy rules for a new project.
 * Implements strict deny-by-default.
 */
export function createDefaultProjectPolicies(projectId: string): PolicyRule[] {
  const allActions = ActionClassEnum.options;

  return allActions.map((actionClass) => {
    const isGated = GATED_ACTION_CLASSES.has(actionClass);
    return {
      id: `${projectId}-${actionClass}`,
      projectId,
      actionClass,
      // Public/internal read are permitted without human signoff
      allowed: true,
      // Gated actions strictly require approval
      requiresApproval: isGated,
      createdAt: new Date(),
    };
  });
}
