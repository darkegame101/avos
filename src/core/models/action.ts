import { z } from 'zod';

export const ActionClassEnum = z.enum([
  'read.public',
  'read.internal',
  'account.connect',
  'social.draft',
  'social.publish',
  'social.message',
  'ads.launch',
  'purchase',
  'infrastructure.create',
  'production.change',
  'domain.dns.change',
  'financial.transfer',
  'runtime.self_modify',
  'tool.install',
  'agent.spawn',
  'agent.fund',
  'shell.execute',
]);

export type ActionClass = z.infer<typeof ActionClassEnum>;

/**
 * Gated actions strictly require explicit human owner approval.
 * Safe actions may run autonomously if permitted by project policy.
 */
export const GATED_ACTION_CLASSES: Set<ActionClass> = new Set([
  'account.connect',
  'social.draft',
  'social.publish',
  'social.message',
  'ads.launch',
  'purchase',
  'infrastructure.create',
  'production.change',
  'domain.dns.change',
  'financial.transfer',
  'runtime.self_modify',
  'tool.install',
  'agent.spawn',
  'agent.fund',
  'shell.execute',
]);

export function isGatedAction(action: ActionClass): boolean {
  return GATED_ACTION_CLASSES.has(action);
}
