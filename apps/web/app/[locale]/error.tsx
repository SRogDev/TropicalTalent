'use client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className='flex min-h-dvh flex-col items-center justify-center px-6 text-center'>
      <h1 className='text-2xl font-bold tracking-tight'>Something went wrong</h1>
      <p className='text-muted-foreground mt-2 max-w-sm text-sm'>
        That is on us. Try again, and if it keeps happening let the Cubora team know.
      </p>
      <button
        type='button'
        onClick={reset}
        className='gradient-app text-on-brand mt-6 rounded-lg px-5 py-2.5 text-sm font-medium hover:opacity-90'
      >
        Try again
      </button>
    </main>
  );
}
