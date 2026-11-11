import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminDb } from '@/lib/supabase';
import { getTenant } from '@/modules/tenancy/queries';
import { hasFeature } from '@/modules/tenancy/types';

/**
 * The waitlist endpoint.
 *
 * The landing page no longer posts here — its CTA creates a real account, and
 * `signUpAction` writes the waitlist row itself so the production funnel data
 * continues uninterrupted.
 *
 * This route is kept anyway. The `waitlist` table is live in production and
 * this endpoint may have callers outside this codebase (a campaign form, an
 * embed); removing it would silently break them. It is deliberately narrow:
 * insert a row, nothing else.
 */

const waitlistSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(['creative', 'brand']),
  companyBlurb: z.string().max(280).optional(),
  passion: z.string().max(500).optional(),
  bio: z.string().max(280).optional(),
  locationText: z.string().max(200).optional(),
});

export async function POST(request: NextRequest) {
  let raw: unknown;

  // Accept both JSON and the multipart form the old dialog sent.
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    raw = await request.json().catch(() => null);
  } else {
    const form = await request.formData();
    raw = {
      name: form.get('name'),
      email: form.get('email'),
      role: form.get('role'),
      companyBlurb: form.get('companyBlurb') ?? undefined,
      passion: form.get('passions')
        ? safeJoin(form.get('passions'))
        : (form.get('passion') ?? undefined),
      bio: form.get('bio') ?? undefined,
      locationText: form.get('locationText') ?? undefined,
    };
  }

  // Only on the hosts that keep a waitlist.
  //
  // proxy.ts lists this path in PUBLIC_API, so it answers on every branded
  // host, not just tropicaltalent.dev — and `waitlist` has no tenant column, so
  // a post to a white-label's domain would file a row in TropicalTalent's funnel. 404
  // rather than 403: a host that runs no waitlist has no such endpoint, and
  // saying otherwise tells a caller which sites are white-labels.
  const tenant = await getTenant();
  if (!hasFeature(tenant, 'waitlist')) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const parsed = waitlistSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid submission' },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const { error } = await adminDb()
    .from('waitlist')
    .insert({
      name: data.name,
      email: data.email,
      role: data.role,
      company_blurb: data.companyBlurb ?? null,
      passion: data.passion ?? null,
      bio: data.bio ?? null,
      location_text: data.locationText ?? null,
    });

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: "You're already on the waitlist." }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to join the waitlist.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

function safeJoin(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.join(', ') : value;
  } catch {
    return value;
  }
}
