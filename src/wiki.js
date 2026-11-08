import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SEGMENT_RE, wikiRoot, safeJoin, relLabel } from './paths.js';
import { workspaceForProject } from './projects.js';

// Per-file cap on the text view only (`indexText`); the JSON view returns files
// whole. A module constant rather than a tool argument: the cap exists to bound
// one pathological page, not to give the model a knob. Live index pages run
// ~6 KiB and the largest wiki page ~36 KiB, so this never bites in practice
// while capping a worst-case text call (5 scopes) at ~320 KiB.
export const MAX_FILE_BYTES = 64 * 1024;

// A domain refusal: surfaced as {error, code, details?} in both output formats.
// Identified with `instanceof`, never by sniffing `code` (Node fs errors carry
// string codes too).
export class ToolRefusal extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    if (details) this.details = details;
  }
}

const SHAPE = `must be a single path segment matching ${SEGMENT_RE.source}`;

// Cut a buffer to at most `cap` bytes without splitting a UTF-8 codepoint.
// buf[cap] is the first excluded byte; if it is a continuation byte (0b10xxxxxx)
// the sequence it belongs to straddles the boundary, so walk back to that
// sequence's lead byte and drop it whole. Deliberately not TextDecoder in
// non-fatal mode: that substitutes a U+FFFD the source file never contained.
export function truncateUtf8(buf, cap) {
  let end = cap;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8');
}

// Read the wiki index pages for a scope set. Returns the complete data
// ({wikiRoot, resolvedWorkspace, indexes, missing}), never cut; throws
// ToolRefusal for a bad argument. An absent scope is `missing`, not an error:
// "no workspace wiki yet" is a normal answer.
export async function readIndex(args) {
  const { project, workspace } = args ?? {};

  if (project != null && (typeof project !== 'string' || !SEGMENT_RE.test(project))) {
    throw new ToolRefusal('PROJECT_INVALID', `project ${SHAPE}`);
  }
  if (workspace != null && (typeof workspace !== 'string' || !SEGMENT_RE.test(workspace))) {
    throw new ToolRefusal('WORKSPACE_INVALID', `workspace ${SHAPE}`);
  }

  // Captured once: every path below resolves against this same root, so a
  // mid-call env change can't split the result across two wikis.
  const root = wikiRoot();
  const missing = [];

  // Emission order is broad -> narrow, deduped by resolved absolute path so the
  // same index never appears twice when scopes overlap.
  const candidates = [];
  const push = (abs, scope, name) => {
    if (!candidates.some((c) => c.abs === abs)) candidates.push({ abs, scope, name });
  };

  push(path.join(root, 'index.md'), 'root', null);
  push(path.join(root, 'global', 'index.md'), 'global', null);

  if (workspace != null) {
    const abs = safeJoin(root, 'workspaces', workspace, 'index.md');
    if (abs === null) throw new ToolRefusal('WORKSPACE_INVALID', `workspace ${SHAPE}`);
    push(abs, 'workspace', workspace);
  }

  let resolvedWorkspace = null;
  if (project != null) {
    resolvedWorkspace = await workspaceForProject(project);
    if (resolvedWorkspace !== null) {
      // The host's workspace rule is looser than ours (it permits spaces and
      // '/'), so a legal workspace name may not be addressable as a directory
      // segment. The caller did nothing wrong — report that scope absent rather
      // than refusing the call and denying them every other scope too.
      const abs = SEGMENT_RE.test(resolvedWorkspace)
        ? safeJoin(root, 'workspaces', resolvedWorkspace, 'index.md')
        : null;
      if (abs === null) missing.push(`workspaces/${resolvedWorkspace}/index.md`);
      else push(abs, 'workspace', resolvedWorkspace);
    }
    const abs = safeJoin(root, 'projects', project, 'index.md');
    if (abs === null) throw new ToolRefusal('PROJECT_INVALID', `project ${SHAPE}`);
    push(abs, 'project', project);
  }

  const indexes = [];
  for (const { abs, scope, name } of candidates) {
    const rel = relLabel(root, abs);
    let content;
    try {
      content = await fs.readFile(abs, 'utf8');
    } catch {
      // ENOENT, EISDIR, EACCES — all "no body for this scope", never an error.
      missing.push(rel);
      continue;
    }
    indexes.push({ scope, name, path: rel, content });
  }

  return { wikiRoot: root, resolvedWorkspace, indexes, missing };
}

// The text view of readIndex's data: {meta, text} for the host's raw-text
// channel. This is where MAX_FILE_BYTES applies. A cut is marked inline as well
// as in meta.truncated: once blocks are flattened, a body that just stops looks
// complete. Each body leads with a one-line header so it stays identifiable.
export function indexText({ wikiRoot: root, resolvedWorkspace, indexes, missing }) {
  const truncated = [];
  const text = indexes.map(({ path: rel, content }) => {
    let body = content;
    const buf = Buffer.from(content, 'utf8');
    if (buf.length > MAX_FILE_BYTES) {
      body = `${truncateUtf8(buf, MAX_FILE_BYTES)}\n\n<!-- truncated at ${MAX_FILE_BYTES} bytes; the full page is ${path.join(root, ...rel.split('/'))} -->`;
      truncated.push(rel);
    }
    return `<!-- .conduct/wiki/${rel} -->\n\n${body}`;
  });
  return { meta: { wikiRoot: root, resolvedWorkspace, missing, truncated }, text };
}
