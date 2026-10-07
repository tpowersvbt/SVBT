import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { verifyPassword, openDatabase, seedDemo, hashPassword, demoCredentials } from '../server/db.js';

test('production sample data creates no staff login, ignores the old seller bootstrap and survives restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'svbt-handoff-'));
  // The obsolete bootstrap settings are passed on purpose: they must no longer create or recreate a login.
  const env = { MODERATOR_EMAIL: 'operations@example.com', MODERATOR_PASSWORD: 'ObsoleteBootstrapSecret!2026' };
  const options = { production: true, demoSeed: false, sampleData: true, origin: 'https://bank.example', frontend: false, dbPath: join(dir, 'bank.sqlite'), statementDir: join(dir, 'statements'), uploadDir: join(dir, 'uploads'), env };
  let app;
  try {
    app = await createApp(options);
    const db = app.locals.db;
    assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE role!='customer'").get().n, 0);
    assert.equal(db.prepare('SELECT id FROM users WHERE email=?').get(env.MODERATOR_EMAIL), undefined);
    assert.deepEqual(db.prepare('SELECT month FROM statements ORDER BY month').all().map(x => x.month), ['2026-06', '2026-07', '2026-08', '2026-09']);
    const before = db.prepare('SELECT id,hash,pdfHash FROM statements ORDER BY id').all();
    const transactions = db.prepare('SELECT COUNT(*) n FROM transactions').get().n;
    const customer = db.prepare("SELECT * FROM users WHERE role='customer'").get();
    assert.equal(await verifyPassword(demoCredentials.customer[1], customer.passwordHash), false);
    await app.locals.close(); app = null;
    app = await createApp(options);
    assert.equal(app.locals.db.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
    assert.equal(app.locals.db.prepare('SELECT COUNT(*) n FROM transactions').get().n, transactions);
    assert.deepEqual(app.locals.db.prepare('SELECT id,hash,pdfHash FROM statements ORDER BY id').all(), before);
    assert.equal(app.locals.db.prepare('SELECT passwordHash FROM users WHERE id=?').get(customer.id).passwordHash, customer.passwordHash);
  } finally {
    if (app) await app.locals.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sample setup reuses a pre-provisioned customer without duplicate email or password reset', async () => {
  const db = openDatabase(':memory:');
  try {
    const hash = await hashPassword('ExistingCustomerSecret!2026');
    db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(demoCredentials.customer[0], 'Existing', 'Review', 'customer', hash);
    await seedDemo(db);
    await seedDemo(db);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 2);
    assert.equal(db.prepare('SELECT passwordHash FROM users WHERE email=?').get(demoCredentials.customer[0]).passwordHash, hash);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM transactions').get().n, 52);
  } finally { db.close(); }
});

test('sample setup never downgrades an existing owner', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(demoCredentials.moderator[0], 'Owner', 'Office', 'owner', await hashPassword('OwnerSecret!2026x'));
    await seedDemo(db);
    assert.equal(db.prepare('SELECT role FROM users WHERE email=?').get(demoCredentials.moderator[0]).role, 'owner');
  } finally { db.close(); }
});
