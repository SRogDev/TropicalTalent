/**
 * Exercises the rebuilt query paths against the live database as real
 * signed-in seed users.
 *
 * Plain fetch against PostgREST rather than supabase-js: the JS client
 * constructs a realtime socket on import, which Node 20 has no WebSocket for.
 * The HTTP path is what RLS actually evaluates, so this tests the same thing.
 *
 * Every select string below is copied verbatim from the shipping code — this
 * is what catches embed-hint typos and RLS mistakes that a typecheck cannot.
 */
import { readFileSync } from 'node:fs';

// Resolved against the project root, not this file's directory.
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PW = 'change-me-dev-only';

async function signIn(handle) {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${handle}@tropical-seed.invalid`, password: PW }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${handle}: ${body.error_description ?? body.msg}`);
  return { token: body.access_token, id: body.user.id };
}

const rest = (session) => async (path) => {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${session.token}` },
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, body, error: res.ok ? null : (body?.message ?? `HTTP ${res.status}`) };
};

const rpc = (session) => async (fn, args) => {
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
  return { ok: res.ok, body, error: res.ok ? null : (body?.message ?? `HTTP ${res.status}`) };
};

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

const brandSession = await signIn('seed_brand');
const singerSession = await signIn('seed_singer');
const brand = rest(brandSession);
const singer = rest(singerSession);
const brandRpc = rpc(brandSession);
const singerRpc = rpc(singerSession);

// Every tenant-scoped query needs the tenant it is scoped to. Read it rather
// than hardcoded: the id differs per environment.
const CLASSIC_TENANT = await (async () => {
  const r = await brand('tropical_tenants?select=id&is_classic=is.true');
  return r.ok && r.body?.[0] ? r.body[0].id : null;
})();
check('classic tenant is readable by a member', Boolean(CLASSIC_TENANT), CLASSIC_TENANT ?? '');

console.log('\n=== TALENT (brand) ===');
{
  // Mirrors TALENT_SELECT in modules/talent/queries.ts, including the
  // membership !inner embed that carries the tenant boundary. If that embed is
  // ever dropped from the shipping select, this query keeps passing while the
  // real one starts returning other tenants' talent — so it is copied here
  // deliberately rather than simplified.
  const q =
    'users?select=id,username,name,avatar,bio,created_at,' +
    'membership:tropical_tenant_members!inner(tenant_id),' +
    'creative:creative_data(tags,passion,video,verification),' +
    'stats:user_stats(jobs_done),' +
    'disciplines:tropical_creative_disciplines(discipline_slug,is_primary),' +
    'place:locations(city,county,country)' +
    `&role=eq.creative&id=neq.${brandSession.id}` +
    `&membership.tenant_id=eq.${CLASSIC_TENANT}&membership.status=eq.active` +
    '&order=created_at.desc';
  const { ok, body, error } = await brand(q);
  check('TALENT_SELECT runs as a signed-in brand', ok, error ?? '');

  if (ok) {
    check('returns the roster', body.length > 0, `${body.length} creatives`);
    const withDisc = body.filter((u) => (u.disciplines ?? []).length > 0).length;
    const without = body.length - withDisc;
    check(
      'roster includes creatives with NO discipline',
      without > 0,
      `${withDisc} with, ${without} without — the group the roster fix restores`,
    );
    const withAvatar = body.filter((u) => u.avatar).length;
    check('spotlight has eligible candidates', withAvatar > 0, `${withAvatar} have a portrait`);

    // Keyset paging: every talent has to be reachable by walking the pages,
    // not just the first 24. This is the shape the Talent board's "show more"
    // asks for.
    const PAGE = 24;
    const seen = new Set();
    let cursor = null;
    let pages = 0;
    for (;;) {
      const paged = await brand(
        `${q}&limit=${PAGE + 1}${cursor ? `&created_at=lt.${encodeURIComponent(cursor)}` : ''}`,
      );
      if (!paged.ok) break;
      const more = paged.body.length > PAGE;
      const page = more ? paged.body.slice(0, PAGE) : paged.body;
      page.forEach((u) => seen.add(u.id));
      pages += 1;
      cursor = more ? page[page.length - 1].created_at : null;
      if (!cursor || pages > 20) break;
    }
    check(
      'keyset paging reaches every creative',
      seen.size === body.length,
      `${seen.size}/${body.length} over ${pages} page(s)`,
    );

    // The skill filter, as TALENT_SELECT_BY_DISCIPLINE writes it: an aliased
    // !inner embed so the filter cuts parent rows, with the plain embed still
    // returning the talent's full discipline list.
    const slug = body.flatMap((u) => (u.disciplines ?? []).map((d) => d.discipline_slug))[0];
    const filtered = await brand(
      `${q.replace('&role=eq.creative', ',match:tropical_creative_disciplines!inner(discipline_slug)&role=eq.creative')}` +
        `&match.discipline_slug=in.(${slug})`,
    );
    check('TALENT_SELECT_BY_DISCIPLINE runs', filtered.ok, filtered.error ?? '');
    if (filtered.ok) {
      const everyoneMatches = filtered.body.every((u) =>
        (u.disciplines ?? []).some((d) => d.discipline_slug === slug),
      );
      check(
        `skill filter returns whole profiles — ${slug}`,
        filtered.body.length > 0 && everyoneMatches,
        `${filtered.body.length} match, full discipline lists intact`,
      );
    }
  }
}

console.log('\n=== FAVOURITES / NOTIFICATIONS / CONTRACTS / DELIVERABLES (010–011) ===');
{
  const f = await brand('tropical_favourites?select=creative_id&limit=1');
  check('tropical_favourites readable under RLS', f.ok, f.error ?? '');

  const n = await brand(
    `tropical_notifications?select=id,kind,title,body,project_id,read,created_at&user_id=eq.${brandSession.id}&limit=5`,
  );
  check('own notifications readable', n.ok, n.error ?? `${n.body?.length ?? 0} rows`);

  const leak = await brand(`tropical_notifications?select=id&user_id=neq.${brandSession.id}&limit=1`);
  check("cannot read another user's notifications", leak.ok && leak.body.length === 0);

  const c = await brand(
    'tropical_role_contracts?select=id,project_id,role_id,status,terms,brand_accepted,' +
      'creative_accepted,updated_at,updated_by,' +
      'role:tropical_project_roles!tropical_role_contracts_role_id_fkey(title,amount,assigned_user_id)&limit=1',
  );
  check('role-contract embed hint resolves', c.ok, c.error ?? '');

  const d = await brand(
    'tropical_deliverables?select=id,project_id,title,description,due_date,sort_order,updated_at&limit=1',
  );
  check('deliverables readable', d.ok, d.error ?? '');
}

console.log('\n=== APPLICANT VIEW (011) ===');
{
  const a = await singer('tropical_my_applications?select=*&limit=50');
  check('creative reads their own applications + job detail', a.ok, a.error ?? '');
  if (a.ok) {
    const money = ['amount', 'percentage', 'budget', 'platform_fee_pct'];
    const leaked = money.filter((k) => (a.body ?? []).some((r) => k in r));
    check('applicant view carries NO money columns', leaked.length === 0, leaked.join(', '));
  }
}

console.log('\n=== MY ROLES / INVITATIONS (creative) ===');
{
  const q =
    'tropical_project_roles?select=id,title,percentage,amount,status,deadline_date,deliverables,' +
    'project:tropical_projects!tropical_project_roles_project_id_fkey(id,name,brief,status,currency,deadline_date,budget)' +
    `&assigned_user_id=eq.${singerSession.id}`;
  const { ok, body, error } = await singer(q);
  check('my-roles query runs', ok, error ?? '');
  if (ok) {
    const invited = body.filter((r) => r.status === 'invited');
    console.log(
      `        ${body.length} roles, ${invited.length} at status 'invited'` +
        (invited.length ? ' → now render as answerable invitations' : ''),
    );
  }
}

console.log('\n=== MIGRATION 012 (applied — these must all pass) ===');
{
  const r1 = await singerRpc('tropical_respond_to_invite', {
    p_role: '00000000-0000-0000-0000-000000000000',
    p_response: 'accepted',
  });
  const m1 = String(r1.error ?? '').includes('Could not find the function');
  check('tropical_respond_to_invite present', !m1, m1 ? 'NOT APPLIED — run migration 012' : '');

  const r2 = await brandRpc('tropical_unread_counts', { p_project: null });
  const m2 = String(r2.error ?? '').includes('Could not find the function');
  check('tropical_unread_counts present', !m2, m2 ? 'NOT APPLIED — run migration 012' : '');

  const r3 = await brandRpc('tropical_mark_channel_read', {
    p_channel: '00000000-0000-0000-0000-000000000000',
  });
  const m3 = String(r3.error ?? '').includes('Could not find the function');
  check('tropical_mark_channel_read present', !m3, m3 ? 'NOT APPLIED — run migration 012' : '');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(0);
