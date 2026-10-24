import { IStorageRepository } from '../../storage/repository';
import { AuditEvent, computeEventHash } from '../models/audit';
import { redactSecrets } from '../security/redactor';

export class AuditLogger {
  constructor(private storage: IStorageRepository) {}

  /**
   * Appends an immutable, hash-chained audit event to the log.
   */
  async log(
    eventType: string,
    actor: string,
    details: Record<string, any>,
    projectId?: string,
    taskId?: string
  ): Promise<AuditEvent> {
    const now = new Date();
    const id = `audit_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Redact any secrets before logging
    const safeDetails = redactSecrets(details);

    // Retrieve previous event hash for blockchain-like cryptographic chaining
    const latest = await this.storage.getLatestAuditEvent();
    const prevEventHash = latest?.eventHash;

    const eventHash = computeEventHash(id, eventType, actor, safeDetails, now, prevEventHash);

    const event: AuditEvent = {
      id,
      eventType,
      actor,
      projectId,
      taskId,
      details: safeDetails,
      prevEventHash,
      eventHash,
      createdAt: now,
    };

    return this.storage.recordAuditEvent(event);
  }
}
