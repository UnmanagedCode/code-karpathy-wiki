import { createContext, useContext, type ComponentProps } from 'react';
import { isPlainClick, navigate, routeHref, type Route } from '@/lib/route';

/** Called after a link navigates in-app: the phone drawer closes on it. */
export const NavigatedContext = createContext<(() => void) | null>(null);

/** A link to an in-app route. A plain click navigates in place; a modified click opens the relative href natively. */
export function RouteLink({ to, onClick, ...props }: { to: Route } & Omit<ComponentProps<'a'>, 'href'>) {
  const onNavigated = useContext(NavigatedContext);
  return (
    <a
      {...props}
      href={routeHref(to)}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || !isPlainClick(e)) return;
        e.preventDefault();
        navigate(to);
        onNavigated?.();
      }}
    />
  );
}
