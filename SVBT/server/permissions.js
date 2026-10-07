// Central permission rules. Every server route and every frontend gate uses these capabilities.
export const ROLES = ['customer', 'staff', 'moderator', 'admin', 'owner'];
export const EMPLOYEE_ROLES = ['staff', 'moderator', 'admin', 'owner'];
export const ROLE_LABELS = { customer: 'Customer', staff: 'Staff', moderator: 'Moderator', admin: 'Administrator', owner: 'Owner' };

const GRANTS = {
  owner: ['customers', 'investments', 'content', 'disclosures', 'employees', 'owners', 'settings', 'audit'],
  admin: ['customers', 'investments', 'content', 'disclosures', 'employees', 'settings', 'audit'],
  moderator: ['customers', 'investments', 'content', 'audit'],
  staff: ['customers'],
  customer: []
};

const deny = (status, message) => { const error = new Error(message); error.status = status; throw error; };
export const isActive = user => !!user && user.active !== 0;
export const capabilities = user => isActive(user) ? [...(GRANTS[user.role] || [])] : [];
export const can = (user, capability) => capabilities(user).includes(capability);
export const isEmployee = user => isActive(user) && EMPLOYEE_ROLES.includes(user.role);
export const canManageCustomers = user => can(user, 'customers');
export const canManageInvestments = user => can(user, 'investments');
export const canManageContent = user => can(user, 'content');
export const canManageDisclosures = user => can(user, 'disclosures');
export const canManageEmployees = user => can(user, 'employees');
export const canManageOwners = user => can(user, 'owners');
export const canManageSettings = user => can(user, 'settings');
export const canViewAudit = user => can(user, 'audit');

// Express middleware factory: 401 when signed out, 403 when the capability is missing.
export function requireCapability(capability) {
  return (req, res, next) => {
    if (!req.user) return next(Object.assign(new Error('Sign in to access this resource.'), { status: 401 }));
    if (!can(req.user, capability)) return next(Object.assign(new Error('You do not have permission for this action.'), { status: 403 }));
    next();
  };
}

export const activeOwnerCount = db => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='owner' AND active=1").get().n;

// Owners may manage anyone. Admins manage staff and moderators only: they cannot grant owner/admin
// or change/deactivate owners and admins. Nobody can remove the last active owner or change themselves.
export function assertCanManageEmployee(db, actor, target, { role, active } = {}) {
  if (!canManageEmployees(actor)) deny(403, 'You do not have permission to manage employees.');
  if (!target || !EMPLOYEE_ROLES.includes(target.role)) deny(404, 'Employee not found.');
  if (role !== undefined && !EMPLOYEE_ROLES.includes(role)) deny(400, 'Choose a valid employee role.');
  const privileged = r => r === 'owner' || r === 'admin';
  if (!canManageOwners(actor) && (privileged(target.role) || privileged(role))) deny(403, 'Only an owner can appoint, change or remove owners and administrators.');
  if (target.id === actor.id && ((role !== undefined && role !== target.role) || active === false)) deny(400, 'You cannot change your own role or deactivate yourself. Ask another owner.');
  const losesOwner = target.role === 'owner' && target.active === 1 && ((role !== undefined && role !== 'owner') || active === false);
  if (losesOwner && activeOwnerCount(db) <= 1) deny(409, 'This is the last active owner. Appoint another owner first.');
}

export function assertCanAssignNewEmployee(actor, role) {
  if (!canManageEmployees(actor)) deny(403, 'You do not have permission to manage employees.');
  if (!EMPLOYEE_ROLES.includes(role)) deny(400, 'Choose a valid employee role.');
  if ((role === 'owner' || role === 'admin') && !canManageOwners(actor)) deny(403, 'Only an owner can appoint owners and administrators.');
}
