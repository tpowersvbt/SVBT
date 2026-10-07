import 'dotenv/config';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { dataPaths } from './paths.js';

// Safe while the site is running: VACUUM INTO writes a consistent snapshot of the database.
// Statement PDFs and uploaded files are copied next to it. Nothing is overwritten or deleted.
export function backup(paths = dataPaths(), outRoot) {
  if (!existsSync(paths.dbPath)) throw new Error(`No database at ${paths.dbPath}. Nothing was backed up.`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = resolve(outRoot || join(paths.dataDir || dirname(paths.dbPath), 'backups'), `svbt-${stamp}`);
  if (existsSync(target)) throw new Error(`${target} already exists. Nothing was backed up.`);
  mkdirSync(target, { recursive: true });
  const dbFile = join(target, 'bank.sqlite');
  const source = new DatabaseSync(paths.dbPath);
  try { source.exec(`VACUUM INTO '${dbFile.replaceAll("'", "''")}'`); } finally { source.close(); }
  const copy = new DatabaseSync(dbFile, { readOnly: true });
  let summary;
  try {
    const check = copy.prepare('PRAGMA integrity_check').get();
    if (Object.values(check)[0] !== 'ok') throw new Error('The backup copy failed its integrity check.');
    const count = table => copy.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
    summary = { users: count('users'), transactions: count('transactions'), statements: count('statements') };
  } finally { copy.close(); }
  for (const [name, dir] of [['statements', paths.statementDir], ['uploads', paths.uploadDir]]) {
    if (existsSync(dir)) cpSync(dir, join(target, name), { recursive: true, force: false, errorOnExist: true });
  }
  return { target, ...summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const outIndex = process.argv.indexOf('--out');
    const result = backup(dataPaths(), outIndex === -1 ? undefined : process.argv[outIndex + 1]);
    console.log(`Backup complete: ${result.target}`);
    console.log(`Contains ${result.users} user(s), ${result.transactions} transaction(s), ${result.statements} issued statement(s), plus statement and upload files.`);
  } catch (error) {
    console.error(`Backup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
