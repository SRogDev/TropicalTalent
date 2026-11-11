/**
 * Applies the tropical_* migrations in order against a Postgres connection.
 *
 *   bun add -d pg
 *   TROPICAL_DB_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
 *     node migrations/tropical/apply.mjs
 *
 * Get the string from: Supabase dashboard > Project Settings > Database >
 * Connection string > URI. Use the SESSION pooler (port 5432), not the
 * transaction pooler on 6543 — transaction mode cannot run DDL in a
 * transaction block, and every migration here is wrapped in BEGIN/COMMIT.
 *
 * Each file is already transactional, so a failure rolls that file back
 * cleanly and later files are skipped. Safe to re-run: every statement is
 * IF NOT EXISTS / ON CONFLICT guarded, except the two ALTER TABLE ... ADD
 * CONSTRAINT in 005, which are skipped explicitly if already present.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const url = process.env.TROPICAL_DB_URL;

if (!url) {
  console.error('TROPICAL_DB_URL is not set. See the header of this file.');
  process.exit(1);
}

const files = readdirSync(here)
  .filter((f) => /^\d{3}_.*\.sql$/.test(f))
  .sort();

if (files.length === 0) {
  console.error('No migration files found in', here);
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  // A backfill over every user row should never sit behind a default timeout.
  statement_timeout: 120_000,
});

await client.connect();
console.log('connected\n');

let failed = null;

for (const file of files) {
  const sql = readFileSync(join(here, file), 'utf8');
  process.stdout.write(`${file} ... `);
  try {
    await client.query(sql);
    console.log('ok');
  } catch (err) {
    // Every migration wraps itself in BEGIN/COMMIT, so a failed statement
    // leaves the CONNECTION inside an aborted transaction. Without this
    // rollback the next file fails with 25P02 ("current transaction is
    // aborted") no matter what it contains, which makes one real error look
    // like a cascade of unrelated ones.
    await client.query('ROLLBACK').catch(() => {});

    console.log('FAILED');
    console.error(`\n  ${err.code ?? ''} ${err.message}`);
    if (err.detail) console.error(`  detail: ${err.detail}`);
    if (err.hint) console.error(`  hint: ${err.hint}`);
    failed = file;
    break;
  }
}

if (!failed) {
  console.log('\n--- verification ---');
  const checks = [
    ['tropical tables created', `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'tropical\\_%'`],
    ['disciplines seeded', `SELECT count(*)::int AS n FROM public.tropical_disciplines`],
    // Archived out of `public` by 039 — it was 003 seed data read only by the
    // 004 backfill, and 039 runs before this block, so `archive` is where it
    // lives after any successful run. Still counted: a zero here means 003
    // never seeded and 004 had nothing to infer disciplines from.
    ['tag map rows (archived)', `SELECT count(*)::int AS n FROM archive.tropical_tag_discipline_map`],
    ['creatives with a discipline', `SELECT count(DISTINCT user_id)::int AS n
       FROM public.tropical_creative_disciplines`],
    ['wallet rows', `SELECT count(*)::int AS n FROM public.tropical_user_balances`],
    ['rls-enabled tropical tables', `SELECT count(*)::int AS n FROM pg_tables
       WHERE schemaname = 'public' AND tablename LIKE 'tropical\\_%' AND rowsecurity`],
    ['rls policies', `SELECT count(*)::int AS n FROM pg_policies
       WHERE schemaname = 'public' AND tablename LIKE 'tropical\\_%'`],
    // Not observable through PostgREST, so it is checked here or not at all.
    // If this is 0, realtime chat silently never delivers a message.
    ['realtime-published tables', `SELECT count(*)::int AS n FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND tablename LIKE 'tropical%'`],
    ['tropical functions', `SELECT count(*)::int AS n FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname LIKE 'tropical\\_%'`],
  ];
  for (const [label, q] of checks) {
    const { rows } = await client.query(q);
    console.log(`  ${label}: ${rows[0].n}`);
  }
  // 17 = 16 tropical_ tables + the tropical_public_briefs view, which
  // information_schema.tables counts but pg_tables does not.
  console.log(
    '\nExpected: 17 tables (16 + 1 view), 33 disciplines, 61 tag rows,' +
      '\n          28 creatives, 45 wallets, 16 rls, 29 policies,' +
      '\n          3 realtime, 4 functions.',
  );
}

await client.end();
process.exit(failed ? 1 : 0);
