import dotenv from 'dotenv';
dotenv.config();

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: string;
  logLevel: string;
  ownerToken: string;
  databaseUrl: string;
  monthlyBudgetCap: number;
  defaultExperimentBudget: number;
  workerConcurrency: number;
  workerPollIntervalMs: number;
  workerLeaseDurationMs: number;
  automatonEnabled: boolean;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '4000', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  ownerToken: process.env.AVOS_OWNER_TOKEN || 'test-owner-token-32-chars-long-min',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://avos_user:avos_password@localhost:5432/avos_db',
  monthlyBudgetCap: parseFloat(process.env.AVOS_MONTHLY_BUDGET_CAP || '50.00'),
  defaultExperimentBudget: parseFloat(process.env.AVOS_DEFAULT_EXPERIMENT_BUDGET || '20.00'),
  workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || '5', 10),
  workerPollIntervalMs: parseInt(process.env.WORKER_POLL_INTERVAL_MS || '1000', 10),
  workerLeaseDurationMs: parseInt(process.env.WORKER_LEASE_DURATION_MS || '30000', 10),
  automatonEnabled: process.env.AUTOMATON_ENABLED === 'true',
};
