import 'dotenv/config';
import { initializeLeadership, leadership, updateLeadership } from './leadership.js';
import { initializeProjects, saveProject, publishProject, publicProjects } from './projects.js';
import { renderStatement } from './pdf.js';
import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase, seedDemo, hashPassword, verifyPassword, atomic, audit, newAccount } from './db.js';
import { root, dataPaths } from './paths.js';
import { ROLE_LABELS, capabilities, isActive, isEmployee, requireCapability } from './permissions.js';
import { email, passwordLink, describeToken, usePasswordToken, listEmployees, createEmployee, updateEmployee, employeeResetLink, listCustomers, createCustomer, updateCustomer, customerResetLink, settings, saveSettings, statementFiles, uploadStatementFile, readStatementFile } from './accounts.js';
import { listDisclosures, saveDisclosure, publishDisclosure, disclosureVersions, publicDisclosures } from './disclosures.js';
import { emailConfigured, sendPasswordLink } from './mailer.js';
import { digest, fail, text, accountData, postTransaction, reverseTransaction, preview, archive, statement, integrity, issueStatement, saveInvestment, setInvestmentState, publicInvestments } from './services.js';

let authenticationActive = 0;
async function authenticate(operation, res) {
  if (authenticationActive >= 2) {
    res.set('Retry-After', '1');
    fail(429, 'Authentication capacity is busy. Try again later.');
  }
  authenticationActive++;
  try { return await operation(); } finally { authenticationActive--; }
}

// Settings that used to recreate the seller login on every start. They are ignored now.
export const OBSOLETE_ENV = ['MODERATOR_EMAIL', 'MODERATOR_PASSWORD', 'MODERATOR_RESET', 'MODERATOR_NAME', 'MODERATOR_ADDRESS', 'DEMO_MODERATOR_EMAIL', 'DEMO_MODERATOR_PASSWORD'];

export function configuration(options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const origin = options.origin ?? process.env.APP_ORIGIN ?? (production ? '' : 'http://localhost:3000');
  let parsed;
  try { parsed = new URL(origin); } catch { throw new Error('APP_ORIGIN must be an explicit valid origin.'); }
  if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol) || (production && parsed.protocol !== 'https:')) throw new Error('APP_ORIGIN must be an exact origin, HTTPS in production.');
  const sampleData = options.sampleData ?? process.env.SAMPLE_DATA === 'true';
  const demoSeed = options.demoSeed ?? (process.env.DEMO_SEED === undefined ? !production : process.env.DEMO_SEED === 'true');
  if (production && demoSeed) throw new Error('Demonstration seeding is forbidden in production.');
  const authRateLimit = options.authRateLimit ?? 30;
  if (!Number.isSafeInteger(authRateLimit) || authRateLimit < 1) throw new Error('authRateLimit must be a positive integer.');
  const paths = dataPaths(process.env, { dbPath: options.dbPath, statementDir: options.statementDir, uploadDir: options.uploadDir });
  return { production, origin, demoSeed, sampleData, authRateLimit, frontend: options.frontend ?? true, ...paths, trustProxy: options.trustProxy ?? process.env.TRUST_PROXY === 'true', dev: options.dev ?? false, env: options.env ?? process.env };
}

function publicUser(user) { return user ? { id: user.id, name: user.name, email: user.email, role: user.role, roleLabel: ROLE_LABELS[user.role], capabilities: capabilities(user) } : null; }

function password(value, registration = false) {
  if (typeof value !== 'string' || value.length > 1024 || value.length < (registration ? 12 : 1)) fail(400, registration ? 'Password must contain 12–1024 characters.' : 'Password is required.');
  return value;
}

function identifier(value) { if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) fail(400, 'Invalid record identifier.'); return Number(value); }

const sendPdf = (res, filename, pdf) => res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` }).send(Buffer.from(pdf));

export async function createApp(options = {}) {
  const config = configuration(options);
  const db = openDatabase(config.dbPath);
  initializeProjects(db);
  initializeLeadership(db);
  let vite;
  try {
    if (config.production && !config.sampleData && db.prepare("SELECT value FROM metadata WHERE key='demo-seeded'").get()) {
      throw new Error('A demo-seeded database requires SAMPLE_DATA=true for operations review.');
    }
    const obsolete = OBSOLETE_ENV.filter(name => config.env[name]);
    if (obsolete.length) console.warn(`Ignoring obsolete settings: ${obsolete.join(', ')}. Staff accounts are managed in Administration; these can be deleted.`);
    if (config.production && !config.dataDir) console.warn('DATA_DIR is not set. Data is stored inside the app folder, which the host may erase on redeploy. Set DATA_DIR=/var/data on a persistent disk.');
    if (config.demoSeed || config.sampleData) {
      // Sample data never creates or changes a staff login in production, and never changes an existing user's role.
      await seedDemo(db, config.sampleData ? { customerPassword: randomBytes(48).toString('hex') } : {});
      const accountId = Number(db.prepare("SELECT value FROM metadata WHERE key='demo-seeded'").get().value);
      const actor = db.prepare("SELECT id FROM users WHERE role IN ('owner','admin','moderator') AND active=1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, id LIMIT 1").get()?.id ?? null;
      for (const month of ['2026-06', '2026-07', '2026-08', '2026-09']) {
        if (!db.prepare('SELECT id FROM statements WHERE accountId=? AND month=?').get(accountId, month)) {
          await issueStatement(db, accountId, month, actor, config.statementDir);
        }
      }
    }
    const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
    const app = express();
    app.disable('x-powered-by');
    if (config.trustProxy) app.set('trust proxy', 1);
    app.use((req, res, next) => {
      res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
      if (config.production) res.set({ 'Strict-Transport-Security': 'max-age=31536000', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" });
      next();
    });
    app.use('/api', (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      const requestOrigin = req.get('origin');
      if (requestOrigin && requestOrigin !== config.origin) return next(Object.assign(new Error('Request origin is not allowed.'), { status: 403 }));
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && requestOrigin !== config.origin) return next(Object.assign(new Error('An exact matching Origin is required for write requests.'), { status: 403 }));
      if (req.get('sec-fetch-site') === 'cross-site') return next(Object.assign(new Error('Cross-site requests are forbidden.'), { status: 403 }));
      next();
    });
    app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
    // Statement PDF uploads are the only large request bodies (base64, up to 10 MB of PDF).
    app.use('/api/admin/accounts/:id/files', express.json({ limit: '15mb', strict: true }));
    app.use('/api', express.json({ limit: '16kb', strict: true }));
    const cookieName = 'svbt_session';
    function makeSession(req, res, userId) {
      const token = randomBytes(32).toString('base64url'), csrfToken = randomBytes(32).toString('base64url');
      atomic(db, () => {
        if (req.session) db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(req.session.tokenHash);
        db.prepare('DELETE FROM sessions WHERE expiresAt<=?').run(Date.now());
        db.prepare('INSERT INTO sessions(tokenHash,userId,csrfToken,expiresAt) VALUES (?,?,?,?)').run(digest(token), userId ?? null, csrfToken, Date.now() + 8 * 60 * 60 * 1000);
      });
      res.cookie(cookieName, token, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 8 * 60 * 60 * 1000 });
      req.session = { tokenHash: digest(token), userId, csrfToken };
      return csrfToken;
    }
    app.use('/api', (req, res, next) => {
      const tokens = (req.get('cookie') || '').split(';').map(item => item.trim()).filter(item => item.startsWith(`${cookieName}=`));
      const token = tokens.length === 1 ? tokens[0].slice(cookieName.length + 1) : '';
      if (/^[A-Za-z0-9_-]{43}$/.test(token)) req.session = db.prepare('SELECT * FROM sessions WHERE tokenHash=? AND expiresAt>?').get(digest(token), Date.now());
      req.user = req.session?.userId ? db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId) : null;
      if (req.user && !isActive(req.user)) req.user = null; // deactivated people are treated as signed out
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const provided = req.get('x-csrf-token') || '', expected = req.session?.csrfToken || '';
        if (!expected || Buffer.byteLength(provided) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return next(Object.assign(new Error('A valid session CSRF token is required.'), { status: 403 }));
        if (!req.is('application/json')) return next(Object.assign(new Error('Write requests require application/json.'), { status: 415 }));
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return next(Object.assign(new Error('A JSON object is required.'), { status: 400 }));
      }
      next();
    });
    const auth = (req, res, next) => req.user ? next() : next(Object.assign(new Error('Sign in to access this resource.'), { status: 401 }));
    const employee = (req, res, next) => !req.user ? next(Object.assign(new Error('Sign in to access operations.'), { status: 401 })) : isEmployee(req.user) ? next() : next(Object.assign(new Error('You do not have permission for this action.'), { status: 403 }));
    const [customersCap, investmentsCap, contentCap, disclosuresCap, employeesCap, settingsCap, auditCap] = ['customers', 'investments', 'content', 'disclosures', 'employees', 'settings', 'audit'].map(requireCapability);
    app.get('/api/session', (req, res) => res.json({ user: publicUser(req.user), csrfToken: req.session?.csrfToken || makeSession(req, res, null) }));
    const attempts = new Map();
    const limiter = (req, res, next) => {
      const key = req.ip, now = Date.now();
      for (const [ip, value] of attempts) if (value.until <= now) attempts.delete(ip);
      const current = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
      if ((!attempts.has(key) && attempts.size >= 10000) || current.count >= config.authRateLimit) { res.set('Retry-After', String(Math.max(1, Math.ceil((current.until - now) / 1000)))); return next(Object.assign(new Error('Too many authentication attempts. Try again later.'), { status: 429 })); }
      current.count++;
      attempts.set(key, current); next();
    };
    app.post('/api/register', limiter, async (req, res) => {
      if (!settings(db).registrationOpen) fail(403, 'Online registration is currently closed.');
      const values = req.body, userEmail = email(values.email), name = text(values.name, 'Name', 200), address = text(values.address, 'Address', 500);
      // Public registration can only ever create customers. Privileged roles are rejected outright.
      if (Object.hasOwn(values, 'role') && values.role !== 'customer') fail(400, 'Registration can only create customers.');
      if (db.prepare('SELECT id FROM users WHERE email=?').get(userEmail)) fail(409, 'This email address is already registered.');
      const secret = password(values.password, true);
      const passwordHash = await authenticate(() => hashPassword(secret), res);
      const id = atomic(db, () => {
        if (db.prepare('SELECT id FROM users WHERE email=?').get(userEmail)) fail(409, 'This email address is already registered.');
        const userId = Number(db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(userEmail, name, address, 'customer', passwordHash).lastInsertRowid);
        const accountId = newAccount(db, userId, name, address);
        audit(db, userId, 'user.register', accountId);
        return userId;
      });
      res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)), csrfToken: makeSession(req, res, id) });
    });
    app.post('/api/login', limiter, async (req, res) => {
      const userEmail = email(req.body.email), secret = password(req.body.password);
      const user = db.prepare('SELECT * FROM users WHERE email=?').get(userEmail);
      const verified = await authenticate(() => verifyPassword(secret, user?.passwordHash || dummyHash), res);
      if (!user || !verified || !isActive(user)) fail(401, 'Email or password is incorrect.');
      audit(db, user.id, 'session.login', user.id);
      res.json({ user: publicUser(user), csrfToken: makeSession(req, res, user.id) });
    });
    app.post('/api/logout', (req, res) => {
      if (req.user) audit(db, req.user.id, 'session.logout', req.user.id);
      res.json({ user: null, csrfToken: makeSession(req, res, null) });
    });
    // Single-use password setup/reset links created in Administration.
    app.post('/api/password/describe', limiter, (req, res) => res.json(describeToken(db, req.body.token)));
    app.post('/api/password/set', limiter, async (req, res) => {
      describeToken(db, req.body.token);
      const secret = password(req.body.password, true);
      const passwordHash = await authenticate(() => hashPassword(secret), res);
      usePasswordToken(db, req.body.token, passwordHash);
      res.json({ ok: true, message: 'Password saved. You can now sign in.' });
    });
    app.get('/api/profile', auth, (req, res) => res.json({ ...publicUser(req.user), address: req.user.address }));
    app.patch('/api/profile', auth, limiter, async (req, res) => {
      const name = text(req.body.name, 'Name', 200), address = text(req.body.address, 'Address', 500);
      const secret = password(req.body.password);
      if (!await authenticate(() => verifyPassword(secret, req.user.passwordHash), res)) fail(401, 'Current password verification failed.');
      atomic(db, () => {
        db.prepare('UPDATE users SET name=?,address=? WHERE id=?').run(name, address, req.user.id);
        db.prepare('UPDATE accounts SET name=?,address=? WHERE userId=?').run(name, address, req.user.id);
        audit(db, req.user.id, 'profile.update', req.user.id, { name, address });
      });
      res.json({ ...publicUser(req.user), name, address });
    });
    // Customers only ever see their own account; the id always comes from the session, never from the request.
    const ownAccountId = req => {
      const row = db.prepare('SELECT id FROM accounts WHERE userId=?').get(req.user.id);
      if (!row) fail(404, 'No customer account is associated with this user.');
      return row.id;
    };
    const ownStatementAccount = req => {
      if (req.user.role !== 'customer') fail(403, 'Statement downloads here are for customers.');
      if (!settings(db).customerStatements) fail(403, 'Online statements are not available yet.');
      return ownAccountId(req);
    };
    app.get('/api/account', auth, (req, res) => res.json({ ...accountData(db, ownAccountId(req)), notice: settings(db).customerNotice }));
    app.get('/api/account/statements', auth, (req, res) => {
      const accountId = ownStatementAccount(req);
      res.json({ issued: archive(db, accountId), files: statementFiles(db, accountId).filter(file => file.current) });
    });
    app.get('/api/account/statements/:id/pdf', auth, (req, res) => {
      const accountId = ownStatementAccount(req), id = identifier(req.params.id);
      const row = db.prepare('SELECT * FROM statements WHERE id=? AND accountId=?').get(id, accountId);
      if (!row) fail(404, 'Issued statement not found.');
      if (!integrity(db, id, config.statementDir).valid) fail(409, 'Issued statement integrity failed. PDF download is blocked.');
      sendPdf(res, `statement-${row.month}-r${row.revision}.pdf`, row.pdf);
    });
    app.get('/api/account/files/:id/pdf', auth, (req, res) => {
      const accountId = ownStatementAccount(req), id = identifier(req.params.id);
      const current = statementFiles(db, accountId).find(file => file.id === id && file.current);
      if (!current) fail(404, 'Statement file not found.');
      const { row, pdf } = readStatementFile(db, id, config.uploadDir);
      sendPdf(res, row.filename, pdf);
    });
    // Public, published-only content.
    app.get('/api/site', (req, res) => res.json({ registrationOpen: settings(db).registrationOpen }));
    app.get('/api/leadership', (req, res) => res.json(leadership(db).published));
    app.get('/api/projects', (req, res) => res.json(publicProjects(db)));
    app.get('/api/investments', (req, res) => res.json(publicInvestments(db)));
    app.get('/api/disclosures', (req, res) => res.json(publicDisclosures(db)));

    // ---- Operations / Administration. Every route below needs an active employee plus the named capability.
    app.use('/api/admin', employee);
    app.get('/api/admin/leadership', contentCap, (req, res) => res.json(leadership(db)));
    app.put('/api/admin/leadership', contentCap, (req, res) => res.json(updateLeadership(db, req.body, req.user.id)));
    app.post('/api/admin/leadership/publish', contentCap, (req, res) => res.json(updateLeadership(db, req.body, req.user.id, true)));
    app.get('/api/admin/projects', contentCap, (req, res) => res.json(db.prepare('SELECT * FROM projects ORDER BY updatedAt DESC,id DESC').all()));
    app.post('/api/admin/projects', contentCap, (req, res) => res.status(201).json(saveProject(db, null, req.body, req.user.id)));
    app.put('/api/admin/projects/:id', contentCap, (req, res) => res.json(saveProject(db, identifier(req.params.id), req.body, req.user.id)));
    app.post('/api/admin/projects/:id/publish', contentCap, (req, res) => res.json(publishProject(db, identifier(req.params.id), req.body.version, true, req.user.id)));
    app.post('/api/admin/projects/:id/unpublish', contentCap, (req, res) => res.json(publishProject(db, identifier(req.params.id), req.body.version, false, req.user.id)));

    app.get('/api/admin/accounts', customersCap, (req, res) => res.json(db.prepare('SELECT * FROM accounts ORDER BY id').all()));
    app.get('/api/admin/accounts/:id', customersCap, (req, res) => res.json(accountData(db, identifier(req.params.id))));
    app.post('/api/admin/accounts/:id/transactions', customersCap, (req, res) => res.status(201).json(postTransaction(db, identifier(req.params.id), req.body, req.user.id)));
    app.post('/api/admin/transactions/:id/reverse', customersCap, (req, res) => res.status(201).json(reverseTransaction(db, identifier(req.params.id), req.body, req.user.id)));
    app.get('/api/admin/accounts/:id/preview', customersCap, (req, res) => res.json(preview(db, identifier(req.params.id), req.query.month)));
    app.get('/api/admin/accounts/:id/statements', customersCap, (req, res) => res.json(archive(db, identifier(req.params.id))));
    app.post('/api/admin/accounts/:id/statements', customersCap, async (req, res) => res.status(201).json(await issueStatement(db, identifier(req.params.id), req.body.month, req.user.id, config.statementDir)));
    app.get('/api/admin/statements/:id/integrity', customersCap, (req, res) => res.json(integrity(db, identifier(req.params.id), config.statementDir)));
    app.get('/api/admin/statements/:id/branded-pdf', customersCap, async (req, res) => {
      const id = identifier(req.params.id), row = statement(db, id);
      if (!integrity(db, id, config.statementDir).valid) fail(409, 'Issued statement integrity failed. PDF download is blocked.');
      sendPdf(res, `business-checking-${row.month}-r${row.revision}-branded.pdf`, await renderStatement(JSON.parse(row.snapshot), { brandedCopy: true }));
    });
    app.get('/api/admin/statements/:id/pdf', customersCap, (req, res) => {
      const id = identifier(req.params.id), row = statement(db, id);
      if (!integrity(db, id, config.statementDir).valid) fail(409, 'Issued statement integrity failed. PDF download is blocked.');
      sendPdf(res, `business-checking-${row.month}-r${row.revision}.pdf`, row.pdf);
    });
    app.get('/api/admin/accounts/:id/files', customersCap, (req, res) => res.json(statementFiles(db, identifier(req.params.id))));
    app.post('/api/admin/accounts/:id/files', customersCap, (req, res) => res.status(201).json(uploadStatementFile(db, req.user, identifier(req.params.id), req.body, config.uploadDir)));
    app.get('/api/admin/files/:id/pdf', customersCap, (req, res) => { const { row, pdf } = readStatementFile(db, identifier(req.params.id), config.uploadDir); sendPdf(res, row.filename, pdf); });

    // Password links are emailed when an email provider is configured; otherwise they are returned for the administrator to share.
    async function deliver(user, issued) {
      const link = passwordLink(config.origin, issued.token);
      const emailed = await sendPasswordLink({ to: user.email, name: user.name, link, purpose: issued.purpose, expiresAt: issued.expiresAt }, config.env);
      return { purpose: issued.purpose, expiresAt: issued.expiresAt, emailed, ...(emailed ? {} : { link }) };
    }
    const userById = id => db.prepare('SELECT * FROM users WHERE id=?').get(id);
    app.get('/api/admin/customers', customersCap, (req, res) => res.json(listCustomers(db)));
    app.post('/api/admin/customers', customersCap, async (req, res) => { const { customer, ...issued } = createCustomer(db, req.user, req.body); res.status(201).json({ customer, ...await deliver(customer, issued) }); });
    app.patch('/api/admin/customers/:id', customersCap, (req, res) => res.json(updateCustomer(db, req.user, identifier(req.params.id), req.body)));
    app.post('/api/admin/customers/:id/password-link', customersCap, async (req, res) => { const id = identifier(req.params.id); res.json(await deliver(userById(id), customerResetLink(db, req.user, id))); });
    app.get('/api/admin/employees', employeesCap, (req, res) => res.json({ employees: listEmployees(db), emailConfigured: emailConfigured(config.env) }));
    app.post('/api/admin/employees', employeesCap, async (req, res) => { const { employee: created, ...issued } = createEmployee(db, req.user, req.body); res.status(201).json({ employee: created, ...await deliver(created, issued) }); });
    app.patch('/api/admin/employees/:id', employeesCap, (req, res) => res.json(updateEmployee(db, req.user, identifier(req.params.id), req.body)));
    app.post('/api/admin/employees/:id/password-link', employeesCap, async (req, res) => { const id = identifier(req.params.id); res.json(await deliver(userById(id), employeeResetLink(db, req.user, id))); });
    app.get('/api/admin/settings', customersCap, (req, res) => res.json({ ...settings(db), emailConfigured: emailConfigured(config.env) }));
    app.put('/api/admin/settings', settingsCap, (req, res) => res.json(saveSettings(db, req.user, req.body)));

    app.get('/api/admin/investments', investmentsCap, (req, res) => res.json(db.prepare('SELECT * FROM investments ORDER BY id').all()));
    app.post('/api/admin/investments', investmentsCap, (req, res) => res.status(201).json(saveInvestment(db, null, req.body, req.user.id)));
    app.put('/api/admin/investments/:id', investmentsCap, (req, res) => res.json(saveInvestment(db, identifier(req.params.id), req.body, req.user.id)));
    for (const action of ['publish', 'unpublish', 'archive']) app.post(`/api/admin/investments/:id/${action}`, investmentsCap, (req, res) => res.json(setInvestmentState(db, identifier(req.params.id), action, req.user.id)));

    app.get('/api/admin/disclosures', disclosuresCap, (req, res) => res.json(listDisclosures(db)));
    app.post('/api/admin/disclosures', disclosuresCap, (req, res) => res.status(201).json(saveDisclosure(db, null, req.body, req.user.id)));
    app.put('/api/admin/disclosures/:id', disclosuresCap, (req, res) => res.json(saveDisclosure(db, identifier(req.params.id), req.body, req.user.id)));
    app.post('/api/admin/disclosures/:id/publish', disclosuresCap, (req, res) => res.json(publishDisclosure(db, identifier(req.params.id), req.body.version, true, req.user.id)));
    app.post('/api/admin/disclosures/:id/unpublish', disclosuresCap, (req, res) => res.json(publishDisclosure(db, identifier(req.params.id), req.body.version, false, req.user.id)));
    app.get('/api/admin/disclosures/:id/versions', disclosuresCap, (req, res) => res.json(disclosureVersions(db, identifier(req.params.id))));

    app.get('/api/admin/audit', auditCap, (req, res) => res.json(db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 1000').all().map(row => ({ ...row, details: JSON.parse(row.details) }))));
    app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
    if (config.frontend && config.dev) {
      const { createServer } = await import('vite');
      vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
      app.use(vite.middlewares);
    } else if (config.frontend) {
      app.use(express.static(resolve(root, 'dist'), { index: false }));
      app.get('/{*path}', (req, res, next) => res.sendFile(resolve(root, 'dist/index.html'), error => error && next(error)));
    }
    app.use((error, req, res, next) => {
      if (res.headersSent) return next(error);
      const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
      if (status >= 500) console.error(error);
      res.status(status).json({ error: status >= 500 ? 'The operation could not be completed. Please try again.' : error.type === 'entity.parse.failed' ? 'Malformed JSON request.' : error.type === 'entity.too.large' ? 'The upload is too large.' : error.message });
    });
    const close = async () => { if (vite) await vite.close(); db.close(); };
    app.locals.db = db; app.locals.config = config; app.locals.close = close;
    return app;
  } catch (error) { if (vite) await vite.close(); db.close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = await createApp({ dev: process.argv.includes('--dev') });
  const server = app.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log(`SVBT listening at ${app.locals.config.origin}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(async () => { await app.locals.close(); process.exit(0); }));
}
