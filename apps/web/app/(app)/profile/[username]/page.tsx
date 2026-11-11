import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getProfile, getViewer, loadMyWorkspaces } from '@/modules/identity/queries';
import { listDisciplines } from '@/modules/skills/queries';
import { loadMyReferrals } from '@/modules/referrals/queries';
import { loadEmailPreference } from '@/modules/notifications/queries';
import { getTenant } from '@/modules/tenancy/queries';
import { referralAudience } from '@/modules/tenancy/presets';
import { ProfileView } from '@/components/tropical/profile-view';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const profile = await getProfile(username);
  if (!profile) return { title: 'Profile' };

  return {
    title: profile.name || profile.username || 'Profile',
    description: profile.bio ?? undefined,
  };
}

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;

  const viewer = await getViewer();
  if (!viewer) redirect(`/auth/sign-in?next=/profile/${username}`);

  // The profile and the vocabulary are independent — the skill picker needs
  // the full list whether or not the profile resolves.
  const [profile, disciplines] = await Promise.all([getProfile(username), listDisciplines()]);
  if (!profile) notFound();

  const isOwnProfile = profile.id === viewer.id;

  // Who gets the referral panel — the same audience the sign-up step uses.
  //
  // Two tests, and until 2026-08-27 only the second was applied here: whether
  // the tenant runs referrals at all (features.referrals, off for both live
  // white-labels), and then whether this viewer is a contractor, since someone
  // put on a client's roster is not growing a community and a code to share is
  // a mechanic from another product.
  //
  // The flag matters because codes are global: tropical_referrals has no tenant
  // column, so a code handed out on a client's site spends on TropicalTalent.
  const tenant = await getTenant();
  const audience = referralAudience(tenant);
  const showReferrals = viewer.isCreative ? audience.worker : audience.payer;

  // Only for your own profile. A visitor must not be handed someone else's
  // referral code to spend, and the RPC is scoped to auth.uid() anyway.
  // Own-profile-only reads, all three concurrent. Nothing here is fetched for
  // a visitor: a referral code is spendable, an email preference is a setting,
  // and the workspace list discloses where someone's profile appears — none of
  // which is anyone else's business.
  const [referrals, emailEnabled, workspaces] = isOwnProfile
    ? await Promise.all([
        showReferrals ? loadMyReferrals() : Promise.resolve(null),
        loadEmailPreference(viewer.id),
        loadMyWorkspaces(),
      ])
    : [null, null, null];

  return (
    <ProfileView
      data={profile}
      disciplines={disciplines}
      isOwnProfile={isOwnProfile}
      workspaces={workspaces}
      referrals={referrals}
      emailEnabled={emailEnabled}
    />
  );
}
