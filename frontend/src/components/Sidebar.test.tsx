import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import type { Wikis } from '@/lib/data';
import type { Route } from '@/lib/route';
import { DEMO_TREE, ORCH_TREE, SOURCES, dir } from '@/test/fixtures';
import { Sidebar } from './Sidebar';

const WIKIS: Wikis = {
  sources: SOURCES.sources,
  trees: { orchestrator: { tree: ORCH_TREE.tree, truncated: false }, 'p:demo': { tree: DEMO_TREE.tree, truncated: true } },
};

function renderSidebar(route: Route, wikis: Wikis = WIKIS) {
  return render(<Sidebar route={route} wikis={wikis} loadError={null} reloading={false} onReload={vi.fn()} />);
}
const home: Route = { view: 'page', source: 'orchestrator', path: 'index.md' };
const disclosure = (name: string) => screen.getByRole('button', { name, hidden: true });

describe('Sidebar', () => {
  // Invariant: an unreadable root shows the destructive alert, never "No pages yet".
  it('shows an unreadable root as an error, an empty one as empty', () => {
    renderSidebar(home, {
      sources: SOURCES.sources,
      trees: { orchestrator: { tree: dir({ error: 'READ_FAILED' }) }, 'p:demo': { tree: dir() } },
    });
    const orch = screen.getByRole('region', { name: 'Orchestrator' });
    expect(within(orch).getByRole('alert').textContent).toContain('could not be read');
    expect(within(orch).queryByText('No pages yet.')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'demo' })).getByText('No pages yet.')).toBeTruthy();
  });

  // Invariant: a source whose tree failed to load shows that error; a truncated walk shows its note.
  it('shows a per-source fetch error and the truncated note', () => {
    renderSidebar(home, {
      sources: SOURCES.sources,
      trees: { orchestrator: { error: new ApiError(500, 'internal error') }, 'p:demo': { tree: DEMO_TREE.tree, truncated: true } },
    });
    expect(within(screen.getByRole('region', { name: 'Orchestrator' })).getByText('internal error')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'demo' })).getByText(/Tree truncated/)).toBeTruthy();
  });

  // Invariant: top-level dirs open; the archive starts collapsed and is the only badged dir; unreadable dirs are badged.
  it('opens top-level dirs, collapses and badges only the archive root', () => {
    renderSidebar(home);
    expect(disclosure('global').getAttribute('aria-expanded')).toBe('true');
    expect(disclosure('archive').getAttribute('aria-expanded')).toBe('false');
    expect(disclosure('fam').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByText('archive — not in recall path')).toHaveLength(1);
    expect(disclosure('archive').closest('li')!.className).toContain('archived-item');
    // The archive's own sub-dir is neither badged nor dimmed a second time.
    expect(disclosure('deep').closest('li')!.className).not.toContain('archived-item');
    expect(within(disclosure('projects').closest('li')!).getByText('unreadable')).toBeTruthy();
    // The dir's index is its label link; a page leaf links with its title.
    expect(screen.getByRole('link', { name: 'global' }).getAttribute('href')).toBe('?view=page&source=orchestrator&path=global%2Findex.md');
    expect(screen.getByRole('link', { name: 'a' }).getAttribute('title')).toBe('Page A');
  });

  // Invariant: the active page is marked aria-current and every directory above it is expanded.
  it('marks the active page and expands its ancestors', () => {
    renderSidebar({ view: 'page', source: 'orchestrator', path: 'global/archive/deep/x.md' });
    expect(disclosure('archive').getAttribute('aria-expanded')).toBe('true');
    expect(disclosure('deep').getAttribute('aria-expanded')).toBe('true');
    const current = document.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('href')).toBe('?view=page&source=orchestrator&path=global%2Farchive%2Fdeep%2Fx.md');
  });

  // Invariant: the source label marks the root index active; Health is marked on its own route.
  it('marks the root index and the Health link active on their routes', () => {
    const { unmount } = renderSidebar(home);
    expect(screen.getByRole('link', { name: 'Orchestrator' }).getAttribute('aria-current')).toBe('page');
    unmount();
    renderSidebar({ view: 'health', source: 'p:demo' });
    const health = within(screen.getByRole('region', { name: 'demo' })).getByRole('link', { name: 'Health' });
    expect(health.getAttribute('aria-current')).toBe('page');
    expect(health.getAttribute('href')).toBe('?view=health&source=p%3Ademo');
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  // Invariant: disclosures are real buttons: Enter and Space toggle aria-expanded and the children's visibility.
  it('toggles a directory with Enter and Space', async () => {
    const user = userEvent.setup();
    renderSidebar(home);
    const fam = disclosure('fam');
    const kids = document.getElementById(fam.getAttribute('aria-controls')!)!;
    expect(kids.hidden).toBe(true);
    fam.focus();
    await user.keyboard('{Enter}');
    expect(fam.getAttribute('aria-expanded')).toBe('true');
    expect(kids.hidden).toBe(false);
    await user.keyboard(' ');
    expect(fam.getAttribute('aria-expanded')).toBe('false');
    expect(kids.hidden).toBe(true);
  });
});
