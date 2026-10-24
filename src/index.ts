import { config } from './config';
import { PostgresRepository } from './storage/postgresRepository';
import { InMemoryRepository } from './storage/inMemoryRepository';
import { IStorageRepository } from './storage/repository';
import { PolicyEngine } from './core/policy/policyEngine';
import { EmergencyService } from './core/emergency/emergencyService';
import { BudgetService } from './core/budget/budgetLedger';
import { AuditLogger } from './core/audit/auditLogger';
import { ExecutionGateway } from './gateway/executionGateway';
import { DurableQueue } from './queue/durableQueue';
import { WorkerManager } from './queue/workerManager';
import { MockRuntimeAdapter } from './adapters/mockAdapter';
import { AutomatonRuntimeAdapter } from './adapters/automatonAdapter';
import { IRuntimeAdapter } from './adapters/runtimeAdapter';
import { DailyReportGenerator } from './reporting/dailyReport';
import { buildServer, AppServices } from './api/server';

async function bootstrap() {
  console.log(`[AVOS] Bootstrapping AVOS Core (Node ${process.version}, PID ${process.pid})...`);

  // Initialize storage: use Postgres in production, fallback to InMemory if DB not reachable
  let storage: IStorageRepository;
  try {
    const pg = new PostgresRepository(config.databaseUrl);
    // Quick test query
    await pg.getProject('test-connectivity');
    storage = pg;
    console.log('[AVOS] Connected to PostgreSQL storage.');
  } catch (err: any) {
    console.warn(`[AVOS] PostgreSQL connection failed (${err.message}). Defaulting to InMemoryRepository for local development/test.`);
    storage = new InMemoryRepository();
  }

  // Core Services
  const policyEngine = new PolicyEngine(storage);
  const emergencyService = new EmergencyService(storage);
  const budgetService = new BudgetService(storage);
  const auditLogger = new AuditLogger(storage);

  // Runtime Adapter Selection
  let adapter: IRuntimeAdapter;
  if (config.automatonEnabled) {
    adapter = new AutomatonRuntimeAdapter({
      sandboxPath: './sandbox/automaton',
      allowExternalActions: false,
      maxExecutionTimeoutMs: 60000,
    });
    console.log('[AVOS] Automaton Sandboxed Adapter activated (Restricted sandbox mode).');
  } else {
    adapter = new MockRuntimeAdapter();
    console.log('[AVOS] Mock Runtime Adapter activated (Zero external side effects).');
  }

  // Execution Gateway & Queue
  const gateway = new ExecutionGateway(storage, policyEngine, emergencyService, budgetService, auditLogger);
  const queue = new DurableQueue(storage, auditLogger);
  const workerManager = new WorkerManager(queue, gateway, adapter, storage, {
    concurrency: config.workerConcurrency,
    pollIntervalMs: config.workerPollIntervalMs,
    leaseDurationMs: config.workerLeaseDurationMs,
  });

  const reportGenerator = new DailyReportGenerator(storage, emergencyService, config.monthlyBudgetCap);

  // Start Worker Pool
  workerManager.start();
  console.log(`[AVOS] Worker pool started with concurrency = ${config.workerConcurrency}.`);

  // Start API Server
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

  const server = buildServer(services);

  try {
    await server.listen({ port: config.port, host: config.host });
    console.log(`[AVOS] API Control Plane listening on http://${config.host}:${config.port}`);
  } catch (err) {
    console.error('[AVOS] Server startup error:', err);
    process.exit(1);
  }

  // Graceful Shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[AVOS] Received ${signal}. Shutting down gracefully...`);
    await workerManager.stop();
    await server.close();
    console.log('[AVOS] Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[AVOS] Fatal bootstrap error:', err);
  process.exit(1);
});
