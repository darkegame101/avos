import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { IStorageRepository } from '../storage/repository';
import { PolicyEngine } from '../core/policy/policyEngine';
import { EmergencyService } from '../core/emergency/emergencyService';
import { BudgetService } from '../core/budget/budgetLedger';
import { AuditLogger } from '../core/audit/auditLogger';
import { ExecutionGateway } from '../gateway/executionGateway';
import { DurableQueue } from '../queue/durableQueue';
import { WorkerManager } from '../queue/workerManager';
import { DailyReportGenerator } from '../reporting/dailyReport';
import { authenticateRequest } from '../core/security/auth';
import {
  CreateTaskDtoSchema,
  TriggerEmergencyStopDtoSchema,
  ResumeEmergencyStopDtoSchema,
  ActionClassEnum,
} from '../core/models';
import { getDashboardHtml } from './dashboardHtml';
import { z } from 'zod';

export interface AppServices {
  storage: IStorageRepository;
  policyEngine: PolicyEngine;
  emergencyService: EmergencyService;
  budgetService: BudgetService;
  auditLogger: AuditLogger;
  gateway: ExecutionGateway;
  queue: DurableQueue;
  workerManager: WorkerManager;
  reportGenerator: DailyReportGenerator;
}

export function buildServer(services: AppServices): FastifyInstance {
  const app = Fastify({
    logger: false, // Custom audit logging handles structured events
  });

  // Security Headers & Rate Limiting Hook
  const requestCounts = new Map<string, { count: number; resetAt: number }>();
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('X-XSS-Protection', '1; mode=block');

    // Throttling: 120 requests per minute per IP
    const ip = req.ip || '127.0.0.1';
    const now = Date.now();
    const windowMs = 60000;
    const maxRequests = 120;

    let record = requestCounts.get(ip);
    if (!record || record.resetAt < now) {
      record = { count: 1, resetAt: now + windowMs };
      requestCounts.set(ip, record);
    } else {
      record.count++;
      if (record.count > maxRequests) {
        return reply.status(429).send({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please throttle your requests.',
        });
      }
    }
  });

  // Global auth hook for /api/ routes
  const requireOwnerAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    const authHeader = req.headers.authorization;
    // CRITICAL: NEVER trust request body for identity/role claims
    const auth = authenticateRequest(authHeader, req.body as any);

    if (!auth.isAuthenticated || !auth.isOwner) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Valid owner Bearer token required. Body claims are ignored.',
      });
    }

    (req as any).auth = auth;
  };

  // --- Health Endpoint (Public / Monitoring) ---
  app.get('/health', async (_req, reply) => {
    const stopStatus = await services.emergencyService.isStopped();
    const workerStatus = services.workerManager.getStatus();

    return reply.status(200).send({
      status: 'OK',
      timestamp: new Date(),
      emergencyStop: stopStatus,
      worker: workerStatus,
    });
  });

  // --- Admin Dashboard (Web UI) ---
  app.get('/', async (_req, reply) => {
    return reply.type('text/html').send(getDashboardHtml());
  });

  app.get('/dashboard', async (_req, reply) => {
    return reply.type('text/html').send(getDashboardHtml());
  });

  // --- Projects Endpoints ---
  app.get('/api/projects', { preHandler: requireOwnerAuth }, async (_req, reply) => {
    const projects = await services.storage.listProjects();
    return reply.send(projects);
  });

  app.post('/api/projects', { preHandler: requireOwnerAuth }, async (req, reply) => {
    const bodySchema = z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      budgetCeilingUsd: z.number().nonnegative().default(50.0),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }

    const created = await services.storage.createProject({
      id: parsed.data.id,
      name: parsed.data.name,
      status: 'ACTIVE',
      budgetCeilingUsd: parsed.data.budgetCeilingUsd,
      spentUsd: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await services.auditLogger.log('PROJECT_CREATED', 'owner', { projectId: created.id, name: created.name });
    return reply.status(201).send(created);
  });

  // --- Tasks Endpoints ---
  app.get('/api/tasks', { preHandler: requireOwnerAuth }, async (req, reply) => {
    const query = req.query as any;
    const tasks = await services.storage.listTasks({
      projectId: query?.projectId,
      status: query?.status,
    });
    return reply.send(tasks);
  });

  app.get('/api/tasks/:id', { preHandler: requireOwnerAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = await services.storage.getTask(id);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    return reply.send(task);
  });

  app.post('/api/tasks', { preHandler: requireOwnerAuth }, async (req, reply) => {
    const parsed = CreateTaskDtoSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }

    const data = parsed.data;

    // Check project exists
    const project = await services.storage.getProject(data.projectId);
    if (!project) {
      return reply.status(404).send({ error: `Project '${data.projectId}' not found` });
    }

    // Check idempotency key uniqueness
    const existing = await services.storage.getTaskByIdempotencyKey(data.idempotencyKey);
    if (existing) {
      return reply.status(200).send({
        message: 'Task with idempotency key already exists. Returning existing task.',
        task: existing,
      });
    }

    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Determine initial status based on policy gating
    const requiresApproval = await services.policyEngine.requiresApproval(data.projectId, data.actionClass);
    const initialStatus = requiresApproval ? 'PENDING_APPROVAL' : 'QUEUED';

    const task = await services.storage.createTask({
      id: taskId,
      projectId: data.projectId,
      title: data.title,
      description: data.description,
      status: initialStatus,
      actionClass: data.actionClass,
      targetResource: data.targetResource,
      parameters: data.parameters,
      idempotencyKey: data.idempotencyKey,
      estimatedCostUsd: data.estimatedCostUsd,
      actualCostUsd: 0,
      retryCount: 0,
      maxRetries: data.maxRetries,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await services.auditLogger.log(
      'TASK_CREATED',
      'owner',
      { taskId, actionClass: data.actionClass, initialStatus },
      data.projectId,
      taskId
    );

    return reply.status(201).send(task);
  });

  // --- Approvals Endpoints ---
  app.get('/api/approvals', { preHandler: requireOwnerAuth }, async (req, reply) => {
    const query = req.query as any;
    const approvals = await services.storage.listApprovals({
      projectId: query?.projectId,
      status: query?.status,
    });
    return reply.send(approvals);
  });

  app.post('/api/approvals/:id/approve', { preHandler: requireOwnerAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const approval = await services.storage.getApproval(id);
    if (!approval) return reply.status(404).send({ error: 'Approval not found' });

    if (approval.status !== 'PENDING') {
      return reply.status(400).send({ error: `Approval is not in PENDING state (current: ${approval.status})` });
    }

    const updated = await services.storage.updateApprovalStatus(id, 'APPROVED', 'owner');

    // Move associated task to QUEUED
    const task = await services.storage.getTask(approval.taskId);
    if (task && task.status === 'PENDING_APPROVAL') {
      await services.queue.enqueue(task, `Approved by owner via approval ${id}`);
    }

    await services.auditLogger.log(
      'APPROVAL_GRANTED',
      'owner',
      { approvalId: id, taskId: approval.taskId, actionClass: approval.actionClass },
      approval.projectId,
      approval.taskId
    );

    return reply.send(updated);
  });

  app.post('/api/approvals/:id/reject', { preHandler: requireOwnerAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const reason = body?.reason || 'Rejected by owner';

    const approval = await services.storage.getApproval(id);
    if (!approval) return reply.status(404).send({ error: 'Approval not found' });

    const updated = await services.storage.updateApprovalStatus(id, 'REJECTED', 'owner', reason);

    // Cancel task
    const task = await services.storage.getTask(approval.taskId);
    if (task && task.status === 'PENDING_APPROVAL') {
      await services.storage.updateTaskStatus(task.id, 'CANCELLED', `Rejected by owner: ${reason}`);
    }

    await services.auditLogger.log(
      'APPROVAL_REJECTED',
      'owner',
      { approvalId: id, taskId: approval.taskId, reason },
      approval.projectId,
      approval.taskId
    );

    return reply.send(updated);
  });

  // --- Emergency Stop Endpoints ---
  app.get('/api/emergency/status', { preHandler: requireOwnerAuth }, async (_req, reply) => {
    const status = await services.emergencyService.isStopped();
    return reply.send(status);
  });

  app.post('/api/emergency/stop', { preHandler: requireOwnerAuth }, async (req, reply) => {
    const parsed = TriggerEmergencyStopDtoSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }

    const state = await services.emergencyService.triggerStop(parsed.data.scope, parsed.data.reason, 'owner');
    return reply.send(state);
  });

  app.post('/api/emergency/resume', { preHandler: requireOwnerAuth }, async (req, reply) => {
    const parsed = ResumeEmergencyStopDtoSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }

    try {
      const state = await services.emergencyService.resume(
        parsed.data.scope,
        parsed.data.reason,
        'owner',
        parsed.data.investigationCompleted
      );
      return reply.send(state);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // --- Daily Executive Report Endpoint ---
  app.get('/api/reports/daily', { preHandler: requireOwnerAuth }, async (_req, reply) => {
    const report = await services.reportGenerator.generate();
    return reply.send(report);
  });

  // --- Audit Logs Endpoint ---
  app.get('/api/audit', { preHandler: requireOwnerAuth }, async (req, reply) => {
    const query = req.query as any;
    const events = await services.storage.listAuditEvents({
      projectId: query?.projectId,
      taskId: query?.taskId,
    });
    return reply.send(events);
  });

  return app;
}
