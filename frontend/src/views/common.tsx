import { useEffect } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

/** Sets the view's title (the document title and the phone top bar) once it is known. */
export function useViewTitle(title: string | null, onTitle: (t: string) => void) {
  useEffect(() => {
    if (title !== null) onTitle(title);
  }, [title, onTitle]);
}

/** A loading placeholder: a title bar plus `lines` text bars, with `label` for screen readers. */
export function LoadingState({ label, lines = 6 }: { label: string; lines?: number }) {
  return (
    <div aria-busy="true" className="space-y-3">
      <span className="sr-only" aria-live="polite">
        {label}
      </span>
      <Skeleton className="h-7 w-2/5" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={i % 3 === 2 ? 'h-4 w-3/5' : 'h-4 w-full'} />
      ))}
    </div>
  );
}

