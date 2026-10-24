import { z } from 'zod';
import { ActionClassEnum } from './action';

export const TaskStatusEnum = z.enum([
  'CREATED',
  'PLANNED',
  'PENDING_APPROVAL',
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'STOPPED',
]);

export type TaskStatus = z.infer<typeof TaskStatusEnum>;

export const TaskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: TaskStatusEnum.default('CREATED'),
  actionClass: ActionClassEnum,
  targetResource: z.string().optional(),
  parameters: z.record(z.any()).default({}),
  idempotencyKey: z.string(),
  estimatedCostUsd: z.number().nonnegative().default(0),
  actualCostUsd: z.number().nonnegative().default(0),
  retryCount: z.number().int().nonnegative().default(0),
  maxRetries: z.number().int().nonnegative().default(3),
  evidence: z.record(z.any()).optional(),
  errorDetails: z.record(z.any()).optional(),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskDtoSchema = z.object({
  projectId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  actionClass: ActionClassEnum,
  targetResource: z.string().optional(),
  parameters: z.record(z.any()).default({}),
  idempotencyKey: z.string().min(8),
  estimatedCostUsd: z.number().nonnegative().default(0),
  maxRetries: z.number().int().nonnegative().default(3),
});

export type CreateTaskDto = z.infer<typeof CreateTaskDtoSchema>;

export const TaskTransitionSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  fromStatus: TaskStatusEnum,
  toStatus: TaskStatusEnum,
  reason: z.string().optional(),
  createdAt: z.date().default(() => new Date()),
});

export type TaskTransition = z.infer<typeof TaskTransitionSchema>;

/**
 * Valid state transitions table for the Task State Machine.
 */
export const VALID_TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  CREATED: ['PLANNED', 'PENDING_APPROVAL', 'QUEUED', 'CANCELLED'],
  PLANNED: ['PENDING_APPROVAL', 'QUEUED', 'CANCELLED'],
  PENDING_APPROVAL: ['QUEUED', 'CANCELLED', 'STOPPED'],
  QUEUED: ['RUNNING', 'CANCELLED', 'STOPPED'],
  RUNNING: ['COMPLETED', 'FAILED', 'QUEUED', 'CANCELLED', 'STOPPED'],
  COMPLETED: [], // Terminal
  FAILED: ['QUEUED'], // Can be manually re-queued after remediation
  CANCELLED: [], // Terminal
  STOPPED: ['QUEUED', 'CANCELLED'], // Can be resumed after investigation
};

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TASK_TRANSITIONS[from]?.includes(to) ?? false;
}
