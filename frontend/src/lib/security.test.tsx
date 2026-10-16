import { render, renderHook, act } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { safeHref } from './safeHref';
import { useTheme } from './theme';
import { api, ApiError } from './api';
import { WikiContent } from './render';

afterEach(() => { vi.unstubAllGlobals(); document.documentElement.classList.remove('dark'); });

it('renders model text as text, never as markup', () => {
  const evil = '<img src=x onerror="alert(1)">';
  const { container } = render(<WikiContent blocks={[{ t: 'p', c: [{ t: 'text', v: evil }] }]} ctx={{ source: 'orchestrator' }} />);
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toContain(evil);
});

it('safeHref refuses javascript: and data: URLs', () => {
  expect(safeHref('javascript:alert(1)')).toBeNull();
  expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeNull();
  expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
  // Absolute URLs only: nothing resolves against the page.
  expect(safeHref('//evil.example/x')).toBeNull();
  expect(safeHref('relative/x')).toBeNull();
  expect(safeHref('mailto:a@example.com')).toBeNull();
});

it('useTheme follows a .dark flip on <html>', async () => {
  const { result } = renderHook(() => useTheme());
  expect(result.current).toBe('light');
  await act(async () => { document.documentElement.classList.add('dark'); });
  expect(result.current).toBe('dark');
  await act(async () => { document.documentElement.classList.remove('dark'); });
  expect(result.current).toBe('light');
});

it('API requests use relative URLs', async () => {
  const fetchMock = vi.fn(async () => new Response('{"ok":true}'));
  vi.stubGlobal('fetch', fetchMock);
  await api('api/board');
  expect(fetchMock).toHaveBeenCalledWith('api/board', undefined);
  await expect(api('/api/board')).rejects.toThrow(/root-relative/);
});

// Invariant: a failed request carries the status and the backend's {error, code}, never the raw body.
it('API errors carry status, message and code', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"no such page: x.md","code":"NOT_FOUND"}', { status: 404 })));
  const e = await api('api/page').catch((x) => x);
  expect(e).toBeInstanceOf(ApiError);
  expect(e).toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'no such page: x.md' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>secret</html>', { status: 502 })));
  const e2 = await api('api/page').catch((x) => x);
  expect(e2).toMatchObject({ status: 502, code: undefined, message: 'HTTP 502' });
});
