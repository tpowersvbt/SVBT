import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, copyFileSync, existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/index.js';
import { openDatabase } from '../server/db.js';
import { digest, integrity } from '../server/services.js';
import { promoteOwner } from '../server/promote-owner.js';
import { assertCanManageEmployee } from '../server/permissions.js';
import { dataPaths } from '../server/paths.js';
import { backup } from '../server/backup.js';

const origin = 'http://localhost:3000';
const OWNER = 'tpower@siliconvalleybankandtrust.com';
const BACKUP_DB = process.env.SVBT_BACKUP_DB || '/home/ubuntu/svbt_backups/bank-20261007T191456Z.sqlite';
const BACKUP_PDFS = process.env.SVBT_BACKUP_STATEMENTS || '/home/ubuntu/.tmp/backup_statements';
const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'svbt-owner-'));
  const app = await createApp({ production: false, origin, frontend: false, dbPath: join(directory, 'bank.sqlite'), statementDir: join(directory, 'statements'), uploadDir: join(directory, 'uploads'), demoSeed: true, authRateLimit: 500, env: {} });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie = '', csrf = '';
    return {
      async request(path, method = 'GET', body) {
        const response = await fetch(`${url}/api${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
        if (data.csrfToken) csrf = data.csrfToken;
        return { status: response.status, data };
      },
      async login(email, password, expected = 200) {
        await this.request('/session');
        const result = await this.request('/login', 'POST', { email, password });
        assert.equal(result.status, expected, `login ${email}`);
        return result;
      }
    };
  }
  // Uses a single-use link the way a new person would, then signs in.
  async function activate(link, email, password) {
    const token = link.split('#set-password=')[1];
    const anon = client();
    await anon.request('/session');
    assert.equal((await anon.request('/password/describe', 'POST', { token })).status, 200);
    assert.equal((await anon.request('/password/set', 'POST', { token, password })).status, 200);
    assert.equal((await anon.request('/password/set', 'POST', { token, password })).status, 410, 'links are single use');
    const person = client();
    await person.login(email, password);
    return person;
  }
  return { app, db: app.locals.db, client, activate, async close() { await new Promise(resolve => server.close(resolve)); await app.locals.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('DATA_DIR keeps the database, statements and uploads together; DATA_DIR wins over old per-path settings', () => {
  assert.deepEqual(dataPaths({ DATA_DIR: '/var/data', DB_PATH: './data/bank.sqlite', STATEMENT_DIR: './monthly/statements' }), { dataDir: '/var/data', dbPath: '/var/data/bank.sqlite', statementDir: '/var/data/statements', uploadDir: '/var/data/uploads' });
  const legacy = dataPaths({});
  assert.ok(legacy.dbPath.endsWith('/data/bank.sqlite') && legacy.statementDir.endsWith('/monthly/statements'));
});

test('backup writes a checked database snapshot plus statement files, and refuses when there is no database', async () => {
  const fx = await fixture();
  const out = mkdtempSync(join(tmpdir(), 'svbt-backup-'));
  try {
    const paths = { dbPath: fx.app.locals.config.dbPath, statementDir: fx.app.locals.config.statementDir, uploadDir: fx.app.locals.config.uploadDir };
    const result = backup(paths, out);
    assert.equal(result.users, count(fx.db, 'users'));
    assert.equal(result.statements, count(fx.db, 'statements'));
    const copy = new DatabaseSync(join(result.target, 'bank.sqlite'), { readOnly: true });
    assert.equal(count(copy, 'transactions'), count(fx.db, 'transactions'));
    copy.close();
    assert.deepEqual(readdirSync(join(result.target, 'statements')).sort(), readdirSync(paths.statementDir).sort());
    assert.throws(() => backup({ ...paths, dbPath: join(out, 'missing.sqlite') }, out), /Nothing was backed up/);
  } finally { await fx.close(); rmSync(out, { recursive: true, force: true }); }
});

test('migration and owner promotion on a COPY of the production backup, then two restarts', { skip: !existsSync(BACKUP_DB) && 'backup not present' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'svbt-backup-copy-'));
  const originalHash = digest(readFileSync(BACKUP_DB));
  try {
    const copy = join(dir, 'bank.sqlite');
    copyFileSync(BACKUP_DB, copy);
    const raw = new DatabaseSync(copy, { readOnly: true });
    const before = { users: raw.prepare('SELECT id,email,role,passwordHash FROM users ORDER BY id').all(), transactions: count(raw, 'transactions'), statements: count(raw, 'statements'), investments: count(raw, 'investments'), audit: count(raw, 'audit'), accounts: raw.prepare('SELECT * FROM accounts').all() };
    raw.close();
    assert.equal(before.users.length, 2);
    assert.equal(before.users[0].role, 'moderator');

    const run = email => execFileSync(process.execPath, ['server/promote-owner.js', '--db', copy, '--email', email], { encoding: 'utf8', env: { ...process.env, DATA_DIR: '' } });
    const first = run('TPower@SiliconValleyBankAndTrust.com');
    assert.match(first, /User #1 .* changed from moderator to owner/);
    assert.ok(!first.includes('scrypt$') && !first.includes(OWNER), 'no secrets or full email printed');
    let db = openDatabase(copy);
    const users = db.prepare('SELECT id,email,role,passwordHash,active FROM users ORDER BY id').all();
    assert.equal(users[0].role, 'owner');
    assert.equal(users[0].passwordHash, before.users[0].passwordHash);
    assert.equal(users[1].role, 'customer');
    assert.equal(users[1].passwordHash, before.users[1].passwordHash);
    assert.deepEqual([count(db, 'users'), count(db, 'transactions'), count(db, 'statements'), count(db, 'investments')], [2, 52, 4, 3]);
    assert.deepEqual(db.prepare('SELECT * FROM accounts').all(), before.accounts);
    assert.ok(count(db, 'audit') >= 9);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE userId=1').get().n, 0, 'old sessions ended');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    const auditAfterFirst = count(db, 'audit');
    assert.ok(!JSON.stringify(db.prepare('SELECT details FROM audit').all()).includes('scrypt$'));
    db.close();

    assert.match(run(OWNER), /No change needed/);
    assert.throws(() => run('nobody@example.com'), /No user has that email/);
    db = openDatabase(copy);
    assert.equal(count(db, 'audit'), auditAfterFirst, 'second run changes nothing');
    assert.equal(count(db, 'users'), 2, 'never creates a user');
    db.close();

    const statementDir = join(dir, 'statements');
    mkdirSync(statementDir);
    if (existsSync(BACKUP_PDFS)) for (const name of readdirSync(BACKUP_PDFS)) copyFileSync(join(BACKUP_PDFS, name), join(statementDir, name));
    const options = { production: true, sampleData: true, demoSeed: false, origin: 'https://bank.example', frontend: false, dbPath: copy, statementDir, uploadDir: join(dir, 'uploads'), env: {} };
    for (let start = 0; start < 2; start++) {
      const app = await createApp(options);
      const live = app.locals.db;
      assert.deepEqual([count(live, 'users'), count(live, 'transactions'), count(live, 'statements'), count(live, 'investments')], [2, 52, 4, 3]);
      assert.equal(live.prepare('SELECT role FROM users WHERE id=1').get().role, 'owner');
      if (existsSync(BACKUP_PDFS)) for (const { id } of live.prepare('SELECT id FROM statements').all()) assert.equal(integrity(live, id, statementDir).valid, true, 'moved statement PDFs still verify');
      await app.locals.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    assert.equal(digest(readFileSync(BACKUP_DB)), originalHash, 'original backup untouched');
  }
});

test('owner, admin and staff permissions, employees, password links and last-owner protection', async () => {
  const f = await fixture();
  try {
    assert.equal(promoteOwner(f.db, OWNER).changed, true);
    const anon = f.client(), customer = f.client(), owner = f.client();
    await anon.request('/session');
    for (const path of ['/admin/employees', '/admin/customers', '/admin/investments', '/admin/disclosures', '/admin/settings', '/admin/audit']) assert.equal((await anon.request(path)).status, 401, path);
    await customer.login('sales@bakhtiariautogroup.com', 'FounderClient!2026');
    for (const path of ['/admin/employees', '/admin/customers', '/admin/investments', '/admin/disclosures', '/admin/settings', '/admin/audit', '/admin/accounts']) assert.equal((await customer.request(path)).status, 403, path);
    assert.equal((await customer.request('/admin/employees', 'POST', { email: 'x@example.com', name: 'X', role: 'owner' })).status, 403);
    assert.equal((await anon.request('/register', 'POST', { email: 'climber@example.com', name: 'C', address: 'A', password: 'LongEnoughPassword!1', role: 'owner' })).status, 400);

    const session = await owner.login(OWNER, 'ModeratorGod!2026');
    assert.equal(session.data.user.role, 'owner');
    assert.ok(session.data.user.capabilities.includes('owners'));
    const created = await owner.request('/admin/employees', 'POST', { email: 'Admin@Example.com', name: 'Office Admin', role: 'admin' });
    assert.equal(created.status, 201);
    assert.equal(created.data.emailed, false);
    assert.equal(created.data.employee.passwordSet, false);
    assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM password_tokens').all()).includes(created.data.link.split('=')[1]), 'only a hash of the link is stored');
    await f.client().login('admin@example.com', 'anything', 401);
    const admin = await f.activate(created.data.link, 'admin@example.com', 'AdminPassword!2026');

    assert.equal((await admin.request('/admin/employees', 'POST', { email: 'o2@example.com', name: 'Owner Two', role: 'owner' })).status, 403, 'admins cannot grant owner');
    assert.equal((await admin.request('/admin/employees', 'POST', { email: 'a2@example.com', name: 'Admin Two', role: 'admin' })).status, 403);
    const ownerId = f.db.prepare('SELECT id FROM users WHERE email=?').get(OWNER).id;
    assert.equal((await admin.request(`/admin/employees/${ownerId}`, 'PATCH', { role: 'staff' })).status, 403, 'admins cannot demote owners');
    assert.equal((await admin.request(`/admin/employees/${ownerId}`, 'PATCH', { active: false })).status, 403, 'admins cannot remove owners');
    const staffCreated = await admin.request('/admin/employees', 'POST', { email: 'staff@example.com', name: 'Front Desk', role: 'staff' });
    assert.equal(staffCreated.status, 201);
    const staff = await f.activate(staffCreated.data.link, 'staff@example.com', 'StaffPassword!2026');
    assert.equal((await staff.request('/admin/customers')).status, 200);
    for (const path of ['/admin/employees', '/admin/investments', '/admin/disclosures', '/admin/audit', '/admin/projects']) assert.equal((await staff.request(path)).status, 403, path);
    assert.equal((await staff.request('/admin/settings', 'PUT', { registrationOpen: false })).status, 403);

    const staffId = staffCreated.data.employee.id;
    const promoted = await admin.request(`/admin/employees/${staffId}`, 'PATCH', { role: 'moderator' });
    assert.equal(promoted.status, 200);
    assert.equal(promoted.data.role, 'moderator');
    assert.equal((await staff.request('/profile')).status, 401, 'role change ends the affected sessions');
    assert.equal((await owner.request(`/admin/employees/${ownerId}`, 'PATCH', { role: 'admin' })).status, 400, 'nobody changes their own role');
    assert.equal((await owner.request(`/admin/employees/${staffId}`, 'PATCH', { active: false })).status, 200);
    await f.client().login('staff@example.com', 'StaffPassword!2026', 401);
    const reset = await owner.request(`/admin/employees/${staffId}/password-link`, 'POST', {});
    assert.equal(reset.status, 409, 'deactivated people get no links');

    const adminId = created.data.employee.id;
    assert.equal((await owner.request(`/admin/employees/${adminId}`, 'PATCH', { role: 'owner' })).status, 200, 'owners appoint owners');
    assert.equal((await admin.request('/profile')).status, 401);
    const secondOwner = f.client();
    await secondOwner.login('admin@example.com', 'AdminPassword!2026');
    assert.equal((await secondOwner.request(`/admin/employees/${ownerId}`, 'PATCH', { role: 'admin' })).status, 200, 'owners remove owners');
    const lastOwner = f.db.prepare('SELECT * FROM users WHERE id=?').get(adminId);
    assert.throws(() => assertCanManageEmployee(f.db, { id: 9999, role: 'owner', active: 1 }, lastOwner, { role: 'admin' }), error => error.status === 409);
    assert.throws(() => assertCanManageEmployee(f.db, { id: 9999, role: 'owner', active: 1 }, lastOwner, { active: false }), error => error.status === 409);
    const auditText = JSON.stringify(f.db.prepare('SELECT * FROM audit').all());
    assert.ok(auditText.includes('employee.update') && auditText.includes('employee.create'));
    assert.ok(!auditText.includes('scrypt$') && !auditText.includes(created.data.link.split('=')[1]), 'audit holds no secrets');
  } finally { await f.close(); }
});

test('customers are isolated; statements download only for their owner; uploads keep originals', async () => {
  const f = await fixture();
  try {
    promoteOwner(f.db, OWNER);
    const owner = f.client(), sales = f.client();
    await owner.login(OWNER, 'ModeratorGod!2026');
    await sales.login('sales@bakhtiariautogroup.com', 'FounderClient!2026');
    const made = await owner.request('/admin/customers', 'POST', { email: 'second@example.com', name: 'Second Client LLC', address: '1 Main St' });
    assert.equal(made.status, 201);
    assert.match(made.data.customer.accountNumber, /^\d{12}$/);
    const second = await f.activate(made.data.link, 'second@example.com', 'SecondClient!2026');
    const salesAccount = (await sales.request('/account')).data.account, secondAccount = (await second.request('/account')).data.account;
    assert.notEqual(salesAccount.number, secondAccount.number);
    const salesStatement = f.db.prepare('SELECT id FROM statements WHERE accountId=? ORDER BY id LIMIT 1').get(salesAccount.id).id;
    assert.equal((await sales.request('/account/statements')).status, 403, 'off until enabled');
    assert.equal((await owner.request('/admin/settings', 'PUT', { customerStatements: true, customerNotice: 'Sample statements only.' })).status, 200);
    assert.equal((await sales.request('/account')).data.notice, 'Sample statements only.');
    const own = await sales.request(`/account/statements/${salesStatement}/pdf`);
    assert.equal(own.status, 200);
    assert.equal(own.data.subarray(0, 5).toString(), '%PDF-');
    assert.equal((await second.request(`/account/statements/${salesStatement}/pdf`)).status, 404, 'cannot read another customer statement');
    assert.equal((await second.request(`/admin/accounts/${salesAccount.id}`)).status, 403);
    assert.equal((await second.request('/account/statements')).data.issued.length, 0);

    const pdf = n => Buffer.from(`%PDF-1.4\n% sample ${n}\n%%EOF\n`).toString('base64');
    assert.equal((await owner.request(`/admin/accounts/${salesAccount.id}/files`, 'POST', { month: '2026-09', title: 'September', contentBase64: Buffer.from('not a pdf').toString('base64') })).status, 400);
    const first = await owner.request(`/admin/accounts/${salesAccount.id}/files`, 'POST', { month: '2026-09', title: 'September statement', filename: 'sept.pdf', contentBase64: pdf(1) });
    assert.equal(first.status, 201);
    assert.equal((await owner.request(`/admin/accounts/${salesAccount.id}/files`, 'POST', { month: '2026-09', title: 'Fix', contentBase64: pdf(2), supersedes: first.data.id })).status, 400, 'corrections need a note');
    const fixed = await owner.request(`/admin/accounts/${salesAccount.id}/files`, 'POST', { month: '2026-09', title: 'September statement', filename: 'sept.pdf', contentBase64: pdf(2), supersedes: first.data.id, note: 'Corrected address line' });
    assert.equal(fixed.status, 201);
    const versions = (await owner.request(`/admin/accounts/${salesAccount.id}/files`)).data;
    assert.deepEqual(versions.map(v => [v.id, v.current]), [[fixed.data.id, true], [first.data.id, false]]);
    assert.equal((await owner.request(`/admin/files/${first.data.id}/pdf`)).data.toString(), Buffer.from(pdf(1), 'base64').toString(), 'original kept');
    const visible = (await sales.request('/account/statements')).data.files;
    assert.deepEqual(visible.map(v => v.id), [fixed.data.id]);
    assert.equal((await sales.request(`/account/files/${first.data.id}/pdf`)).status, 404, 'customers only see the current version');
    assert.equal((await sales.request(`/account/files/${fixed.data.id}/pdf`)).status, 200);
    assert.equal((await second.request(`/account/files/${fixed.data.id}/pdf`)).status, 404);
    assert.throws(() => f.db.prepare('DELETE FROM statement_files').run(), /Immutable/);

    assert.equal((await owner.request('/admin/settings', 'PUT', { registrationOpen: false })).status, 200);
    const visitor = f.client();
    await visitor.request('/session');
    assert.equal((await visitor.request('/site')).data.registrationOpen, false);
    assert.equal((await visitor.request('/register', 'POST', { email: 'new@example.com', name: 'N', address: 'A', password: 'LongEnoughPassword!1' })).status, 403);
    assert.equal((await owner.request(`/admin/customers/${made.data.customer.id}`, 'PATCH', { active: false })).status, 200);
    assert.equal((await second.request('/account')).status, 401, 'deactivated customer is signed out');
  } finally { await f.close(); }
});

test('investments and disclosures keep drafts private and publish, unpublish and archive with history', async () => {
  const f = await fixture();
  try {
    promoteOwner(f.db, OWNER);
    const owner = f.client(), anon = f.client(), customer = f.client();
    await owner.login(OWNER, 'ModeratorGod!2026');
    await anon.request('/session');
    await customer.login('sales@bakhtiariautogroup.com', 'FounderClient!2026');
    const seeded = (await owner.request('/admin/investments')).data;
    assert.ok(seeded.every(row => row.state === 'draft'), 'existing records stay private');
    assert.deepEqual(seeded.map(row => row.kind).sort(), ['data-center', 'reit', 'startup']);
    assert.equal((await owner.request(`/admin/investments/${seeded[0].id}/publish`, 'POST', {})).status, 400, 'needs a public title first');
    const values = { kind: 'land-development', sector: 'New home builders', status: 'Review', targetCapital: 100000000, risk: 'Capital at risk', strategy: 'Phased entitlement', title: 'Hillside parcels', summary: 'Public summary', publicDescription: 'Public details', privateNotes: 'SECRET-INVESTMENT-NOTE' };
    assert.equal((await customer.request('/admin/investments', 'POST', values)).status, 403);
    let row = (await owner.request('/admin/investments', 'POST', values)).data;
    assert.deepEqual((await anon.request('/investments')).data, []);
    row = (await owner.request(`/admin/investments/${row.id}/publish`, 'POST', {})).data;
    let shown = (await anon.request('/investments')).data;
    assert.equal(shown[0].title, 'Hillside parcels');
    assert.ok(!JSON.stringify(shown).includes('SECRET') && !JSON.stringify(shown).includes('targetCapital'));
    row = (await owner.request(`/admin/investments/${row.id}`, 'PUT', { ...values, title: 'Private rename', version: row.version })).data;
    assert.equal((await anon.request('/investments')).data[0].title, 'Hillside parcels', 'edits stay private until republished');
    assert.equal((await owner.request(`/admin/investments/${row.id}`, 'PUT', { ...values, version: 1 })).status, 409);
    await owner.request(`/admin/investments/${row.id}/unpublish`, 'POST', {});
    assert.deepEqual((await anon.request('/investments')).data, []);
    row = (await owner.request(`/admin/investments/${row.id}/archive`, 'POST', {})).data;
    assert.equal(row.state, 'archived');
    assert.equal(row.privateNotes, 'SECRET-INVESTMENT-NOTE');

    let disclosure = (await owner.request('/admin/disclosures', 'POST', { title: 'Important information', body: 'Draft text' })).data;
    assert.deepEqual((await anon.request('/disclosures')).data, []);
    disclosure = (await owner.request(`/admin/disclosures/${disclosure.id}/publish`, 'POST', { version: disclosure.version })).data;
    assert.equal((await anon.request('/disclosures')).data[0].body, 'Draft text');
    disclosure = (await owner.request(`/admin/disclosures/${disclosure.id}`, 'PUT', { title: 'Important information', body: 'Revised text', version: disclosure.version })).data;
    assert.equal((await anon.request('/disclosures')).data[0].body, 'Draft text');
    disclosure = (await owner.request(`/admin/disclosures/${disclosure.id}/publish`, 'POST', { version: disclosure.version })).data;
    assert.equal((await anon.request('/disclosures')).data[0].body, 'Revised text');
    assert.deepEqual((await owner.request(`/admin/disclosures/${disclosure.id}/versions`)).data.map(v => v.body), ['Revised text', 'Draft text']);
    await owner.request(`/admin/disclosures/${disclosure.id}/unpublish`, 'POST', { version: disclosure.version });
    assert.deepEqual((await anon.request('/disclosures')).data, []);
    assert.throws(() => f.db.prepare('UPDATE disclosure_versions SET body=?').run('x'), /Immutable/);
    assert.equal((await customer.request(`/admin/disclosures/${disclosure.id}/versions`)).status, 403);
  } finally { await f.close(); }
});
