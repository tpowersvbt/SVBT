import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { hashPassword, verifyPassword, openDatabase, newAccount } from '../server/db.js';
import { migrate, migrations } from '../server/migrations.js';

test('production startup provisions staff only and ignores old sample-data settings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'svbt-handoff-'));
  const keys = ['MODERATOR_EMAIL', 'MODERATOR_PASSWORD', 'SAMPLE_DATA', 'DEMO_SEED'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.MODERATOR_EMAIL = 'operations@example.com';
  process.env.MODERATOR_PASSWORD = 'UniqueOperationsTest!2026';
  process.env.SAMPLE_DATA = 'true';
  process.env.DEMO_SEED = 'true';
  const options = { production: true, origin: 'https://bank.example', frontend: false, dbPath: join(dir, 'bank.sqlite'), statementDir: join(dir, 'statements') };
  let app;
  try {
    app = await createApp(options);
    const db = app.locals.db;
    const moderator = db.prepare('SELECT * FROM users WHERE email=?').get(process.env.MODERATOR_EMAIL);
    assert.equal(moderator.role, 'moderator');
    assert.ok(await verifyPassword(process.env.MODERATOR_PASSWORD, moderator.passwordHash));
    for (const table of ['accounts', 'transactions', 'statements', 'imports']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
    await app.locals.close();
    app = await createApp(options);
    assert.equal(app.locals.db.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
    assert.equal(app.locals.db.prepare('SELECT COUNT(*) n FROM accounts').get().n, 0);
  } finally {
    if (app) await app.locals.close();
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the first-ledger migration marks legacy imported records and removes the account flag', async () => {
  const db = openDatabase(':memory:');
  try {
    migrate(db, migrations.slice(0, 6));
    const passwordHash = await hashPassword('LegacyImportTest!2026');
    const customer1 = Number(db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run('legacy-demo@example.com', 'Legacy customer', 'Address', 'customer', passwordHash).lastInsertRowid);
    const customer2 = Number(db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run('legacy-import@example.com', 'Imported customer', 'Address', 'customer', passwordHash).lastInsertRowid);
    const staff = Number(db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run('legacy-staff@example.com', 'Staff', 'Address', 'moderator', passwordHash).lastInsertRowid);
    const legacySeed = newAccount(db, customer1, 'Legacy customer', 'Address');
    const imported = newAccount(db, customer2, 'Imported customer', 'Address');
    db.prepare('UPDATE accounts SET demo=1 WHERE id=?').run(legacySeed);
    const transaction = db.prepare('INSERT INTO transactions(accountId,date,description,amount,actorId) VALUES (?,?,?,?,?)');
    const legacyTransaction = Number(transaction.run(legacySeed, '2026-06-01', 'Legacy sample ledger', 1000, staff).lastInsertRowid);
    const importedTransaction = Number(transaction.run(imported, '2026-06-01', 'Imported ledger entry', 2000, staff).lastInsertRowid);
    db.prepare("INSERT INTO metadata(key,value) VALUES ('demo-seeded',?)").run(String(legacySeed));
    db.prepare('INSERT INTO imports(accountId,actorId,fileHash,rowCount,firstTransactionId,lastTransactionId,closing) VALUES (?,?,?,?,?,?,?)').run(imported, staff, 'a'.repeat(64), 1, importedTransaction, importedTransaction, 2000);

    migrate(db);

    assert.equal(db.prepare("SELECT name FROM pragma_table_info('accounts') WHERE name='demo'").get(), undefined);
    assert.equal(db.prepare('SELECT imported FROM transactions WHERE id=?').get(legacyTransaction).imported, 1);
    assert.equal(db.prepare('SELECT imported FROM transactions WHERE id=?').get(importedTransaction).imported, 1);
    assert.throws(() => db.prepare('UPDATE transactions SET imported=0 WHERE id=?').run(importedTransaction), /Immutable transactions/);
  } finally { db.close(); }
});
