import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { atomic, audit, newAccount, NO_PASSWORD } from './db.js';
import { digest, fail, text } from './services.js';
import { EMPLOYEE_ROLES, assertCanManageEmployee, assertCanAssignNewEmployee } from './permissions.js';

export const TOKEN_HOURS = { setup: 72, reset: 2 };
export function email(value) {
  const normalized = text(value, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) fail(400, 'A valid email address is required.');
  return normalized;
}
export const maskEmail = value => value.replace(/^(.)[^@]*(@.*)$/, '$1***$2');
export const signOutUser = (db, userId) => Number(db.prepare('DELETE FROM sessions WHERE userId=?').run(userId).changes);
const userRow = (db, id) => db.prepare('SELECT * FROM users WHERE id=?').get(id);
const listed = row => ({ id: row.id, email: row.email, name: row.name, role: row.role, active: row.active === 1, passwordSet: row.passwordHash !== NO_PASSWORD });

// ---- Single-use, expiring password setup/reset links. Only a SHA-256 of the token is stored.
export function issuePasswordToken(db, userId, purpose, actorId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + TOKEN_HOURS[purpose] * 3600 * 1000;
  // Issuing a new link cancels earlier unused links for the same person.
  db.prepare('UPDATE password_tokens SET usedAt=? WHERE userId=? AND usedAt IS NULL').run(Date.now(), userId);
  db.prepare('INSERT INTO password_tokens(tokenHash,userId,purpose,expiresAt,createdBy) VALUES (?,?,?,?,?)').run(digest(token), userId, purpose, expiresAt, actorId ?? null);
  audit(db, actorId, `password.${purpose}-link`, userId, { expiresAt: new Date(expiresAt).toISOString() });
  return { token, purpose, expiresAt: new Date(expiresAt).toISOString() };
}
export const passwordLink = (origin, token) => `${origin}/#set-password=${token}`;
function liveToken(db, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail(400, 'This password link is invalid.');
  const row = db.prepare('SELECT * FROM password_tokens WHERE tokenHash=?').get(digest(token));
  if (!row || row.usedAt || row.expiresAt <= Date.now()) fail(410, 'This password link has expired or was already used. Ask an administrator for a new link.');
  const user = userRow(db, row.userId);
  if (!user || user.active !== 1) fail(410, 'This account is not active.');
  return { row, user };
}
export function describeToken(db, token) {
  const { row, user } = liveToken(db, token);
  return { purpose: row.purpose, email: maskEmail(user.email), expiresAt: new Date(row.expiresAt).toISOString() };
}
export function usePasswordToken(db, token, passwordHash) {
  return atomic(db, () => {
    const { row, user } = liveToken(db, token);
    db.prepare('UPDATE password_tokens SET usedAt=? WHERE userId=? AND usedAt IS NULL').run(Date.now(), user.id);
    db.prepare('UPDATE users SET passwordHash=? WHERE id=?').run(passwordHash, user.id);
    const sessions = signOutUser(db, user.id);
    audit(db, user.id, `password.${row.purpose}-complete`, user.id, { sessionsEnded: sessions });
    return user.id;
  });
}

// ---- Employees
export const listEmployees = db => db.prepare(`SELECT * FROM users WHERE role IN (${EMPLOYEE_ROLES.map(() => '?').join(',')}) ORDER BY active DESC, CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END, id`).all(...EMPLOYEE_ROLES).map(listed);
export function createEmployee(db, actor, values) {
  const role = values.role, address = values.address ? text(values.address, 'Address', 500) : 'Employee';
  assertCanAssignNewEmployee(actor, role);
  const userEmail = email(values.email), name = text(values.name, 'Name', 200);
  return atomic(db, () => {
    if (db.prepare('SELECT id FROM users WHERE email=?').get(userEmail)) fail(409, 'This email address is already registered.');
    const id = Number(db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(userEmail, name, address, role, NO_PASSWORD).lastInsertRowid);
    audit(db, actor.id, 'employee.create', id, { email: userEmail, role });
    return { employee: listed(userRow(db, id)), ...issuePasswordToken(db, id, 'setup', actor.id) };
  });
}
export function updateEmployee(db, actor, id, values) {
  return atomic(db, () => {
    const target = userRow(db, id);
    const change = {};
    if (values.role !== undefined) change.role = values.role;
    if (values.active !== undefined) { if (typeof values.active !== 'boolean') fail(400, 'Active must be true or false.'); change.active = values.active; }
    if (values.name !== undefined) change.name = text(values.name, 'Name', 200);
    assertCanManageEmployee(db, actor, target, change);
    const before = { role: target.role, active: target.active === 1, name: target.name };
    db.prepare('UPDATE users SET role=?, active=?, name=? WHERE id=?').run(change.role ?? target.role, change.active === undefined ? target.active : Number(change.active), change.name ?? target.name, id);
    const after = userRow(db, id);
    const privilegesChanged = after.role !== target.role || after.active !== target.active;
    const sessionsEnded = privilegesChanged ? signOutUser(db, id) : 0;
    audit(db, actor.id, 'employee.update', id, { before, after: { role: after.role, active: after.active === 1, name: after.name }, sessionsEnded });
    return listed(after);
  });
}
export function employeeResetLink(db, actor, id) {
  return atomic(db, () => {
    const target = userRow(db, id);
    assertCanManageEmployee(db, actor, target);
    if (target.active !== 1) fail(409, 'Reactivate this employee before sending a password link.');
    return issuePasswordToken(db, id, target.passwordHash === NO_PASSWORD ? 'setup' : 'reset', actor.id);
  });
}

// ---- Customers
export const listCustomers = db => db.prepare(`SELECT u.id,u.email,u.name,u.address,u.active,u.passwordHash,a.id AS accountId,a.number,
  (SELECT COUNT(*) FROM statements s WHERE s.accountId=a.id) AS issuedStatements,
  (SELECT COUNT(*) FROM statement_files f WHERE f.accountId=a.id) AS uploadedStatements
  FROM users u LEFT JOIN accounts a ON a.userId=u.id WHERE u.role='customer' ORDER BY u.id`).all()
  .map(row => ({ ...listed({ ...row, role: 'customer' }), address: row.address, accountId: row.accountId, accountNumber: row.number, issuedStatements: row.issuedStatements, uploadedStatements: row.uploadedStatements }));
function customer(db, id) {
  const row = userRow(db, id);
  if (!row || row.role !== 'customer') fail(404, 'Customer not found.');
  return row;
}
export function createCustomer(db, actor, values) {
  const userEmail = email(values.email), name = text(values.name, 'Name', 200), address = text(values.address, 'Address', 500);
  return atomic(db, () => {
    if (db.prepare('SELECT id FROM users WHERE email=?').get(userEmail)) fail(409, 'This email address is already registered.');
    const id = Number(db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(userEmail, name, address, 'customer', NO_PASSWORD).lastInsertRowid);
    const accountId = newAccount(db, id, name, address);
    audit(db, actor.id, 'customer.create', id, { email: userEmail, accountId });
    return { customer: listCustomers(db).find(row => row.id === id), ...issuePasswordToken(db, id, 'setup', actor.id) };
  });
}
export function updateCustomer(db, actor, id, values) {
  return atomic(db, () => {
    const target = customer(db, id);
    const name = values.name === undefined ? target.name : text(values.name, 'Name', 200);
    const address = values.address === undefined ? target.address : text(values.address, 'Address', 500);
    if (values.active !== undefined && typeof values.active !== 'boolean') fail(400, 'Active must be true or false.');
    const active = values.active === undefined ? target.active : Number(values.active);
    db.prepare('UPDATE users SET name=?,address=?,active=? WHERE id=?').run(name, address, active, id);
    db.prepare('UPDATE accounts SET name=?,address=? WHERE userId=?').run(name, address, id);
    const sessionsEnded = active !== target.active ? signOutUser(db, id) : 0;
    audit(db, actor.id, 'customer.update', id, { before: { name: target.name, address: target.address, active: target.active === 1 }, after: { name, address, active: active === 1 }, sessionsEnded });
    return listCustomers(db).find(row => row.id === id);
  });
}
export function customerResetLink(db, actor, id) {
  return atomic(db, () => {
    const target = customer(db, id);
    if (target.active !== 1) fail(409, 'Reactivate this customer before sending a password link.');
    return issuePasswordToken(db, id, target.passwordHash === NO_PASSWORD ? 'setup' : 'reset', actor.id);
  });
}

// ---- Settings (registration and customer-facing content)
export const SETTING_DEFAULTS = { registrationOpen: true, customerStatements: false, customerNotice: '' };
export function settings(db) {
  const result = { ...SETTING_DEFAULTS };
  for (const row of db.prepare('SELECT key,value FROM settings').all()) if (Object.hasOwn(SETTING_DEFAULTS, row.key)) result[row.key] = JSON.parse(row.value);
  return result;
}
export function saveSettings(db, actor, values) {
  const next = settings(db);
  for (const key of ['registrationOpen', 'customerStatements']) if (values[key] !== undefined) { if (typeof values[key] !== 'boolean') fail(400, `${key} must be true or false.`); next[key] = values[key]; }
  if (values.customerNotice !== undefined) {
    if (typeof values.customerNotice !== 'string' || values.customerNotice.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(values.customerNotice)) fail(400, 'Customer notice must be at most 2000 characters.');
    next.customerNotice = values.customerNotice.trim();
  }
  return atomic(db, () => {
    const before = settings(db);
    for (const key of Object.keys(SETTING_DEFAULTS)) db.prepare('INSERT INTO settings(key,value,actorId) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, actorId=excluded.actorId, updatedAt=excluded.updatedAt').run(key, JSON.stringify(next[key]), actor.id);
    audit(db, actor.id, 'settings.update', 'settings', { before, after: next });
    return settings(db);
  });
}

// ---- Uploaded statement files. Files are never overwritten: a correction is a new version that supersedes the old one.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export function statementFiles(db, accountId) {
  const rows = db.prepare('SELECT id,accountId,month,title,filename,size,sha256,note,supersedes,uploadedBy,uploadedAt FROM statement_files WHERE accountId=? ORDER BY month DESC,id DESC').all(accountId);
  const replaced = new Set(rows.map(row => row.supersedes).filter(Boolean));
  return rows.map(row => ({ ...row, current: !replaced.has(row.id) }));
}
export function uploadStatementFile(db, actor, accountId, values, directory) {
  const account = db.prepare('SELECT * FROM accounts WHERE id=?').get(accountId);
  if (!account) fail(404, 'Account not found.');
  if (typeof values.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(values.month)) fail(400, 'A valid statement month (YYYY-MM) is required.');
  const title = text(values.title, 'Title', 150);
  const note = values.note ? text(values.note, 'Correction note', 500) : '';
  if (typeof values.contentBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(values.contentBase64)) fail(400, 'Attach a PDF file.');
  const pdf = Buffer.from(values.contentBase64, 'base64');
  if (!pdf.length || pdf.length > MAX_UPLOAD_BYTES) fail(413, 'PDF must be smaller than 10 MB.');
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') fail(400, 'Only PDF files can be uploaded.');
  const supersedes = values.supersedes == null ? null : Number(values.supersedes);
  if (supersedes !== null) {
    const prior = db.prepare('SELECT * FROM statement_files WHERE id=? AND accountId=?').get(supersedes, accountId);
    if (!prior) fail(404, 'The statement being corrected was not found for this account.');
    if (db.prepare('SELECT id FROM statement_files WHERE supersedes=?').get(supersedes)) fail(409, 'That statement already has a newer version. Correct the latest version instead.');
    if (!note) fail(400, 'Explain the correction in the correction note.');
  }
  const sha256 = digest(pdf), safeName = basename(String(values.filename || 'statement.pdf')).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'statement.pdf';
  const folder = join(directory, account.number);
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `${values.month}-${Date.now()}-${sha256.slice(0, 12)}.pdf`);
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(temporary, pdf, { flag: 'wx', mode: 0o600 });
  try {
    return atomic(db, () => {
      const id = Number(db.prepare('INSERT INTO statement_files(accountId,month,title,filename,size,sha256,path,note,supersedes,uploadedBy) VALUES (?,?,?,?,?,?,?,?,?,?)').run(accountId, values.month, title, safeName, pdf.length, sha256, path, note, supersedes, actor.id).lastInsertRowid);
      audit(db, actor.id, supersedes ? 'statement-file.correct' : 'statement-file.upload', id, { accountId, month: values.month, sha256, size: pdf.length, supersedes, note });
      renameSync(temporary, path);
      return statementFiles(db, accountId).find(row => row.id === id);
    });
  } catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
}
export function readStatementFile(db, id, directory) {
  const row = db.prepare('SELECT * FROM statement_files WHERE id=?').get(id);
  if (!row) fail(404, 'Statement file not found.');
  const candidates = [row.path, join(directory, basename(join(row.path, '..')), basename(row.path))];
  const found = candidates.find(path => existsSync(path));
  if (!found) fail(409, 'The stored statement file is missing. Restore it from backup.');
  const pdf = readFileSync(found);
  if (digest(pdf) !== row.sha256) fail(409, 'Statement file integrity check failed. Download is blocked.');
  return { row, pdf };
}
