import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { config } from '../config';

export async function runMigrations(databaseUrl: string = config.databaseUrl): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    console.log('Running database migrations...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const defaultDir = path.join(__dirname, '../../migrations');
    const cwdDir = path.join(process.cwd(), 'migrations');
    const migrationsDir = fs.existsSync(defaultDir) ? defaultDir : cwdDir;
    if (!fs.existsSync(migrationsDir)) {
      console.log('No migrations directory found.');
      return;
    }

    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      const { rows } = await client.query('SELECT version FROM schema_migrations WHERE version = $1', [file]);
      if (rows.length === 0) {
        console.log(`Applying migration: ${file}`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Successfully applied: ${file}`);
      } else {
        console.log(`Migration ${file} already applied.`);
      }
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Allow direct CLI invocation
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migrations complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
