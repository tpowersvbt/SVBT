import { useCallback, useEffect, useState } from 'react';

import { DisclosureText, InvestmentCard, KIND_LABELS } from './Public.jsx';

// Administration screens. The server enforces every permission; the capability checks here only hide controls.
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((value || 0) / 100);
const ROLE_LABELS = { owner: 'Owner', admin: 'Administrator', moderator: 'Moderator', staff: 'Staff' };
const ROLE_HELP = { owner: 'Everything, including appointing owners and administrators.', admin: 'Everything except owners: employees, customers, investments, content, disclosures and settings.', moderator: 'Customers, statements, investments, projects, leadership bio and audit.', staff: 'Customer accounts and statements only.' };

function useAdmin(api, path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => setData(await api(path)), [api, path]);
  useEffect(() => { let active = true; api(path).then(result => active && setData(result)).catch(e => active && setError(e.message)); return () => { active = false; }; }, [api, path]);
  async function perform(task, message) {
    setBusy(true); setError(''); setNotice('');
    try { const result = await task(); if (message) setNotice(message); return result ?? true; } catch (e) { setError(e.message); return false; } finally { setBusy(false); }
  }
  return { data, reload, error, notice, busy, perform, setNotice };
}
const send = (api, path, method, body) => api(path, { method, body: JSON.stringify(body ?? {}) });
function Messages({ error, notice }) { return <>{error && <div className="error" role="alert">{error}</div>}{notice && <p className="success" role="status">{notice}</p>}</>; }

// Shows the outcome of an invitation or password reset. Without an email provider the link is shown once to copy.
function LinkResult({ result, name, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!result) return null;
  const expires = new Date(result.expiresAt).toLocaleString();
  return <div className="project-preview" role="status"><h4>{result.purpose === 'setup' ? 'Account setup link' : 'Password reset link'} for {name}</h4>{result.emailed ? <p>The link was emailed. It works once and expires {expires}.</p> : <><p>Email sending is not set up, so copy this link and send it to the person privately. It works once and expires {expires}. It will not be shown again; create a new link if it is lost.</p><label>Single-use link<input readOnly value={result.link} onFocus={e => e.target.select()} /></label><button className="button small" onClick={async () => { try { await navigator.clipboard.writeText(result.link); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Copied ✓' : 'Copy link'}</button></>}<button className="text-button" onClick={onClose}>Done</button></div>;
}

export function EmployeesAdmin({ api, user }) {
  const { data, reload, error, notice, busy, perform } = useAdmin(api, '/admin/employees');
  const [link, setLink] = useState(null);
  const owner = user.capabilities.includes('owners');
  const assignable = owner ? ['staff', 'moderator', 'admin', 'owner'] : ['staff', 'moderator'];
  const manageable = row => row.id !== user.id && (owner || !['owner', 'admin'].includes(row.role));
  async function invite(e) {
    e.preventDefault(); const form = e.currentTarget, values = Object.fromEntries(new FormData(form));
    const result = await perform(() => send(api, '/admin/employees', 'POST', values), 'Employee added.');
    if (result) { setLink({ name: result.employee.name, result }); form.reset(); await reload(); }
  }
  const update = (row, change, message) => perform(async () => { await send(api, `/admin/employees/${row.id}`, 'PATCH', change); await reload(); }, message);
  const resetLink = row => perform(async () => { const result = await send(api, `/admin/employees/${row.id}/password-link`, 'POST'); setLink({ name: row.name, result }); });
  return <section className="panel"><div className="panel-heading"><h3>Employees</h3><span className="eyebrow">{data ? `${data.employees.filter(e => e.active).length} ACTIVE` : ''}</span></div><p>Invite people by email, choose what they can do, and deactivate access when someone leaves. Changing a role or deactivating someone signs them out everywhere immediately.{!owner && ' Only an owner can appoint or change owners and administrators.'}</p>{data && !data.emailConfigured && <p className="fine-print">Email is not set up. Invitation and reset links will be shown here for you to copy and send privately.</p>}<Messages error={error} notice={notice} /><LinkResult result={link?.result} name={link?.name} onClose={() => setLink(null)} />
    <form className="project-editor" onSubmit={invite}><h4>Invite an employee</h4><label>Full name<input name="name" required maxLength={200} /></label><label>Work email<input name="email" type="email" required maxLength={254} /></label><label>Role<select name="role" defaultValue="staff">{assignable.map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></label><ul className="fine-print">{assignable.map(role => <li key={role}><strong>{ROLE_LABELS[role]}:</strong> {ROLE_HELP[role]}</li>)}</ul><button className="button" disabled={busy}>Add employee and create setup link ↗</button></form>
    {data ? data.employees.map(row => <article className="archive-row" key={row.id}><div><h4>{row.name} <span className="role-badge">{ROLE_LABELS[row.role]}</span>{!row.active && <span className="role-badge">Deactivated</span>}</h4><p>{row.email}{row.id === user.id ? ' · You' : ''}{!row.passwordSet ? ' · Setup not finished' : ''}</p></div><div className="archive-actions">{manageable(row) ? <><label>Change role<select aria-label={`Role for ${row.name}`} value={row.role} disabled={busy} onChange={e => update(row, { role: e.target.value }, `${row.name} is now ${ROLE_LABELS[e.target.value]}. They were signed out.`)}>{(assignable.includes(row.role) ? assignable : [row.role, ...assignable]).map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></label>{row.active ? <button className="text-button" disabled={busy} onClick={() => window.confirm(`Deactivate ${row.name}? They will be signed out and cannot sign in.`) && update(row, { active: false }, `${row.name} was deactivated and signed out.`)}>Deactivate</button> : <button className="text-button" disabled={busy} onClick={() => update(row, { active: true }, `${row.name} was reactivated.`)}>Reactivate</button>}{row.active && <button className="text-button" disabled={busy} onClick={() => resetLink(row)}>{row.passwordSet ? 'Password reset link' : 'New setup link'}</button>}</> : <span className="muted">{row.id === user.id ? 'Your own account' : 'Owner only'}</span>}</div></article>) : !error && <p role="status">Loading employees…</p>}</section>;
}

function readPdf(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Choose a PDF file.'));
    if (file.size > 10 * 1024 * 1024) return reject(new Error('PDF must be smaller than 10 MB.'));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}
export async function downloadPdf(path, filename) {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || 'Unable to download the PDF.'); }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function StatementFiles({ api, customer, onChange }) {
  const path = `/admin/accounts/${customer.accountId}/files`;
  const { data, reload, error, notice, busy, perform } = useAdmin(api, path);
  const [correcting, setCorrecting] = useState(null);
  async function upload(e) {
    e.preventDefault(); const form = e.currentTarget, values = Object.fromEntries(new FormData(form));
    const ok = await perform(async () => {
      const contentBase64 = await readPdf(values.file);
      await send(api, path, 'POST', { month: values.month, title: values.title, note: values.note || undefined, filename: values.file.name, contentBase64, ...(correcting ? { supersedes: correcting.id } : {}) });
      await reload(); onChange();
    }, correcting ? 'Corrected version uploaded. The original is kept in the history.' : 'Statement uploaded.');
    if (ok) { form.reset(); setCorrecting(null); }
  }
  return <div className="project-editor"><h4>Uploaded statements · {customer.name} · {customer.accountNumber}</h4><p className="fine-print">Upload a PDF for a month. To fix a mistake, upload a corrected version: the original is never deleted and stays in the history with your note. Customers only see the latest version, and only when online statements are turned on.</p><Messages error={error} notice={notice} />
    <form onSubmit={upload} key={correcting?.id || 'new'}><h4>{correcting ? `Correct “${correcting.title}” (${correcting.month})` : 'Upload a statement PDF'}</h4><label>Statement month<input name="month" type="month" required defaultValue={correcting?.month || ''} /></label><label>Title<input name="title" required maxLength={150} defaultValue={correcting ? correcting.title : ''} placeholder="e.g. September 2026 statement" /></label><label>PDF file<input name="file" type="file" accept="application/pdf,.pdf" required /></label><label>{correcting ? 'What was corrected (required)' : 'Note (optional)'}<textarea name="note" maxLength={500} rows={2} required={!!correcting} /></label><div className="toolbar"><button className="button small" disabled={busy}>{busy ? 'Uploading…' : correcting ? 'Upload corrected version' : 'Upload statement'}</button>{correcting && <button type="button" className="text-button" onClick={() => setCorrecting(null)}>Cancel correction</button>}</div></form>
    {data ? data.length ? data.map(file => <article className="archive-row" key={file.id}><div><h4>{file.month} · {file.title} <span className="role-badge">{file.current ? 'Current' : 'Replaced'}</span></h4><p>{file.filename} · {(file.size / 1024).toFixed(0)} KB · Uploaded {new Date(file.uploadedAt).toLocaleString()}{file.supersedes ? ` · Corrects file #${file.supersedes}` : ''}</p>{file.note && <p className="fine-print">Note: {file.note}</p>}</div><div className="archive-actions"><button className="text-button" disabled={busy} onClick={() => perform(() => downloadPdf(`/admin/files/${file.id}/pdf`, file.filename))}>Download</button>{file.current && <button className="text-button" disabled={busy} onClick={() => setCorrecting(file)}>Upload correction</button>}</div></article>) : <p>No uploaded statements yet. Issued sample statements are in the Statements tab.</p> : <p role="status">Loading…</p>}</div>;
}

export function CustomersAdmin({ api, user }) {
  const { data, reload, error, notice, busy, perform } = useAdmin(api, '/admin/customers');
  const site = useAdmin(api, '/admin/settings');
  const [link, setLink] = useState(null);
  const [editing, setEditing] = useState(null);
  const [files, setFiles] = useState(null);
  const canSettings = user.capabilities.includes('settings');
  async function create(e) {
    e.preventDefault(); const form = e.currentTarget, values = Object.fromEntries(new FormData(form));
    const result = await perform(() => send(api, '/admin/customers', 'POST', values), 'Customer added with a new account number and a $0.00 balance.');
    if (result) { setLink({ name: result.customer.name, result }); form.reset(); await reload(); }
  }
  async function saveEdit(e) {
    e.preventDefault(); const values = Object.fromEntries(new FormData(e.currentTarget));
    if (await perform(() => send(api, `/admin/customers/${editing.id}`, 'PATCH', values), 'Customer details saved.')) { setEditing(null); await reload(); }
  }
  async function saveSettings(e) {
    e.preventDefault(); const form = new FormData(e.currentTarget);
    await site.perform(async () => { await send(api, '/admin/settings', 'PUT', { registrationOpen: form.get('registrationOpen') === 'on', customerStatements: form.get('customerStatements') === 'on', customerNotice: form.get('customerNotice') }); await site.reload(); }, 'Customer settings saved.');
  }
  const setActive = (row, active) => perform(async () => { await send(api, `/admin/customers/${row.id}`, 'PATCH', { active }); await reload(); }, active ? `${row.name} can sign in again.` : `${row.name} was deactivated and signed out. Their records are kept.`);
  const resetLink = row => perform(async () => { const result = await send(api, `/admin/customers/${row.id}/password-link`, 'POST'); setLink({ name: row.name, result }); });
  const s = site.data;
  return <><section className="panel"><div className="panel-heading"><h3>Customer access and content</h3><span className="eyebrow">{canSettings ? 'EDITABLE' : 'VIEW ONLY'}</span></div><Messages error={site.error} notice={site.notice} />{s && <form key={JSON.stringify(s)} onSubmit={saveSettings}><label className="checkbox"><input type="checkbox" name="registrationOpen" defaultChecked={s.registrationOpen} disabled={!canSettings} /> Allow people to create their own customer workspace online</label><label className="checkbox"><input type="checkbox" name="customerStatements" defaultChecked={s.customerStatements} disabled={!canSettings} /> Let customers view and download their statements</label><label>Notice shown to every signed-in customer (leave empty for none)<textarea name="customerNotice" maxLength={2000} rows={3} defaultValue={s.customerNotice} disabled={!canSettings} /></label>{canSettings && <button className="button small" disabled={site.busy}>Save customer settings</button>}</form>}</section>
    <section className="panel"><div className="panel-heading"><h3>Customers</h3><span className="eyebrow">{data ? `${data.length} PROFILES` : ''}</span></div><p>Each customer gets a unique account number and starts at a $0.00 balance. These are sample review records, not real bank accounts. Deactivating a customer signs them out and keeps every record.</p><Messages error={error} notice={notice} /><LinkResult result={link?.result} name={link?.name} onClose={() => setLink(null)} />
      <form className="project-editor" onSubmit={create}><h4>Add a customer</h4><label>Business / account name<input name="name" required maxLength={200} /></label><label>Email<input name="email" type="email" required maxLength={254} /></label><label>Address<input name="address" required maxLength={500} /></label><button className="button" disabled={busy}>Add customer and create setup link ↗</button></form>
      {editing && <form className="project-editor" onSubmit={saveEdit}><h4>Edit {editing.name}</h4><label>Business / account name<input name="name" required maxLength={200} defaultValue={editing.name} /></label><label>Address<input name="address" required maxLength={500} defaultValue={editing.address} /></label><p className="fine-print">Email: {editing.email} · Account {editing.accountNumber}</p><div className="toolbar"><button className="button small" disabled={busy}>Save details</button><button type="button" className="text-button" onClick={() => setEditing(null)}>Cancel</button></div></form>}
      {files && <StatementFiles api={api} customer={files} onChange={reload} />}
      {data ? data.map(row => <article className="archive-row" key={row.id}><div><h4>{row.name} {!row.active && <span className="role-badge">Deactivated</span>}{!row.passwordSet && <span className="role-badge">Setup not finished</span>}</h4><p>{row.email} · Account {row.accountNumber || '—'}</p><p className="fine-print">{row.address} · {row.issuedStatements} issued sample statement(s) · {row.uploadedStatements} uploaded file(s)</p></div><div className="archive-actions"><button className="text-button" disabled={busy} onClick={() => { setEditing(row); setFiles(null); }}>Edit details</button>{row.accountId && <button className="text-button" disabled={busy} onClick={() => { setFiles(row); setEditing(null); }}>Statement files</button>}{row.active ? <button className="text-button" disabled={busy} onClick={() => window.confirm(`Deactivate ${row.name}? They will be signed out. No records are deleted.`) && setActive(row, false)}>Deactivate</button> : <button className="text-button" disabled={busy} onClick={() => setActive(row, true)}>Reactivate</button>}{row.active && <button className="text-button" disabled={busy} onClick={() => resetLink(row)}>{row.passwordSet ? 'Password reset link' : 'New setup link'}</button>}</div></article>) : !error && <p role="status">Loading customers…</p>}</section></>;
}

const blankInvestment = { kind: 'reit', title: '', summary: '', publicDescription: '', sector: '', status: 'Review', targetCapital: '', risk: 'Capital at risk', strategy: '', privateNotes: '' };
const STATE_LABELS = { draft: 'Private draft', published: 'Published', archived: 'Archived' };
function toCents(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value))) throw new Error('Enter target capital in USD with no more than two decimal places.');
  return Math.round(Number(value) * 100);
}
export function InvestmentsAdmin({ api }) {
  const { data, reload, error, notice, busy, perform } = useAdmin(api, '/admin/investments');
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const field = name => ({ value: editing[name] ?? '', onChange: e => setEditing({ ...editing, [name]: e.target.value }) });
  async function save(e) {
    e.preventDefault();
    const ok = await perform(async () => { const { id, version } = editing; await send(api, `/admin/investments${id ? `/${id}` : ''}`, id ? 'PUT' : 'POST', { ...Object.fromEntries(Object.keys(blankInvestment).map(k => [k, editing[k]])), targetCapital: toCents(editing.targetCapital), ...(id ? { version } : {}) }); await reload(); }, 'Saved as a private draft. Public pages change only when you publish.');
    if (ok) setEditing(null);
  }
  const act = (row, action, message) => perform(async () => { await send(api, `/admin/investments/${row.id}/${action}`, 'POST'); setPreview(null); await reload(); }, message);
  const rows = (data || []).filter(row => showArchived || row.state !== 'archived');
  return <section className="panel"><div className="panel-heading"><h3>Restricted investment records</h3><button className="button small" disabled={busy || !!editing} onClick={() => { setEditing({ ...blankInvestment }); setPreview(null); }}>Create record +</button></div><p>REIT, land-development and data-center records start as private drafts. Private notes and target capital are never shown publicly. Publish only what you want anyone to read; edits stay private until you publish again. Archiving hides a record everywhere but keeps it.</p><p className="fine-print">Internal review records, not investment offers or verified valuations.</p><Messages error={error} notice={notice} />
    {editing && <form className="project-editor" onSubmit={save}><h4>{editing.id ? `Edit record #${editing.id}` : 'New private draft'}</h4><label>Type<select {...field('kind')}>{Object.entries(KIND_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label><label>Public title<input maxLength={150} {...field('title')} /></label><label>Public summary<textarea maxLength={500} rows={2} {...field('summary')} /></label><label>Public description<textarea maxLength={6000} rows={5} {...field('publicDescription')} /></label><label>Risk statement (public)<input required maxLength={200} {...field('risk')} /></label><h4>Private details</h4><label>Internal sector name<input required maxLength={100} list="investment-sectors" {...field('sector')} /></label><datalist id="investment-sectors">{['REITs', 'New home builders', 'Small data centers', 'Startup technologies'].map(v => <option key={v} value={v} />)}</datalist><label>Status<input required maxLength={100} {...field('status')} /></label><label>Target capital · USD (private)<input required type="number" min="0" step="0.01" max="1000000000" {...field('targetCapital')} /></label><label>Strategy (private)<textarea required maxLength={2000} rows={3} {...field('strategy')} /></label><label>Private notes and document links<textarea maxLength={6000} rows={4} {...field('privateNotes')} /></label><div className="toolbar"><button className="button" disabled={busy}>Save private draft</button><button type="button" className="text-button" onClick={() => setEditing(null)}>Cancel editing</button></div></form>}
    {preview && <div className="project-preview"><h4>Public preview</h4><p>Publishing shows exactly this card on the public site. Private notes, strategy and target capital are excluded.</p><InvestmentCard item={{ ...preview, description: preview.publicDescription }} /><div className="toolbar"><button className="button" disabled={busy || !preview.title || !preview.summary} onClick={() => act(preview, 'publish', 'Published on the public site.')}>Publish publicly</button><button className="text-button" onClick={() => setPreview(null)}>Cancel preview</button></div>{(!preview.title || !preview.summary) && <p className="error">Add a public title and summary before publishing.</p>}</div>}
    <label className="checkbox"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived records</label>
    {data ? rows.length ? <div className="investment-grid">{rows.map(row => { const published = row.published ? JSON.parse(row.published) : null; const changed = published && (published.title !== row.title || published.summary !== row.summary || published.description !== row.publicDescription || published.risk !== row.risk || published.kind !== row.kind); return <article className="investment-card" key={row.id}><span className="role-badge">{STATE_LABELS[row.state] || row.state}</span><span className="eyebrow">{(KIND_LABELS[row.kind] || row.kind).toUpperCase()}</span><h3>{row.title || row.sector}</h3><h4>{money(row.targetCapital)}</h4><span className="eyebrow">TARGET CAPITAL · PRIVATE</span><p><strong>Status:</strong> {row.status} · <strong>Risk:</strong> {row.risk}</p><p>{row.summary || row.strategy}</p>{changed && <p className="fine-print">Unpublished changes saved.</p>}{row.privateNotes && <details><summary>Private notes</summary><p className="project-description">{row.privateNotes}</p></details>}<div className="archive-actions"><button className="link-arrow" disabled={busy || !!editing} onClick={() => { setEditing({ ...row, targetCapital: String(row.targetCapital / 100) }); setPreview(null); }}>Edit record ↗</button>{row.state !== 'archived' && <button className="text-button" disabled={busy || !!editing} onClick={() => setPreview(row)}>Preview &amp; publish</button>}{row.state === 'published' && <button className="text-button" disabled={busy} onClick={() => act(row, 'unpublish', 'Unpublished. The record is a private draft again.')}>Unpublish</button>}{row.state !== 'archived' ? <button className="text-button" disabled={busy} onClick={() => window.confirm('Archive this record? It will be hidden everywhere but kept.') && act(row, 'archive', 'Archived. Use Show archived records to find it.')}>Archive</button> : <button className="text-button" disabled={busy} onClick={() => act(row, 'unpublish', 'Restored as a private draft.')}>Restore as draft</button>}</div></article>; })}</div> : <p>No investment records. Create a record to begin.</p> : !error && <p role="status">Loading investment records…</p>}</section>;
}

export function DisclosuresAdmin({ api }) {
  const { data, reload, error, notice, busy, perform } = useAdmin(api, '/admin/disclosures');
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [history, setHistory] = useState(null);
  async function save(e) {
    e.preventDefault();
    const ok = await perform(async () => { await send(api, `/admin/disclosures${editing.id ? `/${editing.id}` : ''}`, editing.id ? 'PUT' : 'POST', { title: editing.title, body: editing.body, ...(editing.id ? { version: editing.version } : {}) }); await reload(); }, 'Draft saved. The public version changes only when you publish.');
    if (ok) setEditing(null);
  }
  const act = (row, action, message) => perform(async () => { await send(api, `/admin/disclosures/${row.id}/${action}`, 'POST', { version: row.version }); setPreview(null); setHistory(null); await reload(); }, message);
  const showHistory = row => perform(async () => setHistory({ row, versions: await api(`/admin/disclosures/${row.id}/versions`) }));
  return <section className="panel"><div className="panel-heading"><h3>Disclosures</h3><button className="button small" disabled={busy || !!editing} onClick={() => { setEditing({ title: '', body: '' }); setPreview(null); }}>New disclosure +</button></div><p>Write disclosures as private drafts, preview them, then publish. Published disclosures appear as links in the footer of every public page and next to public opportunities. Every published version is kept permanently in the history.</p><p className="fine-print">Only publish statements you can stand behind. Do not describe regulatory status, insurance or bank affiliations unless they are true and verified.</p><Messages error={error} notice={notice} />
    {editing && <form className="project-editor" onSubmit={save}><h4>{editing.id ? 'Edit draft' : 'New private draft'}</h4><label>Title<input required maxLength={150} value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} /></label><label>Text (leave a blank line between paragraphs)<textarea required maxLength={20000} rows={10} value={editing.body} onChange={e => setEditing({ ...editing, body: e.target.value })} /></label><div className="toolbar"><button className="button" disabled={busy}>Save private draft</button><button type="button" className="text-button" onClick={() => setEditing(null)}>Cancel editing</button></div></form>}
    {preview && <div className="project-preview"><h4>Public preview</h4><p>Publishing shows exactly this text to everyone and adds it to the version history.</p><DisclosureText disclosure={{ title: preview.title, body: preview.body }} /><div className="toolbar"><button className="button" disabled={busy} onClick={() => act(preview, 'publish', 'Disclosure published.')}>Publish disclosure</button><button className="text-button" onClick={() => setPreview(null)}>Cancel preview</button></div></div>}
    {history && <div className="project-preview"><h4>Published history · {history.row.title}</h4>{history.versions.length ? history.versions.map((v, i) => <details key={v.id} open={i === 0}><summary>{i === 0 ? 'Latest · ' : ''}Published {new Date(v.publishedAt).toLocaleString()}</summary><DisclosureText disclosure={{ title: v.title, body: v.body }} /></details>) : <p>Not published yet.</p>}<button className="text-button" onClick={() => setHistory(null)}>Close history</button></div>}
    {data ? data.length ? data.map(row => { const published = row.published ? JSON.parse(row.published) : null; return <article className="archive-row" key={row.id}><div><span className="role-badge">{published ? 'Published' : 'Private draft'}</span><h4>{row.title}</h4><p>{row.body.slice(0, 160)}{row.body.length > 160 ? '…' : ''}</p>{published && (published.title !== row.title || published.body !== row.body) && <p>Unpublished changes saved.</p>}<p className="fine-print">{row.publishedVersions} published version(s)</p></div><div className="archive-actions"><button className="text-button" disabled={busy || !!editing} onClick={() => { setEditing({ ...row }); setPreview(null); }}>Edit draft</button><button className="text-button" disabled={busy || !!editing} onClick={() => setPreview(row)}>Preview &amp; publish</button>{published && <button className="text-button" disabled={busy} onClick={() => act(row, 'unpublish', 'Disclosure removed from public pages. Its history is kept.')}>Unpublish</button>}<button className="text-button" disabled={busy} onClick={() => showHistory(row)}>Version history</button></div></article>; }) : !editing && <p>No disclosures yet. Choose New disclosure to write a draft.</p> : !error && <p role="status">Loading disclosures…</p>}</section>;
}
