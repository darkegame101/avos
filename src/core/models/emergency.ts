import { z } from 'zod';

export const EmergencyStopStateSchema = z.object({
  scope: z.string(), // 'GLOBAL' or projectId
  isStopped: z.boolean().default(false),
  reason: z.string().optional(),
  activatedBy: z.string().optional(),
  activatedAt: z.date().optional(),
  deactivatedBy: z.string().optional(),
  deactivatedAt: z.date().optional(),
});

export type EmergencyStopState = z.infer<typeof EmergencyStopStateSchema>;

export const TriggerEmergencyStopDtoSchema = z.object({
  scope: z.string().default('GLOBAL'),
  reason: z.string().min(5),
});

export type TriggerEmergencyStopDto = z.infer<typeof TriggerEmergencyStopDtoSchema>;

export const ResumeEmergencyStopDtoSchema = z.object({
  scope: z.string().default('GLOBAL'),
  reason: z.string().min(5),
  investigationCompleted: z.boolean(),
});

export type ResumeEmergencyStopDto = z.infer<typeof ResumeEmergencyStopDtoSchema>;
