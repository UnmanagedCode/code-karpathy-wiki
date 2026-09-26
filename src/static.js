import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
// Flat names only: no directories, no dots beyond the extension.
const ASSET_RE = /^\/([a-z0-9-]+\.(html|js|css))$/;
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css' };

// pathname -> {status, headers, body} for a frontend asset, or null.
export async function serveAsset(pathname) {
  const m = pathname === '/' ? ['/index.html', 'index.html', 'html'] : ASSET_RE.exec(pathname);
  if (!m) return null;
  let body;
  try {
    body = await fs.readFile(path.join(FRONTEND, m[1]));
  } catch {
    return null;
  }
  return {
    status: 200,
    headers: { 'content-type': `${TYPES[m[2]]}; charset=utf-8`, 'cache-control': 'no-cache', 'content-length': body.length },
    body,
  };
}
