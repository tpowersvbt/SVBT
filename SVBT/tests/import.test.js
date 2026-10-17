import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { openDatabase, newAccount } from '../server/db.js';
import { migrate } from '../server/migrations.js';
import { accountData, issueStatement, reverseTransaction } from '../server/services.js';
import { parseMoney, previewImport, postImport } from '../server/imports.js';
import { postTransfer } from '../server/transfers.js';

// Same layout as an exported cash book: a first section with no year heading, then "Month YYYY"
// headings, repeated header rows, blank separators, Unicode minus signs and quoted amounts.
const sheet = `Date,Payee / payer,Description,Category,In / (out),Running cash
June 1,Example Investor,Initial capital,Capital,"$10,000.00","$10,000.00"
June 3,Example Landlord ,June rent,Rent,"−$2,500.00","$7,500.00"
June 9,Example Supplies,"Desks, chairs",Furniture,−$499.99,"$7,000.01"
,,,,,
July 2026,,,,,
,,,,,
Date,Payee / payer,Description,Category,In / (out),Running cash
July 1,Example Landlord,July rent,Rent,"−$2,500.00","$4,500.01"
July 10,Example Client,July subscription,Revenue,"$1,200.00","$5,700.01"
`;

function bank() {
  const dir = mkdtempSync(join(tmpdir(), 'svbt-import-'));
  const db = openDatabase(join(dir, 'bank.sqlite'));
  migrate(db);
  const user = (email, role) => Number(db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(email, email, 'Address', role, 'x').lastInsertRowid);
  const owner = user('owner@example.com', 'moderator');
  const customer = user('new@example.com', 'customer');
  const id = newAccount(db, customer, 'Example Customer Co', 'Address');
  return { dir, db, owner, customer, id, close() { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('cash-book amounts parse to exact cents', () => {
  assert.equal(parseMoney('"$20,000.00"'.replaceAll('"', '')), 2000000);
  assert.equal(parseMoney('−$3,350.00'), -335000);
  assert.equal(parseMoney('-$0.05'), -5);
  assert.equal(parseMoney('($12.5)'), -1250);
  assert.equal(parseMoney('$1.234'), null);
  assert.equal(parseMoney('abc'), null);
});

test('preview reads every section, infers the year and reconciles to the running cash column', () => {
  const b = bank();
  try {
    assert.throws(() => previewImport(b.db, b.id, { csv: 'x'.repeat(4097) }), /row is larger than 4 KB/);
    const result = previewImport(b.db, b.id, { csv: sheet });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.rows.map(row => row.date), ['2026-06-01', '2026-06-03', '2026-06-09', '2026-07-01', '2026-07-10']);
    assert.equal(result.rows[1].description, 'Example Landlord — June rent');
    assert.equal(result.closing, 570001);
    assert.equal(result.deposits, 1120000);
    assert.equal(result.debits, 549999);
    const broken = previewImport(b.db, b.id, { csv: sheet.replace('"$4,500.01"', '"$4,500.00"') });
    assert.equal(broken.errors.length, 1, JSON.stringify(broken.errors));
    assert.match(broken.errors[0].error, /Running cash/);
  } finally { b.close(); }
});

test('uploads are limited to an empty new-account ledger and imported entries are marked', () => {
  const b = bank();
  try {
    const { fileHash } = previewImport(b.db, b.id, { csv: sheet });
    assert.throws(() => postImport(b.db, b.id, { csv: sheet, fileHash: 'stale' }, b.owner), /changed since it was previewed/);
    const result = postImport(b.db, b.id, { csv: sheet, fileHash }, b.owner);
    assert.equal(result.rows, 5);
    const data = accountData(b.db, b.id);
    assert.equal(data.balance, 570001);
    assert.equal(data.availableBalance, 0);
    assert.equal(data.hasImportedRecords, true);
    assert.equal(b.db.prepare('SELECT COUNT(*) n FROM transactions WHERE accountId=? AND imported=1').get(b.id).n, 5);
    assert.throws(() => previewImport(b.db, b.id, { csv: sheet }), /only available before the account has any ledger entries/);
    assert.throws(() => postImport(b.db, b.id, { csv: sheet, fileHash }, b.owner), /only available before the account has any ledger entries/);
    const importedId = b.db.prepare('SELECT id FROM transactions WHERE accountId=? ORDER BY id LIMIT 1').get(b.id).id;
    assert.throws(() => reverseTransaction(b.db, importedId, { date: '2026-07-11', reason: 'Incorrect imported entry' }, b.owner), /cannot be reversed/);
    const recipient = newAccount(b.db, b.owner, 'Recipient Co', 'Address');
    const recipientNumber = b.db.prepare('SELECT number FROM accounts WHERE id=?').get(recipient).number;
    assert.throws(() => postTransfer(b.db, b.customer, { toAccountNumber: recipientNumber, amount: 100, description: '', requestId: 'import-cannot-fund-transfer-001' }, 1000000), /Insufficient available balance/);
    assert.equal(b.db.prepare("SELECT name FROM pragma_table_info('accounts') WHERE name='demo'").get(), undefined);
    assert.ok(b.db.prepare("SELECT id FROM audit WHERE action='import.post'").get());
  } finally { b.close(); }
});

test('a rejected import posts nothing', () => {
  const b = bank();
  try {
    const csv = sheet.replace('July 10,', 'July 32,');
    const preview = previewImport(b.db, b.id, { csv });
    assert.equal(preview.errors.length, 1);
    assert.throws(() => postImport(b.db, b.id, { csv, fileHash: preview.fileHash }, b.owner), /problem/);
    assert.equal(accountData(b.db, b.id).transactions.length, 0);
  } finally { b.close(); }
});

test('issued statements identify imported customer records as unverified', async () => {
  const b = bank();
  try {
    const { fileHash } = previewImport(b.db, b.id, { csv: sheet });
    postImport(b.db, b.id, { csv: sheet, fileHash }, b.owner);
    const issued = await issueStatement(b.db, b.id, '2026-06', b.owner, join(b.dir, 'statements'));
    const row = b.db.prepare('SELECT pdf FROM statements WHERE id=?').get(issued.id);
    const document = await getDocument({ data: new Uint8Array(row.pdf), useSystemFonts: true, isEvalSupported: false }).promise;
    for (let page = 1; page <= document.numPages; page++) {
      const text = (await (await document.getPage(page)).getTextContent()).items.map(item => item.str).join(' ');
      assert.ok(text.includes('Customer-provided imported records are not independently verified by SVBT.'), text);
      assert.ok(text.includes('Internal ledger record; not proof of funds or payment settlement.'), text);
    }
    assert.match((await document.getMetadata()).info.Title, /^Customer-provided records - /);
  } finally { b.close(); }
});
