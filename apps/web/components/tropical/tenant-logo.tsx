import Image from 'next/image';

/**
 * The tenant's mark.
 *
 * Replaces seven hardcoded `<Image src='/tropicaltalent-logo.svg' alt='TropicalTalent'>` uses
 * across the shell, the landing page, the auth screens and not-found.
 *
 * A tenant that has not uploaded a logo falls back to TropicalTalent's own file, which
 * is right for the classic tenant and acceptable-but-visible for a
 * half-configured white-label: better a placeholder someone notices than a
 * broken image, and the tenant-creation console requires one anyway.
 *
 * `next/image` is pointed at Supabase Storage, which next.config.mjs already
 * allows (`**.supabase.co/storage/v1/object/public/**`) for avatars — tenant
 * logos land in the same place, so no config change was needed. A logo from
 * anywhere else would fail that allowlist, which is the desired answer: we
 * serve tenant assets, we do not hotlink whatever URL was pasted in.
 */
export function TenantLogo({
  logoUrl,
  name,
  size = 24,
  priority = false,
  className = 'h-6 w-6',
}: {
  logoUrl?: string | null;
  name: string;
  size?: number;
  priority?: boolean;
  className?: string;
}) {
  const src = usableLogo(logoUrl) ?? '/tropicaltalent-logo.svg';

  return (
    <Image
      src={src}
      alt={name}
      width={size}
      height={size}
      priority={priority}
      // object-contain, always. A tenant uploads whatever they have — a wide
      // wordmark, a photo, a 2048px JPEG — and the sizes here are square. Left
      // to default the browser stretches it to fit, which turns a customer's
      // logo into a distorted smear at exactly the moment they are judging
      // whether this looks like their product.
      className={`${className} object-contain`}
      // A tenant logo is one small file served from Storage; Next's optimiser
      // would add a round trip per variant for no saving on an SVG or a
      // already-sized PNG.
      unoptimized={src !== '/tropicaltalent-logo.svg'}
    />
  );
}

/**
 * Only absolute https URLs are used.
 *
 * The value comes from tenant jsonb, so it is whatever was written to the row.
 * A relative path would resolve against the tenant's own host and could point
 * at an app route; a `javascript:` or `data:` value has no business in a src.
 * Anything that is not plainly an https URL falls back to the default mark.
 */
function usableLogo(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('https://')) return null;
  try {
    new URL(trimmed);
    return trimmed;
  } catch {
    return null;
  }
}
