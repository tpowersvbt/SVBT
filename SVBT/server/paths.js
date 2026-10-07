import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// One place decides where persistent data lives.
// DATA_DIR (e.g. /var/data on a Render persistent disk) holds bank.sqlite, statements/ and uploads/.
// When DATA_DIR is set it wins, so an old DB_PATH/STATEMENT_DIR left in the Render dashboard cannot point at temporary storage.
// Without DATA_DIR, DB_PATH / STATEMENT_DIR / UPLOAD_DIR still work as before.
// With nothing set, the original in-repo locations are used, so behaviour is unchanged until the env is set.
export function dataPaths(env = process.env, overrides = {}) {
  const dataDir = env.DATA_DIR ? resolve(env.DATA_DIR) : null;
  const pick = (override, variable, inData, legacy) => override ?? resolve(dataDir ? join(dataDir, inData) : (env[variable] || join(root, legacy)));
  return {
    dataDir,
    dbPath: overrides.dbPath ?? pick(undefined, 'DB_PATH', 'bank.sqlite', 'data/bank.sqlite'),
    statementDir: resolve(pick(overrides.statementDir, 'STATEMENT_DIR', 'statements', 'monthly/statements')),
    uploadDir: resolve(pick(overrides.uploadDir, 'UPLOAD_DIR', 'uploads', 'monthly/uploads'))
  };
}
