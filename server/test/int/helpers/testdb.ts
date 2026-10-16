import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

/**
 * The integration tests' own database: a separate `prisma dev --name ichiba-test --db-port 51300` server, never the
 * local working database (51214, whose PGlite serves the same data whatever database name is asked for) and never a
 * remote one. Every reset wipes the schema, so the guard refuses anything that isn't plainly this test database.
 */
export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:51300/template1?sslmode=disable';
const MARKER = '_ichiba_test_marker';
const MIGRATIONS = join(import.meta.dirname, '..', '..', '..', 'prisma', 'migrations');

function assertTestUrl(url: string) {
  const u = new URL(url);
  if (!['localhost', '127.0.0.1'].includes(u.hostname)) throw new Error(`Refusing to run tests against a non-local database (${u.hostname})`);
  if (u.port === '51214' || u.port === '5432' || u.port === '') throw new Error(`Refusing port ${u.port || 'default'}: start the test database with \`npx prisma dev --name ichiba-test --db-port 51300\``);
}

/** Migration folders in the order Prisma applies them. */
export const migrationNames = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();

export async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  assertTestUrl(TEST_DB_URL);
  const c = new pg.Client({ connectionString: TEST_DB_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/**
 * Empty schema, then the migrations as Prisma would apply them. `before[name]` runs right before that migration —
 * to seed rows the way they were when a migration met them in production.
 */
export async function resetAndMigrate(opts: { before?: Record<string, (c: pg.Client) => Promise<void>>; until?: string } = {}) {
  await withClient(async (c) => {
    const tables = await c.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
    if (tables.rows.length && !tables.rows.some((t) => t.tablename === MARKER)) throw new Error('The database has tables but no test marker: not a test database, refusing to wipe it');
    await c.query('DROP SCHEMA public CASCADE');
    await c.query('CREATE SCHEMA public');
    await c.query(`CREATE TABLE "${MARKER}" (at timestamptz DEFAULT now())`);
    for (const name of migrationNames()) {
      if (opts.until && name > opts.until) break;
      await opts.before?.[name]?.(c);
      await c.query(readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8'));
    }
  });
}

/** Point the app's PrismaService at the test database (read when it is constructed). */
export function useTestDatabaseForApp() {
  assertTestUrl(TEST_DB_URL);
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.DIRECT_URL = TEST_DB_URL;
  process.env.DATABASE_POOL_MAX = '1';
  process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret';
}
