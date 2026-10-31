import { wikiRoot } from './paths.js';
import { localProjectWikis } from './projects.js';

// A browsable wiki: {id, kind, label, root}. `root` never leaves the server.
// The orchestrator source is always listed, even when its directory is absent.
function orchestrator() {
  return { id: 'orchestrator', kind: 'orchestrator', label: 'Orchestrator', root: wikiRoot() };
}

// `projectsError` is the reason the host project lookup failed, or null.
export async function listSources() {
  const { sources, error } = await localProjectWikis();
  return { sources: [orchestrator(), ...sources], projectsError: error };
}

// Project sources are re-fetched per request (no cache): the host list is
// loopback and project membership changes under us.
export async function getSource(id) {
  if (id === 'orchestrator') return orchestrator();
  if (typeof id !== 'string' || !id.startsWith('p:')) return null;
  return (await localProjectWikis()).sources.find((s) => s.id === id) ?? null;
}
