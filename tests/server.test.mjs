import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../server.js';
import { freshWiki, cleanup, resetEnv, useProjects, freshProjectWiki, treeDigest } from './_helpers.mjs';

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

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

// Invariant: the shell and assets are served with their content types and the security headers.
test('static: index shell and assets, with CSP and nosniff', async () => {
  await withServer(async ({ base }) => {
    const r = await fetch(`${base}/`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(r.headers.get('content-security-policy'), CSP);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('cache-control'), 'no-cache');
    assert.match(await r.text(), /<script type="module" src="app\.js"><\/script>/);
    for (const [p, type] of [['/app.js', 'text/javascript'], ['/render.js', 'text/javascript'], ['/styles.css', 'text/css'], ['/index.html', 'text/html']]) {
      const a = await fetch(base + p);
      assert.equal(a.status, 200, p);
      assert.equal(a.headers.get('content-type'), `${type}; charset=utf-8`);
    }
    const api = await fetch(`${base}/api/sources`);
    assert.equal(api.headers.get('content-security-policy'), CSP, 'API responses carry the headers too');
    assert.equal(api.headers.get('x-content-type-options'), 'nosniff');
  });
});

// Invariant: nothing outside frontend/ is reachable as a static asset.
test('static: traversal and source files are 404', async () => {
  await withServer(async ({ base }) => {
    for (const p of ['/../server.js', '/src/wiki.js', '/package.json', '/%2e%2e/server.js', '/..%2fserver.js',
      '/server.js', '/conductor.plugin.json', '/frontend/app.js', '/App.js', '/app.js.map']) {
      assert.equal(await rawGet(base, p), 404, p);
    }
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
// method with 405, and a full sweep including the GETs leaves both trees byte-identical.
test('no-write invariant: 405 for writes, trees unchanged after a full sweep', async () => {
  await withServer(async ({ root, wiki, write, base }) => {
    await write('index.md', '# Root\n\n[g](global/index.md) [[a]]\n');
    await write('global/index.md', '# G\n\n[[a]]\n');
    await write('global/a.md', '---\nupdated: 2000-01-01\n---\n# A\n');
    const row = await freshProjectWiki(root, 'demo', { 'index.md': '# D\n\n[[x]]\n', 'x.md': '# X\n' });
    useProjects([row]);
    const before = [await treeDigest(wiki), await treeDigest(row.path)];

    const paths = [
      '/api/sources', '/api/tree?source=orchestrator', '/api/tree?source=p:demo',
      '/api/page?source=orchestrator&path=global/a.md', '/api/page?source=p:demo&path=x.md',
      '/api/lint?source=orchestrator', '/api/lint?source=p:demo', '/api/search?q=root',
      '/', '/index.html', '/app.js', '/render.js', '/styles.css', '/nope',
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
    assert.deepEqual([await treeDigest(wiki), await treeDigest(row.path)], before);
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
