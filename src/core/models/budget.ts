import { z } from 'zod';

export const LedgerEntryTypeEnum = z.enum([
  'ESTIMATE',
  'ACTUAL',
  'RESERVE',
  'ADJUSTMENT',
]);

export type LedgerEntryType = z.infer<typeof LedgerEntryTypeEnum>;

export const BudgetLedgerEntrySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  taskId: z.string().optional(),
  entryType: LedgerEntryTypeEnum,
  amountUsd: z.number(),
  description: z.string().optional(),
  createdAt: z.date().default(() => new Date()),
});

export type BudgetLedgerEntry = z.infer<typeof BudgetLedgerEntrySchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).default('ACTIVE'),
  budgetCeilingUsd: z.number().nonnegative().default(50.0),
  spentUsd: z.number().nonnegative().default(0.0),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

export type Project = z.infer<typeof ProjectSchema>;
