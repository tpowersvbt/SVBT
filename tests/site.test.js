import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/index.js';
import { demoCredentials } from '../server/db.js';
import { parseFundsFlow } from '../server/funds-parse.js';
import { mergeSite, defaultSite, showImage, brandImages } from '../src/brand.js';

const origin = 'http://localhost:3000';
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'svbt-site-'));
  const app = await createApp({ production: false, origin, frontend: false, dbPath: join(directory, 'bank.sqlite'), statementDir: join(directory, 'statements'), demoSeed: true });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie = '', csrf = '';
    return {
      async request(path, method = 'GET', body) {
        const response = await fetch(`${url}/api${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const set = response.headers.get('set-cookie');
        if (set) cookie = set.split(';')[0];
        const data = await response.json();
        if (data.csrfToken) csrf = data.csrfToken;
        return { status: response.status, data };
      },
      async login([email, password]) { await this.request('/session'); assert.equal((await this.request('/login', 'POST', { email, password })).status, 200); }
    };
  }
  return { db: app.locals.db, client, async close() { await new Promise(resolve => server.close(resolve)); await app.locals.close(); rmSync(directory, { recursive: true, force: true }); } };
}
const site = { headerBanner: 'Banner <b>x</b>', footerText: 'Footer', heroTitle: 'Title', heroSubtitle: 'Subtitle' };

test('site settings: public read, moderator write, denial, validation, audit', async () => {
  const f = await fixture();
  try {
    const anon = f.client(), customer = f.client(), mod = f.client();
    assert.equal((await anon.request('/site')).data.heroTitle, defaultSite.heroTitle);
    await anon.request('/session');
    assert.equal((await anon.request('/admin/site', 'PUT', site)).status, 401);
    await customer.login(demoCredentials.customer);
    assert.equal((await customer.request('/admin/site', 'PUT', site)).status, 403);
    await mod.login(demoCredentials.moderator);
    assert.equal((await mod.request('/admin/site', 'PUT', { ...site, heroTitle: '' })).status, 400);
    assert.equal((await mod.request('/admin/site', 'PUT', { ...site, footerText: 'x'.repeat(301) })).status, 400);
    assert.equal((await mod.request('/admin/site', 'PUT', site)).status, 200);
    assert.equal((await anon.request('/site')).data.headerBanner, 'Banner <b>x</b>');
    assert.ok(f.db.prepare("SELECT id FROM audit WHERE action='site.update'").get());
  } finally { await f.close(); }
});

test('team: public listing, moderator add/remove, denial, validation, audit', async () => {
  const f = await fixture();
  try {
    const anon = f.client(), customer = f.client(), mod = f.client();
    assert.ok((await anon.request('/team')).data.some(m => m.name === 'Timothy Powers'));
    await anon.request('/session');
    assert.equal((await anon.request('/admin/team', 'POST', { name: 'A', title: 'B' })).status, 401);
    await customer.login(demoCredentials.customer);
    assert.equal((await customer.request('/admin/team', 'POST', { name: 'A', title: 'B' })).status, 403);
    await mod.login(demoCredentials.moderator);
    assert.equal((await mod.request('/admin/team', 'POST', { name: '', title: 'B' })).status, 400);
    assert.equal((await mod.request('/admin/team', 'POST', { name: 'A', title: 'B', photoUrl: 'javascript:alert(1)' })).status, 400);
    const added = await mod.request('/admin/team', 'POST', { name: 'Jane Doe', title: 'CFO', photoUrl: '/jane.jpg', bio: 'Bio' });
    assert.equal(added.status, 201);
    assert.ok((await anon.request('/team')).data.some(m => m.name === 'Jane Doe'));
    assert.equal((await customer.request(`/admin/team/${added.data.id}`, 'DELETE', {})).status, 403);
    assert.equal((await mod.request(`/admin/team/${added.data.id}`, 'DELETE', {})).status, 200);
    assert.equal((await mod.request(`/admin/team/${added.data.id}`, 'DELETE', {})).status, 404);
    assert.ok(!(await anon.request('/team')).data.some(m => m.name === 'Jane Doe'));
    for (const action of ['team.add', 'team.remove']) assert.ok(f.db.prepare('SELECT id FROM audit WHERE action=?').get(action));
  } finally { await f.close(); }
});

test('funds flow bulk posting: success, atomic failure, per-row errors, auth', async () => {
  const f = await fixture();
  try {
    const anon = f.client(), customer = f.client(), mod = f.client();
    await anon.request('/session');
    const accountId = f.db.prepare('SELECT id FROM accounts ORDER BY id LIMIT 1').get().id;
    const path = `/admin/accounts/${accountId}/transactions/bulk`;
    const rows = '2026-10-01, Wire in, 1,500.00\n2026-10-02\tOffice rent, Suite 4\t(1800.50)\n\n10/03/2026, Fee, -2.5';
    assert.equal((await anon.request(path, 'POST', { rows })).status, 401);
    await customer.login(demoCredentials.customer);
    assert.equal((await customer.request(path, 'POST', { rows })).status, 403);
    await mod.login(demoCredentials.moderator);
    const count = () => f.db.prepare('SELECT COUNT(*) n FROM transactions').get().n;
    const before = count();
    const bad = await mod.request(path, 'POST', { rows: `${rows}\nnot a row\n2026-02-30, Bad date, 1.00` });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.data.rowErrors.map(e => e.row), [5, 6]);
    assert.equal(count(), before);
    const ok = await mod.request(path, 'POST', { rows });
    assert.equal(ok.status, 201);
    assert.deepEqual(ok.data.map(t => t.amount), [150000, -180050, -250]);
    assert.equal(ok.data[1].description, 'Office rent, Suite 4');
    assert.equal(count(), before + 3);
    assert.equal(JSON.parse(f.db.prepare("SELECT details FROM audit WHERE action='transaction.bulkPost'").get().details).count, 3);
    assert.equal((await mod.request(path, 'POST', { rows: '' })).status, 400);
  } finally { await f.close(); }
});

test('funds flow parser and brand fallbacks work without brand images', () => {
  assert.deepEqual(parseFundsFlow('2026-01-05|Deposit|$10').entries.map(e => e.amount), [1000]);
  assert.equal(parseFundsFlow('2026-01-05, X, 1.234').errors.length, 1);
  assert.deepEqual(mergeSite(null), defaultSite);
  assert.equal(mergeSite({ heroTitle: 'Hi', footerText: '  ' }).footerText, defaultSite.footerText);
  assert.equal(showImage({}, 'logo'), true);
  assert.equal(showImage({ logo: true }, 'logo'), false);
  assert.equal(brandImages.logo, '/svbt-logo.jpg');
  assert.equal(brandImages.facade, '/svbt-facade.jpg');
  assert.match(readFileSync('index.html', 'utf8'), /<link rel="icon" href="\/svbt-logo\.jpg"/);
  assert.match(readFileSync('src/App.jsx', 'utf8'), /onError=\{\(\) => markFailed\('logo'\)\}/);
  assert.match(readFileSync('src/App.jsx', 'utf8'), /onError=\{\(\) => markFailed\('facade'\)\}/);
  assert.match(readFileSync('src/App.jsx', 'utf8'), /tel:\+18448247828|phone\.href/);
});
