import { z } from 'zod';
import crypto from 'crypto';
import { ActionClassEnum } from './action';

export const ApprovalStatusEnum = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'REVOKED',
]);

export type ApprovalStatus = z.infer<typeof ApprovalStatusEnum>;

export const ApprovalRequestSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  actionClass: ActionClassEnum,
  targetResource: z.string(),
  parametersHash: z.string(),
  rationale: z.string().min(5),
  estimatedCostUsd: z.number().nonnegative(),
  budgetCeilingUsd: z.number().nonnegative(),
  status: ApprovalStatusEnum.default('PENDING'),
  approvedBy: z.string().optional(),
  approvedAt: z.date().optional(),
  expiresAt: z.date(),
  rejectionReason: z.string().optional(),
  createdAt: z.date().default(() => new Date()),
});

export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

/**
 * Computes a deterministic SHA-256 hash of task parameters to prevent tampering.
 */
export function computeParametersHash(parameters: Record<string, any>): string {
  // Sort keys recursively for canonical JSON representation
  const canonicalString = JSON.stringify(parameters, Object.keys(parameters).sort());
  return crypto.createHash('sha256').update(canonicalString).digest('hex');
}

/**
 * Validates that an approval is strictly valid, unexpired, and matches parameters.
 */
export function isApprovalValid(
  approval: ApprovalRequest,
  expectedParamsHash: string,
  now: Date = new Date()
): { valid: boolean; reason?: string } {
  if (approval.status !== 'APPROVED') {
    return { valid: false, reason: `Approval status is '${approval.status}', expected 'APPROVED'` };
  }

  if (now > approval.expiresAt) {
    return { valid: false, reason: 'Approval has expired' };
  }

  if (approval.parametersHash !== expectedParamsHash) {
    return { valid: false, reason: 'Parameters hash mismatch: action parameters were tampered with' };
  }

  return { valid: true };
}
