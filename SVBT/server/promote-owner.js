import 'dotenv/config';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase, atomic, audit } from './db.js';
import { dataPaths } from './paths.js';
import { maskEmail, signOutUser } from './accounts.js';

// One-time ownership handoff: makes an EXISTING user an owner.
// Never creates users, never touches passwords, keeps the same user id and every linked record.
// Running it again on an owner changes nothing.
export function promoteOwner(db, rawEmail) {
  const wanted = String(rawEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wanted)) throw new Error('Provide a valid email address with --email.');
  return atomic(db, () => {
    const matches = db.prepare('SELECT id,email,role,active FROM users WHERE lower(trim(email))=?').all(wanted);
    if (matches.length === 0) throw new Error('No user has that email address. Nothing was changed. Register or sign in once with that email first.');
    if (matches.length > 1) throw new Error('More than one user matches that email address. Nothing was changed.');
    const [user] = matches;
    if (user.role === 'owner' && user.active === 1) return { changed: false, id: user.id, email: maskEmail(user.email), previousRole: 'owner', sessionsEnded: 0 };
    db.prepare("UPDATE users SET role='owner', active=1 WHERE id=?").run(user.id);
    const sessionsEnded = signOutUser(db, user.id);
    audit(db, null, 'user.promote-owner', user.id, { previousRole: user.role, previouslyActive: user.active === 1, via: 'promote-owner command', sessionsEnded });
    return { changed: true, id: user.id, email: maskEmail(user.email), previousRole: user.role, sessionsEnded };
  });
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) return process.argv[index + 1];
  return process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dbPath = argument('db') ? resolve(argument('db')) : dataPaths().dbPath;
  let db;
  try {
    db = openDatabase(dbPath);
    const result = promoteOwner(db, argument('email'));
    console.log(result.changed
      ? `Done. User #${result.id} (${result.email}) changed from ${result.previousRole} to owner. ${result.sessionsEnded} old session(s) were signed out. Sign in again to see Administration.`
      : `No change needed. User #${result.id} (${result.email}) is already an active owner.`);
    console.log(`Database: ${dbPath}`);
  } catch (error) {
    console.error(`Promotion failed: ${error.message}`);
    process.exitCode = 1;
  } finally { db?.close(); }
}
