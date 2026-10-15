import { useContext, useEffect, useId, useState, type Ref } from 'react';
import { Input } from '@/components/ui/input';
import { navigate } from '@/lib/route';
import { NavigatedContext } from './RouteLink';

const MIN_QUERY = 2;

/** The sidebar search box. Enter searches every wiki; on a search route it shows that route's query. */
export function SearchBox({ q, inputRef }: { q: string | null; inputRef?: Ref<HTMLInputElement> }) {
  const [value, setValue] = useState(q ?? '');
  const [short, setShort] = useState(false);
  const onNavigated = useContext(NavigatedContext);
  const hintId = useId();
  useEffect(() => {
    if (q !== null) setValue(q);
  }, [q]);
  return (
    <div className="min-w-0 flex-1">
      <Input
        ref={inputRef}
        type="search"
        placeholder="Search all wikis…"
        aria-label="Search"
        aria-describedby={short ? hintId : undefined}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setShort(false);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          const trimmed = value.trim();
          if (trimmed.length < MIN_QUERY) {
            setShort(true);
            return;
          }
          navigate({ view: 'search', q: trimmed });
          onNavigated?.();
        }}
        className="h-8 bg-background"
      />
      {short && (
        <p id={hintId} className="mt-1 px-1 text-xs text-muted-foreground">
          Type at least {MIN_QUERY} characters
        </p>
      )}
    </div>
  );
}
