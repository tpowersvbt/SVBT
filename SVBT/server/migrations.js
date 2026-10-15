// Versioned schema changes. The CREATE TABLE IF NOT EXISTS statements in db.js and the
// initialize* functions describe the original schema; editing them does not change a database
// that already exists. Every later change to tables, columns, indexes or triggers goes here as a
// new entry with the next version number, and is never edited after it has been deployed.
// The applied version is kept in SQLite's PRAGMA user_version.
export const migrations = [
  { version: 1, name: 'baseline', up() {} },
  {
    version: 2,
    name: 'ledger-value-guards',
    up(db) {
      // The API already validates these; the triggers stop any other writer (a script, a shell
      // session, a future code path) from recording an entry the statement logic cannot read.
      db.exec(`CREATE TRIGGER IF NOT EXISTS valid_transaction_date BEFORE INSERT ON transactions
          WHEN typeof(NEW.date)!='text' OR NEW.date IS NOT date(NEW.date) OR NEW.date<'1900-01-01'
          BEGIN SELECT RAISE(ABORT,'Invalid ledger date'); END;
        CREATE TRIGGER IF NOT EXISTS valid_statement_closing BEFORE INSERT ON statements
          WHEN typeof(NEW.closing)!='integer'
          BEGIN SELECT RAISE(ABORT,'Statement closing balance must be integer cents'); END;`);
      const invalid = db.prepare("SELECT count(*) n FROM transactions WHERE typeof(date)!='text' OR date IS NOT date(date) OR date<'1900-01-01'").get().n;
      if (invalid) console.warn(`Ledger check: ${invalid} existing transaction(s) have an invalid date. They were left unchanged.`);
    }
  }
];

export const schemaVersion = migrations.at(-1).version;

export function migrate(db, list = migrations) {
  const latest = list.at(-1).version;
  const applied = () => db.prepare('PRAGMA user_version').get().user_version;
  if (applied() > latest) {
    console.warn(`Database schema version ${applied()} is newer than this code (${latest}). No migrations were run.`);
    return applied();
  }
  for (const migration of list) {
    if (migration.version <= applied()) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      // Another process may have applied it while this one waited for the write lock.
      if (migration.version > applied()) {
        migration.up(db);
        db.exec(`PRAGMA user_version=${Number(migration.version)}`);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Schema migration ${migration.version} (${migration.name}) failed: ${error.message}`, { cause: error });
    }
  }
  return applied();
}
