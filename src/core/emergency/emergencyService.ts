import { IStorageRepository } from '../../storage/repository';
import { EmergencyStopState, computeEventHash } from '../models';

export class EmergencyStopActiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmergencyStopActiveError';
  }
}

export class EmergencyService {
  constructor(private storage: IStorageRepository) {}

  /**
   * Checks whether external actions are stopped globally or for a specific project.
   */
  async isStopped(projectId?: string): Promise<{ stopped: boolean; scope?: string; reason?: string }> {
    // 1. Check Global Emergency Stop
    const globalState = await this.storage.getEmergencyStop('GLOBAL');
    if (globalState.isStopped) {
      return { stopped: true, scope: 'GLOBAL', reason: globalState.reason };
    }

    // 2. Check Project-Specific Emergency Stop
    if (projectId) {
      const projectState = await this.storage.getEmergencyStop(projectId);
      if (projectState.isStopped) {
        return { stopped: true, scope: projectId, reason: projectState.reason };
      }
    }

    return { stopped: false };
  }

  /**
   * Activates Emergency Stop immediately.
   */
  async triggerStop(scope: string, reason: string, activatedBy: string): Promise<EmergencyStopState> {
    const state: EmergencyStopState = {
      scope,
      isStopped: true,
      reason,
      activatedBy,
      activatedAt: new Date(),
    };
    await this.storage.setEmergencyStop(state);

    // Record immutable audit event
    const now = new Date();
    const eventId = `audit_stop_${Date.now()}`;
    const latest = await this.storage.getLatestAuditEvent();
    const eventHash = computeEventHash(
      eventId,
      'EMERGENCY_STOP_ACTIVATED',
      activatedBy,
      { scope, reason },
      now,
      latest?.eventHash
    );

    await this.storage.recordAuditEvent({
      id: eventId,
      eventType: 'EMERGENCY_STOP_ACTIVATED',
      actor: activatedBy,
      projectId: scope !== 'GLOBAL' ? scope : undefined,
      details: { scope, reason },
      prevEventHash: latest?.eventHash,
      eventHash,
      createdAt: now,
    });

    return state;
  }

  /**
   * Resumes operations following verified recovery.
   * Requires confirmation of root-cause investigation.
   */
  async resume(
    scope: string,
    reason: string,
    deactivatedBy: string,
    investigationCompleted: boolean
  ): Promise<EmergencyStopState> {
    if (!investigationCompleted) {
      throw new Error('Cannot resume operations without confirmed root-cause investigation');
    }

    const state: EmergencyStopState = {
      scope,
      isStopped: false,
      reason: `Resumed: ${reason}`,
      deactivatedBy,
      deactivatedAt: new Date(),
    };
    await this.storage.setEmergencyStop(state);

    // Record immutable audit event
    const now = new Date();
    const eventId = `audit_resume_${Date.now()}`;
    const latest = await this.storage.getLatestAuditEvent();
    const eventHash = computeEventHash(
      eventId,
      'EMERGENCY_STOP_DEACTIVATED',
      deactivatedBy,
      { scope, reason },
      now,
      latest?.eventHash
    );

    await this.storage.recordAuditEvent({
      id: eventId,
      eventType: 'EMERGENCY_STOP_DEACTIVATED',
      actor: deactivatedBy,
      projectId: scope !== 'GLOBAL' ? scope : undefined,
      details: { scope, reason },
      prevEventHash: latest?.eventHash,
      eventHash,
      createdAt: now,
    });

    return state;
  }
}
