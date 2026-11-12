import type { Metadata } from 'next';
import { loadAdminUsers } from '@/modules/admin/queries';
import { AdminCommsPanel } from '@/components/tropical/admin-comms-panel';

export const metadata: Metadata = { title: 'Admin - User comms' };

export default async function AdminCommsPage() {
  const users = await loadAdminUsers();

  return (
    <div className='space-y-6'>
      <header>
        <h1 className='text-2xl font-semibold tracking-tight'>User comms</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          Send one of four canned emails to a chosen set of accounts. Anyone with email
          notifications turned off is skipped automatically.
        </p>
      </header>

      <AdminCommsPanel users={users} />
    </div>
  );
}
