// Checks the Supabase RLS policies on any Postgres: creates the Supabase roles and auth.uid() inside a transaction,
// runs the policy block of the migration, tries reads/writes as anon and as a signed-in user, then rolls back.
// node _rls-check.mjs   (uses DIRECT_URL or DATABASE_URL; on a real Supabase DB, the roles already exist)
import 'dotenv/config';
import { readFileSync } from 'fs';
import pg from 'pg';

const db = new pg.Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
await db.connect();
let failures = 0;
const ok = (c, m) => (console.log(`${c ? 'PASS' : 'FAIL'} ${m}`), c || failures++);
const attempt = async (sql, params) => {
  await db.query('SAVEPOINT s');
  try {
    const r = await db.query(sql, params);
    await db.query('RELEASE SAVEPOINT s');
    return { rows: r.rows, rowCount: r.rowCount };
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT s');
    return { error: e.message };
  }
};

await db.query('BEGIN');
const supabase = (await db.query(`SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'`)).rowCount > 0;
if (!supabase) {
  await db.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth, public TO anon, authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;`);
  const sql = readFileSync('prisma/migrations/20261012091000_supabase_rls/migration.sql', 'utf8');
  const block = sql.slice(sql.indexOf('DO $$\nBEGIN\n  IF NOT EXISTS'), sql.indexOf('-- Tables added by later migrations'));
  await db.query(block);
}

// An empty database gets two sellers with a live and a draft listing each (rolled back at the end).
if (!(await db.query(`SELECT 1 FROM "Listing" WHERE status = 'PUBLISHED'`)).rowCount) {
  await db.query(`INSERT INTO "User" (id, username, "updatedAt") VALUES (gen_random_uuid(), 'rls_a', now()), (gen_random_uuid(), 'rls_b', now())`);
  await db.query(`INSERT INTO "Listing" (id, "sellerId", status, title, "updatedAt")
    SELECT gen_random_uuid(), u.id, s.status::"ListingStatus", 'RLS test', now() FROM "User" u, (VALUES ('PUBLISHED'), ('DRAFT')) s(status) WHERE u.username LIKE 'rls_%'`);
  await db.query(`INSERT INTO "Photo" (id, "ownerId", "listingId", key, width, height) SELECT gen_random_uuid(), "sellerId", id, 'k', 800, 1000 FROM "Listing"`);
}

const seller = (await db.query(`SELECT "sellerId" FROM "Listing" WHERE status = 'PUBLISHED' LIMIT 1`)).rows[0].sellerId;
const mine = (await db.query(`SELECT id FROM "Listing" WHERE "sellerId" = $1 LIMIT 1`, [seller])).rows[0].id;
const theirs = (await db.query(`SELECT id FROM "Listing" WHERE "sellerId" <> $1 AND status = 'PUBLISHED' LIMIT 1`, [seller])).rows[0].id;
const counts = (await db.query(`SELECT count(*) FILTER (WHERE status IN ('PUBLISHED','RESERVED','SOLD'))::int AS visible, count(*)::int AS total FROM "Listing"`)).rows[0];

await db.query('SET LOCAL ROLE anon');
const anonList = await attempt(`SELECT count(*)::int AS n FROM "Listing"`);
ok(anonList.rows?.[0].n === counts.visible && counts.visible < counts.total, `anon sees only visible listings (${anonList.rows?.[0].n} of ${counts.total})`);
ok((await attempt(`SELECT count(*) FROM "Photo"`)).rows, 'anon can read photos of visible listings');
ok(!!(await attempt(`SELECT * FROM "User" LIMIT 1`)).error, 'anon cannot read users (emails, phones)');
ok(!!(await attempt(`SELECT * FROM "Order" LIMIT 1`)).error, 'anon cannot read orders');
ok(!!(await attempt(`UPDATE "Listing" SET price = 1 WHERE id = $1`, [mine])).error, 'anon cannot update listings');
await db.query('RESET ROLE');

await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [seller]);
await db.query('SET LOCAL ROLE authenticated');
const own = await attempt(`UPDATE "Listing" SET price = price WHERE id = $1`, [mine]);
ok(own.rowCount === 1, 'owner can update their listing');
const other = await attempt(`UPDATE "Listing" SET price = 1 WHERE id = $1`, [theirs]);
ok(other.rowCount === 0, "owner cannot update someone else's listing");
const steal = await attempt(`UPDATE "Listing" SET "sellerId" = (SELECT "sellerId" FROM "Listing" WHERE id = $2) WHERE id = $1`, [mine, theirs]);
ok(!!steal.error, 'owner cannot hand a listing to another seller');
const delOther = await attempt(`DELETE FROM "Listing" WHERE id = $1`, [theirs]);
ok(delOther.rowCount === 0, "owner cannot delete someone else's listing");
const photoOther = await attempt(`UPDATE "Photo" SET "order" = 9 WHERE "listingId" = $1`, [theirs]);
ok(photoOther.rowCount === 0, "owner cannot change someone else's photos");
ok(!!(await attempt(`SELECT * FROM "User" LIMIT 1`)).error, 'signed-in user cannot read the users table');
await db.query('RESET ROLE');

await db.query('ROLLBACK');
await db.end();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
