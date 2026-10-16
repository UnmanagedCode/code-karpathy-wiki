import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The built UI: `npm install` runs `prepare`, which builds frontend/ into here.
export const DEFAULT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'dist');
let distDir = DEFAULT_DIST;

// Test seam: serve from another dist directory; null restores the default.
export function _setDistDir(dir) {
  distDir = dir ?? DEFAULT_DIST;
}

// A flat name at the dist root or under assets/ (Vite's index-<hash>.js, hashes
// in base64url). No dots beyond the extension, so no traversal and no .map.
export const ASSET_RE = /^\/((?:assets\/)?[A-Za-z0-9][A-Za-z0-9_-]*\.(html|js|css))$/;
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css' };
const NOT_BUILT = 'UI not built — run npm install';

// pathname -> {status, headers, body} for a UI asset, or null. No SPA fallback:
// an unknown path (the host's /pluginBridge.js and /pluginTheme.css standalone
// included) is null, so the server answers 404.
export async function serveAsset(pathname) {
  const m = pathname === '/' ? ['/index.html', 'index.html', 'html'] : ASSET_RE.exec(pathname);
  if (!m) return null;
  let body;
  try {
    body = await fs.readFile(path.join(distDir, m[1]));
  } catch {
    if (m[1] === 'index.html') {
      const text = Buffer.from(NOT_BUILT);
      return { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache', 'content-length': text.length }, body: text };
    }
    return null;
  }
  return {
    status: 200,
    headers: { 'content-type': `${TYPES[m[2]]}; charset=utf-8`, 'cache-control': 'no-cache', 'content-length': body.length },
    body,
  };
}

// The built entry page's path; the server logs when it is missing.
export const distIndex = () => path.join(distDir, 'index.html');
