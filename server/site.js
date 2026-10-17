import { atomic, audit } from './db.js';
import { fail, text } from './services.js';

export const settingDefaults = {
  bannerText: 'Independent local demonstration. Not a live bank.',
  bannerImage: '',
  footerText: 'A perspective for the next economy.',
  heroTitle: 'Built for what comes next.',
  heroSubtitle: 'Ambitious ideas deserve a thoughtful financial foundation. Explore a banking experience shaped around the people building tomorrow.'
};
const limits = { bannerText: 200, bannerImage: 500, footerText: 300, heroTitle: 120, heroSubtitle: 400 };
const optional = new Set(['bannerImage']);

function imageUrl(value, name) {
  if (typeof value !== 'string' || value.length > 500 || /[\x00-\x20\x7f"'<>\\]/.test(value)) fail(400, `${name} must be a valid URL.`);
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  let parsed;
  try { parsed = new URL(value); } catch { fail(400, `${name} must be an https:// URL or a path starting with /.`); }
  if (parsed.protocol !== 'https:') fail(400, `${name} must be an https:// URL or a path starting with /.`);
  return value;
}
export function getSettings(db) {
  const stored = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, r.value]));
  return Object.fromEntries(Object.keys(settingDefaults).map(k => [k, Object.hasOwn(stored, k) ? stored[k] : settingDefaults[k]]));
}
export function saveSettings(db, values, actorId) {
  const keys = Object.keys(values);
  if (!keys.length || keys.some(k => !Object.hasOwn(settingDefaults, k))) fail(400, 'Provide one or more known site settings.');
  const clean = {};
  for (const key of keys) {
    const value = values[key];
    if (optional.has(key) && value === '') clean[key] = '';
    else clean[key] = key === 'bannerImage' ? imageUrl(value, 'Banner image') : text(value, key, limits[key]);
  }
  atomic(db, () => {
    const put = db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    for (const [k, v] of Object.entries(clean)) put.run(k, v);
    audit(db, actorId, 'settings.save', 'site', { keys });
  });
  return getSettings(db);
}
export function listEmployees(db) { return db.prepare('SELECT id,name,title,photoUrl,bio,displayOrder FROM employees ORDER BY displayOrder,id').all(); }
function employeeValues(values) {
  const order = values.displayOrder === undefined || values.displayOrder === '' ? 0 : values.displayOrder;
  if (!Number.isInteger(order) || order < -100000 || order > 100000) fail(400, 'Display order must be an integer.');
  return { name: text(values.name, 'Name', 120), title: text(values.title, 'Title', 160), photoUrl: values.photoUrl ? imageUrl(values.photoUrl, 'Photo URL') : '', bio: text(values.bio, 'Bio', 2000), displayOrder: order };
}
export function saveEmployee(db, id, values, actorId) {
  const v = employeeValues(values);
  return atomic(db, () => {
    let employeeId = id;
    if (id === null) employeeId = Number(db.prepare('INSERT INTO employees(name,title,photoUrl,bio,displayOrder) VALUES (?,?,?,?,?)').run(v.name, v.title, v.photoUrl, v.bio, v.displayOrder).lastInsertRowid);
    else if (!db.prepare('UPDATE employees SET name=?,title=?,photoUrl=?,bio=?,displayOrder=? WHERE id=?').run(v.name, v.title, v.photoUrl, v.bio, v.displayOrder, id).changes) fail(404, 'Employee not found.');
    audit(db, actorId, id === null ? 'employee.add' : 'employee.update', employeeId, { name: v.name });
    return db.prepare('SELECT id,name,title,photoUrl,bio,displayOrder FROM employees WHERE id=?').get(employeeId);
  });
}
export function removeEmployee(db, id, actorId) {
  atomic(db, () => {
    const row = db.prepare('SELECT name FROM employees WHERE id=?').get(id);
    if (!row) fail(404, 'Employee not found.');
    db.prepare('DELETE FROM employees WHERE id=?').run(id);
    audit(db, actorId, 'employee.remove', id, { name: row.name });
  });
}
