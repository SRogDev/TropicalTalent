'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import {
  BadgeCheck,
  Briefcase,
  Camera,
  Check,
  Edit3,
  ExternalLink,
  MapPin,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { ShowreelPlayer } from './showreel-player';
import { DisciplineSearch } from './discipline-search';
import { ReferralPanel } from './referral-panel';
import { EmailPreferencesPanel } from './email-preferences-panel';
import { RaiseComplaintPanel } from './raise-complaint-panel';
import { WorkspacesPanel } from './workspaces-panel';
import { ExportDataPanel } from './export-data-panel';
import { DeleteAccountPanel } from './delete-account-panel';
import { useToast } from '@/components/ui/toast';
import {
  updateAvatarAction,
  updateProfileAction,
  type ProfileUpdateInput,
} from '@/modules/identity/actions';
import { addSkillAction, removeSkillAction, setPrimarySkillAction } from '@/modules/skills/actions';
import { avatarUrl, cn } from '@/lib/utils';
import { TERMS_URL } from '@/lib/urls';
import type { EmailPreferences } from '@/modules/notifications/queries';
import type { MyWorkspace } from '@/modules/identity/queries';
import { formatPence } from '@/lib/money';
import type { CreativeProfile } from '@/modules/identity/types';
import type { Discipline } from '@/modules/skills/types';
import { useTenantName } from './tenant-context';

/**
 * The profile, inline-editable.
 *
 * ---------------------------------------------------------------------------
 * The stale-state / re-render-loop fix
 * ---------------------------------------------------------------------------
 * The previous version held a `draft` copy of every field, initialised from
 * props, and rendered the SKILLS list from that draft rather than from the
 * server data. Two consequences:
 *
 *   * `router.refresh()` after a save re-rendered with new props, but `draft`
 *     was seeded in useState and never re-seeded, so the page showed the old
 *     values until a hard reload. That is the stale state.
 *   * The skills list rendered from `draft.tags` even when not editing, so a
 *     save that changed tags updated one copy and not the other, and each
 *     reconciliation pass fought the last.
 *
 * What this does instead:
 *
 *   * Read state is ALWAYS `data` (the server's). The draft exists only while
 *     `editing` is true, is seeded when editing opens, and is discarded on
 *     close — it can never be the stale one, because it does not outlive the
 *     interaction.
 *   * Skills are their own concern with their own server actions. They commit
 *     immediately rather than riding along with the text fields, so adding a
 *     skill does not need the whole form to be in edit mode — and adding one
 *     is what releases held applications, which should not wait on a Save
 *     button.
 *   * Saves reconcile against what the action returned, then refresh.
 */

export function ProfileView({
  data,
  disciplines,
  isOwnProfile,
  referrals,
  emailEnabled,
  workspaces,
  offerCount,
}: {
  data: CreativeProfile;
  disciplines: Discipline[];
  isOwnProfile: boolean;
  /** Null on someone else's profile. */
  referrals: { code: string | null; confirmed: number; tier: number } | null;
  /** Null on someone else's profile. */
  emailEnabled: EmailPreferences | null;
  /** Null on someone else's profile. */
  workspaces?: MyWorkspace[] | null;
  /** Own offers in the unified catalog (Phase 2). Null on someone else's profile. */
  offerCount?: number | null;
}) {
  const tenantName = useTenantName();
  const router = useRouter();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [saving, startSaving] = useTransition();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProfileUpdateInput | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [addingSkill, setAddingSkill] = useState(false);

  const isCreative = data.role === 'creative' || data.role === 'admin';

  const openEditor = () => {
    setDraft({
      name: data.name ?? '',
      bio: data.bio ?? '',
      passion: data.passion ?? '',
      showreelUrl: data.showreelUrl ?? '',
      tags: data.tags,
    });
    setEditing(true);
  };

  const closeEditor = () => {
    setDraft(null);
    setAvatarPreview(null);
    setEditing(false);
  };

  const save = useCallback(() => {
    if (!draft) return;
    startSaving(async () => {
      const result = await updateProfileAction(draft);
      if (result.success !== true) {
        toast({ title: 'Could not save', description: result.error, variant: 'destructive' });
        return;
      }
      closeEditor();
      toast({ title: 'Profile updated' });
      // The server is the source of truth from here; the draft is gone.
      router.refresh();
    });
  }, [draft, toast, router]);

  const pickAvatar = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Preview immediately, upload in the background — the avatar is the one
    // field where waiting for a round trip before showing anything is felt.
    setAvatarPreview(URL.createObjectURL(file));

    const form = new FormData();
    form.set('avatar', file);

    startSaving(async () => {
      const result = await updateAvatarAction(form);
      if (result.success !== true) {
        setAvatarPreview(null);
        toast({ title: 'Could not upload', description: result.error, variant: 'destructive' });
        return;
      }
      setAvatarPreview(null);
      router.refresh();
    });
  };

  const addSkill = (label: string) => {
    startSaving(async () => {
      const result = await addSkillAction(label);
      if (result.success !== true) {
        toast({ title: 'Could not add skill', description: result.error, variant: 'destructive' });
        return;
      }
      setAddingSkill(false);
      toast({
        title: `${result.data.label} added`,
        description: 'Any applications waiting on this skill have been sent.',
      });
      router.refresh();
    });
  };

  const removeSkill = (slug: string) => {
    startSaving(async () => {
      const result = await removeSkillAction(slug);
      if (result.success !== true) {
        toast({ title: 'Could not remove', description: result.error, variant: 'destructive' });
        return;
      }
      router.refresh();
    });
  };

  const makePrimary = (slug: string) => {
    startSaving(async () => {
      const result = await setPrimarySkillAction(slug);
      if (result.success !== true) {
        toast({ title: 'Could not update', description: result.error, variant: 'destructive' });
        return;
      }
      router.refresh();
    });
  };

  const displayAvatar = avatarPreview ?? avatarUrl(data.avatar);

  return (
    <div className='mx-auto max-w-3xl px-4 py-8 sm:px-6'>
      {/* ---- header ---- */}
      <div className='bg-gradient-brand h-28 rounded-2xl opacity-80' />

      <div className='-mt-12 px-1'>
        <div className='flex items-start justify-between gap-4'>
          <div className='relative shrink-0'>
            <span className='ring-background block h-24 w-24 overflow-hidden rounded-2xl ring-4'>
              {displayAvatar ? (
                <Image
                  src={displayAvatar}
                  alt={data.name ?? ''}
                  width={96}
                  height={96}
                  className='h-full w-full object-cover'
                  unoptimized={displayAvatar.startsWith('blob:') || displayAvatar.includes('?t=')}
                />
              ) : (
                <span className='bg-gradient-brand text-on-brand grid h-full w-full place-items-center text-2xl font-bold'>
                  {(data.name || data.username || '?').slice(0, 2).toUpperCase()}
                </span>
              )}
            </span>

            {isOwnProfile && (
              <button
                type='button'
                onClick={() => fileInput.current?.click()}
                className='bg-gradient-brand text-on-brand absolute -right-1 -bottom-1 grid h-9 w-9 place-items-center rounded-full shadow-lg'
                aria-label='Change photo'
              >
                <Camera size={14} />
              </button>
            )}
            <input
              ref={fileInput}
              type='file'
              accept='image/jpeg,image/png,image/webp,image/heic,image/heif'
              onChange={pickAvatar}
              className='hidden'
            />
          </div>

          {isOwnProfile && !editing && (
            <button
              type='button'
              onClick={openEditor}
              className='text-muted-foreground border-foreground/10 hover:text-foreground mt-14 flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs'
            >
              <Edit3 size={13} /> Edit
            </button>
          )}
        </div>

        <div className='mt-3 min-w-0'>
          {editing && draft ? (
            <input
              value={draft.name ?? ''}
              onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
              placeholder='Your name'
              className='placeholder:text-muted-foreground/50 border-foreground/20 focus:border-foreground/50 w-full border-b bg-transparent pb-1 text-2xl font-semibold tracking-tight focus:outline-none'
              aria-label='Display name'
            />
          ) : (
            <h1 className='flex items-center gap-2 text-2xl font-semibold tracking-tight'>
              {/* break-words on the text node, not the flex parent, so a single
                  long word wraps instead of widening the row. */}
              <span className='min-w-0 break-words'>{data.name || data.username || 'Unnamed'}</span>
              {/* 'approved', not 'verified'. creative_data.verification carries
               * CHECK (verification IN ('pending','approved','rejected')), so
               * the old comparison was against a value the constraint forbids
               * and this badge could never render for anyone. Sign-up writes
               * 'approved' (identity/actions.ts:779). */}
              {data.verification === 'approved' && (
                <BadgeCheck size={17} className='text-accent shrink-0' />
              )}
            </h1>
          )}
          {/* Brands frequently have no username; a bare "@" reads as broken. */}
          {data.username && (
            <p className='text-muted-foreground truncate text-sm'>@{data.username}</p>
          )}
        </div>
      </div>

      {/* ---- stats ---- */}
      {/* Earned is the owner's figure alone.
       *
       * It was rendered on every profile, but user_stats had RLS on with no
       * policy (fixed in migration 048), so it read £0 for everyone and the
       * disclosure went unnoticed. Adding the read policy would have turned
       * that into every talent's lifetime earnings on a public page. */}
      <div className={`mt-6 grid gap-2.5 ${isOwnProfile ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <Stat icon={<Briefcase size={12} />} label='Projects' value={String(data.stats.jobsDone)} />
        <Stat
          icon={<Sparkles size={12} />}
          label='Skills'
          value={String(data.disciplines.length)}
        />
        {isOwnProfile && (
          <Stat
            icon={<Check size={12} />}
            label='Earned'
            value={formatPence(data.stats.totalRevenue)}
          />
        )}
      </div>

      {data.locationDisplay && (
        <p className='text-muted-foreground mt-5 flex items-center gap-1.5 text-sm'>
          <MapPin size={13} /> {data.locationDisplay}
        </p>
      )}

      {/* ---- My offers (Phase 2) ---- */}
      {/* Own profile only: the count and the link go to /offers, where the
          provider profile and the offers live. A visitor sees the talent
          profile, not the offer management surface. */}
      {isOwnProfile && offerCount !== null && offerCount !== undefined && (
        <div className='mt-5 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm'>
          <span>
            <span className='font-medium'>My offers</span>
            <span className='text-muted-foreground'>
              {' '}
              · {offerCount} {offerCount === 1 ? 'offer' : 'offers'} in the catalog
            </span>
          </span>
          <Link href='/offers' className='text-primary shrink-0 font-medium hover:underline'>
            Manage offers →
          </Link>
        </div>
      )}

      {/* ---- bio ---- */}
      <Section title='About'>
        {editing && draft ? (
          <textarea
            value={draft.bio ?? ''}
            onChange={(e) => setDraft((d) => (d ? { ...d, bio: e.target.value } : d))}
            rows={3}
            placeholder='A line or two about you'
            className='placeholder:text-muted-foreground/50 border-foreground/10 bg-sunken focus:border-foreground/30 w-full resize-none rounded-xl border px-4 py-3 text-sm focus:outline-none'
          />
        ) : data.bio ? (
          <p className='text-sm leading-relaxed'>{data.bio}</p>
        ) : (
          <Empty own={isOwnProfile} what='a short bio' />
        )}
      </Section>

      {/* ---- passion ---- */}
      {isCreative && (
        <Section title='What drives you'>
          {editing && draft ? (
            <textarea
              value={draft.passion ?? ''}
              onChange={(e) => setDraft((d) => (d ? { ...d, passion: e.target.value } : d))}
              rows={3}
              placeholder='The work you want more of'
              className='placeholder:text-muted-foreground/50 border-foreground/10 bg-sunken focus:border-foreground/30 w-full resize-none rounded-xl border px-4 py-3 text-sm focus:outline-none'
            />
          ) : data.passion ? (
            <p className='text-sm leading-relaxed'>{data.passion}</p>
          ) : (
            <Empty own={isOwnProfile} what='what drives you' />
          )}
        </Section>
      )}

      {/* ---- skills / disciplines ----
          Their own concern, committing immediately. Not part of the text-field
          draft, and readable straight from `data`. */}
      {isCreative && (
        <Section title='Skills'>
          <div className='flex flex-wrap gap-1.5'>
            {data.disciplines.map((discipline) => (
              <span
                key={discipline.slug}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs',
                  discipline.is_primary
                    ? 'bg-gradient-brand text-on-brand'
                    : 'border-foreground/10 bg-foreground/5 border',
                )}
              >
                {discipline.label}
                {isOwnProfile && (
                  <>
                    {!discipline.is_primary && (
                      <button
                        type='button'
                        onClick={() => makePrimary(discipline.slug)}
                        disabled={saving}
                        title='Make this your primary skill'
                        aria-label={`Make ${discipline.label} your primary skill`}
                        className='text-muted-foreground hover:text-foreground disabled:opacity-40'
                      >
                        <Star size={10} />
                      </button>
                    )}
                    <button
                      type='button'
                      onClick={() => removeSkill(discipline.slug)}
                      disabled={saving}
                      aria-label={`Remove ${discipline.label}`}
                      className='opacity-70 hover:opacity-100 disabled:opacity-40'
                    >
                      <X size={11} />
                    </button>
                  </>
                )}
              </span>
            ))}

            {isOwnProfile && !addingSkill && (
              <button
                type='button'
                onClick={() => setAddingSkill(true)}
                className='text-muted-foreground border-foreground/20 hover:text-foreground flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-xs'
              >
                <Sparkles size={11} /> Add a skill
              </button>
            )}

            {data.disciplines.length === 0 && !addingSkill && (
              <Empty own={isOwnProfile} what='your skills' />
            )}
          </div>

          {addingSkill && (
            <div className='border-foreground/15 mt-3 rounded-xl border border-dashed p-3'>
              <DisciplineSearch
                disciplines={disciplines}
                selected={data.disciplines.map((d) => d.slug)}
                maxResults={20}
                allowCreate
                placeholder='Search skills, or type a new one…'
                onCancel={() => setAddingSkill(false)}
                onSelect={({ label }) => addSkill(label)}
              />
              <p className='text-muted-foreground mt-2 text-[11px]'>
                A skill that is not on the list yet is added to {tenantName}, so brands can find you
                by it.
              </p>
            </div>
          )}
        </Section>
      )}

      {/* ---- showreel ---- */}
      {isCreative && (
        <Section title='Showreel'>
          {editing && draft ? (
            <>
              <input
                value={draft.showreelUrl ?? ''}
                onChange={(e) => setDraft((d) => (d ? { ...d, showreelUrl: e.target.value } : d))}
                placeholder='YouTube, Vimeo or a direct video link'
                className='placeholder:text-muted-foreground/50 border-foreground/10 bg-sunken focus:border-foreground/30 w-full rounded-xl border px-4 py-3 text-sm focus:outline-none'
              />
              {draft.showreelUrl && (
                <div className='mt-3'>
                  <ShowreelPlayer url={draft.showreelUrl} />
                </div>
              )}
            </>
          ) : data.showreelUrl ? (
            <ShowreelPlayer url={data.showreelUrl} />
          ) : (
            <Empty own={isOwnProfile} what='a showreel' />
          )}
        </Section>
      )}

      {/* ---- free-text tags ---- */}
      {isCreative && editing && draft && (
        <Section title='Other tags'>
          <TagEditor
            tags={draft.tags ?? []}
            onChange={(tags) => setDraft((d) => (d ? { ...d, tags } : d))}
          />
        </Section>
      )}

      {/* ---- referrals ----
          Own profile only, and not while editing — the panel is a set of
          actions, not a field, and mixing the two invites a stray save. */}
      {isOwnProfile && referrals && !editing && (
        <ReferralPanel
          code={referrals.code}
          confirmed={referrals.confirmed}
          tier={referrals.tier}
          audience={data.role === 'brand' ? 'brand' : 'creative'}
        />
      )}

      {/* ---- email preferences ---- same reasoning as referrals above. */}
      {isOwnProfile && emailEnabled !== null && !editing && (
        <EmailPreferencesPanel initial={emailEnabled} />
      )}

      {/* ---- workspaces ----
          Where this profile appears, what each workspace's admins can see, and
          the way out of one. Above the email switches because it answers a
          bigger question than they do: who is looking. */}
      {isOwnProfile && workspaces && !editing && <WorkspacesPanel workspaces={workspaces} />}

      {/* ---- report a problem ----
          Every profile, own or not. On someone else's it opens pre-filled as a
          report about them, which is the case people actually arrive with. Not
          while editing, for the same reason as the panels above. */}
      {!editing && (
        <RaiseComplaintPanel
          subjectUsername={isOwnProfile ? undefined : (data.username ?? undefined)}
          subjectName={isOwnProfile ? undefined : data.name}
        />
      )}

      {/* ---- data export ----
          Next to deletion, because portability and erasure are the two things
          people come to this part of the page to do, and finding one without
          the other is what makes the other feel like the only option. */}
      {isOwnProfile && !editing && <ExportDataPanel username={data.username} />}

      {/* ---- delete account ----
          Own profile only. "On every user's profile page" has to mean the page
          each user manages themselves — a delete control on someone else's
          profile would be a button to delete THEM. Last on the page, below the
          reporting panel, because it is the most destructive thing here. */}
      {isOwnProfile && !editing && <DeleteAccountPanel />}

      {/* ---- terms of use ----
          Unconditional, unlike the two panels above: the terms bind everyone
          who reads this page, not just its owner, so this renders on every
          profile and during editing too. That also makes it the one thing here
          that is always present, which is why it carries the top rule rather
          than relying on a panel above it to provide one. */}
      <p className='border-foreground/10 text-muted-foreground mt-8 border-t pt-5 text-center text-xs'>
        <a
          href={TERMS_URL}
          target='_blank'
          rel='noopener noreferrer'
          className='hover:text-foreground inline-flex items-center gap-1.5 underline decoration-current/30 underline-offset-4 transition'
        >
          Terms of Use
          <ExternalLink size={11} aria-hidden='true' />
          <span className='sr-only'>(opens in a new tab)</span>
        </a>
      </p>

      {/* ---- save bar ---- */}
      {editing && (
        <div className='sticky bottom-4 mt-8 flex justify-end gap-2'>
          <button
            type='button'
            onClick={closeEditor}
            disabled={saving}
            className='glass text-muted-foreground hover:text-foreground rounded-lg px-4 py-2.5 text-sm disabled:opacity-40'
          >
            Cancel
          </button>
          <button
            type='button'
            onClick={save}
            disabled={saving}
            className='bg-gradient-brand glow text-on-brand rounded-lg px-5 py-2.5 text-sm font-medium disabled:opacity-40'
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  );
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [value, setValue] = useState('');

  const add = () => {
    const tag = value.trim();
    if (!tag || tags.includes(tag)) return;
    onChange([...tags, tag]);
    setValue('');
  };

  return (
    <div className='flex flex-wrap gap-1.5'>
      {tags.map((tag) => (
        <span
          key={tag}
          className='border-foreground/10 bg-foreground/5 flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs'
        >
          {tag}
          <button
            type='button'
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            className='text-muted-foreground hover:text-foreground'
            aria-label={`Remove ${tag}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}

      <span className='border-foreground/20 flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1'>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder='Add'
          className='placeholder:text-muted-foreground/50 w-16 bg-transparent text-xs focus:outline-none'
          aria-label='Add a tag'
        />
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className='mt-7'>
      <h2 className='text-muted-foreground mb-2.5 text-[11px] tracking-[0.14em] uppercase'>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className='border-foreground/10 bg-sunken rounded-xl border px-3.5 py-2.5'>
      <div className='text-muted-foreground flex items-center gap-1 text-[10px] tracking-widest uppercase'>
        {icon}
        {label}
      </div>
      <div className='mt-0.5 text-base font-semibold tabular-nums'>{value}</div>
    </div>
  );
}

function Empty({ own, what }: { own: boolean; what: string }) {
  return (
    <p className='text-muted-foreground/70 text-sm'>{own ? `Add ${what}.` : `No ${what} yet.`}</p>
  );
}
