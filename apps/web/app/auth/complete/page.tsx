import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getViewer } from '@/modules/identity/queries';
import { CompleteProfile } from '@/components/waitlist/complete-profile';
import { TenantLogo } from '@/components/tropical/tenant-logo';
import { getTenant } from '@/modules/tenancy/queries';
import { homePath } from '@/modules/tenancy/types';
import { ARCHETYPE_PRESETS, referralAudience } from '@/modules/tenancy/presets';
import { TenantStyle } from '@/components/tropical/tenant-style';

/**
 * The tab icon has to be set per route.
 *
 * app/icon.svg is Next's file convention and applies to every page, so a
 * white-label's visitor sees the TropicalTalent mark in their tab even on a fully
 * branded screen. Only an explicit `icons` entry displaces it, and it has to
 * be generateMetadata rather than a static object because the tenant is not
 * known until the request.
 */
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const icon = tenant.branding.logoUrl;
  return {
    title: 'Finish setting up',
    ...(icon && icon.startsWith('https://') ? { icons: { icon } } : {}),
  };
}

/**
 * Where a Google sign-in lands when the account has no profile yet.
 *
 * OAuth gives us a verified email, a name and usually an avatar — but no role,
 * which is the field the entire product branches on. A user who skipped this
 * would be a talent with no disciplines: matched to nothing, invisible to
 * every brief.
 *
 * Already-complete profiles are bounced straight into the app, so a stale link
 * or a back-button press cannot strand someone here.
 */
export default async function CompleteProfilePage() {
  const tenant = await getTenant();

  const viewer = await getViewer();
  if (!viewer) redirect('/auth/sign-in');

  // Already done — a stale link or a back-button press. Where they go next is
  // the tenant's answer, not a fixed one: `/briefs` is a feed a contractor
  // white-label has switched off, so the old split landed them on a page that
  // immediately redirects somewhere else.
  if (viewer.profileCompleted) {
    if (!viewer.belongsToTenant) redirect('/auth/no-access');
    redirect(
      homePath({ canBrand: viewer.canBrand, isCreative: viewer.isCreative }, tenant.features),
    );
  }

  const preset = ARCHETYPE_PRESETS[tenant.archetype] ?? ARCHETYPE_PRESETS.classic;

  return (
    <main className='flex min-h-dvh flex-col items-center justify-center px-6 py-10'>
      <TenantStyle />
      <div className='mb-8 flex flex-col items-center text-center'>
        <TenantLogo
          logoUrl={tenant.branding.logoUrl}
          name={tenant.name}
          size={40}
          priority
          className='h-10 w-10'
        />
        <h1 className='mt-4 text-2xl font-bold tracking-tight'>Almost there</h1>
        <p className='text-muted-foreground mt-2 max-w-sm text-sm'>
          A few questions so we can match you to the right work.
        </p>
      </div>

      <CompleteProfile
        defaultName={viewer.name ?? ''}
        hasAvatar={Boolean(viewer.avatar)}
        tenant={{
          name: tenant.name,
          workerLabel: preset.signup.worker.label,
          payerLabel: preset.signup.payer.label,
          workerPlural: preset.nouns.worker.many,
          allowPayer: tenant.features.selfServeBrands !== false,
          referrals: referralAudience(tenant),
        }}
      />
    </main>
  );
}
