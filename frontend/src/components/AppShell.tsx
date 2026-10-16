import type { ReactNode, RefObject } from 'react';
import { MenuIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { NavigatedContext } from './RouteLink';

/** Tailwind's `md` breakpoint, the query this shell's `md:` classes switch on: the sidebar pane shows from here up. */
export const WIDE_QUERY = '(width >= 48rem)';

type Props = {
  title: string;
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
  /** Runs before the drawer's own opening focus; preventing it keeps focus where the handler put it. */
  onDrawerOpenAutoFocus?: (e: Event) => void;
  /** The sidebar, rendered once per layout: beside the page from `md` up, in a drawer below it. */
  sidebar: (where: 'pane' | 'drawer') => ReactNode;
  mainRef: RefObject<HTMLElement | null>;
  children: ReactNode;
};

/** Two panes from `md` up; below it, a top bar whose menu button opens the sidebar as a drawer. */
export function AppShell({ title, drawerOpen, onDrawerOpenChange, onDrawerOpenAutoFocus, sidebar, mainRef, children }: Props) {
  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm shadow focus:not-sr-only focus:fixed focus:top-2 focus:left-1/2 focus:-translate-x-1/2 focus:ring-[3px] focus:ring-ring/50 focus:outline-none"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-2 md:hidden">
        <Button variant="ghost" size="icon-sm" aria-label="Open navigation" onClick={() => onDrawerOpenChange(true)}>
          <MenuIcon />
        </Button>
        <span className="min-w-0 truncate text-sm font-medium">{title}</span>
      </header>
      <Sheet open={drawerOpen} onOpenChange={onDrawerOpenChange}>
        <SheetContent side="left" aria-describedby={undefined} onOpenAutoFocus={onDrawerOpenAutoFocus} className="gap-0 overflow-y-auto bg-sidebar p-0 text-sidebar-foreground">
          <SheetTitle className="sr-only">Code Wiki</SheetTitle>
          <NavigatedContext.Provider value={() => onDrawerOpenChange(false)}>{drawerOpen && sidebar('drawer')}</NavigatedContext.Provider>
        </SheetContent>
      </Sheet>
      <aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:block">
        {sidebar('pane')}
      </aside>
      <main id="main" ref={mainRef} tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto focus:outline-none">
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">{children}</div>
      </main>
    </div>
  );
}
