// Data loading for the sidebar and the views.
import { useEffect, useState } from 'react';
import { api } from './api';
import type { Source, SourcesResponse, TreeNode, TreeResponse } from './types';

export type TreeResult = { tree?: TreeNode; truncated?: boolean; error?: unknown };
export type Wikis = { sources: Source[]; trees: Record<string, TreeResult>; projectsError?: string };

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();
export const pageUrl = (source: string, path: string) => `api/page?${q({ source, path })}`;
export const lintUrl = (source: string) => `api/lint?${q({ source })}`;
export const searchUrl = (query: string) => `api/search?${q({ q: query })}`;
const treeUrl = (source: string) => `api/tree?${q({ source })}`;

/** Every source and its tree. A source's tree failing is that source's error; the sources list failing rejects. */
export async function loadWikis(): Promise<Wikis> {
  const { sources, projectsError } = await api<SourcesResponse>('api/sources');
  const results = await Promise.all(
    sources.map((s) =>
      api<TreeResponse>(treeUrl(s.id)).then(
        (r): TreeResult => ({ tree: r.tree, truncated: r.truncated }),
        (error): TreeResult => ({ error }),
      ),
    ),
  );
  return { sources, trees: Object.fromEntries(sources.map((s, i) => [s.id, results[i]])), projectsError };
}

export type Loaded<T> = { data: T | null; error: unknown; loading: boolean };

/** GET `url` whenever it or `reloadKey` changes; a response for a superseded request is dropped. */
export function useApiData<T>(url: string, reloadKey: number): Loaded<T> {
  const [state, setState] = useState<Loaded<T> & { key: string }>({ data: null, error: null, loading: true, key: '' });
  const key = `${reloadKey}|${url}`;
  useEffect(() => {
    let live = true;
    setState({ data: null, error: null, loading: true, key });
    api<T>(url).then(
      (data) => live && setState({ data, error: null, loading: false, key }),
      (error) => live && setState({ data: null, error, loading: false, key }),
    );
    return () => {
      live = false;
    };
  }, [key, url]);
  // Until the effect runs for a new key, the previous key's state is stale: show loading.
  return state.key === key ? state : { data: null, error: null, loading: true };
}
