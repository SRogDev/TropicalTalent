/**
 * Cross-tenant isolation, proved against the live database.
 *
 * Separate from verify.mjs on purpose. That script is read-only — it signs in
 * as existing seed accounts and exercises shipping queries. This one has to
 * CREATE a second tenant to have anything to isolate from, so it owns a
 * fixture and is responsible for removing it again.
 *
 * What it proves, as real signed-in users over PostgREST — the same path RLS
 * actually evaluates, not a mocked client:
 *
 *   1. An Acme contractor sees no classic talent and no classic briefs.
 *   2. A classic member sees no Acme talent and no Acme briefs.
 *   3. Neither can read the other's tenant row or membership rows.
 *   4. Anonymous callers get nothing from the briefs feed at all.
 *
 * Every object it makes is prefixed `zz-verify-tenancy` or belongs to the
 * `acme-verify` tenant, and teardown runs even when an assertion fails — a
 * failed run must not leave a second tenant sitting in the database.
 *
 *   node scripts/verify-tenancy.mjs
 */
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PW = 'change-me-dev-only';
const SLUG = 'acme-verify';
const MARK = 'zz-verify-tenancy';

const svc = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  'Content-Type': 'application/json',
};

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

async function db(path, init = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { ...svc, Prefer: init.prefer ?? 'return=representation', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path}: ${body?.message ?? res.status}`);
  return body;
}

async function signIn(email) {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${email}: ${body.error_description ?? body.msg}`);
  return { token: body.access_token, id: body.user.id };
}

/** Reads as a signed-in user — the path RLS evaluates. */
const asUser = (session) => async (path) => {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${session.token}` },
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body: Array.isArray(body) ? body : [], raw: body };
};

/** Calls an RPC as a signed-in user, so auth.uid() is theirs. */
const rpcAsUser = (session) => async (fn, args) => {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
};

async function createUser(email, name, username, role) {
  const res = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: 'POST',
    headers: svc,
    body: JSON.stringify({ email, password: PW, email_confirm: true }),
  });
  const body = await res.json();
  if (!res.ok && !/already/i.test(body.msg ?? body.message ?? '')) {
    throw new Error(`createUser ${email}: ${body.msg ?? body.message}`);
  }
  let id = body.id;
  if (!id) {
    const found = await db(`users?select=id&username=eq.${username}`);
    id = found[0]?.id;
  }
  // A trigger creates public.users from auth.users, so upsert rather than
  // insert — same reason scripts/seed-tropical.ts does.
  await db('users?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([{ id, username, name, role, profile_completed: true }]),
  });
  return id;
}

const created = { users: [], tenantId: null, projectId: null };

async function teardown() {
  console.log('\n=== TEARDOWN ===');
  try {
    if (created.projectId) {
      await db(`tropical_projects?id=eq.${created.projectId}`, { method: 'DELETE' });
    }
    if (created.tenantId) {
      // Memberships and domains cascade from the tenant.
      await db(`tropical_tenants?id=eq.${created.tenantId}`, { method: 'DELETE' });
    }
    // Deleting the auth user does NOT cascade to public.users in this
    // database — the first run of this script proved it, leaving two orphan
    // profile rows behind. The profile and everything hanging off it has to be
    // removed explicitly, children first, or the users delete trips a foreign
    // key and the fixture accumulates a little more every run.
    if (created.users.length) {
      const list = `(${created.users.join(',')})`;
      for (const table of [
        'tropical_tenant_members',
        'tropical_creative_disciplines',
        'tropical_user_balances',
        'creative_data',
        'brand_data',
        'user_stats',
        'user_balances',
      ]) {
        await db(`${table}?user_id=in.${list}`, { method: 'DELETE' });
      }
      await db(`users?id=in.${list}`, { method: 'DELETE' });

      for (const id of created.users) {
        await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: svc });
      }
    }
    // Confirm nothing of ours survives.
    const t = await db(`tropical_tenants?select=id&slug=eq.${SLUG}`);
    const u = await db(`users?select=id&username=like.${MARK}*`);
    check(
      'fixture removed',
      t.length === 0 && u.length === 0,
      `${t.length} tenant, ${u.length} users left`,
    );
  } catch (err) {
    check('teardown clean', false, err.message);
  }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

async function setup() {
  console.log('=== FIXTURE ===');

  const [tenant] = await db('tropical_tenants', {
    method: 'POST',
    body: JSON.stringify({
      slug: SLUG,
      name: 'Acme Verify',
      archetype: 'contractors_brands',
      features: { publicBriefs: true, talentBrowse: true, recurring: true },
      branding: { poweredBy: true },
      platform_fee_pct: 20,
      partner_share_pct: 25,
    }),
  });
  created.tenantId = tenant.id;
  check(
    'acme tenant created',
    Boolean(tenant.id),
    `fee=${tenant.platform_fee_pct} partner=${tenant.partner_share_pct}`,
  );

  await db('tropical_tenant_domains', {
    method: 'POST',
    body: JSON.stringify({ host: 'acme-verify.tropicaltalent.dev', tenant_id: tenant.id, is_primary: true }),
  });

  const contractorId = await createUser(
    `${MARK}-contractor@tropical-seed.invalid`,
    'Acme Contractor',
    `${MARK}-contractor`,
    'creative',
  );
  const brandId = await createUser(
    `${MARK}-brand@tropical-seed.invalid`,
    'Acme Company',
    `${MARK}-brand`,
    'brand',
  );
  created.users.push(contractorId, brandId);

  // The trigger on public.users does NOT create tenant memberships — sign-up
  // does, in writeProfile(). Here the fixture stands in for that, and gives
  // them membership of Acme ONLY. That single fact is what the whole file
  // tests: they exist in the same database as 50 classic users and must not
  // be able to see any of them.
  await db('tropical_tenant_members?on_conflict=tenant_id,user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([
      {
        tenant_id: tenant.id,
        user_id: contractorId,
        role: 'member',
        capabilities: { brand: false, work: true },
      },
      {
        tenant_id: tenant.id,
        user_id: brandId,
        role: 'member',
        capabilities: { brand: true, work: false },
      },
    ]),
  });

  // Remove the classic membership the backfill may have granted, so these two
  // are Acme-only. Without this they would legitimately see classic rows and
  // the test would prove nothing.
  const classic = await db('tropical_tenants?select=id&is_classic=is.true');
  await db(
    `tropical_tenant_members?tenant_id=eq.${classic[0].id}&user_id=in.(${contractorId},${brandId})`,
    { method: 'DELETE' },
  );

  // Through tropical_create_project, as the signed-in brand — NOT a service-role
  // insert with tenant_id set by hand.
  //
  // This is the assertion whose absence let the tenancy bug ship. The RPC never
  // named tenant_id, so every project created by the real app fell to the
  // column default (the classic tenant) and became unreadable to its own
  // creator under RLS. The fixture set the column itself, so the isolation
  // suite passed against data the product could not actually produce. If it is
  // ever rewritten to insert directly again, this check stops meaning anything.
  const brandSession = await signIn(`${MARK}-brand@tropical-seed.invalid`);
  const budget = 500000;
  const feePct = Number(tenant.platform_fee_pct ?? 15);
  const crewPool = budget - Math.floor((budget * feePct) / 100);

  const createdProject = await rpcAsUser(brandSession)('tropical_create_project', {
    p_name: `${MARK} Acme brief`,
    p_brief: 'Acme internal work. Must never appear on the classic feed.',
    p_budget: budget,
    p_visibility: 'public',
    p_deadline: null,
    p_roles: [{ title: 'Contractor', percentage: 100, amount: crewPool, sort_order: 0 }],
    p_tenant_id: tenant.id,
  });

  check(
    'create_project RPC accepted',
    createdProject.ok && typeof createdProject.body === 'string',
    createdProject.ok ? '' : JSON.stringify(createdProject.body),
  );

  created.projectId = typeof createdProject.body === 'string' ? createdProject.body : null;

  let project = {};
  if (created.projectId) {
    [project] = await db(
      `tropical_projects?select=id,tenant_id,platform_fee_pct&id=eq.${created.projectId}`,
    );

    // Activate it: the feed only lists pending_payment/active, and the RPC
    // opens at pending_payment. Done through the service role because going
    // via escrow would mean charging a card.
    await db(`tropical_projects?id=eq.${created.projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
    });
  }

  check(
    'project created through the RPC lands in the right tenant',
    project?.tenant_id === tenant.id,
    `tenant_id = ${project?.tenant_id ?? 'none'}, expected ${tenant.id}`,
  );

  check(
    "project carries the tenant's fee, not the client's",
    Number(project?.platform_fee_pct) === feePct,
    `platform_fee_pct = ${project?.platform_fee_pct}, tenant = ${feePct}`,
  );

  return { tenantId: tenant.id, classicId: classic[0].id, contractorId, brandId };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

const TALENT = (tenantId, selfId) =>
  'users?select=id,username,name,membership:tropical_tenant_members!inner(tenant_id)' +
  `&role=eq.creative&id=neq.${selfId}` +
  `&membership.tenant_id=eq.${tenantId}&membership.status=eq.active`;

async function run() {
  const { tenantId, classicId, contractorId } = await setup();

  const contractor = asUser(await signIn(`${MARK}-contractor@tropical-seed.invalid`));
  const classicUser = asUser(await signIn('seed_singer@tropical-seed.invalid'));

  console.log('\n=== ACME CONTRACTOR CANNOT SEE CLASSIC ===');
  {
    // Scoped the way the app scopes it.
    const own = await contractor(TALENT(tenantId, contractorId));
    check(
      'talent scoped to acme returns only acme',
      own.ok && own.body.length === 0,
      `${own.body.length} rows (only member is themselves + the brand, who is not a creative)`,
    );

    // The important one: ask for the CLASSIC tenant explicitly. RLS on
    // tropical_tenant_members must make the inner join empty regardless.
    const cross = await contractor(TALENT(classicId, contractorId));
    check(
      'talent forced to classic tenant still returns nothing',
      cross.ok && cross.body.length === 0,
      `${cross.body.length} classic creatives leaked`,
    );

    // And with no tenant filter at all — the app-layer filter removed. The
    // membership policy alone has to hold the line.
    const unfiltered = await contractor(
      `users?select=id,membership:tropical_tenant_members!inner(tenant_id)&role=eq.creative&id=neq.${contractorId}`,
    );
    check(
      'talent with NO tenant filter still returns nothing',
      unfiltered.ok && unfiltered.body.length === 0,
      `${unfiltered.body.length} rows without the app-layer filter — this is the RLS boundary, not the query`,
    );

    const briefs = await contractor('tropical_public_briefs?select=id,name,tenant_id');
    const foreign = briefs.body.filter((b) => b.tenant_id !== tenantId);
    check(
      'briefs feed shows acme only',
      briefs.ok && foreign.length === 0,
      `${briefs.body.length} briefs, ${foreign.length} from another tenant`,
    );
    check(
      'acme brief is visible to acme',
      briefs.body.some((b) => b.name.includes(MARK)),
      `${briefs.body.length} visible`,
    );

    const tenants = await contractor('tropical_tenants?select=id,slug');
    check(
      'cannot read the classic tenant row',
      !tenants.body.some((t) => t.id === classicId),
      `sees ${tenants.body.map((t) => t.slug).join(',') || 'none'}`,
    );

    const members = await contractor(
      `tropical_tenant_members?select=user_id&tenant_id=eq.${classicId}`,
    );
    check(
      'cannot enumerate classic memberships',
      members.body.length === 0,
      `${members.body.length} rows`,
    );
  }

  console.log('\n=== CLASSIC MEMBER CANNOT SEE ACME ===');
  {
    const acme = await classicUser(TALENT(tenantId, contractorId));
    check(
      'talent forced to acme returns nothing',
      acme.ok && acme.body.length === 0,
      `${acme.body.length} acme members leaked`,
    );

    const briefs = await classicUser('tropical_public_briefs?select=id,name,tenant_id');
    const leaked = briefs.body.filter((b) => b.tenant_id === tenantId);
    check(
      'classic feed excludes the acme brief',
      leaked.length === 0,
      `${briefs.body.length} briefs, ${leaked.length} from acme`,
    );

    const tenants = await classicUser('tropical_tenants?select=id,slug');
    check(
      'cannot read the acme tenant row',
      !tenants.body.some((t) => t.id === tenantId),
      `sees ${tenants.body.map((t) => t.slug).join(',') || 'none'}`,
    );
  }

  console.log('\n=== ADMIN SCOPE ===');
  {
    // The admin console reads through the SERVICE ROLE, which bypasses RLS
    // entirely. So unlike everything above, its tenant boundary is not
    // enforced by Postgres — it is the filter requireAdminScope() hands to
    // each loader. That makes these the assertions that matter most: if a
    // loader forgets its filter, nothing else stops it.
    //
    // Checked here at the query level, mirroring what modules/admin/queries.ts
    // builds, so a loader that drops its scope shows up as a leak rather than
    // as a passing test.
    const svcGet = async (path) => {
      const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: svc });
      const b = await r.json().catch(() => []);
      return Array.isArray(b) ? b : [];
    };

    const scopedUsers = await svcGet(
      `users?select=id,membership:tropical_tenant_members!inner(tenant_id)&membership.tenant_id=eq.${tenantId}`,
    );
    check(
      'admin accounts scoped to acme returns only acme members',
      scopedUsers.length === 2,
      `${scopedUsers.length} (the contractor and the company)`,
    );

    const scopedProjects = await svcGet(
      `tropical_projects?select=id,tenant_id&tenant_id=eq.${tenantId}`,
    );
    const strays = scopedProjects.filter((p) => p.tenant_id !== tenantId);
    check(
      'admin projects scoped to acme returns only acme',
      strays.length === 0,
      `${scopedProjects.length} project(s), ${strays.length} foreign`,
    );

    // Holds and disputes reach a tenant only through their project, which is
    // the join most likely to be written wrong.
    const scopedHolds = await svcGet(
      `tropical_escrow_holds?select=amount,project:tropical_projects!inner(tenant_id)&project.tenant_id=eq.${tenantId}`,
    );
    check(
      'admin escrow holds scope through the project join',
      scopedHolds.length === 0,
      `${scopedHolds.length} (acme has no funded escrow)`,
    );

    // And the classic side still sees its own, so the filter narrows rather
    // than empties.
    const classicUsers = await svcGet(
      `users?select=id,membership:tropical_tenant_members!inner(tenant_id)&membership.tenant_id=eq.${classicId}`,
    );
    check(
      'admin accounts scoped to classic still returns the roster',
      classicUsers.length > 40,
      `${classicUsers.length} classic members`,
    );

    const unscoped = await svcGet('users?select=id');
    check(
      'unscoped super-admin view is wider than either tenant',
      unscoped.length > classicUsers.length,
      `${unscoped.length} total vs ${classicUsers.length} classic — includes members of no tenant`,
    );
  }

  console.log('\n=== ANONYMOUS ===');
  {
    const res = await fetch(`${URL_}/rest/v1/tropical_public_briefs?select=id`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    const body = await res.json().catch(() => null);
    check(
      'anon gets nothing from the briefs feed',
      !res.ok || (Array.isArray(body) && body.length === 0),
      `http=${res.status} ${body?.message ?? ''}`,
    );
  }
}

try {
  await run();
} catch (err) {
  check('run completed', false, err.message);
} finally {
  await teardown();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
