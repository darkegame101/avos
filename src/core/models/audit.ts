import { z } from 'zod';
import crypto from 'crypto';

export const AuditEventSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  actor: z.string(),
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  details: z.record(z.any()).default({}),
  prevEventHash: z.string().optional(),
  eventHash: z.string(),
  createdAt: z.date().default(() => new Date()),
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;

/**
 * Computes a cryptographic SHA-256 hash linking the new event to the previous event hash.
 * This guarantees an immutable, tamper-evident audit trail.
 */
export function computeEventHash(
  id: string,
  eventType: string,
  actor: string,
  details: Record<string, any>,
  createdAt: Date,
  prevEventHash?: string
): string {
  const payload = {
    id,
    eventType,
    actor,
    details,
    createdAt: createdAt.toISOString(),
    prevEventHash: prevEventHash || 'GENESIS',
  };
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
