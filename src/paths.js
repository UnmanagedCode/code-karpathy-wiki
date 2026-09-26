import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A project or workspace name usable as a single path segment. The leading
// character class excludes '.', so '..', '.' and '.hidden' are rejected here
// rather than relying on the containment assert below to catch them. The host's
// own workspace rule is LOOSER (it permits spaces and '/'), so a name that is
// legal upstream may still fail this — see wiki.js for how that is handled.
export const SEGMENT_RE = /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/;

// Default projects root = parent dir of this repo, resolved once.
// Layout: <parent>/code-karpathy-wiki/src/paths.js -> <parent>/. The conductor
// injects the authoritative value as PROJECTS_ROOT when it spawns this plugin,
// so that env var always wins in a supervised run. Never hardcode the absolute
// path, and never import host modules — this plugin runs out-of-process.
const DEFAULT_PROJECTS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..',
);

// Read at call time, never cached: tests swap PROJECTS_ROOT between calls.
export function projectsRoot() {
  return process.env.PROJECTS_ROOT ?? DEFAULT_PROJECTS_ROOT;
}

// The conductor's wiki lives in ITS tree, not in this repo. ".conduct" is a
// stable host constant (CONDUCT_PROJECT_NAME) with no env override, so the
// literal segment is safe to embed.
export function wikiRoot() {
  return path.join(projectsRoot(), '.conduct', 'wiki');
}

// Second safety layer behind SEGMENT_RE: resolve, then assert containment.
// Returns null instead of throwing so callers pick the outcome — an escaping
// *argument* is a refusal, an escaping *resolved* workspace is a skip.
export function safeJoin(root, ...segments) {
  const abs = path.resolve(root, ...segments);
  return (abs === root || abs.startsWith(root + path.sep)) ? abs : null;
}

// Label used in meta.missing/meta.truncated and in each body's header comment.
// Always posix-separated so the label is stable across platforms.
export function relLabel(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

// A page path as the browser API receives it: posix, relative, every segment a
// real name (no '', '.', '..', nor any dot-prefixed entry — those are conductor
// scratch files and are excluded everywhere), ending in .md. Returns the path or null.
export function validateRelPath(rel) {
  if (typeof rel !== 'string' || rel === '') return null;
  if (rel.startsWith('/') || rel.includes('\\') || rel.includes('\0')) return null;
  const segs = rel.split('/');
  if (segs.some((s) => s === '' || s.startsWith('.'))) return null;
  if (!segs[segs.length - 1].endsWith('.md')) return null;
  return segs.join('/');
}

export const ESCAPES = 'ESCAPES';

// The symlink-aware containment check the browser applies to every walk entry
// and every read. rootReal must already be a realpath. Returns the resolved
// absolute path, ESCAPES when it lands outside rootReal, or null when it does
// not resolve (ENOENT, ELOOP, ENOTDIR, ...).
export async function confinedRealpath(rootReal, rel) {
  let abs;
  try {
    abs = await fs.realpath(path.join(rootReal, rel));
  } catch {
    return null;
  }
  return (abs === rootReal || abs.startsWith(rootReal + path.sep)) ? abs : ESCAPES;
}
