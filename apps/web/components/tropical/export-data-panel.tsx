'use client';

import { useTransition } from 'react';
import { Download } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { exportMyDataAction } from '@/modules/identity/actions';

/**
 * Download everything we hold about you.
 *
 * The file is built in memory and handed to the browser as a blob. Nothing is
 * written to storage: an export sitting in a bucket is a copy of someone's
 * whole account waiting for whoever finds the URL, and the one thing worse
 * than not honouring a portability request is honouring it into a public
 * bucket.
 *
 * The object URL is revoked immediately after the click. Chrome keeps a live
 * blob alive for the document's lifetime otherwise, which on a long-lived
 * single-page session means the export stays in memory long after the download
 * finished.
 */
export function ExportDataPanel({ username }: { username: string | null }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const download = () => {
    startTransition(async () => {
      const result = await exportMyDataAction();
      if (result.success !== true) {
        toast({ title: 'Could not export', description: result.error, variant: 'destructive' });
        return;
      }

      const blob = new Blob([result.data.json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cubora-data-${username || 'account'}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast({ title: 'Your data is downloading' });
    });
  };

  return (
    <section className='mt-7'>
      <h2 className='text-muted-foreground mb-2.5 text-[11px] tracking-[0.14em] uppercase'>
        Your data
      </h2>

      <div className='glass flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5'>
        <div className='flex min-w-0 items-center gap-3'>
          <span className='text-muted-foreground bg-foreground/5 grid h-9 w-9 shrink-0 place-items-center rounded-lg'>
            <Download size={15} />
          </span>
          <div className='min-w-0'>
            <div className='text-sm font-medium'>Download a copy</div>
            <p className='text-muted-foreground text-xs'>
              Your profile, projects, roles, messages, payments and preferences, as a JSON file.
            </p>
          </div>
        </div>

        <button
          type='button'
          onClick={download}
          disabled={pending}
          className='glass text-foreground hover:bg-foreground/5 shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-40'
        >
          {pending ? 'Preparing…' : 'Download'}
        </button>
      </div>
    </section>
  );
}
