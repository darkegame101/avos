import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRepository } from '../src/storage/inMemoryRepository';
import { PolicyEngine, PolicyViolationError } from '../src/core/policy/policyEngine';
import { EmergencyService } from '../src/core/emergency/emergencyService';
import { BudgetService } from '../src/core/budget/budgetLedger';
import { AuditLogger } from '../src/core/audit/auditLogger';
import { ExecutionGateway, ApprovalMissingOrInvalidError } from '../src/gateway/executionGateway';
import { MockRuntimeAdapter } from '../src/adapters/mockAdapter';
import { authenticateRequest } from '../src/core/security/auth';
import { redactSecrets } from '../src/core/security/redactor';
import { computeParametersHash } from '../src/core/models/approval';
import { buildServer } from '../src/api/server';
import { DurableQueue } from '../src/queue/durableQueue';
import { WorkerManager } from '../src/queue/workerManager';
import { DailyReportGenerator } from '../src/reporting/dailyReport';
import { config } from '../src/config';

describe('Security and Policy Enforcement Tests', () => {
  let storage: InMemoryRepository;
  let policyEngine: PolicyEngine;
  let emergencyService: EmergencyService;
  let budgetService: BudgetService;
  let auditLogger: AuditLogger;
  let gateway: ExecutionGateway;
  let adapter: MockRuntimeAdapter;

  beforeEach(async () => {
    storage = new InMemoryRepository();
    policyEngine = new PolicyEngine(storage);
    emergencyService = new EmergencyService(storage);
    budgetService = new BudgetService(storage);
    auditLogger = new AuditLogger(storage);
    gateway = new ExecutionGateway(storage, policyEngine, emergencyService, budgetService, auditLogger);
    adapter = new MockRuntimeAdapter();

    // Create test project
    await storage.createProject({
      id: 'proj_alpha',
      name: 'Alpha Venture',
      status: 'ACTIVE',
      budgetCeilingUsd: 100,
      spentUsd: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  describe('Authentication & Body Spoofing Resistance', () => {
    it('rejects unauthenticated requests without Bearer token', () => {
      const auth = authenticateRequest(undefined);
      expect(auth.isAuthenticated).toBe(false);
      expect(auth.isOwner).toBe(false);
    });

    it('REJECTS caller asserting owner in request body when Bearer token is invalid or missing', () => {
      // Attacker attempts body spoofing: { "approver": "owner", "role": "admin" }
      const spoofedBody = { approver: 'owner', role: 'admin', isOwner: true };
      const auth = authenticateRequest(undefined, spoofedBody);

      expect(auth.isAuthenticated).toBe(false);
      expect(auth.isOwner).toBe(false);
      expect(auth.actor).toBe('anonymous');
    });

    it('rejects spoofed Bearer tokens', () => {
      const auth = authenticateRequest('Bearer invalid-token-12345');
      expect(auth.isAuthenticated).toBe(false);
      expect(auth.isOwner).toBe(false);
    });

    it('accepts valid cryptographic owner token', () => {
      const auth = authenticateRequest(`Bearer ${config.ownerToken}`);
      expect(auth.isAuthenticated).toBe(true);
      expect(auth.isOwner).toBe(true);
      expect(auth.actor).toBe('owner');
    });
  });

  describe('Deny-by-Default Policy Enforcement', () => {
    it('allows safe public read by default', async () => {
      const allowed = await policyEngine.assertActionAllowed('proj_alpha', 'read.public');
      expect(allowed).toBe(true);
    });

    it('denies execution when project has no allow rule for action', async () => {
      // Modify policy to delete a rule
      await storage.upsertPolicyRule({
        id: 'proj_alpha-shell.execute',
        projectId: 'proj_alpha',
        actionClass: 'shell.execute',
        allowed: false,
        requiresApproval: true,
        createdAt: new Date(),
      });

      await expect(
        gateway.assertCanExecute({
          projectId: 'proj_alpha',
          taskId: 'task_1',
          actionClass: 'shell.execute',
          parameters: {},
          estimatedCostUsd: 0,
          idempotencyKey: 'idem_key_1',
        })
      ).rejects.toThrow(PolicyViolationError);
    });
  });

  describe('Approval Scope Binding & Anti-Tampering', () => {
    it('blocks gated action if approval is missing', async () => {
      await expect(
        gateway.assertCanExecute({
          projectId: 'proj_alpha',
          taskId: 'task_gated_1',
          actionClass: 'social.publish',
          targetResource: 'https://twitter.com/itcerthub',
          parameters: { message: 'Hello World' },
          estimatedCostUsd: 1.0,
          idempotencyKey: 'idem_gated_1',
        })
      ).rejects.toThrow(ApprovalMissingOrInvalidError);
    });

    it('blocks execution if approval has EXPIRED', async () => {
      const params = { message: 'Promo content' };
      const paramsHash = computeParametersHash(params);

      // Create expired approval
      await storage.createApproval({
        id: 'app_expired',
        projectId: 'proj_alpha',
        taskId: 'task_expired',
        actionClass: 'social.publish',
        targetResource: 'https://facebook.com/itcerthub',
        parametersHash: paramsHash,
        rationale: 'Promo campaign',
        estimatedCostUsd: 5.0,
        budgetCeilingUsd: 10.0,
        status: 'APPROVED',
        approvedBy: 'owner',
        approvedAt: new Date(Date.now() - 7200000),
        expiresAt: new Date(Date.now() - 3600000), // Expired 1 hour ago
        createdAt: new Date(Date.now() - 7200000),
      });

      await expect(
        gateway.assertCanExecute({
          projectId: 'proj_alpha',
          taskId: 'task_expired',
          actionClass: 'social.publish',
          targetResource: 'https://facebook.com/itcerthub',
          parameters: params,
          estimatedCostUsd: 5.0,
          idempotencyKey: 'idem_exp_1',
        })
      ).rejects.toThrow(/Approval has expired/);
    });

    it('blocks execution if task parameters were TAMPERED after approval', async () => {
      const originalParams = { message: 'Approved standard message', discount: '10%' };
      const originalHash = computeParametersHash(originalParams);

      await storage.createApproval({
        id: 'app_tamper',
        projectId: 'proj_alpha',
        taskId: 'task_tamper',
        actionClass: 'social.publish',
        targetResource: 'https://twitter.com/itcerthub',
        parametersHash: originalHash,
        rationale: 'Campaign launch',
        estimatedCostUsd: 2.0,
        budgetCeilingUsd: 5.0,
        status: 'APPROVED',
        approvedBy: 'owner',
        approvedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
      });

      // Attacker attempts to modify parameters to grant 90% discount
      const tamperedParams = { message: 'Approved standard message', discount: '90%' };

      await expect(
        gateway.assertCanExecute({
          projectId: 'proj_alpha',
          taskId: 'task_tamper',
          actionClass: 'social.publish',
          targetResource: 'https://twitter.com/itcerthub',
          parameters: tamperedParams,
          estimatedCostUsd: 2.0,
          idempotencyKey: 'idem_tamper_1',
        })
      ).rejects.toThrow(/Parameters hash mismatch/);
    });

    it('blocks execution if target resource does not match approval target', async () => {
      const params = { amount: 10 };
      const hash = computeParametersHash(params);

      await storage.createApproval({
        id: 'app_target_mismatch',
        projectId: 'proj_alpha',
        taskId: 'task_target_mismatch',
        actionClass: 'purchase',
        targetResource: 'https://vendor-a.com/item',
        parametersHash: hash,
        rationale: 'Supplies',
        estimatedCostUsd: 10.0,
        budgetCeilingUsd: 15.0,
        status: 'APPROVED',
        approvedBy: 'owner',
        approvedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
      });

      // Caller attempts to purchase from vendor-b instead
      await expect(
        gateway.assertCanExecute({
          projectId: 'proj_alpha',
          taskId: 'task_target_mismatch',
          actionClass: 'purchase',
          targetResource: 'https://vendor-b-phishing.com/item',
          parameters: params,
          estimatedCostUsd: 10.0,
          idempotencyKey: 'idem_mismatch_1',
        })
      ).rejects.toThrow(/Target resource mismatch/);
    });
  });

  describe('Secret Redaction in Logs & Error Traces', () => {
    it('redacts tokens, passwords, and database URLs', () => {
      const rawPayload = {
        taskId: 'task_99',
        apiKey: 'sk-secret-live-api-key-xyz',
        databaseUrl: 'postgresql://postgres:secretPass@db.aws.com:5432/main',
        nested: {
          userPassword: 'P@ssword123!',
          safeField: 'Hello World',
        },
      };

      const redacted = redactSecrets(rawPayload);
      expect(redacted.apiKey).toBe('[REDACTED]');
      expect(redacted.databaseUrl).toBe('[REDACTED]');
      expect(redacted.nested.userPassword).toBe('[REDACTED]');
      expect(redacted.nested.safeField).toBe('Hello World');
    });
  });

  describe('Cross-Project Isolation & Budget Cap Tests', () => {
    it('prohibits task in Project Beta from executing under Project Alpha approval', async () => {
      await storage.createProject({
        id: 'proj_beta',
        name: 'Beta Venture',
        status: 'ACTIVE',
        budgetCeilingUsd: 100,
        spentUsd: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const params = { action: 'deploy' };
      const hash = computeParametersHash(params);

      // Approval belongs to proj_alpha
      await storage.createApproval({
        id: 'app_cross_proj',
        projectId: 'proj_alpha',
        taskId: 'task_beta_attempt',
        actionClass: 'social.publish',
        targetResource: 'https://twitter.com/alpha',
        parametersHash: hash,
        rationale: 'Alpha promo',
        estimatedCostUsd: 1.0,
        budgetCeilingUsd: 5.0,
        status: 'APPROVED',
        approvedBy: 'owner',
        approvedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
      });

      // Caller from proj_beta attempts to execute task_beta_attempt
      await expect(
        gateway.assertCanExecute({
          projectId: 'proj_beta',
          taskId: 'task_beta_attempt',
          actionClass: 'social.publish',
          targetResource: 'https://twitter.com/alpha',
          parameters: params,
          estimatedCostUsd: 1.0,
          idempotencyKey: 'idem_cross_1',
        })
      ).rejects.toThrow();
    });

    it('blocks execution when proposed cost breaches project budget ceiling', async () => {
      // Proj alpha has $100 ceiling, current spent 0. Proposing $105 must fail!
      await expect(
        gateway.assertCanExecute({
          projectId: 'proj_alpha',
          taskId: 'task_over_budget',
          actionClass: 'read.public',
          parameters: {},
          estimatedCostUsd: 105.0,
          idempotencyKey: 'idem_over_budget_1',
        })
      ).rejects.toThrow(/budget ceiling exceeded/);
    });
  });
});
