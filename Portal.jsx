import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import logo from './assets/svbt_logo.png';

const API_BASE = '/api';

const Portal = () => {
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [statement, setStatement] = useState(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // moderator / staff state
  const [isAdmin, setIsAdmin] = useState(false);
  const [modPin, setModPin] = useState('');
  const [adminTransactions, setAdminTransactions] = useState([]);
  const [adminPin, setAdminPin] = useState('');

  // interbank state
  const [ibTransfer, setIbTransfer] = useState({ toAccountId: '', amount: '', description: '', pin: '' });
  const [ibResults, setIbResults] = useState([]);
  const [ibLoading, setIbLoading] = useState(false);
  const [ibPending, setIbPending] = useState([]);
  const [ibApprovePin, setIbApprovePin] = useState('');

  // initialize — verify the render token
  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      initUser(token);
    }
  }, [searchParams]);

  const api = useCallback(async (path, opts = {}) => {
    const headers = { 'Content-Type': 'application/json', ...opts.headers };
    const token = searchParams.get('token');
    if (token) headers['X-Render-Token'] = token;
    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
    return json;
  }, [searchParams]);

  const initUser = async (token) => {
    try {
      const data = await api('/init', { method: 'POST', body: JSON.stringify({ token }) });
      setUser(data.user);
      setIsAdmin(data.admin);
      setStatement(data.statement);
      setIbResults(data.recentTransfers || []);
      if (data.adminTransactions) setAdminTransactions(data.adminTransactions);
      if (data.pendingTransfers) setIbPending(data.pendingTransfers);
    } catch (err) {
      setError(err.message || 'Failed to load account');
    } finally {
      setLoading(false);
    }
  };

  // pin-protected transaction
  const submitTransaction = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      const result = await api('/transaction', { method: 'POST', body: JSON.stringify({ pin }) });
      setSuccess(`Transaction complete. Reference: ${result.ref}`);
      setStatement(result.statement);
      setPin('');
    } catch (err) {
      setError(err.message);
    }
  };

  // interbank transfer
  const submitInterbank = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIbLoading(true);
    try {
      const result = await api('/interbank/initiate', {
        method: 'POST',
        body: JSON.stringify({ ...ibTransfer, amount: parseFloat(ibTransfer.amount) }),
      });
      setSuccess(`Transfer initiated. Reference: ${result.ref}. Awaiting moderator approval.`);
      setIbTransfer({ toAccountId: '', amount: '', description: '', pin: '' });
      setIbPending(prev => [...prev, result.transfer]);
    } catch (err) {
      setError(err.message);
    } finally {
      setIbLoading(false);
    }
  };

  // moderator: approve / reject
  const modAction = async (transferId, action) => {
    setError('');
    try {
      const result = await api(`/interbank/${transferId}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ approvalPin: ibApprovePin }),
      });
      setSuccess(result.message);
      setIbPending(prev => prev.filter(t => t.id !== transferId));
      setAdminTransactions(prev => [result.transfer, ...prev]);
      setIbApprovePin('');
    } catch (err) {
      setError(err.message);
    }
  };

  // moderate: refresh pending
  const refreshPending = async () => {
    try {
      const data = await api('/interbank/all');
      setIbPending(data.pending || []);
      setAdminTransactions(data.recent || []);
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <div className="portal-loading">
        <img src={logo} alt="SVBT" className="logo" />
        <p>Loading your account…</p>
      </div>
    );
  }

  return (
    <div className="portal">
      <header className="portal-header">
        <img src={logo} alt="SVBT" className="logo" />
        <div className="user-info">
          {user && (
            <span>
              {user.firstName} {user.lastName} — {user.accountType}
            </span>
          )}
        </div>
      </header>

      <nav className="portal-tabs">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>
          Overview
        </button>
        <button className={tab === 'transaction' ? 'active' : ''} onClick={() => setTab('transaction')}>
          Transaction
        </button>
        <button className={tab === 'Bank Transfer' ? 'active' : ''} onClick={() => setTab('Bank Transfer')}>
          Bank Transfer
        </button>
        {isAdmin && (
          <button className={tab === 'moderator' ? 'active' : ''} onClick={() => setTab('moderator')}>
            Moderator
          </button>
        )}
      </nav>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Overview */}
      {tab === 'overview' && statement && (
        <div className="statement">
          <h2>Account Statement</h2>
          <div className="balance-row">
            <span>Available Balance:</span>
            <strong>${parseFloat(statement.available).toFixed(2)}</strong>
          </div>
          <div className="balance-row">
            <span>Current Balance:</span>
            <strong>${parseFloat(statement.current).toFixed(2)}</strong>
          </div>
          <div className="balance-row">
            <span>Account:</span>
            <strong>{statement.account}</strong>
          </div>
          <div className="balance-row">
            <span>Routing:</span>
            <strong>{statement.routing}</strong>
          </div>
          <h3>Recent Transactions</h3>
          {statement.transactions && statement.transactions.length > 0 ? (
            <table className="tx-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {statement.transactions.map((tx, i) => (
                  <tr key={i}>
                    <td>{new Date(tx.date).toLocaleDateString()}</td>
                    <td>{tx.description}</td>
                    <td className={parseFloat(tx.amount) < 0 ? 'negative' : 'positive'}>
                      ${parseFloat(tx.amount).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No recent transactions.</p>
          )}
        </div>
      )}

      {/* Transaction */}
      {tab === 'transaction' && (
        <form onSubmit={submitTransaction} className="tx-form">
          <h2>Run Your Statement Transaction</h2>
          <label>
            Transaction PIN
            <input
              type="password"
              value={pin}
              onChange={e => setPin(e.target.value)}
              placeholder="Enter your 6-digit PIN"
              maxLength={6}
              required
            />
          </label>
          <button type="submit">Submit Transaction</button>
        </form>
      )}

      {/* Bank Transfer (interbank) */}
      {tab === 'Bank Transfer' && (
        <div className="interbank-section">
          <h2>Interbank Transfer</h2>
          <form onSubmit={submitInterbank} className="ib-form">
            <label>
              To Account ID
              <input
                type="text"
                value={ibTransfer.toAccountId}
                onChange={e => setIbTransfer({ ...ibTransfer, toAccountId: e.target.value })}
                placeholder="Destination account ID"
                required
              />
            </label>
            <label>
              Amount ($)
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={ibTransfer.amount}
                onChange={e => setIbTransfer({ ...ibTransfer, amount: e.target.value })}
                placeholder="Amount"
                required
              />
            </label>
            <label>
              Description
              <input
                type="text"
                value={ibTransfer.description}
                onChange={e => setIbTransfer({ ...ibTransfer, description: e.target.value })}
                placeholder="What's this for?"
              />
            </label>
            <label>
              Transaction PIN
              <input
                type="password"
                value={ibTransfer.pin}
                onChange={e => setIbTransfer({ ...ibTransfer, pin: e.target.value })}
                placeholder="Your 6-digit PIN"
                maxLength={6}
                required
              />
            </label>
            <button type="submit" disabled={ibLoading}>
              {ibLoading ? 'Initiating…' : 'Initiate Transfer'}
            </button>
          </form>

          <h3>Your Recent Interbank Transfers</h3>
          {ibResults.length > 0 ? (
            <table className="tx-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>To Account</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {ibResults.map((tx, i) => (
                  <tr key={i}>
                    <td>{tx.ref}</td>
                    <td>{tx.toAccount}</td>
                    <td>${parseFloat(tx.amount).toFixed(2)}</td>
                    <td>{tx.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No interbank transfers yet.</p>
          )}
        </div>
      )}

      {/* Moderator */}
      {tab === 'moderator' && isAdmin && (
        <div className="moderator-section">
          <h2>Moderator — Interbank Approvals</h2>
          <button className="refresh-btn" onClick={refreshPending}>Refresh</button>
          {ibPending.length > 0 ? (
            <table className="tx-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Amount</th>
                  <th>Description</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {ibPending.map(tx => (
                  <tr key={tx.id}>
                    <td>{tx.ref}</td>
                    <td>{tx.fromAccount}</td>
                    <td>{tx.toAccount}</td>
                    <td>${parseFloat(tx.amount).toFixed(2)}</td>
                    <td>{tx.description}</td>
                    <td>
                      <button
                        className="approve-btn"
                        onClick={() => modAction(tx.id, 'approve')}
                      >
                        Approve
                      </button>
                      <button
                        className="reject-btn"
                        onClick={() => modAction(tx.id, 'reject')}
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No pending transfers.</p>
          )}

          <h3>Recently Processed</h3>
          {adminTransactions.length > 0 ? (
            <table className="tx-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {adminTransactions.slice(0, 20).map((tx, i) => (
                  <tr key={i}>
                    <td>{tx.ref}</td>
                    <td>${parseFloat(tx.amount).toFixed(2)}</td>
                    <td>{tx.status}</td>
                    <td>{tx.date ? new Date(tx.date).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No processed transfers yet.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default Portal;
