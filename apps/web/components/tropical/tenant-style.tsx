import { getTenant } from '@/modules/tenancy/queries';
import { themeCss } from '@/modules/tenancy/theme';

/**
 * The tenant's palette, as a server-rendered <style> block.
 *
 * Server component, so it can be dropped into any page or layout that should
 * carry tenant branding without that page needing to know how the palette is
 * resolved or validated.
 *
 * Rendered per-surface rather than once in the root layout on purpose: the
 * root layout also covers `/`, which is `force-static`, and reading the Host
 * header up there would make every route in the app dynamic — including the
 * marketing page whose whole point is being static.
 *
 * Emits nothing at all for the classic tenant, so TropicalTalent's own pages pay
 * nothing for this.
 */
export async function TenantStyle() {
  const tenant = await getTenant();
  const css = themeCss(tenant);

  if (!css) return null;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
