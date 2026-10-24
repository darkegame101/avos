import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRepository } from '../src/storage/inMemoryRepository';
import { PolicyEngine } from '../src/core/policy/policyEngine';
import { EmergencyService } from '../src/core/emergency/emergencyService';
import { BudgetService } from '../src/core/budget/budgetLedger';
import { AuditLogger } from '../src/core/audit/auditLogger';
import { ExecutionGateway } from '../src/gateway/executionGateway';
import { DurableQueue } from '../src/queue/durableQueue';
import { WorkerManager } from '../src/queue/workerManager';
import { MockRuntimeAdapter } from '../src/adapters/mockAdapter';
import { DailyReportGenerator } from '../src/reporting/dailyReport';
import { buildServer, AppServices } from '../src/api/server';
import { config } from '../src/config';
import { FastifyInstance } from 'fastify';

describe('AVOS API Control Plane End-to-End Tests', () => {
  let app: FastifyInstance;
  let storage: InMemoryRepository;
  const ownerTokenHeader = `Bearer ${config.ownerToken}`;

  beforeEach(async () => {
    storage = new InMemoryRepository();
    const policyEngine = new PolicyEngine(storage);
    const emergencyService = new EmergencyService(storage);
    const budgetService = new BudgetService(storage);
    const auditLogger = new AuditLogger(storage);
    const adapter = new MockRuntimeAdapter();
    const gateway = new ExecutionGateway(storage, policyEngine, emergencyService, budgetService, auditLogger);
    const queue = new DurableQueue(storage, auditLogger);
    const workerManager = new WorkerManager(queue, gateway, adapter, storage, { concurrency: 2 });
    const reportGenerator = new DailyReportGenerator(storage, emergencyService, 50.0);

    const services: AppServices = {
      storage,
      policyEngine,
      emergencyService,
      budgetService,
      auditLogger,
      gateway,
      queue,
      workerManager,
      reportGenerator,
    };

    app = buildServer(services);
    await app.ready();
  });

  it('GET /health returns 200 OK with system status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('OK');
    expect(body.emergencyStop.stopped).toBe(false);
  });

  it('rejects /api/projects without valid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/projects',
    });
    expect(res.statusCode).toBe(401);
  });

  it('manages project creation, task creation, and approval workflow', async () => {
    // 1. Create project
    const projRes = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { authorization: ownerTokenHeader },
      payload: {
        id: 'proj_itcert',
        name: 'ITCertHub Growth',
        budgetCeilingUsd: 50.0,
      },
    });
    expect(projRes.statusCode).toBe(201);
    expect(projRes.json().id).toBe('proj_itcert');

    // 2. Submit task requiring approval (social.publish is a gated action)
    const taskRes = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { authorization: ownerTokenHeader },
      payload: {
        projectId: 'proj_itcert',
        title: 'Publish AWS DevOps syllabus update',
        actionClass: 'social.publish',
        targetResource: 'https://twitter.com/itcerthub',
        parameters: { content: 'New study guide is live!' },
        idempotencyKey: 'idem_post_guide_101',
        estimatedCostUsd: 1.0,
        maxRetries: 3,
      },
    });

    expect(taskRes.statusCode).toBe(201);
    const task = taskRes.json();
    expect(task.status).toBe('PENDING_APPROVAL');

    // 3. Create approval request record
    const approval = await storage.createApproval({
      id: 'app_guide_101',
      projectId: 'proj_itcert',
      taskId: task.id,
      actionClass: 'social.publish',
      targetResource: 'https://twitter.com/itcerthub',
      parametersHash: 'hash_placeholder',
      rationale: 'Official syllabus update announcement',
      estimatedCostUsd: 1.0,
      budgetCeilingUsd: 2.0,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
    });

    // 4. Approve task via API
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/approvals/${approval.id}/approve`,
      headers: { authorization: ownerTokenHeader },
    });
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().status).toBe('APPROVED');

    // 5. Verify task transitioned to QUEUED
    const updatedTask = await storage.getTask(task.id);
    expect(updatedTask?.status).toBe('QUEUED');
  });

  it('triggers emergency stop and verifies daily report reflects halt', async () => {
    // Trigger stop
    const stopRes = await app.inject({
      method: 'POST',
      url: '/api/emergency/stop',
      headers: { authorization: ownerTokenHeader },
      payload: {
        scope: 'GLOBAL',
        reason: 'Operator triggered maintenance pause',
      },
    });

    expect(stopRes.statusCode).toBe(200);
    expect(stopRes.json().isStopped).toBe(true);

    // Verify daily report
    const reportRes = await app.inject({
      method: 'GET',
      url: '/api/reports/daily',
      headers: { authorization: ownerTokenHeader },
    });

    expect(reportRes.statusCode).toBe(200);
    const report = reportRes.json();
    expect(report.emergencyStop.globalStopped).toBe(true);
    expect(report.emergencyStop.reason).toBe('Operator triggered maintenance pause');
  });
});
