import { atomic, audit } from './db.js';
import { fail, text } from './services.js';

export const settingDefaults = {
  bannerText: 'Independent local demonstration. Not a live bank.',
  bannerImage: '',
  footerText: 'A perspective for the next economy.',
  footerImage: '',
  heroTitle: 'Built for what comes next.',
  heroSubtitle: 'Ambitious ideas deserve a thoughtful financial foundation. Explore a banking experience shaped around the people building tomorrow.',
  heroImage: '/svbt-facade.jpg'
};
const limits = { bannerText: 200, bannerImage: 500, footerText: 300, footerImage: 500, heroTitle: 120, heroSubtitle: 400, heroImage: 500 };
const optional = new Set(['bannerImage', 'footerImage', 'heroImage']);
const settingKeys = Object.keys(settingDefaults);

function imageUrl(value, name) {
  if (typeof value !== 'string' || value.length > 500 || /[\x00-\x20\x7f"'<>\\]/.test(value)) fail(400, `${name} must be a valid URL.`);
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  let parsed;
  try { parsed = new URL(value); } catch { fail(400, `${name} must be an https:// URL or a path starting with /.`); }
  if (parsed.protocol !== 'https:') fail(400, `${name} must be an https:// URL or a path starting with /.`);
  return value;
}
export function getSettings(db) {
  let row = db.prepare('SELECT * FROM site_settings WHERE id=1').get();
  if (!row) {
    const legacy = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, r.value]));
    const values = Object.fromEntries(settingKeys.map(key => [key, Object.hasOwn(legacy, key) ? legacy[key] : settingDefaults[key]]));
    db.prepare(`INSERT INTO site_settings(id,${settingKeys.join(',')}) VALUES (1,${settingKeys.map(() => '?').join(',')})`).run(...settingKeys.map(key => values[key]));
    row = db.prepare('SELECT * FROM site_settings WHERE id=1').get();
  }
  return Object.fromEntries(settingKeys.map(key => [key, row[key]]));
}
export function saveSettings(db, values, actorId) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) fail(400, 'Provide site settings as an object.');
  const keys = Object.keys(values);
  if (!keys.length || keys.some(k => !Object.hasOwn(settingDefaults, k))) fail(400, 'Provide one or more known site settings.');
  const clean = {};
  for (const key of keys) {
    const value = values[key];
    if (optional.has(key) && value === '') clean[key] = '';
    else if (optional.has(key)) clean[key] = imageUrl(value, `${key} URL`);
    else clean[key] = text(value, key, limits[key]);
  }
  const updated = { ...getSettings(db), ...clean };
  atomic(db, () => {
    db.prepare(`INSERT INTO site_settings(id,${settingKeys.join(',')}) VALUES (1,${settingKeys.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${settingKeys.map(key => `${key}=excluded.${key}`).join(',')}`).run(...settingKeys.map(key => updated[key]));
    audit(db, actorId, 'site.update', 'site', { keys });
  });
  return updated;
}
function ensureTeamMembers(db) {
  if (db.prepare("SELECT value FROM metadata WHERE key='team-members-migrated'").get()) return;
  atomic(db, () => {
    if (db.prepare("SELECT value FROM metadata WHERE key='team-members-migrated'").get()) return;
    db.exec(`INSERT INTO team_members(id,name,title,photoUrl,bio,displayOrder)
      SELECT e.id,e.name,e.title,e.photoUrl,e.bio,e.displayOrder FROM employees e
      WHERE NOT EXISTS (SELECT 1 FROM team_members t WHERE t.id=e.id);`);
    db.prepare("INSERT INTO metadata(key,value) VALUES ('team-members-migrated','1')").run();
  });
}
export function listTeamMembers(db) {
  ensureTeamMembers(db);
  return db.prepare('SELECT id,name,title,photoUrl,bio,displayOrder FROM team_members ORDER BY displayOrder,id').all();
}
export const listEmployees = listTeamMembers;
function teamMemberValues(values) {
  const order = values.displayOrder === undefined || values.displayOrder === '' ? 0 : values.displayOrder;
  if (!Number.isInteger(order) || order < -100000 || order > 100000) fail(400, 'Display order must be an integer.');
  return { name: text(values.name, 'Name', 120), title: text(values.title, 'Title', 160), photoUrl: values.photoUrl ? imageUrl(values.photoUrl, 'Photo URL') : '', bio: text(values.bio, 'Bio', 2000), displayOrder: order };
}
export function saveTeamMember(db, id, values, actorId) {
  ensureTeamMembers(db);
  if (!values || typeof values !== 'object' || Array.isArray(values)) fail(400, 'Provide team member details as an object.');
  const v = teamMemberValues(values);
  return atomic(db, () => {
    let teamMemberId = id;
    if (id === null) teamMemberId = Number(db.prepare('INSERT INTO team_members(name,title,photoUrl,bio,displayOrder) VALUES (?,?,?,?,?)').run(v.name, v.title, v.photoUrl, v.bio, v.displayOrder).lastInsertRowid);
    else if (!db.prepare('UPDATE team_members SET name=?,title=?,photoUrl=?,bio=?,displayOrder=? WHERE id=?').run(v.name, v.title, v.photoUrl, v.bio, v.displayOrder, id).changes) fail(404, 'Team member not found.');
    audit(db, actorId, id === null ? 'team.add' : 'team.update', teamMemberId, { name: v.name });
    return db.prepare('SELECT id,name,title,photoUrl,bio,displayOrder FROM team_members WHERE id=?').get(teamMemberId);
  });
}
export const saveEmployee = saveTeamMember;
export function removeTeamMember(db, id, actorId) {
  ensureTeamMembers(db);
  atomic(db, () => {
    const row = db.prepare('SELECT name FROM team_members WHERE id=?').get(id);
    if (!row) fail(404, 'Team member not found.');
    db.prepare('DELETE FROM team_members WHERE id=?').run(id);
    audit(db, actorId, 'team.remove', id, { name: row.name });
  });
}
export const removeEmployee = removeTeamMember;
