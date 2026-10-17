import { hashPassword, newAccount, audit } from '../server/db.js';
import { issueStatement } from '../server/services.js';
import { provisionHandoverOwner } from '../server/administration.js';

export const fixtureCustomer = ['sales@bakhtiariautogroup.com', 'FounderClient!2026'];
export const fixtureModerator = ['tpower@siliconvalleybankandtrust.com', 'ModeratorGod!2026'];

export async function seedTestLedger(db, statementDir) {
  const customerPasswordHash = await hashPassword(fixtureCustomer[1]);
  const moderatorPasswordHash = await hashPassword(fixtureModerator[1]);
  const customerId = Number(db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(fixtureCustomer[0], 'Example Customer, LLC', '3155 Stevens Creek, San Jose, CA 95117', 'customer', customerPasswordHash).lastInsertRowid);
  const moderatorId = Number(db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(fixtureModerator[0], 'Example Staff Member', 'Silicon Valley, California', 'moderator', moderatorPasswordHash).lastInsertRowid);
  const accountId = newAccount(db, customerId, 'Example Customer, LLC', '3155 Stevens Creek, San Jose, CA 95117');
  const descriptions = ['Cloud infrastructure', 'Software subscriptions', 'Office rent', 'Internet and communications', 'Business insurance', 'Accounting services', 'Digital marketing', 'Contract engineering', 'Office supplies', 'Security monitoring', 'Technology hardware', 'Business travel'];
  const base = [65000, 32000, 180000, 18000, 28000, 45000, 50000, 60000, 12000, 22000, 35000, 29700];
  const insert = db.prepare('INSERT INTO transactions(accountId,date,description,amount,actorId) VALUES (?,?,?,?,?)');
  for (let m = 0; m < 4; m++) {
    const month = `2026-${String(m + 6).padStart(2, '0')}`;
    insert.run(accountId, `${month}-02`, m ? 'Opening deposit' : 'Initial deposit', m ? 1500000 : 1000000, moderatorId);
    descriptions.forEach((description, i) => insert.run(accountId, `${month}-${String(i + 3).padStart(2, '0')}`, description, -(base[i] + (i === 11 ? m * 11700 : 0)), moderatorId));
  }
  for (const [sector, capital, strategy] of [['Startup technologies', 250000000, 'Milestone-based capital and runway planning'], ['Small data centers', 500000000, 'Capacity, cooling and energy resilience'], ['REITs', 350000000, 'Diversified property cash-flow review']]) db.prepare('INSERT INTO investments(sector,status,targetCapital,risk,strategy) VALUES (?,?,?,?,?)').run(sector, 'Review', capital, 'Capital at risk', strategy);
  audit(db, moderatorId, 'test.fixture.seed', accountId, { months: 4 });
  for (let m = 6; m <= 9; m++) await issueStatement(db, accountId, `2026-${String(m).padStart(2, '0')}`, moderatorId, statementDir);
  return { customerId, moderatorId, accountId };
}

export function promoteFixtureOwner(db, email) {
  if (email) provisionHandoverOwner(db, email);
}
