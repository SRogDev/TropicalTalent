'use client';

import { useMemo, useState, useTransition } from 'react';
import { Mail, Search } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { sendAdminBroadcastAction } from '@/modules/admin/actions';
import { BROADCAST_TEMPLATES, type BroadcastTemplateId } from '@/modules/admin/broadcast-templates';
import type { AdminUserRow } from '@/modules/admin/types';
import { cn } from '@/lib/utils';

/**
 * Template picker + recipient picker + send, in one screen.
 *
 * Two of the four templates are written for one audience only (the talent
 * portfolio audit, the brand profile audit) — picking one of those filters
 * the recipient list down to that role so a brand can never end up selected
 * for the talent-only copy or vice versa. The other two are open to anyone.
 *
 * Selection is never automatic. Filtering to a role narrows who is
 * SELECTABLE, but nobody is pre-checked — sending to hundreds of real inboxes
 * should always be a deliberate click, not a default.
 */
export function AdminCommsPanel({ users }: { users: AdminUserRow[] }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [templateId, setTemplateId] = useState<BroadcastTemplateId | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<{
    sent: number;
    skippedOptedOut: number;
    skippedNoEmail: number;
    failed: number;
  } | null>(null);

  const template = BROADCAST_TEMPLATES.find((t) => t.id === templateId) ?? null;

  const eligible = useMemo(() => {
    return users.filter((u) => {
      if (template && template.audience !== 'all' && u.role !== template.audience) return false;
      if (!search.trim()) return true;
      const term = search.trim().toLowerCase();
      return (
        (u.name ?? '').toLowerCase().includes(term) ||
        (u.username ?? '').toLowerCase().includes(term) ||
        (u.email ?? '').toLowerCase().includes(term)
      );
    });
  }, [users, template, search]);

  const chooseTemplate = (id: BroadcastTemplateId) => {
    setTemplateId(id);
    setResult(null);
    // Selection may no longer be valid for the new audience — clear it
    // rather than silently sending the wrong copy to someone left checked.
    setSelected(new Set());
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    const visibleIds = eligible.map((u) => u.id);
    const allSelected = visibleIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const send = () => {
    if (!template || selected.size === 0) return;
    const confirmed = window.confirm(
      `Send "${template.label}" to ${selected.size} recipient${selected.size === 1 ? '' : 's'}? This cannot be undone.`,
    );
    if (!confirmed) return;

    startTransition(async () => {
      const res = await sendAdminBroadcastAction({
        templateId: template.id,
        userIds: [...selected],
      });
      if (res.success !== true) {
        toast({ title: 'Could not send', description: res.error, variant: 'destructive' });
        return;
      }
      setResult(res.data);
      setSelected(new Set());
      toast({ title: `Sent to ${res.data.sent} recipient${res.data.sent === 1 ? '' : 's'}` });
    });
  };

  return (
    <div className='space-y-6'>
      <section>
        <h2 className='text-muted-foreground mb-2.5 text-[11px] tracking-[0.14em] uppercase'>
          1. Choose an email
        </h2>
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          {BROADCAST_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type='button'
              onClick={() => chooseTemplate(t.id)}
              className={cn(
                'glass rounded-xl p-4 text-left transition',
                templateId === t.id ? 'border-foreground/40' : 'hover:border-foreground/20',
              )}
            >
              <div className='flex items-center justify-between gap-2'>
                <span className='text-sm font-medium'>{t.label}</span>
                {t.audience !== 'all' && (
                  <span className='text-muted-foreground border-foreground/10 shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase'>
                    {t.audience}s only
                  </span>
                )}
              </div>
              <p className='text-muted-foreground mt-1 text-xs'>{t.subject}</p>
              <p className='text-muted-foreground/80 mt-2 text-xs leading-relaxed'>{t.body}</p>
            </button>
          ))}
        </div>
      </section>

      {template && (
        <section>
          <h2 className='text-muted-foreground mb-2.5 text-[11px] tracking-[0.14em] uppercase'>
            2. Choose recipients
          </h2>

          <div className='bg-sunken mb-3 flex items-center gap-2 rounded-lg px-3 py-2'>
            <Search size={14} className='text-muted-foreground shrink-0' />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Search by name, username or email…'
              className='placeholder:text-muted-foreground/60 min-w-0 flex-1 bg-transparent text-sm focus:outline-none'
            />
          </div>

          <div className='glass overflow-x-auto rounded-2xl'>
            <table className='w-full text-left text-sm'>
              <thead>
                <tr className='text-muted-foreground border-foreground/10 border-b text-[11px] tracking-widest uppercase'>
                  <th className='px-4 py-3 font-medium'>
                    <input
                      type='checkbox'
                      checked={eligible.length > 0 && eligible.every((u) => selected.has(u.id))}
                      onChange={toggleAllVisible}
                      aria-label='Select all visible'
                    />
                  </th>
                  <th className='px-4 py-3 font-medium'>Name</th>
                  <th className='px-4 py-3 font-medium'>Email</th>
                  <th className='px-4 py-3 font-medium'>Role</th>
                  <th className='px-4 py-3 font-medium'>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {eligible.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => toggle(u.id)}
                    className='border-foreground/5 hover:bg-foreground/5 cursor-pointer border-b last:border-0'
                  >
                    <td className='px-4 py-3'>
                      <input
                        type='checkbox'
                        checked={selected.has(u.id)}
                        onChange={() => toggle(u.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select ${u.name ?? u.username ?? u.id}`}
                      />
                    </td>
                    <td className='px-4 py-3'>
                      <div className='font-medium'>{u.name ?? u.username ?? 'Unnamed'}</div>
                      {u.username && (
                        <div className='text-muted-foreground text-[11px]'>@{u.username}</div>
                      )}
                    </td>
                    <td className='text-muted-foreground px-4 py-3'>{u.email ?? '-'}</td>
                    <td className='px-4 py-3 text-xs capitalize'>{u.role}</td>
                    <td className='text-muted-foreground px-4 py-3'>
                      {u.lastSignInAt
                        ? new Date(u.lastSignInAt).toLocaleDateString('en-GB')
                        : 'Never'}
                    </td>
                  </tr>
                ))}
                {eligible.length === 0 && (
                  <tr>
                    <td colSpan={5} className='text-muted-foreground px-4 py-6 text-center text-sm'>
                      No matching accounts.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className='mt-4 flex items-center gap-3'>
            <button
              type='button'
              onClick={send}
              disabled={pending || selected.size === 0}
              className='bg-gradient-brand text-on-brand flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium disabled:opacity-40'
            >
              <Mail size={14} />
              {pending
                ? 'Sending…'
                : `Send to ${selected.size} recipient${selected.size === 1 ? '' : 's'}`}
            </button>

            {result && (
              <p className='text-muted-foreground text-xs'>
                Sent {result.sent}
                {result.skippedOptedOut > 0 && `, ${result.skippedOptedOut} opted out`}
                {result.skippedNoEmail > 0 && `, ${result.skippedNoEmail} had no email on file`}
                {result.failed > 0 && `, ${result.failed} failed`}.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
