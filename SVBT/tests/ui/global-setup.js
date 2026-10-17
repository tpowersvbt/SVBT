import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/index.js';
import { seedTestLedger, promoteFixtureOwner, fixtureModerator } from '../fixtures.js';

export default async function globalSetup() {
  const appRoot = fileURLToPath(new URL('../..', import.meta.url));
  const dbPath = resolve(appRoot, '.tools/ui-test.sqlite');
  const statementDir = resolve(appRoot, '.tools/ui-statements');
  const origin = 'http://localhost:3005';

  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(statementDir, { recursive: true, force: true });

  const app = await createApp({ production: false, origin, dbPath, statementDir, frontend: false });
  try {
    await seedTestLedger(app.locals.db, statementDir);
    promoteFixtureOwner(app.locals.db, fixtureModerator[0]);
  } finally {
    await app.locals.close();
  }
}
