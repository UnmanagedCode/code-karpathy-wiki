import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SEGMENT_RE, wikiRoot, safeJoin, relLabel } from './paths.js';
import { workspaceForProject } from './projects.js';

// Per-file cap, a module constant rather than a tool argument: the cap exists to
// bound one pathological page, not to give the model a knob. Live index pages
// run ~6 KiB and the largest wiki page ~36 KiB, so this never bites in practice
// while capping a worst-case call (5 scopes) at ~320 KiB.
export const MAX_FILE_BYTES = 64 * 1024;

function fail(code, reason) {
  return { ok: false, code, reason };
}

const SHAPE = `must be a single path segment matching ${SEGMENT_RE.source}`;

// Cut a buffer to at most `cap` bytes without splitting a UTF-8 codepoint.
// buf[cap] is the first excluded byte; if it is a continuation byte (0b10xxxxxx)
// the sequence it belongs to straddles the boundary, so walk back to that
// sequence's lead byte and drop it whole. Deliberately not TextDecoder in
// non-fatal mode: that substitutes a U+FFFD the source file never contained.
function truncateUtf8(buf, cap) {
  let end = cap;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8');
}

// Read the wiki index pages for a scope set. Returns {meta, text} on success or
// {ok:false, code, reason} for a refusal — and NEVER throws for a domain
// outcome. An absent scope is meta.missing, not an error: "no workspace wiki
// yet" is a normal answer.
export async function readIndex(args) {
  const { project, workspace } = args ?? {};

  if (project != null && (typeof project !== 'string' || !SEGMENT_RE.test(project))) {
    return fail('PROJECT_INVALID', `project ${SHAPE}`);
  }
  if (workspace != null && (typeof workspace !== 'string' || !SEGMENT_RE.test(workspace))) {
    return fail('WORKSPACE_INVALID', `workspace ${SHAPE}`);
  }

  // Captured once: every path below resolves against this same root, so a
  // mid-call env change can't split the result across two wikis.
  const root = wikiRoot();
  const missing = [];
  const truncated = [];

  // Emission order is broad -> narrow, deduped by resolved absolute path so the
  // same index never appears twice when scopes overlap.
  const candidates = [];
  const push = (abs) => { if (!candidates.includes(abs)) candidates.push(abs); };

  push(path.join(root, 'index.md'));
  push(path.join(root, 'global', 'index.md'));

  if (workspace != null) {
    const abs = safeJoin(root, 'workspaces', workspace, 'index.md');
    if (abs === null) return fail('WORKSPACE_INVALID', `workspace ${SHAPE}`);
    push(abs);
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
      else push(abs);
    }
    const abs = safeJoin(root, 'projects', project, 'index.md');
    if (abs === null) return fail('PROJECT_INVALID', `project ${SHAPE}`);
    push(abs);
  }

  const text = [];
  for (const abs of candidates) {
    const rel = relLabel(root, abs);
    let buf;
    try {
      buf = await fs.readFile(abs);
    } catch {
      // ENOENT, EISDIR, EACCES — all "no body for this scope", never an error.
      missing.push(rel);
      continue;
    }
    let body;
    if (buf.length > MAX_FILE_BYTES) {
      // Mark the cut inline as well as in meta.truncated: once blocks are
      // flattened, a body that just stops looks complete.
      body = `${truncateUtf8(buf, MAX_FILE_BYTES)}\n\n<!-- truncated at ${MAX_FILE_BYTES} bytes -->`;
      truncated.push(rel);
    } else {
      body = buf.toString('utf8');
    }
    // One-line self-labelling header so a body stays identifiable when the host
    // flattens the blocks.
    text.push(`<!-- .conduct/wiki/${rel} -->\n\n${body}`);
  }

  return { meta: { wikiRoot: root, resolvedWorkspace, missing, truncated }, text };
}
