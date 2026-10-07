import { atomic, audit } from './db.js';
import { fail, text } from './services.js';

// Disclosures are written as private drafts. Publishing copies the draft into a public snapshot
// and into disclosure_versions, which can never be edited or deleted (full version history).
function body(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 20000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail(400, 'Disclosure text must be between 1 and 20000 characters.');
  return value.trim();
}
function current(db, id, version) {
  const row = db.prepare('SELECT * FROM disclosures WHERE id=?').get(id);
  if (!row) fail(404, 'Disclosure not found.');
  if (!Number.isSafeInteger(version) || row.version !== version) fail(409, 'This disclosure changed. Reload it before saving or publishing.');
  return row;
}
export const listDisclosures = db => db.prepare('SELECT d.*, (SELECT COUNT(*) FROM disclosure_versions v WHERE v.disclosureId=d.id) AS publishedVersions FROM disclosures d ORDER BY d.id').all();
export function saveDisclosure(db, id, values, actorId) {
  const title = text(values.title, 'Title', 150), content = body(values.body);
  return atomic(db, () => {
    const now = new Date().toISOString();
    if (id) {
      current(db, id, values.version);
      db.prepare('UPDATE disclosures SET title=?,body=?,version=version+1,updatedAt=?,actorId=? WHERE id=?').run(title, content, now, actorId, id);
    } else id = Number(db.prepare('INSERT INTO disclosures(title,body,updatedAt,actorId) VALUES (?,?,?,?)').run(title, content, now, actorId).lastInsertRowid);
    audit(db, actorId, 'disclosure.save', id, { title });
    return db.prepare('SELECT * FROM disclosures WHERE id=?').get(id);
  });
}
export function publishDisclosure(db, id, version, publish, actorId) {
  return atomic(db, () => {
    const row = current(db, id, version), now = new Date().toISOString();
    if (publish) {
      db.prepare('INSERT INTO disclosure_versions(disclosureId,title,body,publishedAt,actorId) VALUES (?,?,?,?,?)').run(id, row.title, row.body, now, actorId);
      db.prepare('UPDATE disclosures SET published=?,publishedAt=?,version=version+1,updatedAt=?,actorId=? WHERE id=?').run(JSON.stringify({ id, title: row.title, body: row.body }), now, now, actorId, id);
    } else db.prepare('UPDATE disclosures SET published=NULL,publishedAt=NULL,version=version+1,updatedAt=?,actorId=? WHERE id=?').run(now, actorId, id);
    audit(db, actorId, publish ? 'disclosure.publish' : 'disclosure.unpublish', id, { title: row.title });
    return db.prepare('SELECT * FROM disclosures WHERE id=?').get(id);
  });
}
export function disclosureVersions(db, id) {
  if (!db.prepare('SELECT id FROM disclosures WHERE id=?').get(id)) fail(404, 'Disclosure not found.');
  return db.prepare('SELECT * FROM disclosure_versions WHERE disclosureId=? ORDER BY id DESC').all(id);
}
export const publicDisclosures = db => db.prepare('SELECT published,publishedAt FROM disclosures WHERE published IS NOT NULL ORDER BY id').all().map(row => ({ ...JSON.parse(row.published), publishedAt: row.publishedAt }));
