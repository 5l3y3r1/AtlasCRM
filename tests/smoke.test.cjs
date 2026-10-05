'use strict';
// Repeatable validation against an isolated, disposable demo database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { randomBytes } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const repo = path.resolve(__dirname, '..');
let server, root, base, cookie;

async function request(route, options = {}) {
  return fetch(base + route, { ...options, headers: { Cookie: cookie || '', ...options.headers } });
}
async function login(email) {
  const response = await request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'warm123' }),
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlascrm-check-'));
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(port),
    JWT_SECRET: randomBytes(48).toString('hex'), APP_URL: base,
    DB_PATH: path.join(root, 'warm.db'), UPLOADS_DIR: path.join(root, 'uploads'),
    BACKUP_DIR: path.join(root, 'backups'), SUPER_ADMIN_EMAILS: 'beso@prime.ge' };
  const seeded = spawnSync(process.execPath, ['--no-warnings', 'seed.js'], { cwd: repo, env, encoding: 'utf8' });
  assert.equal(seeded.status, 0, 'Demo database seeding must succeed');
  const config = JSON.parse(fs.readFileSync(path.join(repo, 'railway.json')));
  server = spawn('sh', ['-c', 'exec ' + config.deploy.startCommand], { cwd: repo, env, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    assert.equal(server.exitCode, null, 'Railway start command exited before readiness');
    try { const r = await request('/healthz'); if (r.ok) return; } catch {}
    await delay(100);
  }
  throw new Error('Railway start command did not become healthy');
});
after(async () => {
  if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

test('Railway startup reaches database health and enforces authentication', async () => {
  const health = await request('/healthz');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  assert.equal((await request('/api/data/listings')).status, 401);
  cookie = await login('beso@prime.ge');
  const response = await request('/api/data/listings');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.length, 12);
});

test('Lead create, update, read and delete persist through the API', async () => {
  const created = await request('/api/data/leads', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: 'Environment smoke lead', source: 'OTHER', status: 'NEW' }) });
  assert.ok(created.ok);
  const createdBody = await created.json();
  const row = Array.isArray(createdBody.data) ? createdBody.data[0] : createdBody.data;
  assert.ok(row.id);
  const route = '/api/data/leads?id=eq.' + encodeURIComponent(row.id);
  try {
    const updated = await request(route, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'Verified persistence' }) });
    assert.ok(updated.ok);
    const read = await request(route);
    assert.equal((await read.json()).data[0].notes, 'Verified persistence');
  } finally { assert.ok((await request(route, { method: 'DELETE' })).ok); }
  assert.equal((await (await request(route)).json()).data.length, 0);
});

test('Configured admin can inspect companies; a regular agent is denied', async () => {
  assert.equal((await request('/api/admin/companies')).status, 200);
  const agentCookie = await login('nino@prime.ge');
  assert.equal((await request('/api/admin/companies', { headers: { Cookie: agentCookie } })).status, 403);
});

test('Uploaded files are written and served from the configured directory', async () => {
  const form = new FormData();
  form.append('files', new Blob(['AtlasCRM upload validation'], { type: 'text/plain' }), 'validation.txt');
  const response = await request('/api/upload', { method: 'POST', body: form });
  assert.equal(response.status, 200);
  const file = (await response.json()).data[0];
  const downloaded = await request(file.url);
  assert.equal(downloaded.status, 200);
  assert.equal(await downloaded.text(), 'AtlasCRM upload validation');
});

test('Logout revokes the authenticated API session', async () => {
  assert.equal((await request('/api/auth/logout', { method: 'POST' })).status, 200);
  assert.equal((await request('/api/data/listings')).status, 401);
});
