'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeftRight, Plus } from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { activateRoleAction } from '@/modules/identity/actions';
import { cuboraRolesFor, roleHome, type CuboraRole } from '@/modules/identity/roles';
import { cn, type ActionResult } from '@/lib/utils';

/**
 * Role switcher + role activation (Phase 1, new).
 *
 * Cubora roles are capabilities: an account holds `consumer`, `provider`,
 * or both. With both, this is a switch — two links to each side's home, the
 * current side highlighted. With one, it offers to activate the other role
 * (server action `activateRoleAction`, additive only). It sits in the app
 * shell, under the nav groups, so switching is one tap from anywhere.
 */
export function RoleSwitcher({ canBrand, isCreative }: { canBrand: boolean; isCreative: boolean }) {
  const tNav = useTranslations('nav');
  const tRoles = useTranslations('roles');
  const pathname = usePathname();
  const [state, formAction] = useActionState<ActionResult<{ role: CuboraRole }> | null, FormData>(
    async (_prev, form: FormData) => activateRoleAction(form),
    null,
  );

  const roles = cuboraRolesFor({ canBrand, isCreative });
  const missing: CuboraRole[] = (['consumer', 'provider'] as CuboraRole[]).filter(
    (r) => !roles.includes(r),
  );

  const isActive = (role: CuboraRole): boolean => {
    if (role === 'consumer') return pathname === '/projects' || pathname.startsWith('/projects/');
    return pathname.startsWith('/briefs') || pathname.startsWith('/jobs');
  };

  return (
    <div className='border-foreground/10 mt-4 border-t px-3 pt-3'>
      <p className='text-muted-foreground/70 px-3 pb-2 text-[10px] tracking-[0.18em] uppercase'>
        {tNav('yourRoles')}
      </p>

      {roles.length > 0 && (
        <div className='space-y-1'>
          {roles.map((role) => (
            <Link
              key={role}
              href={roleHome(role)}
              aria-current={isActive(role) ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                isActive(role)
                  ? 'bg-foreground/10 text-foreground'
                  : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
              )}
            >
              <span className='bg-foreground/5 grid h-7 w-7 shrink-0 place-items-center rounded-md'>
                <ArrowLeftRight size={14} aria-hidden='true' />
              </span>
              <span className='truncate font-medium'>
                {role === 'consumer' ? tNav('switchToConsumer') : tNav('switchToProvider')}
              </span>
            </Link>
          ))}
        </div>
      )}

      {missing.map((role) => (
        <form key={role} action={formAction}>
          <input type='hidden' name='role' value={role} />
          <button
            type='submit'
            className='text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition'
          >
            <span className='bg-foreground/5 grid h-7 w-7 shrink-0 place-items-center rounded-md'>
              <Plus size={14} aria-hidden='true' />
            </span>
            <span className='truncate font-medium'>
              {role === 'consumer' ? tNav('activateConsumer') : tNav('activateProvider')}
            </span>
          </button>
        </form>
      ))}

      {state && state.success !== true && (
        <p className='text-destructive px-3 pt-2 text-xs' role='alert'>
          {state.error}
        </p>
      )}

      {roles.length === 0 && (
        <p className='text-muted-foreground px-3 text-xs'>
          {tRoles('consumerDesc')} {tRoles('providerDesc')}
        </p>
      )}
    </div>
  );
}
