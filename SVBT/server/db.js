import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const derive = promisify(scrypt);
const USERS_TABLE = "CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, address TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('customer','staff','moderator','admin','owner')), passwordHash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)))";
// Marker for accounts whose password has not been set yet (invited employees). It can never verify.
export const NO_PASSWORD = '!unset';
// Development/test fixture logins only. createApp refuses demo seeding in production.
export const demoCredentials = { customer: [process.env.DEMO_CUSTOMER_EMAIL || 'sales@bakhtiariautogroup.com', process.env.DEMO_CUSTOMER_PASSWORD || 'FounderClient!2026'], moderator: ['tpower@siliconvalleybankandtrust.com', 'ModeratorGod!2026'] };
export async function hashPassword(password) {
  const salt = randomBytes(32).toString('hex');
  const hash = await derive(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return `scrypt$131072$8$1$${salt}$${hash.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, salt, hex] = String(encoded || '').split('$');
  if (algorithm !== 'scrypt' || n !== '131072' || r !== '8' || p !== '1' || !/^[a-f0-9]{128}$/.test(hex || '')) return false;
  const actual = await derive(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(hex, 'hex'));
}
export function atomic(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = operation(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function audit(db, actorId, action, entity, details = {}) {
  db.prepare('INSERT INTO audit(actorId, action, entity, details) VALUES (?, ?, ?, ?)').run(actorId ?? null, action, String(entity), JSON.stringify(details));
}
export function newAccount(db, userId, name, address) {
  let number;
  do { number = String(randomInt(100000, 1000000)) + String(randomInt(0, 1000000)).padStart(6, '0'); } while (db.prepare('SELECT id FROM accounts WHERE number = ?').get(number));
  return Number(db.prepare('INSERT INTO accounts(userId, number, name, address) VALUES (?, ?, ?, ?)').run(userId, number, name, address).lastInsertRowid);
}
export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    ${USERS_TABLE.replace('CREATE TABLE users(', 'CREATE TABLE IF NOT EXISTS users(')};
    CREATE TABLE IF NOT EXISTS accounts(id INTEGER PRIMARY KEY, userId INTEGER NOT NULL UNIQUE REFERENCES users(id), number TEXT NOT NULL UNIQUE CHECK(length(number)=12 AND number NOT GLOB '*[^0-9]*'), name TEXT NOT NULL, address TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY, accountId INTEGER NOT NULL REFERENCES accounts(id), date TEXT NOT NULL, description TEXT NOT NULL, amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount != 0 AND abs(amount)<=100000000000), reversalOf INTEGER UNIQUE REFERENCES transactions(id), actorId INTEGER REFERENCES users(id), createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS sessions(tokenHash TEXT PRIMARY KEY, userId INTEGER REFERENCES users(id), csrfToken TEXT NOT NULL, expiresAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS statements(id INTEGER PRIMARY KEY, accountId INTEGER NOT NULL REFERENCES accounts(id), month TEXT NOT NULL, revision INTEGER NOT NULL, issuedAt TEXT NOT NULL, closing INTEGER NOT NULL, snapshot TEXT NOT NULL, hash TEXT NOT NULL, pdf BLOB NOT NULL, pdfHash TEXT NOT NULL, archivePath TEXT NOT NULL, UNIQUE(accountId,month,revision));
    CREATE TABLE IF NOT EXISTS investments(id INTEGER PRIMARY KEY, sector TEXT NOT NULL, status TEXT NOT NULL, targetCapital INTEGER NOT NULL CHECK(typeof(targetCapital)='integer' AND targetCapital>=0 AND targetCapital<=100000000000), risk TEXT NOT NULL, strategy TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actorId INTEGER REFERENCES users(id), action TEXT NOT NULL, entity TEXT NOT NULL, details TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS valid_reversal BEFORE INSERT ON transactions WHEN NEW.reversalOf IS NOT NULL BEGIN
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM transactions WHERE id=NEW.reversalOf AND accountId=NEW.accountId AND amount=-NEW.amount AND reversalOf IS NULL AND date<=NEW.date) THEN RAISE(ABORT,'Invalid reversal') END;
    END;
  `);
  migrateUsers(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_tokens(tokenHash TEXT PRIMARY KEY, userId INTEGER NOT NULL REFERENCES users(id), purpose TEXT NOT NULL CHECK(purpose IN ('setup','reset')), expiresAt INTEGER NOT NULL, usedAt INTEGER, createdBy INTEGER REFERENCES users(id), createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), actorId INTEGER REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS statement_files(id INTEGER PRIMARY KEY, accountId INTEGER NOT NULL REFERENCES accounts(id), month TEXT NOT NULL, title TEXT NOT NULL, filename TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, path TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', supersedes INTEGER UNIQUE REFERENCES statement_files(id), uploadedBy INTEGER REFERENCES users(id), uploadedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS disclosures(id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, published TEXT, publishedAt TEXT, updatedAt TEXT NOT NULL, actorId INTEGER REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS disclosure_versions(id INTEGER PRIMARY KEY, disclosureId INTEGER NOT NULL REFERENCES disclosures(id), title TEXT NOT NULL, body TEXT NOT NULL, publishedAt TEXT NOT NULL, actorId INTEGER REFERENCES users(id));
  `);
  for (const table of ['transactions', 'statements', 'audit', 'statement_files', 'disclosure_versions']) {
    for (const operation of ['UPDATE', 'DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS immutable_${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable ${table}'); END;`);
  }
  migrateInvestments(db);
  return db;
}
const tableSql = (db, name) => db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name)?.sql || '';
const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
// Rebuilds the users table when its CHECK constraint predates the owner/admin/staff roles.
// Follows SQLite's documented 12-step table rebuild: rows, ids, password hashes and foreign keys are preserved.
// Idempotent: a database that already has the new schema is left untouched.
export function migrateUsers(db) {
  const current = tableSql(db, 'users');
  if (current.includes("'owner'") && columns(db, 'users').includes('active')) return false;
  const existing = columns(db, 'users');
  const copy = ['id', 'email', 'name', 'address', 'role', 'passwordHash', ...(existing.includes('active') ? ['active'] : [])].join(',');
  const extras = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='users' AND type IN ('index','trigger') AND sql IS NOT NULL").all().map(row => row.sql);
  const before = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(USERS_TABLE.replace('CREATE TABLE users(', 'CREATE TABLE users_migrating('));
      db.exec(`INSERT INTO users_migrating(${copy}) SELECT ${copy} FROM users`);
      db.exec('DROP TABLE users');
      db.exec('ALTER TABLE users_migrating RENAME TO users');
      for (const sql of extras) db.exec(sql);
      if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n !== before) throw new Error('User migration row count mismatch.');
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('User migration foreign key check failed.');
      if (tableSql(db, 'audit')) audit(db, null, 'schema.users-roles', 'users', { rowsPreserved: before, roles: ['customer', 'staff', 'moderator', 'admin', 'owner'] });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.exec('PRAGMA foreign_keys=ON'); }
  const integrity = db.prepare('PRAGMA integrity_check').get();
  if (Object.values(integrity)[0] !== 'ok') throw new Error('Database integrity check failed after user migration.');
  return true;
}
// Adds publishing fields to investments. Existing records are kept as private drafts.
function migrateInvestments(db) {
  const present = columns(db, 'investments');
  const add = { kind: "TEXT NOT NULL DEFAULT 'other'", title: "TEXT NOT NULL DEFAULT ''", summary: "TEXT NOT NULL DEFAULT ''", publicDescription: "TEXT NOT NULL DEFAULT ''", privateNotes: "TEXT NOT NULL DEFAULT ''", state: "TEXT NOT NULL DEFAULT 'draft'", published: 'TEXT', publishedAt: 'TEXT', version: 'INTEGER NOT NULL DEFAULT 1', updatedAt: 'TEXT' };
  const missing = Object.keys(add).filter(name => !present.includes(name));
  if (!missing.length) return;
  atomic(db, () => {
    for (const name of missing) db.exec(`ALTER TABLE investments ADD COLUMN ${name} ${add[name]}`);
    if (missing.includes('kind')) {
      for (const [sector, kind] of [['REITs', 'reit'], ['Small data centers', 'data-center'], ['Startup technologies', 'startup'], ['New home builders', 'land-development']]) db.prepare("UPDATE investments SET kind=? WHERE sector=? AND kind='other'").run(kind, sector);
    }
  });
}
export async function seedDemo(db, { moderatorId, customerPassword, withStaff = !moderatorId && !customerPassword } = {}) {
  if (db.prepare("SELECT value FROM metadata WHERE key='demo-seeded'").get()) return;
  const customerHash = await hashPassword(customerPassword || demoCredentials.customer[1]);
  const moderatorHash = withStaff ? await hashPassword(demoCredentials.moderator[1]) : null;
  atomic(db, () => {
    if (db.prepare("SELECT value FROM metadata WHERE key='demo-seeded'").get()) return;
    function accountUser(email, name, address, role, hash) {
      const existing = db.prepare('SELECT id,role FROM users WHERE email=?').get(email);
      if (existing) {
        // Never change an existing user's role (owners/admins are never downgraded by sample setup).
        const compatible = role === 'customer' ? existing.role === 'customer' : existing.role !== 'customer';
        if (!compatible) throw new Error('Sample account email belongs to a different role.');
        return existing.id;
      }
      return Number(db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(email, name, address, role, hash).lastInsertRowid);
    }
    const customer = accountUser(demoCredentials.customer[0], 'Bakhtiari Auto Group, LLC', '3155 Stevens Creek, San Jose, CA 95117', 'customer', customerHash);
    // Development/test fixtures only (demo seeding is refused in production). Production sample data creates no staff login.
    const moderator = moderatorId || (withStaff ? accountUser(demoCredentials.moderator[0], 'Timothy Powers', 'Silicon Valley, California', 'moderator', moderatorHash) : null);
    const existingAccount = db.prepare('SELECT id FROM accounts WHERE userId=?').get(customer);
    const accountId = existingAccount?.id || newAccount(db, customer, 'Bakhtiari Auto Group, LLC', '3155 Stevens Creek, San Jose, CA 95117');
    if (db.prepare('SELECT id FROM transactions WHERE accountId=?').get(accountId)) throw new Error('Existing ledger has activity; sample data was not added.');
    const descriptions = ['Cloud infrastructure', 'Software subscriptions', 'Office rent', 'Internet and communications', 'Business insurance', 'Accounting services', 'Digital marketing', 'Contract engineering', 'Office supplies', 'Security monitoring', 'Technology hardware', 'Business travel'];
    const base = [65000, 32000, 180000, 18000, 28000, 45000, 50000, 60000, 12000, 22000, 35000, 29700];
    const insert = db.prepare('INSERT INTO transactions(accountId,date,description,amount,actorId) VALUES (?,?,?,?,?)');
    for (let m = 0; m < 4; m++) {
      const month = `2026-${String(m + 6).padStart(2, '0')}`;
      insert.run(accountId, `${month}-02`, m ? 'Investment funding from Bakhtiari Corp. Wells Fargo Account' : 'Opening deposit', m ? 1500000 : 1000000, moderator);
      descriptions.forEach((description, i) => insert.run(accountId, `${month}-${String(i + 3).padStart(2, '0')}`, description, -(base[i] + (i === 11 ? m * 11700 : 0)), moderator));
    }
    for (const [kind, sector, capital, strategy] of [['startup', 'Startup technologies', 250000000, 'Milestone-based capital and runway planning'], ['data-center', 'Small data centers', 500000000, 'Capacity, cooling and energy resilience'], ['reit', 'REITs', 350000000, 'Diversified property cash-flow review']]) db.prepare('INSERT INTO investments(kind,sector,status,targetCapital,risk,strategy) VALUES (?,?,?,?,?,?)').run(kind, sector, 'Review', capital, 'Capital at risk', strategy);
    audit(db, moderator, 'demo.seed', accountId, { months: 4 });
    db.prepare("INSERT INTO metadata(key,value) VALUES ('demo-seeded',?)").run(String(accountId));
  });
}
