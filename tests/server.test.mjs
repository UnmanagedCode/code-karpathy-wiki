import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { createServer } from '../server.js';
import { _setDistDir } from '../src/static.js';
import { freshWiki, cleanup, resetEnv, useProjects, freshProjectWiki, treeDigest, fixtureDist, writeTree } from './_helpers.mjs';

const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

async function withServer(fn) {
  resetEnv();
  const w = await freshWiki();
  const server = createServer();
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({ ...w, base });
  } finally {
    await new Promise((res) => server.close(res));
    await cleanup(w.root);
    resetEnv();
  }
}

// fetch() normalises dot segments client-side; send the raw path instead.
function rawGet(base, rawPath) {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: rawPath }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
}

// Invariant: the built shell and assets (assets/ and hashed names included) are served with their types and the security headers.
test('static: index shell and assets, with CSP and nosniff', async () => {
  await withServer(async ({ root, base }) => {
    _setDistDir(await fixtureDist(root));
    const r = await fetch(`${base}/`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(r.headers.get('content-security-policy'), CSP);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('cache-control'), 'no-cache');
    assert.match(await r.text(), /src="\.\/assets\/index-Ab_9-x\.js"/);
    for (const [p, type] of [['/assets/index-Ab_9-x.js', 'text/javascript'], ['/theme-init.js', 'text/javascript'],
      ['/assets/index-Cd1.css', 'text/css'], ['/index.html', 'text/html']]) {
      const a = await fetch(base + p);
      assert.equal(a.status, 200, p);
      assert.equal(a.headers.get('content-type'), `${type}; charset=utf-8`);
      assert.equal(a.headers.get('content-security-policy'), CSP, p);
      assert.equal(a.headers.get('x-content-type-options'), 'nosniff', p);
      assert.equal(a.headers.get('cache-control'), 'no-cache', p);
    }
    const api = await fetch(`${base}/api/sources`);
    assert.equal(api.headers.get('content-security-policy'), CSP, 'API responses carry the headers too');
    assert.equal(api.headers.get('x-content-type-options'), 'nosniff');
  });
});

// Invariant: nothing outside the built dist is reachable as a static asset.
test('static: traversal, sources and maps are 404', async () => {
  await withServer(async ({ root, base }) => {
    _setDistDir(await fixtureDist(root));
    for (const p of ['/../server.js', '/src/wiki.js', '/package.json', '/%2e%2e/server.js', '/..%2fserver.js',
      '/server.js', '/conductor.plugin.json', '/frontend/app.js', '/App.js', '/app.js.map',
      '/assets/../server.js', '/frontend/src/main.tsx', '/src/main.tsx', '/assets/index.js.map',
      '/node_modules/react/index.js', '/frontend/dist/index.html', '/assets/index-Ab_9-x.js.map', '/assets/sub/x.js']) {
      assert.equal(await rawGet(base, p), 404, p);
    }
  });
});

// Invariant: the static allowlist itself refuses names outside its rule. Each decoy exists in the dist, so its 404
// comes from ASSET_RE, not from a missing file; each would be served by a loosened rule such as /^\/(.+\.(html|js|css))$/.
test('static: files in the dist that the allowlist refuses are 404', async () => {
  await withServer(async ({ root, base }) => {
    const dist = await fixtureDist(root);
    _setDistDir(dist);
    const decoys = ['a.b.js', 'x/y.js', 'assets/sub/z.css', 'assets/index-Ab_9-x.js.css', '.hidden.js', '_under.js', 'assets/-dash.js'];
    await writeTree(dist, Object.fromEntries(decoys.map((d) => [d, 'decoy'])));
    const LOOSE = /^\/(.+\.(html|js|css))$/;
    for (const d of decoys) {
      assert.match(`/${d}`, LOOSE, `${d} is a decoy a loosened rule would serve`);
      assert.equal(await rawGet(base, `/${d}`), 404, d);
    }
    assert.equal(await rawGet(base, '/assets/index-Ab_9-x.js'), 200, 'the allowed neighbour is served');
  });
});

// Invariant: no SPA fallback: the host-served URLs are a JSON 404 standalone, never index.html.
test('static: /pluginBridge.js and /pluginTheme.css are 404 standalone', async () => {
  await withServer(async ({ root, base }) => {
    _setDistDir(await fixtureDist(root));
    for (const p of ['/pluginBridge.js', '/pluginTheme.css', '/pluginTheme/fonts/x.woff2', '/nope', '/?view=page']) {
      const r = await fetch(base + p);
      const body = await r.text();
      if (p.startsWith('/?')) { assert.equal(r.status, 200, p); continue; }
      assert.equal(r.status, 404, p);
      assert.equal(r.headers.get('content-type'), 'application/json', p);
      assert.equal(body.includes('<html'), false, p);
      assert.equal(r.headers.get('content-security-policy'), CSP, p);
    }
  });
});

// Invariant: with the UI unbuilt, the page answers 503 text/plain with the headers, and the API still works.
test('static: an unbuilt UI is 503 on / and /index.html; the API still answers', async () => {
  await withServer(async ({ root, base }) => {
    _setDistDir(path.join(root, 'no-dist'));
    for (const p of ['/', '/index.html']) {
      const r = await fetch(base + p);
      assert.equal(r.status, 503, p);
      assert.equal(r.headers.get('content-type'), 'text/plain; charset=utf-8');
      assert.equal(await r.text(), 'UI not built — run npm install');
      assert.equal(r.headers.get('content-security-policy'), CSP);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    }
    assert.equal((await fetch(`${base}/assets/index-Ab_9-x.js`)).status, 404);
    assert.equal((await fetch(`${base}/api/sources`)).status, 200);
  });
});

// Invariant: the existing health route is unchanged.
test('/api/health still {ok:true}', async () => {
  await withServer(async ({ base }) => {
    const r = await fetch(`${base}/api/health`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  });
});

// Invariant: HEAD is served on browser routes with no body.
test('HEAD on browser routes', async () => {
  await withServer(async ({ base }) => {
    const r = await fetch(`${base}/api/sources`, { method: 'HEAD' });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), '');
  });
});

// Invariant (no-write): every browser route and static path refuses every write
// method with 405, and a full sweep including the GETs leaves the wikis and the dist byte-identical.
test('no-write invariant: 405 for writes, trees unchanged after a full sweep', async () => {
  await withServer(async ({ root, wiki, write, base }) => {
    const dist = await fixtureDist(root);
    _setDistDir(dist);
    await write('index.md', '# Root\n\n[g](global/index.md) [[a]]\n');
    await write('global/index.md', '# G\n\n[[a]]\n');
    await write('global/a.md', '---\nupdated: 2000-01-01\n---\n# A\n');
    const row = await freshProjectWiki(root, 'demo', { 'index.md': '# D\n\n[[x]]\n', 'x.md': '# X\n' });
    useProjects([row]);
    const before = [await treeDigest(wiki), await treeDigest(row.path), await treeDigest(dist)];

    const paths = [
      '/api/sources', '/api/tree?source=orchestrator', '/api/tree?source=p:demo',
      '/api/page?source=orchestrator&path=global/a.md', '/api/page?source=p:demo&path=x.md',
      '/api/lint?source=orchestrator', '/api/lint?source=p:demo', '/api/search?q=root',
      '/', '/index.html', '/theme-init.js', '/assets/index-Ab_9-x.js', '/assets/index-Cd1.css', '/nope',
    ];
    for (const p of paths) {
      const g = await fetch(base + p);
      await g.arrayBuffer();
      assert.ok([200, 404].includes(g.status), `GET ${p}`);
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const r = await fetch(base + p, { method, body: method === 'DELETE' ? undefined : '{"x":1}' });
        await r.arrayBuffer();
        assert.equal(r.status, 405, `${method} ${p}`);
        assert.equal(r.headers.get('allow'), 'GET, HEAD');
      }
    }
    assert.deepEqual([await treeDigest(wiki), await treeDigest(row.path), await treeDigest(dist)], before);
  });
});

function rawRequest(base, rawPath) {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: rawPath }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

// Invariant: every response carries the security headers; a malformed request URL is a 400 with a code.
test('/api/health and a malformed URL carry CSP and nosniff; malformed URL -> 400 URL_INVALID', async () => {
  await withServer(async ({ base }) => {
    const h = await fetch(`${base}/api/health`);
    assert.equal(h.headers.get('content-security-policy'), CSP);
    assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
    const h405 = await fetch(`${base}/api/health`, { method: 'POST' });
    assert.equal(h405.status, 405);
    assert.equal(h405.headers.get('content-security-policy'), CSP);
    const bad = await rawRequest(base, 'http://[');
    assert.equal(bad.status, 400);
    assert.equal(bad.headers['content-security-policy'], CSP);
    assert.equal(bad.headers['x-content-type-options'], 'nosniff');
    assert.equal(JSON.parse(bad.body).code, 'URL_INVALID');
  });
});

// Invariant: an internal error is a generic 500 with a code and the headers — never the exception text.
test('500 carries the security headers and a generic body, never e.message', async () => {
  await withServer(async ({ base }) => {
    useProjects([{ get name() { throw new Error('/secret/fs/path'); } }]);
    const r = await rawRequest(base, '/api/sources');
    assert.equal(r.status, 500);
    assert.equal(r.headers['content-security-policy'], CSP);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(JSON.parse(r.body), { error: 'internal error', code: 'INTERNAL' });
    assert.equal(r.body.includes('secret'), false);
  });
});
