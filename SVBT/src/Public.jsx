import { useEffect, useState } from 'react';

export const KIND_LABELS = { reit: 'Real estate investment trust', 'land-development': 'Land development', 'data-center': 'Data center', startup: 'Startup technology', other: 'Other' };

// Published-only public records. Drafts, private notes and financial targets never reach these endpoints.
export function usePublic(path) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api${path}`, { signal: controller.signal, cache: 'no-store' }).then(r => r.ok ? r.json() : []).then(setRows).catch(() => {});
    return () => controller.abort();
  }, [path]);
  return rows;
}

export function InvestmentCard({ item }) {
  return <article className="panel project-card"><span className="eyebrow">{(KIND_LABELS[item.kind] || 'Opportunity').toUpperCase()}</span><h3>{item.title}</h3><p>{item.summary}</p>{item.description && <details><summary>Read details</summary><p className="project-description">{item.description}</p></details>}{item.risk && <p className="risk"><strong>Risk:</strong> {item.risk}</p>}</article>;
}

export function PublicInvestments({ onDisclosures }) {
  const items = usePublic('/investments');
  if (!items.length) return null;
  return <section id="opportunities" className="section"><div className="section-heading"><div><span className="eyebrow">OPPORTUNITIES</span><h2>Current opportunities.</h2></div><p>Projects the operator has chosen to describe publicly.</p></div><div className="project-grid">{items.map(item => <InvestmentCard key={item.id} item={item} />)}</div><p className="fine-print">Informational descriptions only. Not investment advice, a financing commitment, a guarantee of returns or an offer of securities. Investment involves risk, including loss of capital.{onDisclosures && <> <button className="text-button" onClick={onDisclosures}>Read important disclosures ↗</button></>}</p></section>;
}

export function DisclosureText({ disclosure }) {
  return <article className="disclosure-text"><h3>{disclosure.title}</h3>{disclosure.body.split(/\n{2,}/).map((paragraph, i) => <p key={i}>{paragraph}</p>)}{disclosure.publishedAt && <p className="fine-print">Published {new Date(disclosure.publishedAt).toLocaleDateString()}</p>}</article>;
}

// Single-use password setup/reset link: /#set-password=TOKEN
export function SetPassword({ token, api, ready, onDone }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    api('/password/describe', { method: 'POST', body: JSON.stringify({ token }) }).then(result => active && setInfo(result)).catch(e => active && setError(e.message));
    return () => { active = false; };
  }, [token, api, ready]);
  async function submit(e) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    if (values.password !== values.confirmPassword) { setError('Passwords must match.'); return; }
    setBusy(true); setError('');
    try { await api('/password/set', { method: 'POST', body: JSON.stringify({ token, password: values.password }) }); setDone(true); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  if (done) return <><p className="success" role="status">Password saved. You can now sign in.</p><button className="button" onClick={() => onDone(true)}>Sign in ↗</button></>;
  return <>{!info && !error && <p role="status">Checking your link…</p>}{info && <p>{info.purpose === 'setup' ? 'Welcome. Choose a password' : 'Choose a new password'} for <strong>{info.email}</strong>. This link works once and expires {new Date(info.expiresAt).toLocaleString()}.</p>}{error && <div className="error" role="alert">{error}</div>}{info && <form onSubmit={submit}><label>New password<input name="password" type="password" required minLength={12} autoComplete="new-password" /></label><small>Use at least 12 characters.</small><label>Confirm password<input name="confirmPassword" type="password" required minLength={12} autoComplete="new-password" /></label><button className="button" disabled={busy}>{busy ? 'Saving…' : 'Save password ↗'}</button></form>}</>;
}
