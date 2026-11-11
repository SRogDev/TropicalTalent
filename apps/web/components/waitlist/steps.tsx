'use client';

import { useRef, useState } from 'react';
import {
  Building2,
  Camera,
  Check,
  MapPin,
  Mic,
  Monitor,
  Music,
  Palette,
  Pen,
  PersonStanding,
  Plus,
  Radio,
  Share2,
  Video,
  X,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { SignUpRole } from './use-sign-up-form';

/**
 * The sign-up wizard's steps.
 *
 * Same layout and copy as the waitlist steps they replace. What changed:
 *
 *   * the email step also takes a password — real accounts need one
 *   * the location step is the plain-text field only. Google Places was
 *     already unreachable in practice (no NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is
 *     configured, so the component always fell through to manual entry), so
 *     dropping @react-google-maps/api and use-places-autocomplete removes two
 *     packages and changes nothing on screen.
 *   * the per-step framer-motion wrapper is a CSS animation on the dialog's
 *     step container instead of nine copies of the same <motion.div>.
 */

const stepClass = 'space-y-4 text-center';
const headingClass = 'text-foreground text-lg font-semibold md:text-xl';

export function NameStep({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className={stepClass}>
      <h2 className={headingClass}>What&apos;s your name?</h2>
      <div className='mx-auto max-w-sm space-y-1 text-left'>
        <Label htmlFor='signup-name'>Name</Label>
        <Input
          id='signup-name'
          autoFocus
          autoComplete='name'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder='Jordan Smith'
        />
      </div>
    </div>
  );
}

export function CredentialsStep({
  email,
  password,
  onEmailChange,
  onPasswordChange,
}: {
  email: string;
  password: string;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
}) {
  return (
    <div className={stepClass}>
      <h2 className={headingClass}>Set up your login</h2>
      <div className='mx-auto max-w-sm space-y-3 text-left'>
        <div className='space-y-1'>
          <Label htmlFor='signup-email'>Email</Label>
          <Input
            id='signup-email'
            type='email'
            autoFocus
            autoComplete='email'
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder='you@example.com'
          />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='signup-password'>Password</Label>
          <Input
            id='signup-password'
            type='password'
            autoComplete='new-password'
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            placeholder='At least 8 characters'
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The two sides of the marketplace, in the words of whichever site is asking.
 *
 * "Talent" and "Brand" are TropicalTalent's names for them. A contractor white-label
 * calls the same two things "Contractor" and "Company", and the labels are
 * already recorded per archetype in modules/tenancy/presets.ts — this reads
 * them rather than inventing a second copy. `workerLabel`/`payerLabel` default
 * to TropicalTalent's pair so the landing page, which is force-static and cannot know
 * the tenant, is unaffected.
 */
const ROLE_META: Record<
  SignUpRole,
  { describe: (workers: string) => string; icon: typeof Palette; fallbackLabel: string }
> = {
  creative: {
    describe: () => 'Share your work and get discovered',
    icon: Palette,
    fallbackLabel: 'Talent',
  },
  brand: {
    // The labels were made tenant-aware and these were left behind, so the card
    // read "I'm a Company / Discover and book verified talent" — the right
    // heading over the wrong industry's noun, on the one screen where someone
    // is deciding what kind of account to open.
    describe: (workers: string) => `Discover and book verified ${workers}`,
    icon: Building2,
    fallbackLabel: 'Brand',
  },
};

export function RoleStep({
  value,
  onChange,
  tenantName = 'TropicalTalent',
  workerLabel,
  payerLabel,
  workerPlural,
  allowPayer = true,
}: {
  value: SignUpRole | null;
  onChange: (r: SignUpRole) => void;
  tenantName?: string;
  workerLabel?: string;
  payerLabel?: string;
  /** Plural worker noun for the card copy, e.g. "contractors". */
  workerPlural?: string;
  /**
   * False when the tenant has `selfServeBrands` switched off.
   *
   * A contractor platform onboards its companies by hand and does not want
   * anyone who finds the sign-in link opening a hiring account. The card is
   * hidden rather than disabled — a control you cannot use is worse than one
   * that was never offered — and signUpAction refuses the role independently,
   * because hiding a card is not a boundary.
   */
  allowPayer?: boolean;
}) {
  const labels: Record<SignUpRole, string> = {
    creative: workerLabel || ROLE_META.creative.fallbackLabel,
    brand: payerLabel || ROLE_META.brand.fallbackLabel,
  };

  const roles: SignUpRole[] = allowPayer ? ['creative', 'brand'] : ['creative'];

  return (
    <div className={stepClass}>
      <h2 className={headingClass}>How will you use {tenantName}?</h2>
      <div
        className={cn(
          'mx-auto grid max-w-sm gap-3',
          roles.length > 1 ? 'sm:grid-cols-2' : 'sm:max-w-xs',
        )}
      >
        {roles.map((role) => {
          const { describe, icon: Icon } = ROLE_META[role];
          const description = describe(workerPlural || 'talent');
          const title = `I'm a ${labels[role]}`;
          return (
            <Card
              key={role}
              interactive
              role='button'
              aria-pressed={value === role}
              onClick={() => onChange(role)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onChange(role);
                }
              }}
              className={cn(
                'hover:border-primary/40 border transition-all duration-200',
                value === role && 'border-primary bg-primary/5 shadow-sm',
              )}
            >
              <CardContent className='flex flex-col items-center gap-2 text-center'>
                <Icon className='text-primary h-6 w-6' />
                <p className='text-foreground text-sm font-medium'>{title}</p>
                <p className='text-muted-foreground text-xs'>{description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export function BrandBlurbStep({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className='space-y-2 text-center'>
      <h2 className={headingClass}>Tell us about your company</h2>
      <p className='text-muted-foreground text-xs'>In 1-2 sentences</p>
      <div className='mx-auto max-w-sm space-y-1 pt-2 text-left'>
        <Label htmlFor='signup-blurb'>Company</Label>
        <Textarea
          id='signup-blurb'
          autoFocus
          rows={3}
          maxLength={280}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="We're a creative studio building..."
        />
      </div>
    </div>
  );
}

export function PhotoStep({
  preview,
  onChange,
}: {
  preview: string;
  onChange: (file: File | null, preview: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className='flex flex-col items-center gap-3 text-center'>
      <h2 className={headingClass}>Add a profile photo</h2>
      <button
        type='button'
        onClick={() => inputRef.current?.click()}
        className='rounded-full transition hover:opacity-80'
        aria-label='Upload profile photo'
      >
        <Avatar className='border-border size-24 border border-dashed'>
          <AvatarImage src={preview} alt='Profile preview' />
          <AvatarFallback>
            <Camera className='text-muted-foreground h-6 w-6' />
          </AvatarFallback>
        </Avatar>
      </button>
      <input
        ref={inputRef}
        type='file'
        accept='image/jpeg,image/png,image/webp,image/heic,image/heif'
        className='hidden'
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          if (file) onChange(file, URL.createObjectURL(file));
        }}
      />
      <Button type='button' variant='ghost' size='sm' onClick={() => inputRef.current?.click()}>
        {preview ? 'Change photo' : 'Upload photo'}
      </Button>
      {!preview && (
        <p className='text-muted-foreground text-xs'>
          Optional - you can skip this and add one later.
        </p>
      )}
    </div>
  );
}

const PASSION_SUGGESTIONS = [
  { label: 'Musician', icon: Music },
  { label: 'Singer', icon: Mic },
  { label: 'Producer', icon: Radio },
  { label: 'Visual Artist', icon: Palette },
  { label: 'Photographer', icon: Camera },
  { label: 'Filmmaker', icon: Video },
  { label: 'Dancer', icon: PersonStanding },
  { label: 'Songwriter', icon: Pen },
  { label: 'Designer', icon: Monitor },
];

export function PassionStep({
  value,
  onChange,
}: {
  value: string[];
  onChange: (passions: string[]) => void;
}) {
  const [customInput, setCustomInput] = useState('');

  const addCustom = () => {
    const trimmed = customInput.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setCustomInput('');
  };

  const customTags = value.filter((v) => !PASSION_SUGGESTIONS.some((s) => s.label === v));

  return (
    <div className='space-y-3 text-center'>
      <h2 className={headingClass}>What kind of talent are you?</h2>
      {/* These become the talent's disciplines, which is what briefs match
          against — so the copy says so rather than reading as a vanity tag. */}
      <p className='text-muted-foreground text-xs'>
        Select all that apply - these are the skills brands match you on
      </p>

      <div className='mx-auto max-w-sm space-y-3'>
        <div className='flex flex-wrap justify-center gap-2'>
          {PASSION_SUGGESTIONS.map(({ label, icon: Icon }) => {
            const isSelected = value.includes(label);
            return (
              <button
                key={label}
                type='button'
                aria-pressed={isSelected}
                onClick={() =>
                  onChange(isSelected ? value.filter((v) => v !== label) : [...value, label])
                }
                className={cn(
                  'hover:border-primary/40 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-normal transition-all duration-200',
                  isSelected
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground',
                )}
              >
                <Icon className='h-3.5 w-3.5 shrink-0' />
                <span className='break-words'>{label}</span>
              </button>
            );
          })}
        </div>

        <div className='space-y-1 text-left'>
          <Label htmlFor='signup-passion-custom'>Don&apos;t see yours? Add your own</Label>
          <div className='flex gap-2'>
            <Input
              id='signup-passion-custom'
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustom();
                }
              }}
              placeholder='e.g., Sound Engineer'
            />
            <button
              type='button'
              onClick={addCustom}
              aria-label='Add'
              className='border-border hover:border-primary/40 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors'
            >
              <Plus className='h-4 w-4' />
            </button>
          </div>
        </div>

        {customTags.length > 0 && (
          <div className='flex flex-wrap justify-center gap-2'>
            {customTags.map((tag) => (
              <span
                key={tag}
                className='bg-primary/10 text-foreground flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium'
              >
                {tag}
                <button
                  type='button'
                  onClick={() => onChange(value.filter((v) => v !== tag))}
                  aria-label={`Remove ${tag}`}
                  className='hover:opacity-70'
                >
                  <X className='h-3 w-3' />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function BioStep({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className='space-y-2 text-center'>
      <h2 className={headingClass}>Tell us a little about your style or what you do</h2>
      <p className='text-muted-foreground text-xs'>In 1-2 sentences</p>
      <div className='mx-auto max-w-sm space-y-1 pt-2 text-left'>
        <Label htmlFor='signup-bio'>Bio</Label>
        <Textarea
          id='signup-bio'
          autoFocus
          rows={3}
          maxLength={280}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder='I make cinematic short films for indie brands...'
        />
      </div>
    </div>
  );
}

export function LocationStep({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className={stepClass}>
      <h2 className={headingClass}>Where are you based?</h2>
      <div className='mx-auto max-w-sm space-y-1 text-left'>
        <Label htmlFor='signup-location'>Location</Label>
        <div className='flex items-center gap-2'>
          <MapPin className='text-muted-foreground h-4 w-4 shrink-0' />
          <Input
            id='signup-location'
            autoFocus
            autoComplete='address-level2'
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder='City, Country'
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The origin to share.
 *
 * Read from the browser rather than a constant: this used to be a hardcoded
 * 'https://tropicaltalent.dev/', which was already wrong on any preview
 * deployment and would be wrong on every white-label host — a visitor who
 * signed up on a branded domain would be handed a link to a site they have
 * never seen. Only ever called from a click handler, so `window` exists.
 */
function shareUrl(): string {
  return `${window.location.origin}/`;
}

export function SuccessStep({
  needsConfirmation,
  tenantName = 'TropicalTalent',
}: {
  needsConfirmation: boolean;
  tenantName?: string;
}) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: tenantName,
          text: `Join me on ${tenantName}`,
          url: shareUrl(),
        });
        return;
      } catch {
        return;
      }
    }
    await navigator.clipboard.writeText(shareUrl());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className='flex flex-col items-center gap-4 py-4 text-center'>
      <div className='gradient-app flex h-14 w-14 items-center justify-center rounded-full'>
        <Check className='text-on-brand h-7 w-7' />
      </div>
      <div className='space-y-1'>
        <h2 className='text-foreground text-xl font-semibold'>
          {needsConfirmation ? 'Check your inbox' : "You're in"}
        </h2>
        <p className='text-muted-foreground text-sm'>
          {needsConfirmation
            ? 'Confirm your email address and your account is ready.'
            : `Taking you to ${tenantName}…`}
        </p>
      </div>
      <Button type='button' onClick={share} variant='outline' className='gap-2'>
        {copied ? <Check className='h-4 w-4' /> : <Share2 className='h-4 w-4' />}
        {copied ? 'Link copied' : 'Share with a friend'}
      </Button>
    </div>
  );
}
