import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { atomic, audit } from './db.js';
import { renderStatement } from './pdf.js';

export const digest = value => createHash('sha256').update(value).digest('hex');
export function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
export function text(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) fail(400, `${name} is required and must be at most ${max} characters without control characters.`);
  return value.trim();
}
export function cents(value, allowZero = false) {
  if (!Number.isSafeInteger(value) || Math.abs(value) > 100000000000 || (!allowZero && value === 0)) fail(400, 'Amount must be integer USD cents within the supported range, and nonzero for ledger entries.');
  return value;
}
export function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(400, 'A valid ledger date (YYYY-MM-DD) is required.');
  return value;
}
export function account(db, id) {
  const result = db.prepare('SELECT * FROM accounts WHERE id=?').get(id);
  if (!result) fail(404, 'Account not found.');
  return result;
}
export function transactions(db, id) { return db.prepare('SELECT * FROM transactions WHERE accountId=? ORDER BY date,id').all(id); }
export function preview(db, id, month) {
  if (typeof month !== 'string' || !/^(19|[2-9]\d)\d{2}-(0[1-9]|1[0-2])$/.test(month)) fail(400, 'A valid statement month (YYYY-MM) is required.');
  const owner = account(db, id);
  const rows = transactions(db, id);
  let opening = 0, deposits = 0, debits = 0;
  for (const row of rows) if (row.date.slice(0, 7) < month) opening += row.amount;
  let runningBalance = opening;
  const entries = rows.filter(row => row.date.startsWith(month)).map(row => {
    if (row.amount > 0) deposits += row.amount; else debits -= row.amount;
    runningBalance += row.amount;
    return { ...row, runningBalance };
  });
  for (const value of [opening, deposits, debits, runningBalance]) if (!Number.isSafeInteger(value)) fail(409, 'Ledger total exceeds safe integer precision.');
  const [year, m] = month.split('-').map(Number);
  return { account: owner, month, startDate: `${month}-01`, endDate: `${month}-${new Date(Date.UTC(year, m, 0)).getUTCDate()}`, opening, deposits, debits, closing: runningBalance, transactions: entries };
}
export function accountData(db, id) {
  const owner = account(db, id), rows = transactions(db, id);
  const monthly = [...new Set(rows.map(row => row.date.slice(0, 7)))].map(month => {
    const { opening, deposits, debits, closing } = preview(db, id, month);
    return { month, opening, deposits, debits, closing };
  });
  const balance = rows.reduce((sum, row) => sum + row.amount, 0);
  if (!Number.isSafeInteger(balance)) fail(409, 'Ledger balance exceeds safe integer precision.');
  return { account: owner, transactions: rows, monthly, balance };
}
export function postTransaction(db, id, values, actorId) {
  account(db, id);
  const entry = { date: date(values.date), description: text(values.description, 'Description', 300), amount: cents(values.amount) };
  return atomic(db, () => {
    const transactionId = Number(db.prepare('INSERT INTO transactions(accountId,date,description,amount,actorId) VALUES (?,?,?,?,?)').run(id, entry.date, entry.description, entry.amount, actorId).lastInsertRowid);
    accountData(db, id);
    audit(db, actorId, 'transaction.post', transactionId, { accountId: id, ...entry });
    return db.prepare('SELECT * FROM transactions WHERE id=?').get(transactionId);
  });
}
export function reverseTransaction(db, id, values, actorId) {
  const ledgerDate = date(values.date), reason = text(values.reason, 'Reversal reason', 250);
  return atomic(db, () => {
    const original = db.prepare('SELECT * FROM transactions WHERE id=?').get(id);
    if (!original) fail(404, 'Transaction not found.');
    if (original.reversalOf || db.prepare('SELECT id FROM transactions WHERE reversalOf=?').get(id)) fail(409, 'This entry cannot be reversed again.');
    if (ledgerDate < original.date) fail(400, 'Reversal date cannot precede the original entry.');
    const transactionId = Number(db.prepare('INSERT INTO transactions(accountId,date,description,amount,reversalOf,actorId) VALUES (?,?,?,?,?,?)').run(original.accountId, ledgerDate, `Reversal #${id}: ${reason}`, -original.amount, id, actorId).lastInsertRowid);
    accountData(db, original.accountId);
    audit(db, actorId, 'transaction.reverse', transactionId, { reversalOf: id, reason });
    return db.prepare('SELECT * FROM transactions WHERE id=?').get(transactionId);
  });
}
export function archive(db, id) {
  account(db, id);
  return db.prepare('SELECT id,accountId,month,revision,issuedAt,closing,hash FROM statements WHERE accountId=? ORDER BY month DESC,revision DESC').all(id);
}
export function statement(db, id) {
  const result = db.prepare('SELECT * FROM statements WHERE id=?').get(id);
  if (!result) fail(404, 'Issued statement not found.');
  return result;
}
// statementDir lets archives that were moved (for example to DATA_DIR=/var/data) still verify by file name.
export function integrity(db, id, statementDir) {
  const row = statement(db, id);
  let archiveValid = false;
  for (const path of [row.archivePath, ...(statementDir ? [join(statementDir, basename(row.archivePath))] : [])]) {
    try { if (digest(readFileSync(path)) === row.pdfHash) { archiveValid = true; break; } } catch { /* try the next location */ }
  }
  const snapshotValid = digest(row.snapshot) === row.hash, pdfValid = digest(row.pdf) === row.pdfHash;
  return { valid: snapshotValid && pdfValid && archiveValid, snapshotValid, pdfValid, archiveValid };
}
export async function issueStatement(db, id, month, actorId, directory) {
  const live = preview(db, id, month);
  const revision = db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM statements WHERE accountId=? AND month=?').get(id, month).revision;
  const snapshot = { ...live, revision, issuedAt: new Date().toISOString() };
  const serialized = JSON.stringify(snapshot), pdf = await renderStatement(snapshot);
  mkdirSync(directory, { recursive: true });
  const archivePath = join(directory, `${live.account.number}-${month}-r${revision}.pdf`);
  const temporary = `${archivePath}.${randomBytes(12).toString('hex')}.tmp`;
  writeFileSync(temporary, pdf, { flag: 'wx', mode: 0o600 });
  let moved = false;
  try {
    return atomic(db, () => {
      if (JSON.stringify(preview(db, id, month)) !== JSON.stringify(live) || db.prepare('SELECT id FROM statements WHERE accountId=? AND month=? AND revision=?').get(id, month, revision)) fail(409, 'Ledger or revision changed during PDF generation. Recalculate and try again.');
      const result = db.prepare('INSERT INTO statements(accountId,month,revision,issuedAt,closing,snapshot,hash,pdf,pdfHash,archivePath) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, month, revision, snapshot.issuedAt, snapshot.closing, serialized, digest(serialized), pdf, digest(pdf), archivePath);
      const statementId = Number(result.lastInsertRowid);
      audit(db, actorId, 'statement.issue', statementId, { accountId: id, month, revision });
      renameSync(temporary, archivePath); moved = true;
      return archive(db, id).find(row => row.id === statementId);
    });
  } catch (error) { try { unlinkSync(moved ? archivePath : temporary); } catch {} throw error; }
}
export const INVESTMENT_KINDS = ['reit', 'land-development', 'data-center', 'startup', 'other'];
function longText(value, label, max) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail(400, `${label} must be at most ${max} characters.`);
  return value.trim();
}
// Saving edits the private working copy only. The public site shows the last published snapshot until it is published again.
export function saveInvestment(db, id, values, actorId) {
  const data = [text(values.sector, 'Sector', 100), text(values.status, 'Status', 100), cents(values.targetCapital, true), text(values.risk, 'Risk', 200), text(values.strategy, 'Strategy', 2000)];
  if (data[2] < 0) fail(400, 'Target capital cannot be negative.');
  if (values.kind !== undefined && !INVESTMENT_KINDS.includes(values.kind)) fail(400, 'Choose a valid investment type.');
  const extra = { kind: values.kind, title: longText(values.title, 'Title', 150), summary: longText(values.summary, 'Summary', 500), publicDescription: longText(values.publicDescription, 'Public description', 6000), privateNotes: longText(values.privateNotes, 'Private notes', 6000) };
  return atomic(db, () => {
    const now = new Date().toISOString();
    if (id) {
      const row = db.prepare('SELECT * FROM investments WHERE id=?').get(id);
      if (!row) fail(404, 'Investment not found.');
      if (values.version !== undefined && values.version !== row.version) fail(409, 'This investment changed. Reload it before saving.');
      db.prepare('UPDATE investments SET sector=?,status=?,targetCapital=?,risk=?,strategy=?,version=version+1,updatedAt=? WHERE id=?').run(...data, now, id);
    } else id = Number(db.prepare('INSERT INTO investments(sector,status,targetCapital,risk,strategy,updatedAt) VALUES (?,?,?,?,?,?)').run(...data, now).lastInsertRowid);
    for (const [column, value] of Object.entries(extra)) if (value !== undefined) db.prepare(`UPDATE investments SET ${column}=? WHERE id=?`).run(value, id);
    const result = db.prepare('SELECT * FROM investments WHERE id=?').get(id);
    audit(db, actorId, 'investment.save', id, { sector: result.sector, kind: result.kind, title: result.title, state: result.state, version: result.version });
    return result;
  });
}
// action: 'publish' copies the public fields into a snapshot; 'unpublish' returns it to a private draft; 'archive' hides it everywhere but keeps the record.
export function setInvestmentState(db, id, action, actorId) {
  return atomic(db, () => {
    const row = db.prepare('SELECT * FROM investments WHERE id=?').get(id);
    if (!row) fail(404, 'Investment not found.');
    const now = new Date().toISOString();
    if (action === 'publish') {
      if (!row.title || !row.summary) fail(400, 'Add a public title and summary before publishing.');
      const snapshot = JSON.stringify({ id: row.id, kind: row.kind, sector: row.sector, title: row.title, summary: row.summary, description: row.publicDescription, risk: row.risk });
      db.prepare("UPDATE investments SET state='published',published=?,publishedAt=?,version=version+1,updatedAt=? WHERE id=?").run(snapshot, now, now, id);
    } else if (action === 'unpublish' || action === 'archive') {
      db.prepare('UPDATE investments SET state=?,published=NULL,publishedAt=NULL,version=version+1,updatedAt=? WHERE id=?').run(action === 'archive' ? 'archived' : 'draft', now, id);
    } else fail(400, 'Unknown investment action.');
    audit(db, actorId, `investment.${action}`, id, { title: row.title, previousState: row.state });
    return db.prepare('SELECT * FROM investments WHERE id=?').get(id);
  });
}
export const publicInvestments = db => db.prepare("SELECT published,publishedAt FROM investments WHERE state='published' AND published IS NOT NULL ORDER BY publishedAt DESC,id DESC").all().map(row => ({ ...JSON.parse(row.published), publishedAt: row.publishedAt }));
