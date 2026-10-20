const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const services = require('./services');

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIGURATION ---
const config = {
  bankName: "Silicon Valley Bank and Trust",
  frn: "24735",
  insurer: "FDIC", // Correct for savings associations
  headquarters: "3003 Tasman Dr, Santa Clara, CA 95054",
  frontend: true,
  settlement: {
    bank: "Bank of America, N.A.",
    electronicRouting: "026009593", // ABA for BofA
    paperRouting: "121000358",
    account: "325223276370"
  }
};

// --- ROUTES ---

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    bank: config.bankName,
    settlementBank: config.settlement.bank
  });
});

// Init Session
app.post('/api/init', async (req, res) => {
  try {
    const token = req.headers['x-render-token'];
    if (!token) return res.status(401).json({ error: 'Missing token' });

    // Mock user retrieval
    const user = await services.getUserByToken(token, db);
    if (!user) {
      // Guest session for demo/setup phase
      const newUser = { id: `guest-${Date.now()}`, name: 'Guest User' };
      return res.json({ 
        user: newUser, 
        bankInfo: config,
        // Explicitly send settlement info to client
        settlement: config.settlement 
      });
    }

    res.json({ 
      user, 
      bankInfo: config,
      settlement: config.settlement
    });
  } catch (e) {
    console.error('Init error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Interbank Transfer Initiation
app.post('/api/interbank/initiate', async (req, res) => {
  try {
    const { toAccountId, amount, description } = req.body;
    const fromAccountId = req.headers['x-render-token'];

    if (!toAccountId || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Pass settlement details to the service layer
    const transfer = await services.createInterbankTransfer(db, {
      fromAccountId,
      toAccountId,
      amount: amt,
      description: description || 'Transfer',
      status: 'pending_review',
      bank: config.bankName,
      settlementRouting: config.settlement.electronicRouting,
      settlementAccount: config.settlement.account
    });

    res.json({ success: true, transferId: transfer.id });

  } catch (e) {
    console.error('Transfer error:', e);
    res.status(500).json({ error: 'Failed to initiate transfer' });
  }
});

// Get Pending Transfers
app.get('/api/interbank/all', async (req, res) => {
  try {
    const pending = await services.getPendingTransfers(db);
    const recent = await services.getRecentTransfers(db);
    res.json({ pending, recent });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch transfers' });
  }
});

// Serve Frontend
if (config.frontend) {
  app.use(express.static(path.join(__dirname, '../dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`${config.bankName} API (Settlement: ${config.settlement.bank}) running on port ${PORT}`);
});

module.exports = app;
