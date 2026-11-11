'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Toasts.
 *
 * Replaces a 189-line reducer plus @radix-ui/react-toast with a context and a
 * list. The old implementation carried a global dispatch queue, a memory store
 * outside React, and a TOAST_REMOVE_DELAY of 1,000,000ms that meant dismissed
 * toasts were never garbage collected for the life of the tab.
 *
 * Same surface for callers: `const { toast } = useToast()`.
 */

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
  /** Milliseconds on screen. 0 keeps it until dismissed. */
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { ...options, id }]);

      const duration = options.duration ?? (options.variant === 'destructive' ? 7000 : 4000);
      if (duration > 0) {
        // Cleared implicitly when the component unmounts with the tab; the
        // timer holds only a number, not the toast itself.
        setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // aria-live so a screen reader announces the message without moving
        // focus away from whatever the user was doing.
        role='status'
        aria-live='polite'
        className='pointer-events-none fixed inset-x-0 bottom-0 z-100 flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:bottom-0 sm:items-end'
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'animate-in slide-in-from-bottom-4 fade-in-0 pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border p-4 shadow-lg backdrop-blur',
              t.variant === 'destructive'
                ? 'border-destructive/40 bg-destructive text-destructive-foreground'
                : 'bg-popover text-popover-foreground border-border',
            )}
          >
            <div className='min-w-0 flex-1'>
              <p className='text-sm font-medium'>{t.title}</p>
              {t.description && <p className='mt-1 text-xs opacity-80'>{t.description}</p>}
            </div>
            <button
              type='button'
              onClick={() => dismiss(t.id)}
              aria-label='Dismiss'
              className='shrink-0 opacity-60 transition-opacity hover:opacity-100'
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  // A no-op fallback rather than a throw: a toast failing to show should never
  // be the thing that white-screens a page.
  return context ?? { toast: () => {} };
}
