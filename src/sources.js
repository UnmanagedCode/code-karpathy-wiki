import { wikiRoot } from './paths.js';
import { localProjectWikis } from './projects.js';

// A browsable wiki: {id, kind, label, root}. `root` never leaves the server.
// The orchestrator source is always listed, even when its directory is absent.
function orchestrator() {
  return { id: 'orchestrator', kind: 'orchestrator', label: 'Orchestrator', root: wikiRoot() };
}

export async function listSources() {
  return [orchestrator(), ...(await localProjectWikis())];
}

// Project sources are re-fetched per request (no cache): the host list is
// loopback and project membership changes under us.
export async function getSource(id) {
  if (id === 'orchestrator') return orchestrator();
  if (typeof id !== 'string' || !id.startsWith('p:')) return null;
  return (await localProjectWikis()).find((s) => s.id === id) ?? null;
}
