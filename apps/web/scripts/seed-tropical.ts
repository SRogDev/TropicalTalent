/**
 * Seeds disposable tropical test fixtures: one brand and three talent with
 * real disciplines, so the apply -> accept -> fund -> release loop can be
 * exercised end to end without touching anyone's real account.
 *
 *   bunx tsx scripts/seed-tropical.ts                 # create fixtures
 *   bunx tsx scripts/seed-tropical.ts --with-project  # also create a project
 *   bunx tsx scripts/seed-tropical.ts --link          # magic sign-in links
 *   bunx tsx scripts/seed-tropical.ts --link --redirect=http://localhost:3000/auth/callback
 *   bunx tsx scripts/seed-tropical.ts --teardown      # remove every fixture
 *
 * SAFETY
 * Every fixture email is under @{SEED_DOMAIN}, which is a .invalid TLD and can
 * never be a real address (RFC 2606). Teardown refuses to touch anything whose
 * email does not end in that domain, so it cannot delete a real user even if
 * the marker were somehow attached to one. Deleting the auth user cascades to
 * public.users and everything keyed off it.
 *
 * CUBORA (Phase 2): creative fixtures also get a `tropical_providers` row and
 * draft `tropical_offers` — invented names, invented supply, verification
 * status `pending`. Drafts never appear in the public catalog; publish one
 * from /offers to exercise the catalog. Nothing here is real supply,
 * availability, or verification.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY. Intended for development databases —
 * it will happily run against production, so check which project .env.local
 * points at before using --teardown.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// .env.local is not loaded automatically outside Next.
function loadEnv(): void {
  try {
    const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!match) continue;
      const [, key, value] = match;
      if (!process.env[key]) {
        process.env[key] = value.trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // Fall through to whatever is already in the environment.
  }
}
loadEnv();

const SEED_DOMAIN = 'tropical-seed.invalid';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface Fixture {
  handle: string;
  name: string;
  role: 'brand' | 'creative';
  bio: string;
  disciplines: string[];
  tags: string[];
  /** Cubora provider profile (Phase 2). Fictitious, verification pending. */
  provider?: {
    kind: 'individual' | 'business';
    displayName: string;
    description: string;
    city: string;
    languages: string[];
  };
  /** Draft offers for the provider above. Never published by the seed. */
  offers?: Array<{
    category: 'talent' | 'services' | 'products';
    title: string;
    description: string;
    skills: string[];
    city: string;
    availability: 'available' | 'limited' | 'unavailable';
    quantityAvailable?: number;
    quantityUnit?: string;
    productionCapacity?: Record<string, unknown>;
    pricingBasis: 'hour' | 'project' | 'unit' | 'quote';
    priceAmount?: number;
    originCountry?: string;
    attributes?: Record<string, unknown>;
  }>;
}

/**
 * Disciplines here are drawn from the seeded taxonomy and chosen to cover the
 * templates in brief-split.ts, so a seeded brief actually finds candidates.
 */
const FIXTURES: Fixture[] = [
  {
    handle: 'seed_brand',
    name: 'Seed Brand Co',
    role: 'brand',
    bio: 'Test brand fixture for tropical development.',
    disciplines: [],
    tags: [],
  },
  {
    handle: 'seed_singer',
    name: 'Ada Vale',
    role: 'creative',
    bio: 'Vocalist and songwriter. Test fixture.',
    disciplines: ['singer', 'songwriter'],
    tags: ['singer', 'songwriter'],
    provider: {
      kind: 'individual',
      displayName: 'Ada Vale',
      description: 'Fictitious vocalist for development testing.',
      city: 'Havana',
      languages: ['es', 'en'],
    },
    offers: [
      {
        category: 'talent',
        title: 'Fictitious session vocalist',
        description: 'Invented talent fixture for development testing only.',
        skills: ['singer', 'songwriter'],
        city: 'Havana',
        availability: 'available',
        pricingBasis: 'hour',
        priceAmount: 40,
        originCountry: 'Cuba',
        attributes: {
          years_experience: 6,
          portfolio_urls: ['https://example.invalid/ada-vale'],
          availability: 'Weekdays, Havana time.',
        },
      },
    ],
  },
  {
    handle: 'seed_shooter',
    name: 'Ren Okafor',
    role: 'creative',
    bio: 'Videographer and editor. Test fixture.',
    disciplines: ['videographer', 'video-editor', 'filmmaker'],
    tags: ['videographer', 'video editor'],
  },
  {
    handle: 'seed_producer',
    name: 'Juno Pike',
    role: 'creative',
    bio: 'Producer and event designer. Test fixture.',
    disciplines: ['producer', 'event-designer', 'event-manager'],
    tags: ['producer', 'event designer'],
    provider: {
      kind: 'individual',
      displayName: 'Juno Pike — Production',
      description: 'Fictitious production coordinator for development testing.',
      city: 'Havana',
      languages: ['es', 'en'],
    },
    offers: [
      {
        category: 'services',
        title: 'Fictitious event production coordination',
        description: 'Invented service fixture for development testing only.',
        skills: ['event-manager', 'producer'],
        city: 'Havana',
        availability: 'limited',
        pricingBasis: 'project',
        priceAmount: 1200,
        originCountry: 'Cuba',
        attributes: {
          scope: 'Coordination of a small fictitious event.',
          deliverables: ['Run sheet', 'Vendor list'],
          conditions: 'Remote planning; on-site in Havana only.',
        },
      },
    ],
  },
  {
    handle: 'seed_coffee',
    name: 'Aurora Coffee Co',
    role: 'creative',
    bio: 'Fictitious coffee producer for development testing.',
    disciplines: ['agricultural-producer'],
    tags: ['coffee', 'producer'],
    provider: {
      kind: 'business',
      displayName: 'Aurora Coffee Co (fictitious)',
      description: 'Invented coffee producer for development testing only.',
      city: 'Santiago de Cuba',
      languages: ['es', 'en'],
    },
    offers: [
      {
        category: 'products',
        title: 'Fictitious washed arabica coffee',
        description: 'Invented product fixture for development testing only.',
        skills: [],
        city: 'Santiago de Cuba',
        availability: 'limited',
        quantityAvailable: 500,
        quantityUnit: 'kg',
        productionCapacity: { monthly_amount: 500, unit: 'kg', lead_time_days: 14 },
        pricingBasis: 'unit',
        priceAmount: 8.5,
        originCountry: 'Cuba',
        attributes: {
          origin: 'Santiago de Cuba (invented)',
          quality: 'Invented grade — not a real claim.',
          quantity: '500 kg',
          availability: 'Harvest season (invented)',
          products: ['Washed arabica'],
          documentation: ['Origin certificate (invented)'],
        },
      },
    ],
  },
];

const emailFor = (handle: string) => `${handle}@${SEED_DOMAIN}`;

/** Obviously-disposable, and only ever used by these .invalid fixtures. */
const PASSWORD = process.env.TROPICAL_SEED_PASSWORD ?? 'change-me-dev-only';

async function findSeedUsers() {
  // listUsers is paginated; seed volume is tiny, but page anyway rather than
  // assuming everything fits in one response.
  const found: Array<{ id: string; email: string }> = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    if (!data.users.length) break;
    for (const user of data.users) {
      if (user.email?.endsWith(`@${SEED_DOMAIN}`)) {
        found.push({ id: user.id, email: user.email });
      }
    }
    if (data.users.length < 200) break;
  }
  return found;
}

async function seed() {
  console.log(`Seeding tropical fixtures into ${SUPABASE_URL}\n`);
  const existing = new Map((await findSeedUsers()).map((u) => [u.email, u.id]));

  for (const fixture of FIXTURES) {
    const email = emailFor(fixture.handle);
    let userId = existing.get(email);

    if (userId) {
      console.log(`  ${fixture.handle.padEnd(14)} exists`);
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { seed: true, name: fixture.name },
      });
      if (error || !data.user) {
        console.error(`  ${fixture.handle.padEnd(14)} FAILED: ${error?.message}`);
        continue;
      }
      userId = data.user.id;
      console.log(`  ${fixture.handle.padEnd(14)} created`);
    }

    // A trigger creates public.users from auth.users, so upsert rather than
    // insert — the row is already there by now.
    const { error: profileError } = await admin.from('users').upsert(
      {
        id: userId,
        username: fixture.handle,
        name: fixture.name,
        bio: fixture.bio,
        role: fixture.role,
        profile_completed: true,
      },
      { onConflict: 'id' },
    );
    if (profileError) console.error(`     profile: ${profileError.message}`);

    if (fixture.role === 'creative') {
      const { data: existingCreative } = await admin
        .from('creative_data')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      if (!existingCreative) {
        const { error } = await admin.from('creative_data').insert({
          user_id: userId,
          name: fixture.name,
          tags: fixture.tags,
          passion: fixture.bio,
        });
        if (error) console.error(`     creative_data: ${error.message}`);
      }

      if (fixture.disciplines.length > 0) {
        const { error } = await admin.from('tropical_creative_disciplines').upsert(
          fixture.disciplines.map((slug, index) => ({
            user_id: userId,
            discipline_slug: slug,
            source: 'confirmed',
            is_primary: index === 0,
          })),
          { onConflict: 'user_id,discipline_slug' },
        );
        if (error) console.error(`     disciplines: ${error.message}`);
      }
    } else {
      const { data: existingBrand } = await admin
        .from('brand_data')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      if (!existingBrand) {
        const { error } = await admin.from('brand_data').insert({
          user_id: userId,
          name: fixture.name,
          type: 'hospitality',
        });
        if (error) console.error(`     brand_data: ${error.message}`);
      }
    }

    // Cubora provider profile + draft offers (Phase 2). Drafts only:
    // nothing seeded here is published, verified, or sealed.
    if (fixture.provider) {
      const { data: providerRow, error: providerError } = await admin
        .from('tropical_providers')
        .upsert(
          {
            user_id: userId,
            kind: fixture.provider.kind,
            display_name: fixture.provider.displayName,
            description: fixture.provider.description,
            city: fixture.provider.city,
            country: 'Cuba',
            languages: fixture.provider.languages,
          },
          { onConflict: 'user_id' },
        )
        .select('id')
        .single();
      if (providerError || !providerRow) {
        console.error(`     provider: ${providerError?.message}`);
      } else if (fixture.offers?.length) {
        const { data: existingOffers } = await admin
          .from('tropical_offers')
          .select('title')
          .eq('provider_id', providerRow.id);
        const existingTitles = new Set((existingOffers ?? []).map((o) => o.title as string));
        for (const offer of fixture.offers) {
          if (existingTitles.has(offer.title)) continue;
          const { error } = await admin.from('tropical_offers').insert({
            provider_id: providerRow.id,
            category: offer.category,
            status: 'draft',
            title: offer.title,
            description: offer.description,
            skills: offer.skills,
            languages: fixture.provider.languages,
            city: offer.city,
            country: 'Cuba',
            availability_status: offer.availability,
            quantity_available: offer.quantityAvailable ?? null,
            quantity_unit: offer.quantityUnit ?? null,
            production_capacity: offer.productionCapacity ?? null,
            pricing_basis: offer.pricingBasis,
            price_amount: offer.priceAmount ?? null,
            price_currency: 'USD',
            origin_country: offer.originCountry ?? null,
            attributes: offer.attributes ?? {},
          });
          if (error) console.error(`     offer ${offer.title}: ${error.message}`);
        }
      }
    }

    // Wallet row, in case the project predates the 004 backfill.
    await admin.from('tropical_user_balances').upsert({ user_id: userId }, { onConflict: 'user_id' });
  }

  console.log('\nDone. Sign in with --link, or:');
  console.log(`  email    ${emailFor('seed_brand')}  (brand)`);
  console.log(`  email    ${emailFor('seed_singer')} (creative)`);
  console.log(`  password ${PASSWORD}`);
}

async function printLinks() {
  // Without an explicit redirect, Supabase sends the user to the project's
  // configured Site URL — production — which is useless for local testing.
  // The target must also be present in the project's Redirect URLs allow-list,
  // or Supabase silently falls back to the Site URL.
  const redirectArg = process.argv.find((a) => a.startsWith('--redirect='));
  const redirectTo =
    redirectArg?.split('=')[1] ??
    process.env.NEXT_PUBLIC_APP_URL ??
    'http://localhost:3000/auth/callback';

  console.log(`Magic sign-in links (single use, expire quickly)`);
  console.log(`redirecting to: ${redirectTo}\n`);

  for (const fixture of FIXTURES) {
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: emailFor(fixture.handle),
      options: { redirectTo },
    });
    if (error) {
      console.error(`  ${fixture.handle.padEnd(14)} ${error.message}`);
      continue;
    }
    console.log(`  ${fixture.handle} (${fixture.role})`);
    console.log(`    ${data.properties?.action_link}\n`);
  }
}

async function teardown() {
  const users = await findSeedUsers();

  // Defence in depth: findSeedUsers already filters on the domain, but this is
  // a destructive path, so re-check every id before deleting it.
  const safe = users.filter((u) => u.email.endsWith(`@${SEED_DOMAIN}`));
  if (safe.length !== users.length) {
    console.error('Refusing to run: found a non-seed address in the delete set.');
    process.exit(1);
  }

  if (safe.length === 0) {
    console.log('No seed fixtures found.');
    return;
  }

  console.log(`Removing ${safe.length} seed fixture(s) from ${SUPABASE_URL}\n`);

  for (const user of safe) {
    // Projects owned by a seed brand cascade from tropical_projects.brand_id,
    // but delete them explicitly so the intent is visible in the output.
    const { data: projects } = await admin
      .from('tropical_projects')
      .select('id, name')
      .eq('brand_id', user.id);

    for (const project of projects ?? []) {
      await admin.from('tropical_projects').delete().eq('id', project.id);
      console.log(`  project  ${project.name}`);
    }

    const { error } = await admin.auth.admin.deleteUser(user.id);
    console.log(`  user     ${user.email}${error ? ` FAILED: ${error.message}` : ''}`);
  }

  console.log('\nDone.');
}

/**
 * Creates a project owned by the seed brand, through the same RPC the app
 * uses. Signs in as the brand first, because tropical_create_project pins
 * brand_id to auth.uid() and refuses a service-role caller — so this exercises
 * the real authorisation path rather than working around it.
 */
async function seedProject() {
  const { createClient: createAnonClient } = await import('@supabase/supabase-js');
  const anon = createAnonClient(SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: authError } = await anon.auth.signInWithPassword({
    email: emailFor('seed_brand'),
    password: PASSWORD,
  });
  if (authError) {
    console.error(`Could not sign in as the seed brand: ${authError.message}`);
    console.error('Run the seeder without --with-project first.');
    process.exit(1);
  }

  // Resolve the seeded talent so roles come out pre-assigned.
  const { data: creatives } = await admin
    .from('users')
    .select('id, username')
    .in('username', ['seed_singer', 'seed_shooter', 'seed_producer']);

  const byHandle = new Map((creatives ?? []).map((c: any) => [c.username, c.id]));

  const budget = 1_200_000; // £12,000 in pence
  const feePct = 15;
  const crewPool = budget - Math.floor((budget * feePct) / 100);

  // Percentages are shares of the crew pool. Amounts must sum to it exactly or
  // the RPC rejects the payload — the same guard the server action relies on.
  const shares = [40, 35, 25];
  const exact = shares.map((s) => (crewPool * s) / 100);
  const amounts = exact.map(Math.floor);
  let remainder = crewPool - amounts.reduce((a, b) => a + b, 0);
  for (let i = 0; remainder > 0; i = (i + 1) % amounts.length, remainder--) amounts[i] += 1;

  const roles = [
    { title: 'Singer', discipline: 'singer', handle: 'seed_singer' },
    { title: 'Videographer', discipline: 'videographer', handle: 'seed_shooter' },
    { title: 'Event Designer', discipline: 'event-designer', handle: null },
  ].map((role, i) => ({
    title: role.title,
    discipline: role.discipline,
    percentage: shares[i],
    amount: amounts[i],
    // The third role is deliberately left open so the apply flow has a target.
    assigned_user_id: role.handle ? (byHandle.get(role.handle) ?? null) : null,
    sort_order: i,
  }));

  const { data, error } = await anon.rpc('tropical_create_project', {
    p_name: 'Seed - 90s Rooftop Session',
    p_brief:
      'A live music night on a hotel rooftop. Vocal-led set, filmed for social, with a designed stage moment.',
    p_budget: budget,
    p_visibility: 'public',
    p_platform_fee_pct: feePct,
    p_deadline: null,
    p_roles: roles,
  });

  if (error) {
    console.error(`Project creation failed: ${error.message}`);
    process.exit(1);
  }

  console.log(`\nCreated project ${data}`);
  console.log(`  £${(budget / 100).toLocaleString()} · 3 roles · 1 left open for applications`);
  console.log(`  http://localhost:3000/projects/${data}`);
}

const mode = process.argv.includes('--teardown')
  ? 'teardown'
  : process.argv.includes('--link')
    ? 'link'
    : 'seed';

const run =
  mode === 'teardown'
    ? teardown
    : mode === 'link'
      ? printLinks
      : async () => {
          await seed();
          if (process.argv.includes('--with-project')) await seedProject();
        };

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
